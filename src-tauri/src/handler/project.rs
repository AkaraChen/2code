use std::collections::HashMap;
use std::sync::Mutex;

use tauri::{AppHandle, Emitter, State};

use infra::db::DbPool;
use infra::git::{
	push_cancellable, watch_git_dir, CancelToken, Identity, IdentityScope,
	WatchHandle,
};
use model::error::AppError;
use model::project::{
	GitBinaryPreview, GitCommit, GitDiffStats, IndexStatus, Project,
	ProjectConfig, ProjectWithProfiles,
};

/// Managed state: live `.git/` watchers keyed by profile_id.
pub type GitWatchers = Mutex<HashMap<String, WatchHandle>>;

pub fn create_git_watchers() -> GitWatchers {
	Mutex::new(HashMap::new())
}

/// Managed state: cancellation tokens for in-flight git operations,
/// keyed by op_id (a uuid the frontend generates per call).
pub type GitCancelTokens = Mutex<HashMap<String, CancelToken>>;

pub fn create_git_cancel_tokens() -> GitCancelTokens {
	Mutex::new(HashMap::new())
}

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
pub async fn get_git_index_status(
	profile_id: String,
	state: State<'_, DbPool>,
) -> Result<IndexStatus, AppError> {
	let folder = resolve_folder(state.inner(), profile_id).await?;
	super::run_blocking(move || service::project::get_index_status(&folder)).await
}

#[tauri::command]
pub async fn stage_git_hunk(
	profile_id: String,
	file_header: String,
	hunks: Vec<String>,
	state: State<'_, DbPool>,
) -> Result<(), AppError> {
	let folder = resolve_folder(state.inner(), profile_id).await?;
	super::run_blocking(move || {
		service::project::stage_hunk(&folder, &file_header, &hunks)
	})
	.await
}

#[tauri::command]
pub async fn unstage_git_hunk(
	profile_id: String,
	file_header: String,
	hunks: Vec<String>,
	state: State<'_, DbPool>,
) -> Result<(), AppError> {
	let folder = resolve_folder(state.inner(), profile_id).await?;
	super::run_blocking(move || {
		service::project::unstage_hunk(&folder, &file_header, &hunks)
	})
	.await
}

#[tauri::command]
pub async fn stage_git_lines(
	profile_id: String,
	file_header: String,
	hunk: String,
	selected_indices: Vec<usize>,
	state: State<'_, DbPool>,
) -> Result<(), AppError> {
	let folder = resolve_folder(state.inner(), profile_id).await?;
	super::run_blocking(move || {
		service::project::stage_lines(&folder, &file_header, &hunk, &selected_indices)
	})
	.await
}

#[tauri::command]
pub async fn unstage_git_lines(
	profile_id: String,
	file_header: String,
	hunk: String,
	selected_indices: Vec<usize>,
	state: State<'_, DbPool>,
) -> Result<(), AppError> {
	let folder = resolve_folder(state.inner(), profile_id).await?;
	super::run_blocking(move || {
		service::project::unstage_lines(&folder, &file_header, &hunk, &selected_indices)
	})
	.await
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

/// Cancellable push. Caller passes an op_id (uuid); they can later call
/// cancel_git_operation(op_id) to abort. Token is removed from the
/// registry when the op completes (success or failure).
#[tauri::command]
pub async fn git_push_cancellable(
	profile_id: String,
	op_id: String,
	state: State<'_, DbPool>,
	tokens: State<'_, GitCancelTokens>,
) -> Result<(), AppError> {
	let folder = resolve_folder(state.inner(), profile_id).await?;

	let token = CancelToken::new();
	{
		let mut map = tokens.lock().map_err(|_| AppError::LockError)?;
		map.insert(op_id.clone(), token.clone());
	}

	let result =
		super::run_blocking(move || push_cancellable(&folder, &token)).await;

	// Clear the token regardless of outcome.
	if let Ok(mut map) = tokens.lock() {
		map.remove(&op_id);
	}

	result
}

/// Signal cancellation for an in-flight op_id. No-op if the op already
/// finished or never registered. Idempotent.
#[tauri::command]
pub async fn cancel_git_operation(
	op_id: String,
	tokens: State<'_, GitCancelTokens>,
) -> Result<(), AppError> {
	let map = tokens.lock().map_err(|_| AppError::LockError)?;
	if let Some(token) = map.get(&op_id) {
		token.cancel();
	}
	Ok(())
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
pub async fn start_git_watcher(
	profile_id: String,
	app: AppHandle,
	state: State<'_, DbPool>,
	watchers: State<'_, GitWatchers>,
) -> Result<(), AppError> {
	let folder = resolve_folder(state.inner(), profile_id.clone()).await?;

	let event_name = format!("git-state-changed-{profile_id}");
	let app_for_cb = app.clone();
	let event_for_cb = event_name.clone();

	let handle = super::run_blocking(move || {
		watch_git_dir(&folder, move || {
			let _ = app_for_cb.emit(&event_for_cb, ());
		})
	})
	.await?;

	let mut map = watchers.lock().map_err(|_| AppError::LockError)?;
	// Replace any existing watcher for this profile (idempotent).
	map.insert(profile_id, handle);
	Ok(())
}

#[tauri::command]
pub async fn stop_git_watcher(
	profile_id: String,
	watchers: State<'_, GitWatchers>,
) -> Result<(), AppError> {
	let mut map = watchers.lock().map_err(|_| AppError::LockError)?;
	map.remove(&profile_id);
	// Drop runs the WatchHandle's stop logic.
	Ok(())
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
