use std::io::Read;
use std::path::Path;
use std::sync::Arc;

use infra::pty::{self as session, PtyReadThreads, PtySessionMap};
use model::error::AppError;
use model::quick_task::QuickTaskPtyEvent;

use crate::QuickTaskEventSender;

pub fn start_session(
	sessions: PtySessionMap,
	read_threads: PtyReadThreads,
	sender: Arc<dyn QuickTaskEventSender>,
	run_id: String,
	shell: String,
	cwd: String,
	command: String,
	rows: u16,
	cols: u16,
) -> Result<(), AppError> {
	if command.trim().is_empty() {
		return Err(AppError::PtyError(
			"Quick task command cannot be empty".to_string(),
		));
	}

	let cwd_path = Path::new(&cwd);
	if !cwd_path.exists() || !cwd_path.is_dir() {
		return Err(AppError::NotFound(format!("Quick task cwd: {cwd}")));
	}

	{
		let map = sessions.lock().map_err(|_| AppError::LockError)?;
		if map.contains_key(&run_id) {
			return Err(AppError::PtyError(format!(
				"Quick task run already exists: {run_id}"
			)));
		}
	}

	let args = vec!["-lc".to_string(), command];
	let reader = session::create_session_with_args(
		&sessions,
		&run_id,
		&shell,
		&args,
		&cwd,
		rows.max(1),
		cols.max(1),
		None,
		None,
		None,
	)?;

	let reader_sessions = sessions.clone();
	let reader_run_id = run_id.clone();
	let handle = std::thread::spawn(move || {
		read_quick_task_output(sender, reader_sessions, reader_run_id, reader);
	});

	if let Ok(mut guard) = read_threads.lock() {
		guard.push(handle);
	}

	tracing::info!(
		target: "quick_task",
		%run_id,
		%cwd,
		%shell,
		"quick task PTY started"
	);

	Ok(())
}

pub fn write_to_session(
	sessions: &PtySessionMap,
	run_id: &str,
	data: &str,
) -> Result<(), AppError> {
	session::write_to_pty(sessions, run_id, data.as_bytes())
}

pub fn resize_session(
	sessions: &PtySessionMap,
	run_id: &str,
	rows: u16,
	cols: u16,
) -> Result<(), AppError> {
	session::resize_pty(sessions, run_id, rows.max(1), cols.max(1))
}

pub fn stop_session(
	sessions: &PtySessionMap,
	run_id: &str,
) -> Result<(), AppError> {
	session::close_session(sessions, run_id)
}

fn read_quick_task_output(
	sender: Arc<dyn QuickTaskEventSender>,
	sessions: PtySessionMap,
	run_id: String,
	mut reader: Box<dyn Read + Send>,
) {
	let mut buf = [0u8; 4096];
	let mut utf8_remainder: Vec<u8> = Vec::new();

	loop {
		match reader.read(&mut buf) {
			Ok(0) => break,
			Ok(n) => {
				let raw = &buf[..n];
				let combined;
				let to_decode: &[u8] = if utf8_remainder.is_empty() {
					raw
				} else {
					utf8_remainder.extend_from_slice(raw);
					combined = std::mem::take(&mut utf8_remainder);
					&combined
				};

				let boundary = crate::pty::find_utf8_boundary(to_decode);
				if boundary > 0 {
					let text = String::from_utf8_lossy(&to_decode[..boundary])
						.to_string();
					if !sender.send(QuickTaskPtyEvent::output(&run_id, text)) {
						break;
					}
				}

				if boundary < to_decode.len() {
					utf8_remainder.extend_from_slice(&to_decode[boundary..]);
				}
			}
			Err(_) => break,
		}
	}

	let _ = session::close_session(&sessions, &run_id);
	let _ = sender.send(QuickTaskPtyEvent::exit(&run_id));
	tracing::info!(target: "quick_task", %run_id, "quick task PTY exited");
}
