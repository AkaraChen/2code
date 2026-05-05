use tauri::State;

use infra::db::DbPool;
use model::error::AppError;
use model::profile::{Profile, ProfileDeleteCheck};

#[tauri::command]
pub async fn create_profile(
	project_id: String,
	branch_name: String,
	state: State<'_, DbPool>,
) -> Result<Profile, AppError> {
	let db = state.inner().clone();
	super::run_blocking(move || {
		let conn = &mut *db.lock().map_err(|_| AppError::LockError)?;
		service::profile::create(conn, &project_id, &branch_name)
	})
	.await
}

#[tauri::command]
pub async fn delete_profile(
	id: String,
	state: State<'_, DbPool>,
) -> Result<(), AppError> {
	let db = state.inner().clone();
	super::run_blocking(move || {
		let conn = &mut *db.lock().map_err(|_| AppError::LockError)?;
		service::profile::delete(conn, &id)
	})
	.await
}

#[tauri::command]
pub async fn get_profile_delete_check(
	id: String,
	state: State<'_, DbPool>,
) -> Result<ProfileDeleteCheck, AppError> {
	let db = state.inner().clone();
	super::run_blocking(move || {
		let conn = &mut *db.lock().map_err(|_| AppError::LockError)?;
		service::profile::delete_check(conn, &id)
	})
	.await
}
