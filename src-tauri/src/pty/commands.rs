use std::io::Read;

use diesel::prelude::*;
use tauri::{AppHandle, Emitter, Manager, State};

use super::models::{NewPtyOutputChunk, NewPtySessionRecord, PtySessionRecord};
use super::session::{self, PtySessionMap};
use crate::db::DbPool;
use crate::error::{AppError, AppResult};
use crate::schema::{pty_output_chunks, pty_sessions};

const FLUSH_THRESHOLD: usize = 32 * 1024; // 32KB
const MAX_OUTPUT_PER_SESSION: usize = 1024 * 1024; // 1MB

#[tauri::command]
pub fn create_pty_session(
	app: AppHandle,
	sessions: State<'_, PtySessionMap>,
	project_id: String,
	title: String,
	shell: String,
	cwd: String,
	rows: u16,
	cols: u16,
) -> AppResult<String> {
	let (session_id, reader) =
		session::create_session(&sessions, &shell, &cwd, rows, cols)?;

	// Insert session record into database
	let db = app.state::<DbPool>().inner().clone();
	{
		let conn = &mut *db.lock().map_err(|_| AppError::LockError)?;
		let new_record = NewPtySessionRecord {
			id: &session_id,
			project_id: &project_id,
			title: &title,
			shell: &shell,
			cwd: &cwd,
		};
		diesel::insert_into(pty_sessions::table)
			.values(&new_record)
			.execute(conn)
			.map_err(|e| AppError::DbError(e.to_string()))?;
	}

	// Spawn a background thread to read PTY output and emit events
	let id = session_id.clone();
	let app_handle = app.clone();
	std::thread::spawn(move || {
		read_pty_output(app_handle, id, reader, db);
	});

	Ok(session_id)
}

fn read_pty_output(
	app: AppHandle,
	session_id: String,
	mut reader: Box<dyn Read + Send>,
	db: DbPool,
) {
	let event_name = format!("pty-output-{}", session_id);
	let exit_event = format!("pty-exit-{}", session_id);
	let mut buf = [0u8; 4096];
	let mut output_buffer: Vec<u8> = Vec::new();
	let mut total_written: usize = 0;

	loop {
		match reader.read(&mut buf) {
			Ok(0) => break,
			Ok(n) => {
				let data = String::from_utf8_lossy(&buf[..n]).to_string();
				if app.emit(&event_name, &data).is_err() {
					break;
				}

				// Buffer output for DB persistence
				output_buffer.extend_from_slice(&buf[..n]);

				if output_buffer.len() >= FLUSH_THRESHOLD {
					flush_output_buffer(
						&db,
						&session_id,
						&mut output_buffer,
						&mut total_written,
					);
				}
			}
			Err(_) => break,
		}
	}

	// Flush remaining buffer on EOF
	if !output_buffer.is_empty() {
		flush_output_buffer(
			&db,
			&session_id,
			&mut output_buffer,
			&mut total_written,
		);
	}

	// Mark session as closed
	mark_session_closed(&db, &session_id);

	let _ = app.emit(&exit_event, ());
}

fn flush_output_buffer(
	db: &DbPool,
	session_id: &str,
	buffer: &mut Vec<u8>,
	total_written: &mut usize,
) {
	let Ok(mut conn) = db.lock() else { return };

	let chunk = NewPtyOutputChunk {
		session_id,
		data: buffer,
	};
	if diesel::insert_into(pty_output_chunks::table)
		.values(&chunk)
		.execute(&mut *conn)
		.is_ok()
	{
		*total_written += buffer.len();
	}
	buffer.clear();

	// Prune oldest chunks if total exceeds cap
	if *total_written > MAX_OUTPUT_PER_SESSION {
		prune_oldest_chunks(&mut conn, session_id, total_written);
	}
}

fn prune_oldest_chunks(
	conn: &mut SqliteConnection,
	session_id: &str,
	total_written: &mut usize,
) {
	// Get all chunk ids and sizes for this session, ordered oldest first
	let chunks: Vec<(Option<i32>, Vec<u8>)> = pty_output_chunks::table
		.filter(pty_output_chunks::session_id.eq(session_id))
		.select((pty_output_chunks::id, pty_output_chunks::data))
		.order(pty_output_chunks::id.asc())
		.load(conn)
		.unwrap_or_default();

	let mut running_total: usize =
		chunks.iter().map(|(_, data)| data.len()).sum();
	for (chunk_id, data) in &chunks {
		if running_total <= MAX_OUTPUT_PER_SESSION {
			break;
		}
		if let Some(cid) = chunk_id {
			let _ = diesel::delete(
				pty_output_chunks::table.filter(pty_output_chunks::id.eq(cid)),
			)
			.execute(conn);
			running_total -= data.len();
		}
	}

	*total_written = running_total;
}

fn mark_session_closed(db: &DbPool, session_id: &str) {
	let Ok(mut conn) = db.lock() else { return };
	let _ = diesel::update(
		pty_sessions::table.filter(pty_sessions::id.eq(session_id)),
	)
	.set(pty_sessions::closed_at.eq(diesel::dsl::now))
	.execute(&mut *conn);
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
	app: AppHandle,
	sessions: State<'_, PtySessionMap>,
	session_id: String,
) -> AppResult<()> {
	session::close_session(&sessions, &session_id)?;

	// Mark session as closed in DB
	let db = app.state::<DbPool>().inner().clone();
	mark_session_closed(&db, &session_id);

	Ok(())
}

#[tauri::command]
pub fn list_pty_sessions(
	project_id: String,
	state: State<'_, DbPool>,
) -> AppResult<Vec<PtySessionRecord>> {
	let conn = &mut *state.lock().map_err(|_| AppError::LockError)?;
	pty_sessions::table
		.filter(pty_sessions::project_id.eq(&project_id))
		.select(PtySessionRecord::as_select())
		.order(pty_sessions::created_at.desc())
		.load(conn)
		.map_err(|e| AppError::DbError(e.to_string()))
}

#[tauri::command]
pub fn get_pty_session_history(
	session_id: String,
	state: State<'_, DbPool>,
) -> AppResult<Vec<u8>> {
	let conn = &mut *state.lock().map_err(|_| AppError::LockError)?;
	let chunks: Vec<Vec<u8>> = pty_output_chunks::table
		.filter(pty_output_chunks::session_id.eq(&session_id))
		.select(pty_output_chunks::data)
		.order(pty_output_chunks::id.asc())
		.load(conn)
		.map_err(|e| AppError::DbError(e.to_string()))?;

	Ok(chunks.into_iter().flatten().collect())
}

#[tauri::command]
pub fn delete_pty_session_record(
	session_id: String,
	state: State<'_, DbPool>,
) -> AppResult<()> {
	let conn = &mut *state.lock().map_err(|_| AppError::LockError)?;
	diesel::delete(
		pty_sessions::table.filter(pty_sessions::id.eq(&session_id)),
	)
	.execute(conn)
	.map_err(|e| AppError::DbError(e.to_string()))?;
	Ok(())
}

/// Mark all open sessions (NULL closed_at) as closed. Called on startup for orphans
/// and on exit for any still-running sessions.
pub fn mark_all_open_sessions_closed(db: &DbPool) {
	let Ok(mut conn) = db.lock() else { return };
	let _ = diesel::update(
		pty_sessions::table
			.filter(pty_sessions::closed_at.is_null()),
	)
	.set(pty_sessions::closed_at.eq(diesel::dsl::now))
	.execute(&mut *conn);
}
