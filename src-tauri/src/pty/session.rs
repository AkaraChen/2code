use std::collections::HashMap;
use std::io::Write;
use std::sync::{Arc, Mutex};

use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};

use crate::error::{AppError, AppResult};

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
	shell: &str,
	rows: u16,
	cols: u16,
) -> AppResult<(String, Box<dyn std::io::Read + Send>)> {
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

	let session_id = uuid::Uuid::new_v4().to_string();

	let session = PtySession {
		master: pair.master,
		writer,
		child,
	};

	sessions
		.lock()
		.map_err(|_| AppError::LockError)?
		.insert(session_id.clone(), session);

	// Drop the slave to avoid blocking
	drop(pair.slave);

	Ok((session_id, reader))
}

pub fn write_to_pty(sessions: &PtySessionMap, session_id: &str, data: &[u8]) -> AppResult<()> {
	let mut map = sessions.lock().map_err(|_| AppError::LockError)?;
	let session = map
		.get_mut(session_id)
		.ok_or_else(|| AppError::PtyError(format!("Session not found: {}", session_id)))?;

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
) -> AppResult<()> {
	let map = sessions.lock().map_err(|_| AppError::LockError)?;
	let session = map
		.get(session_id)
		.ok_or_else(|| AppError::PtyError(format!("Session not found: {}", session_id)))?;

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

pub fn close_session(sessions: &PtySessionMap, session_id: &str) -> AppResult<()> {
	let mut map = sessions.lock().map_err(|_| AppError::LockError)?;
	if let Some(mut session) = map.remove(session_id) {
		let _ = session.child.kill();
	}
	Ok(())
}
