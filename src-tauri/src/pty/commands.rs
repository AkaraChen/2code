use std::io::Read;

use tauri::{AppHandle, Emitter, State};

use crate::error::AppResult;
use super::session::{self, PtySessionMap};

#[tauri::command]
pub fn create_pty_session(
	app: AppHandle,
	sessions: State<'_, PtySessionMap>,
	shell: String,
	rows: u16,
	cols: u16,
) -> AppResult<String> {
	let (session_id, reader) = session::create_session(&sessions, &shell, rows, cols)?;

	// Spawn a background thread to read PTY output and emit events
	let id = session_id.clone();
	let app_handle = app.clone();
	std::thread::spawn(move || {
		read_pty_output(app_handle, id, reader);
	});

	Ok(session_id)
}

fn read_pty_output(app: AppHandle, session_id: String, mut reader: Box<dyn Read + Send>) {
	let event_name = format!("pty-output-{}", session_id);
	let exit_event = format!("pty-exit-{}", session_id);
	let mut buf = [0u8; 4096];

	loop {
		match reader.read(&mut buf) {
			Ok(0) => break,
			Ok(n) => {
				let data = String::from_utf8_lossy(&buf[..n]).to_string();
				if app.emit(&event_name, &data).is_err() {
					break;
				}
			}
			Err(_) => break,
		}
	}

	let _ = app.emit(&exit_event, ());
}

#[tauri::command]
pub fn write_to_pty(
	sessions: State<'_, PtySessionMap>,
	session_id: String,
	data: String,
) -> AppResult<()> {
	session::write_to_pty(&sessions, &session_id, data.as_bytes())
}

#[tauri::command]
pub fn resize_pty(
	sessions: State<'_, PtySessionMap>,
	session_id: String,
	rows: u16,
	cols: u16,
) -> AppResult<()> {
	session::resize_pty(&sessions, &session_id, rows, cols)
}

#[tauri::command]
pub fn close_pty_session(
	sessions: State<'_, PtySessionMap>,
	session_id: String,
) -> AppResult<()> {
	session::close_session(&sessions, &session_id)
}
