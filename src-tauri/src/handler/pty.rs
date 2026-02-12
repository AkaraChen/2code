use tauri::{AppHandle, State};

use crate::error::AppError;
use crate::infra::db::DbPool;
use crate::infra::pty::{self as session, PtySessionMap};
use crate::model::pty::{PtyConfig, PtySessionMeta, PtySessionRecord};

#[tauri::command]
pub fn create_pty_session(
	app: AppHandle,
	sessions: State<'_, PtySessionMap>,
	meta: PtySessionMeta,
	config: PtyConfig,
) -> Result<String, AppError> {
	crate::service::pty::create_session(&app, sessions.inner(), &meta, &config)
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
	session_id: String,
	rows: u16,
	cols: u16,
) -> Result<(), AppError> {
	session::resize_pty(&sessions, &session_id, rows, cols)
}

#[tauri::command]
pub fn close_pty_session(
	app: AppHandle,
	sessions: State<'_, PtySessionMap>,
	session_id: String,
) -> Result<(), AppError> {
	crate::service::pty::close_session(&app, sessions.inner(), &session_id)
}

#[tauri::command]
pub fn list_project_sessions(
	project_id: String,
	state: State<'_, DbPool>,
) -> Result<Vec<PtySessionRecord>, AppError> {
	let conn = &mut *state.lock().map_err(|_| AppError::LockError)?;
	crate::service::pty::list_project_sessions(conn, &project_id)
}

#[tauri::command]
pub fn get_pty_session_history(
	session_id: String,
	state: State<'_, DbPool>,
) -> Result<Vec<u8>, AppError> {
	let conn = &mut *state.lock().map_err(|_| AppError::LockError)?;
	crate::service::pty::get_history(conn, &session_id)
}

#[tauri::command]
pub fn delete_pty_session_record(
	session_id: String,
	state: State<'_, DbPool>,
) -> Result<(), AppError> {
	let conn = &mut *state.lock().map_err(|_| AppError::LockError)?;
	crate::service::pty::delete_session(conn, &session_id)
}
