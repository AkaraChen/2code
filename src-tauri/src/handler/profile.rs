use tauri::State;

use crate::error::{AppError, AppResult};
use crate::infra::db::DbPool;
use crate::model::profile::Profile;

#[tauri::command]
pub fn create_profile(
	project_id: String,
	branch_name: String,
	state: State<'_, DbPool>,
) -> AppResult<Profile> {
	let conn = &mut *state.lock().map_err(|_| AppError::LockError)?;
	crate::service::profile::create(conn, &project_id, &branch_name)
}

#[tauri::command]
pub fn list_profiles(
	project_id: String,
	state: State<'_, DbPool>,
) -> AppResult<Vec<Profile>> {
	let conn = &mut *state.lock().map_err(|_| AppError::LockError)?;
	crate::service::profile::list(conn, &project_id)
}

#[tauri::command]
pub fn get_profile(id: String, state: State<'_, DbPool>) -> AppResult<Profile> {
	let conn = &mut *state.lock().map_err(|_| AppError::LockError)?;
	crate::service::profile::get(conn, &id)
}

#[tauri::command]
pub fn update_profile(
	id: String,
	branch_name: Option<String>,
	state: State<'_, DbPool>,
) -> AppResult<Profile> {
	let conn = &mut *state.lock().map_err(|_| AppError::LockError)?;
	crate::service::profile::update(conn, &id, branch_name)
}

#[tauri::command]
pub fn delete_profile(id: String, state: State<'_, DbPool>) -> AppResult<()> {
	let conn = &mut *state.lock().map_err(|_| AppError::LockError)?;
	crate::service::profile::delete(conn, &id)
}
