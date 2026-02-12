use tauri::{AppHandle, State};

use crate::error::{AppError, AppResult};
use crate::infra::db::DbPool;
use crate::infra::pty::{self as session, PtySessionMap};
use crate::model::pty::{PtyConfig, PtySessionMeta, PtySessionRecord};

#[tauri::command]
pub fn create_pty_session(
	app: AppHandle,
	sessions: State<'_, PtySessionMap>,
	meta: PtySessionMeta,
	config: PtyConfig,
) -> AppResult<String> {
	crate::service::pty::create_session(&app, sessions.inner(), &meta, &config)
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
	crate::service::pty::close_session(&app, sessions.inner(), &session_id)
}

#[tauri::command]
pub fn list_active_sessions(
	project_id: String,
	state: State<'_, DbPool>,
) -> AppResult<Vec<PtySessionRecord>> {
	let conn = &mut *state.lock().map_err(|_| AppError::LockError)?;
	crate::service::pty::list_sessions(conn, &project_id)
}

#[tauri::command]
pub fn get_pty_session_history(
	session_id: String,
	state: State<'_, DbPool>,
) -> AppResult<Vec<u8>> {
	let conn = &mut *state.lock().map_err(|_| AppError::LockError)?;
	crate::service::pty::get_history(conn, &session_id)
}

#[tauri::command]
pub fn delete_pty_session_record(
	session_id: String,
	state: State<'_, DbPool>,
) -> AppResult<()> {
	let conn = &mut *state.lock().map_err(|_| AppError::LockError)?;
	crate::service::pty::delete_session(conn, &session_id)
}
