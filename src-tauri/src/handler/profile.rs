use tauri::State;

use crate::error::AppError;
use crate::infra::db::DbPool;
use crate::model::profile::Profile;

#[tauri::command]
pub fn create_profile(
	project_id: String,
	branch_name: String,
	state: State<'_, DbPool>,
) -> Result<Profile, AppError> {
	let conn = &mut *state.lock().map_err(|_| AppError::LockError)?;
	crate::service::profile::create(conn, &project_id, &branch_name)
}

#[tauri::command]
pub fn delete_profile(
	id: String,
	state: State<'_, DbPool>,
) -> Result<(), AppError> {
	let conn = &mut *state.lock().map_err(|_| AppError::LockError)?;
	crate::service::profile::delete(conn, &id)
}
