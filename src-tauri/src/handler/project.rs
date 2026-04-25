use tauri::State;

use infra::db::DbPool;
use infra::git::{Identity, IdentityScope};
use model::error::AppError;
use model::project::{
	GitBinaryPreview, GitCommit, GitDiffStats, Project, ProjectConfig,
	ProjectWithProfiles,
};

#[tauri::command]
pub async fn create_project_temporary(
	name: Option<String>,
	state: State<'_, DbPool>,
) -> Result<Project, AppError> {
	let db = state.inner().clone();
	super::run_blocking(move || {
		let conn = &mut *db.lock().map_err(|_| AppError::LockError)?;
		service::project::create_temporary(conn, name)
	})
	.await
}

#[tauri::command]
pub async fn create_project_from_folder(
	name: String,
	folder: String,
	state: State<'_, DbPool>,
) -> Result<Project, AppError> {
	let db = state.inner().clone();
	super::run_blocking(move || {
		let conn = &mut *db.lock().map_err(|_| AppError::LockError)?;
		service::project::create_from_folder(conn, &name, &folder)
	})
	.await
}

#[tauri::command]
pub async fn list_projects(
	state: State<'_, DbPool>,
) -> Result<Vec<ProjectWithProfiles>, AppError> {
	let db = state.inner().clone();
	super::run_blocking(move || {
		let conn = &mut *db.lock().map_err(|_| AppError::LockError)?;
		service::project::list(conn)
	})
	.await
}

#[tauri::command]
pub async fn update_project(
	id: String,
	name: Option<String>,
	folder: Option<String>,
	state: State<'_, DbPool>,
) -> Result<Project, AppError> {
	let db = state.inner().clone();
	super::run_blocking(move || {
		let conn = &mut *db.lock().map_err(|_| AppError::LockError)?;
		service::project::update(conn, &id, name, folder)
	})
	.await
}

#[tauri::command]
pub async fn get_git_branch(folder: String) -> Result<String, AppError> {
	super::run_blocking(move || service::project::get_branch(&folder)).await
}

// Git handlers below use the two-phase pattern: brief DB lookup to resolve
// profile → folder, then drop the SQLite mutex before running the git op.
// See `service::project::resolve_profile_folder`. This prevents long git
// operations (push/log on large repos) from blocking unrelated DB queries.

async fn resolve_folder(
	db: &DbPool,
	profile_id: String,
) -> Result<String, AppError> {
	let db = db.clone();
	super::run_blocking(move || {
		let conn = &mut *db.lock().map_err(|_| AppError::LockError)?;
		service::project::resolve_profile_folder(conn, &profile_id)
	})
	.await
}

#[tauri::command]
pub async fn get_git_diff(
	profile_id: String,
	state: State<'_, DbPool>,
) -> Result<String, AppError> {
	let folder = resolve_folder(state.inner(), profile_id).await?;
	super::run_blocking(move || service::project::get_diff(&folder)).await
}

#[tauri::command]
pub async fn get_git_diff_stats(
	profile_id: String,
	state: State<'_, DbPool>,
) -> Result<GitDiffStats, AppError> {
	let folder = resolve_folder(state.inner(), profile_id).await?;
	super::run_blocking(move || service::project::get_diff_stats(&folder)).await
}

#[tauri::command]
pub async fn get_git_log(
	profile_id: String,
	limit: Option<u32>,
	state: State<'_, DbPool>,
) -> Result<Vec<GitCommit>, AppError> {
	let folder = resolve_folder(state.inner(), profile_id).await?;
	super::run_blocking(move || {
		service::project::get_log(&folder, limit.unwrap_or(50))
	})
	.await
}

#[tauri::command]
pub async fn get_commit_diff(
	profile_id: String,
	commit_hash: String,
	state: State<'_, DbPool>,
) -> Result<String, AppError> {
	let folder = resolve_folder(state.inner(), profile_id).await?;
	super::run_blocking(move || {
		service::project::get_commit_diff(&folder, &commit_hash)
	})
	.await
}

#[tauri::command]
pub async fn get_git_binary_preview(
	profile_id: String,
	path: String,
	source: String,
	commit_hash: Option<String>,
	state: State<'_, DbPool>,
) -> Result<Option<GitBinaryPreview>, AppError> {
	let folder = resolve_folder(state.inner(), profile_id).await?;
	super::run_blocking(move || {
		service::project::get_binary_preview(
			&folder,
			&path,
			&source,
			commit_hash.as_deref(),
		)
	})
	.await
}

#[tauri::command]
pub async fn commit_git_changes(
	profile_id: String,
	files: Vec<String>,
	message: String,
	body: Option<String>,
	state: State<'_, DbPool>,
) -> Result<String, AppError> {
	let folder = resolve_folder(state.inner(), profile_id).await?;
	super::run_blocking(move || {
		service::project::commit_changes(
			&folder,
			&files,
			&message,
			body.as_deref(),
		)
	})
	.await
}

#[tauri::command]
pub async fn discard_git_file_changes(
	profile_id: String,
	paths: Vec<String>,
	state: State<'_, DbPool>,
) -> Result<(), AppError> {
	let folder = resolve_folder(state.inner(), profile_id).await?;
	super::run_blocking(move || {
		service::project::discard_file_changes(&folder, &paths)
	})
	.await
}

#[tauri::command]
pub async fn get_git_ahead_count(
	profile_id: String,
	state: State<'_, DbPool>,
) -> Result<u32, AppError> {
	let folder = resolve_folder(state.inner(), profile_id).await?;
	super::run_blocking(move || Ok(service::project::get_ahead_count(&folder)))
		.await
}

#[tauri::command]
pub async fn git_push(
	profile_id: String,
	state: State<'_, DbPool>,
) -> Result<(), AppError> {
	let folder = resolve_folder(state.inner(), profile_id).await?;
	super::run_blocking(move || service::project::push(&folder)).await
}

async fn resolve_identity_folders(
	db: &DbPool,
	profile_id: String,
) -> Result<(String, String), AppError> {
	let db = db.clone();
	super::run_blocking(move || {
		let conn = &mut *db.lock().map_err(|_| AppError::LockError)?;
		service::project::resolve_identity_folders(conn, &profile_id)
	})
	.await
}

#[tauri::command]
pub async fn get_git_identity(
	profile_id: String,
	state: State<'_, DbPool>,
) -> Result<Option<Identity>, AppError> {
	let (profile_folder, project_folder) =
		resolve_identity_folders(state.inner(), profile_id).await?;
	super::run_blocking(move || {
		Ok(service::project::resolve_git_identity(
			&profile_folder,
			&project_folder,
		))
	})
	.await
}

#[tauri::command]
pub async fn set_git_identity(
	profile_id: String,
	identity: Identity,
	scope: IdentityScope,
	state: State<'_, DbPool>,
) -> Result<(), AppError> {
	let (profile_folder, project_folder) =
		resolve_identity_folders(state.inner(), profile_id).await?;
	super::run_blocking(move || {
		service::project::set_git_identity(
			&profile_folder,
			&project_folder,
			&identity,
			scope,
		)
	})
	.await
}

#[tauri::command]
pub async fn unset_git_identity(
	profile_id: String,
	scope: IdentityScope,
	state: State<'_, DbPool>,
) -> Result<(), AppError> {
	let (profile_folder, project_folder) =
		resolve_identity_folders(state.inner(), profile_id).await?;
	super::run_blocking(move || {
		service::project::unset_git_identity(
			&profile_folder,
			&project_folder,
			scope,
		)
	})
	.await
}

#[tauri::command]
pub async fn delete_project(
	id: String,
	state: State<'_, DbPool>,
) -> Result<(), AppError> {
	let db = state.inner().clone();
	super::run_blocking(move || {
		let conn = &mut *db.lock().map_err(|_| AppError::LockError)?;
		service::project::delete(conn, &id)
	})
	.await
}

#[tauri::command]
pub async fn get_project_config(
	project_id: String,
	state: State<'_, DbPool>,
) -> Result<ProjectConfig, AppError> {
	let db = state.inner().clone();
	super::run_blocking(move || {
		let conn = &mut *db.lock().map_err(|_| AppError::LockError)?;
		let project = repo::project::find_by_id(conn, &project_id)?;
		infra::config::load_project_config(&project.folder)
	})
	.await
}

#[tauri::command]
pub async fn save_project_config(
	project_id: String,
	config: ProjectConfig,
	state: State<'_, DbPool>,
) -> Result<(), AppError> {
	let db = state.inner().clone();
	super::run_blocking(move || {
		let conn = &mut *db.lock().map_err(|_| AppError::LockError)?;
		let project = repo::project::find_by_id(conn, &project_id)?;
		infra::config::write_project_config(&project.folder, &config)
	})
	.await
}
