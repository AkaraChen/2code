use tauri::{AppHandle, State};

use infra::db::DbPool;
use infra::pty::{self as session, PtySessionMap};
use model::error::AppError;
use model::pty::{PtyConfig, PtySessionMeta, PtySessionRecord, RestoreResult};
use service::pty::PtyFlushSenders;

#[tauri::command]
pub fn create_pty_session(
	app: AppHandle,
	meta: PtySessionMeta,
	config: PtyConfig,
) -> Result<String, AppError> {
	let ctx = crate::bridge::build_pty_context(&app);
	service::pty::create_session(&ctx, &meta, &config)
}

#[tauri::command]
pub fn write_to_pty(
	sessions: State<'_, PtySessionMap>,
	session_id: String,
	data: String,
) -> Result<(), AppError> {
	session::write_to_pty(&sessions, &session_id, data.as_bytes())
}

#[tauri::command]
pub fn resize_pty(
	sessions: State<'_, PtySessionMap>,
	db: State<'_, DbPool>,
	session_id: String,
	rows: u16,
	cols: u16,
) -> Result<(), AppError> {
	session::resize_pty(&sessions, &session_id, rows, cols)?;

	let conn = &mut *db.lock().map_err(|_| AppError::LockError)?;
	repo::pty::update_dimensions(conn, &session_id, cols, rows);

	Ok(())
}

#[tauri::command]
pub fn close_pty_session(
	db: State<'_, DbPool>,
	sessions: State<'_, PtySessionMap>,
	session_id: String,
) -> Result<(), AppError> {
	service::pty::close_session(db.inner(), sessions.inner(), &session_id)
}

#[tauri::command]
pub fn list_project_sessions(
	project_id: String,
	state: State<'_, DbPool>,
) -> Result<Vec<PtySessionRecord>, AppError> {
	let conn = &mut *state.lock().map_err(|_| AppError::LockError)?;
	service::pty::list_project_sessions(conn, &project_id)
}

#[tauri::command]
pub fn get_pty_session_history(
	session_id: String,
	state: State<'_, DbPool>,
) -> Result<Vec<u8>, AppError> {
	let conn = &mut *state.lock().map_err(|_| AppError::LockError)?;
	service::pty::get_history(conn, &session_id)
}

#[tauri::command]
pub fn delete_pty_session_record(
	session_id: String,
	state: State<'_, DbPool>,
) -> Result<(), AppError> {
	let conn = &mut *state.lock().map_err(|_| AppError::LockError)?;
	service::pty::delete_session(conn, &session_id)
}

#[tauri::command]
pub fn restore_pty_session(
	app: AppHandle,
	old_session_id: String,
	meta: PtySessionMeta,
	config: PtyConfig,
) -> Result<RestoreResult, AppError> {
	let ctx = crate::bridge::build_pty_context(&app);
	service::pty::restore_session(&ctx, &old_session_id, &meta, &config)
}

#[tauri::command]
pub fn flush_pty_output(
	session_id: String,
	state: State<'_, PtyFlushSenders>,
) -> Result<(), AppError> {
	service::pty::flush_output(state.inner(), &session_id)
}
