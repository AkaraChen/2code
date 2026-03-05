use std::collections::HashMap;
use std::io::Write;
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;

use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};

use model::error::AppError;

pub struct PtySession {
	pub master: Box<dyn MasterPty + Send>,
	pub writer: Box<dyn Write + Send>,
	pub child: Box<dyn portable_pty::Child + Send + Sync>,
}

pub type PtySessionMap = Arc<Mutex<HashMap<String, PtySession>>>;
/// Tracks background PTY read thread handles so they can be joined on exit,
/// ensuring persistence threads flush their output buffers before the process terminates.
pub type PtyReadThreads = Arc<Mutex<Vec<JoinHandle<()>>>>;

pub fn create_session_map() -> PtySessionMap {
	Arc::new(Mutex::new(HashMap::new()))
}

pub fn create_thread_tracker() -> PtyReadThreads {
	Arc::new(Mutex::new(Vec::new()))
}

/// Join all tracked read threads, blocking until they complete.
/// This ensures each read thread's persistence sub-thread flushes its output buffer.
pub fn join_all_read_threads(threads: &PtyReadThreads) {
	let handles: Vec<JoinHandle<()>> = {
		let Ok(mut guard) = threads.lock() else {
			return;
		};
		guard.drain(..).collect()
	};

	for handle in handles {
		let _ = handle.join();
	}
}

/// Configuration for spawning a new PTY session.
pub struct PtySessionConfig<'a> {
	pub shell: &'a str,
	pub cwd: &'a str,
	pub rows: u16,
	pub cols: u16,
	pub init_dir: Option<&'a std::path::Path>,
	pub helper_url: Option<&'a str>,
	pub helper_bin: Option<&'a str>,
}

pub fn create_session(
	sessions: &PtySessionMap,
	session_id: &str,
	config: &PtySessionConfig<'_>,
) -> Result<Box<dyn std::io::Read + Send>, AppError> {
	let pty_system = native_pty_system();

	let pair = pty_system
		.openpty(PtySize {
			rows: config.rows,
			cols: config.cols,
			pixel_width: 0,
			pixel_height: 0,
		})
		.map_err(|e| AppError::PtyError(e.to_string()))?;

	let mut cmd = CommandBuilder::new(config.shell);
	cmd.env("TERM", "xterm-256color");

	// Inject helper env vars for CLI sidecar communication
	if let Some(url) = config.helper_url {
		cmd.env("_2CODE_HELPER_URL", url);
	}
	if let Some(bin) = config.helper_bin {
		cmd.env("_2CODE_HELPER", bin);
	}
	cmd.env("_2CODE_SESSION_ID", session_id);

	// Inject shell init via ZDOTDIR
	if let Some(dir) = config.init_dir {
		if let Ok(original) = std::env::var("ZDOTDIR") {
			cmd.env("_2CODE_ORIG_ZDOTDIR", &original);
		}
		cmd.env("ZDOTDIR", dir.to_string_lossy().as_ref());
	}

	if !config.cwd.is_empty() {
		cmd.cwd(config.cwd);
	}

	let child = pair
		.slave
		.spawn_command(cmd)
		.map_err(|e| AppError::PtyError(e.to_string()))?;

	let reader = pair
		.master
		.try_clone_reader()
		.map_err(|e| AppError::PtyError(e.to_string()))?;

	let writer = pair
		.master
		.take_writer()
		.map_err(|e| AppError::PtyError(e.to_string()))?;

	let session = PtySession {
		master: pair.master,
		writer,
		child,
	};

	sessions
		.lock()
		.map_err(|_| AppError::LockError)?
		.insert(session_id.to_string(), session);

	// Drop the slave to avoid blocking
	drop(pair.slave);

	Ok(reader)
}

pub fn write_to_pty(
	sessions: &PtySessionMap,
	session_id: &str,
	data: &[u8],
) -> Result<(), AppError> {
	let mut map = sessions.lock().map_err(|_| AppError::LockError)?;
	let session = map.get_mut(session_id).ok_or_else(|| {
		AppError::PtyError(format!("Session not found: {}", session_id))
	})?;

	session
		.writer
		.write_all(data)
		.map_err(|e| AppError::PtyError(e.to_string()))?;
	session
		.writer
		.flush()
		.map_err(|e| AppError::PtyError(e.to_string()))?;

	Ok(())
}

pub fn resize_pty(
	sessions: &PtySessionMap,
	session_id: &str,
	rows: u16,
	cols: u16,
) -> Result<(), AppError> {
	let map = sessions.lock().map_err(|_| AppError::LockError)?;
	let session = map.get(session_id).ok_or_else(|| {
		AppError::PtyError(format!("Session not found: {}", session_id))
	})?;

	session
		.master
		.resize(PtySize {
			rows,
			cols,
			pixel_width: 0,
			pixel_height: 0,
		})
		.map_err(|e| AppError::PtyError(e.to_string()))?;

	Ok(())
}

pub fn close_session(
	sessions: &PtySessionMap,
	session_id: &str,
) -> Result<(), AppError> {
	let mut map = sessions.lock().map_err(|_| AppError::LockError)?;
	if let Some(mut session) = map.remove(session_id) {
		let _ = session.child.kill();
	}
	Ok(())
}

pub fn close_all_sessions(sessions: &PtySessionMap) {
	if let Ok(mut map) = sessions.lock() {
		for (_, mut session) in map.drain() {
			let _ = session.child.kill();
		}
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn create_session_map_starts_empty() {
		let map = create_session_map();
		let inner = map.lock().unwrap();
		assert!(inner.is_empty());
	}

	#[test]
	fn write_to_nonexistent_session_returns_error() {
		let sessions = create_session_map();
		let result = write_to_pty(&sessions, "nonexistent", b"hello");
		assert!(result.is_err());
		let err = result.unwrap_err().to_string();
		assert!(err.contains("Session not found"));
	}

	#[test]
	fn resize_nonexistent_session_returns_error() {
		let sessions = create_session_map();
		let result = resize_pty(&sessions, "nonexistent", 24, 80);
		assert!(result.is_err());
		let err = result.unwrap_err().to_string();
		assert!(err.contains("Session not found"));
	}

	#[test]
	fn close_nonexistent_session_is_ok() {
		let sessions = create_session_map();
		let result = close_session(&sessions, "nonexistent");
		assert!(result.is_ok());
	}

	#[test]
	fn close_all_on_empty_map_no_panic() {
		let sessions = create_session_map();
		close_all_sessions(&sessions); // should not panic
	}

	#[test]
	fn create_thread_tracker_starts_empty() {
		let tracker = create_thread_tracker();
		let inner = tracker.lock().unwrap();
		assert!(inner.is_empty());
	}

	#[test]
	fn join_all_read_threads_with_real_threads() {
		let tracker = create_thread_tracker();
		{
			let mut guard = tracker.lock().unwrap();
			for _ in 0..3 {
				guard.push(std::thread::spawn(|| {}));
			}
			assert_eq!(guard.len(), 3);
		}
		join_all_read_threads(&tracker);
		let guard = tracker.lock().unwrap();
		assert!(guard.is_empty(), "Vec should be drained after join");
	}

	#[test]
	fn join_all_read_threads_empty() {
		let tracker = create_thread_tracker();
		join_all_read_threads(&tracker); // should not panic
	}
}
