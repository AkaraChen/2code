use tauri::State;

use infra::db::{DbPool, DbPoolExt};
use model::error::AppError;
use model::profile::Profile;

#[tauri::command]
pub fn create_profile(
	project_id: String,
	branch_name: String,
	state: State<'_, DbPool>,
) -> Result<Profile, AppError> {
	let conn = &mut *state.conn()?;
	service::profile::create(conn, &project_id, &branch_name)
}

#[tauri::command]
pub fn delete_profile(
	id: String,
	state: State<'_, DbPool>,
) -> Result<(), AppError> {
	let conn = &mut *state.conn()?;
	service::profile::delete(conn, &id)
}
