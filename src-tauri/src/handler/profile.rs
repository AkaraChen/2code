use tauri::{AppHandle, State};

use infra::db::DbPool;
use model::error::AppError;
use model::profile::{Profile, ProfileDeleteCheck};

#[tauri::command]
#[tracing::instrument(skip_all)]
pub async fn create_profile(
	project_id: String,
	branch_name: String,
	default_worktree_dir: Option<String>,
	state: State<'_, DbPool>,
) -> Result<Profile, AppError> {
	let db = state.inner().clone();
	super::run_blocking(move || {
		service::profile::create_with_db(
			&db,
			&project_id,
			&branch_name,
			default_worktree_dir.as_deref(),
		)
	})
	.await
}

#[tauri::command]
#[tracing::instrument(skip_all)]
pub async fn delete_profile(
	app: AppHandle,
	id: String,
) -> Result<(), AppError> {
	let ctx = crate::bridge::build_pty_context(&app);
	super::run_blocking(move || {
		service::profile::delete_with_context(&ctx, &id)
	})
	.await
}

#[tauri::command]
#[tracing::instrument(skip_all)]
pub async fn get_profile_delete_check(
	id: String,
	state: State<'_, DbPool>,
) -> Result<ProfileDeleteCheck, AppError> {
	let db = state.inner().clone();
	super::run_blocking(move || {
		service::profile::delete_check_with_db(&db, &id)
	})
	.await
}

#[tauri::command]
#[tracing::instrument(skip_all)]
pub async fn update_profile_notes(
	id: String,
	notes: String,
	state: State<'_, DbPool>,
) -> Result<Profile, AppError> {
	let db = state.inner().clone();
	super::run_blocking(move || {
		let conn = &mut *db.lock().map_err(|_| AppError::LockError)?;
		repo::profile::update_notes(conn, &id, &notes)
	})
	.await
}
