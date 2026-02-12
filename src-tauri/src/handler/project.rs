use tauri::State;

use crate::error::AppError;
use crate::infra::db::DbPool;
use crate::model::project::{GitCommit, Project, ProjectWithProfiles};

#[tauri::command]
pub fn create_project_temporary(
	name: Option<String>,
	state: State<'_, DbPool>,
) -> Result<Project, AppError> {
	let conn = &mut *state.lock().map_err(|_| AppError::LockError)?;
	crate::service::project::create_temporary(conn, name)
}

#[tauri::command]
pub fn create_project_from_folder(
	name: String,
	folder: String,
	state: State<'_, DbPool>,
) -> Result<Project, AppError> {
	let conn = &mut *state.lock().map_err(|_| AppError::LockError)?;
	crate::service::project::create_from_folder(conn, &name, &folder)
}

#[tauri::command]
pub fn list_projects(
	state: State<'_, DbPool>,
) -> Result<Vec<ProjectWithProfiles>, AppError> {
	let conn = &mut *state.lock().map_err(|_| AppError::LockError)?;
	crate::service::project::list(conn)
}

#[tauri::command]
pub fn update_project(
	id: String,
	name: Option<String>,
	folder: Option<String>,
	state: State<'_, DbPool>,
) -> Result<Project, AppError> {
	let conn = &mut *state.lock().map_err(|_| AppError::LockError)?;
	crate::service::project::update(conn, &id, name, folder)
}

#[tauri::command]
pub fn get_git_branch(folder: String) -> Result<String, AppError> {
	crate::service::project::get_branch(&folder)
}

#[tauri::command]
pub fn get_git_diff(
	profile_id: String,
	state: State<'_, DbPool>,
) -> Result<String, AppError> {
	let conn = &mut *state.lock().map_err(|_| AppError::LockError)?;
	crate::service::project::get_diff(conn, &profile_id)
}

#[tauri::command]
pub fn get_git_log(
	profile_id: String,
	limit: Option<u32>,
	state: State<'_, DbPool>,
) -> Result<Vec<GitCommit>, AppError> {
	let conn = &mut *state.lock().map_err(|_| AppError::LockError)?;
	crate::service::project::get_log(conn, &profile_id, limit.unwrap_or(50))
}

#[tauri::command]
pub fn get_commit_diff(
	profile_id: String,
	commit_hash: String,
	state: State<'_, DbPool>,
) -> Result<String, AppError> {
	let conn = &mut *state.lock().map_err(|_| AppError::LockError)?;
	crate::service::project::get_commit_diff(conn, &profile_id, &commit_hash)
}

#[tauri::command]
pub fn delete_project(
	id: String,
	state: State<'_, DbPool>,
) -> Result<(), AppError> {
	let conn = &mut *state.lock().map_err(|_| AppError::LockError)?;
	crate::service::project::delete(conn, &id)
}
