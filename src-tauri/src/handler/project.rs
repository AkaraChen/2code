use tauri::{AppHandle, Manager, State};

use infra::db::DbPool;
use model::error::AppError;
use model::project::{
	GitBinaryPreview, GitBranchInfo, GitCommit, GitDiffSnapshot, GitDiffStats,
	GitPullRequestStatus, Project, ProjectConfig, ProjectSidebarLayoutUpdate,
	ProjectWithProfiles,
};
use model::project_group::ProjectGroup;

#[tauri::command]
#[tracing::instrument(skip_all)]
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
#[tracing::instrument(skip_all)]
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
#[tracing::instrument(skip_all)]
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
#[tracing::instrument(skip_all)]
pub async fn get_git_branch(folder: String) -> Result<String, AppError> {
	super::run_blocking(move || service::project::get_branch(&folder)).await
}

#[tauri::command]
#[tracing::instrument(skip_all)]
pub async fn get_git_diff(
	profile_id: String,
	state: State<'_, DbPool>,
) -> Result<String, AppError> {
	let db = state.inner().clone();
	super::run_blocking(move || service::project::get_diff(&db, &profile_id))
		.await
}

#[tauri::command]
#[tracing::instrument(skip_all)]
pub async fn get_git_diff_snapshot(
	profile_id: String,
	state: State<'_, DbPool>,
) -> Result<GitDiffSnapshot, AppError> {
	let db = state.inner().clone();
	super::run_blocking(move || {
		service::project::get_diff_snapshot(&db, &profile_id)
	})
	.await
}

#[tauri::command]
#[tracing::instrument(skip_all)]
pub async fn get_git_diff_stats(
	profile_id: String,
	state: State<'_, DbPool>,
) -> Result<GitDiffStats, AppError> {
	let db = state.inner().clone();
	super::run_blocking(move || {
		service::project::get_diff_stats(&db, &profile_id)
	})
	.await
}

#[tauri::command]
#[tracing::instrument(skip_all)]
pub async fn get_git_log(
	profile_id: String,
	limit: Option<u32>,
	state: State<'_, DbPool>,
) -> Result<Vec<GitCommit>, AppError> {
	let db = state.inner().clone();
	super::run_blocking(move || {
		service::project::get_log(&db, &profile_id, limit.unwrap_or(50))
	})
	.await
}

#[tauri::command]
#[tracing::instrument(skip_all)]
pub async fn get_commit_diff(
	profile_id: String,
	commit_hash: String,
	state: State<'_, DbPool>,
) -> Result<String, AppError> {
	let db = state.inner().clone();
	super::run_blocking(move || {
		service::project::get_commit_diff(&db, &profile_id, &commit_hash)
	})
	.await
}

#[tauri::command]
#[tracing::instrument(skip_all)]
pub async fn get_git_binary_preview(
	profile_id: String,
	path: String,
	source: String,
	commit_hash: Option<String>,
	app: AppHandle,
	state: State<'_, DbPool>,
) -> Result<Option<GitBinaryPreview>, AppError> {
	let db = state.inner().clone();
	let cache_root = app
		.path()
		.app_cache_dir()
		.map_err(|err| AppError::IoError(std::io::Error::other(err)))?
		.join("git-preview-cache");
	super::run_blocking(move || {
		service::project::get_binary_preview(
			&db,
			&profile_id,
			&cache_root,
			&path,
			&source,
			commit_hash.as_deref(),
		)
	})
	.await
}

#[tauri::command]
#[tracing::instrument(skip_all)]
pub async fn commit_git_changes(
	profile_id: String,
	files: Vec<String>,
	message: String,
	body: Option<String>,
	state: State<'_, DbPool>,
) -> Result<String, AppError> {
	let db = state.inner().clone();
	super::run_blocking(move || {
		service::project::commit_changes(
			&db,
			&profile_id,
			&files,
			&message,
			body.as_deref(),
		)
	})
	.await
}

#[tauri::command]
#[tracing::instrument(skip_all)]
pub async fn discard_git_file_changes(
	profile_id: String,
	paths: Vec<String>,
	state: State<'_, DbPool>,
) -> Result<(), AppError> {
	let db = state.inner().clone();
	super::run_blocking(move || {
		service::project::discard_file_changes(&db, &profile_id, &paths)
	})
	.await
}

#[tauri::command]
#[tracing::instrument(skip_all)]
pub async fn get_git_ahead_count(
	profile_id: String,
	state: State<'_, DbPool>,
) -> Result<u32, AppError> {
	let db = state.inner().clone();
	super::run_blocking(move || {
		service::project::get_ahead_count(&db, &profile_id)
	})
	.await
}

#[tauri::command]
#[tracing::instrument(skip_all)]
pub async fn list_git_branches(
	profile_id: String,
	state: State<'_, DbPool>,
) -> Result<Vec<GitBranchInfo>, AppError> {
	let db = state.inner().clone();
	super::run_blocking(move || {
		service::project::list_branches(&db, &profile_id)
	})
	.await
}

#[tauri::command]
#[tracing::instrument(skip_all)]
pub async fn checkout_git_branch(
	profile_id: String,
	branch: String,
	state: State<'_, DbPool>,
) -> Result<(), AppError> {
	let db = state.inner().clone();
	super::run_blocking(move || {
		service::project::checkout_branch(&db, &profile_id, &branch)
	})
	.await
}

#[tauri::command]
#[tracing::instrument(skip_all)]
pub async fn git_push(
	profile_id: String,
	state: State<'_, DbPool>,
) -> Result<(), AppError> {
	let db = state.inner().clone();
	super::run_blocking(move || service::project::push(&db, &profile_id)).await
}

#[tauri::command]
#[tracing::instrument(skip_all)]
pub async fn get_git_pull_request_status(
	profile_id: String,
	branch_name: Option<String>,
	state: State<'_, DbPool>,
) -> Result<Option<GitPullRequestStatus>, AppError> {
	let db = state.inner().clone();
	super::run_blocking(move || {
		service::project::get_pull_request_status(
			&db,
			&profile_id,
			branch_name.as_deref(),
		)
	})
	.await
}

#[tauri::command]
#[tracing::instrument(skip_all)]
pub async fn delete_project(
	app: AppHandle,
	id: String,
) -> Result<(), AppError> {
	let ctx = crate::bridge::build_pty_context(&app);
	super::run_blocking(move || {
		service::project::delete_with_context(&ctx, &id)
	})
	.await
}

#[tauri::command]
#[tracing::instrument(skip_all)]
pub async fn create_project_group(
	name: String,
	state: State<'_, DbPool>,
) -> Result<ProjectGroup, AppError> {
	let db = state.inner().clone();
	super::run_blocking(move || {
		let conn = &mut *db.lock().map_err(|_| AppError::LockError)?;
		service::project::create_group(conn, &name)
	})
	.await
}

#[tauri::command]
#[tracing::instrument(skip_all)]
pub async fn list_project_groups(
	state: State<'_, DbPool>,
) -> Result<Vec<ProjectGroup>, AppError> {
	let db = state.inner().clone();
	super::run_blocking(move || {
		let conn = &mut *db.lock().map_err(|_| AppError::LockError)?;
		service::project::list_groups(conn)
	})
	.await
}

#[tauri::command]
#[tracing::instrument(skip_all)]
pub async fn assign_project_to_group(
	project_id: String,
	group_id: Option<String>,
	state: State<'_, DbPool>,
) -> Result<Project, AppError> {
	let db = state.inner().clone();
	super::run_blocking(move || {
		let conn = &mut *db.lock().map_err(|_| AppError::LockError)?;
		service::project::assign_to_group(conn, &project_id, group_id)
	})
	.await
}

#[tauri::command]
#[tracing::instrument(skip_all)]
pub async fn update_project_sidebar_layout(
	updates: Vec<ProjectSidebarLayoutUpdate>,
	state: State<'_, DbPool>,
) -> Result<(), AppError> {
	let db = state.inner().clone();
	super::run_blocking(move || {
		let conn = &mut *db.lock().map_err(|_| AppError::LockError)?;
		service::project::update_sidebar_layout(conn, updates)
	})
	.await
}

#[tauri::command]
#[tracing::instrument(skip_all)]
pub async fn get_project_config(
	project_id: String,
	state: State<'_, DbPool>,
) -> Result<ProjectConfig, AppError> {
	let db = state.inner().clone();
	super::run_blocking(move || service::project::get_config(&db, &project_id))
		.await
}

#[tauri::command]
#[tracing::instrument(skip_all)]
pub async fn save_project_config(
	project_id: String,
	config: ProjectConfig,
	state: State<'_, DbPool>,
) -> Result<(), AppError> {
	let db = state.inner().clone();
	super::run_blocking(move || {
		service::project::save_config(&db, &project_id, &config)
	})
	.await
}

#[tauri::command]
#[tracing::instrument(skip_all)]
pub async fn get_project_github_avatar(
	project_id: String,
	state: State<'_, DbPool>,
) -> Result<Option<String>, AppError> {
	let db = state.inner().clone();
	super::run_blocking(move || {
		service::project::get_github_avatar(&db, &project_id)
	})
	.await
}
