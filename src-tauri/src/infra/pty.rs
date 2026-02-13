use std::collections::HashMap;
use std::io::Write;
use std::path::Path;
use std::sync::{Arc, Mutex};

use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};

use crate::error::AppError;

pub struct PtySession {
	pub master: Box<dyn MasterPty + Send>,
	pub writer: Box<dyn Write + Send>,
	pub child: Box<dyn portable_pty::Child + Send + Sync>,
}

pub type PtySessionMap = Arc<Mutex<HashMap<String, PtySession>>>;

pub fn create_session_map() -> PtySessionMap {
	Arc::new(Mutex::new(HashMap::new()))
}

pub fn create_session(
	sessions: &PtySessionMap,
	session_id: &str,
	shell: &str,
	cwd: &str,
	rows: u16,
	cols: u16,
	init_dir: Option<&Path>,
) -> Result<Box<dyn std::io::Read + Send>, AppError> {
	let pty_system = native_pty_system();

	let pair = pty_system
		.openpty(PtySize {
			rows,
			cols,
			pixel_width: 0,
			pixel_height: 0,
		})
		.map_err(|e| AppError::PtyError(e.to_string()))?;

	let mut cmd = CommandBuilder::new(shell);
	cmd.env("TERM", "xterm-256color");

	// Inject shell init via ZDOTDIR
	if let Some(dir) = init_dir {
		if let Ok(original) = std::env::var("ZDOTDIR") {
			cmd.env("_2CODE_ORIG_ZDOTDIR", &original);
		}
		cmd.env("ZDOTDIR", dir.to_string_lossy().as_ref());
	}

	if !cwd.is_empty() {
		cmd.cwd(cwd);
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
}
