use tauri::{AppHandle, Manager, State};

use infra::db::DbPool;
use model::error::AppError;
use model::filesystem::{
	FilePreview, FileSearchResult, FileTreeGitStatusEntry, ResolvedFilePath,
};
use service::runtime::RuntimeHandle;

#[tauri::command]
#[tracing::instrument(skip_all)]
pub async fn list_file_tree_child_paths(
	profile_id: String,
	parent_path: Option<String>,
	runtime: State<'_, RuntimeHandle>,
	state: State<'_, DbPool>,
) -> Result<Vec<String>, AppError> {
	let runtime = runtime.inner().clone();
	let db = state.inner().clone();
	super::run_blocking(move || {
		service::filesystem::list_file_tree_child_paths(
			&runtime,
			&db,
			&profile_id,
			parent_path.as_deref(),
		)
	})
	.await
}

#[tauri::command]
#[tracing::instrument(skip_all)]
pub async fn rename_file_tree_path(
	profile_id: String,
	source_path: String,
	destination_path: String,
	runtime: State<'_, RuntimeHandle>,
	state: State<'_, DbPool>,
) -> Result<(), AppError> {
	let runtime = runtime.inner().clone();
	let db = state.inner().clone();
	super::run_blocking(move || {
		service::filesystem::rename_file_tree_path(
			&runtime,
			&db,
			&profile_id,
			&source_path,
			&destination_path,
		)
	})
	.await
}

#[tauri::command]
#[tracing::instrument(skip_all)]
pub async fn move_file_tree_paths(
	profile_id: String,
	source_paths: Vec<String>,
	target_dir_path: Option<String>,
	runtime: State<'_, RuntimeHandle>,
	state: State<'_, DbPool>,
) -> Result<(), AppError> {
	let runtime = runtime.inner().clone();
	let db = state.inner().clone();
	super::run_blocking(move || {
		service::filesystem::move_file_tree_paths(
			&runtime,
			&db,
			&profile_id,
			&source_paths,
			target_dir_path.as_deref(),
		)
	})
	.await
}

#[tauri::command]
#[tracing::instrument(skip_all)]
pub async fn delete_file_tree_paths(
	profile_id: String,
	paths: Vec<String>,
	runtime: State<'_, RuntimeHandle>,
	state: State<'_, DbPool>,
) -> Result<(), AppError> {
	let runtime = runtime.inner().clone();
	let db = state.inner().clone();
	super::run_blocking(move || {
		service::filesystem::delete_file_tree_paths(
			&runtime,
			&db,
			&profile_id,
			&paths,
		)
	})
	.await
}

#[tauri::command]
#[tracing::instrument(skip_all)]
pub async fn create_file_tree_path(
	profile_id: String,
	path: String,
	kind: String,
	runtime: State<'_, RuntimeHandle>,
	state: State<'_, DbPool>,
) -> Result<(), AppError> {
	let runtime = runtime.inner().clone();
	let db = state.inner().clone();
	super::run_blocking(move || {
		service::filesystem::create_file_tree_path(
			&runtime,
			&db,
			&profile_id,
			&path,
			&kind,
		)
	})
	.await
}

#[tauri::command]
#[tracing::instrument(skip_all)]
pub async fn reveal_path_in_file_manager(
	profile_id: String,
	path: Option<String>,
	runtime: State<'_, RuntimeHandle>,
	state: State<'_, DbPool>,
) -> Result<(), AppError> {
	let runtime = runtime.inner().clone();
	let db = state.inner().clone();
	super::run_blocking(move || {
		service::filesystem::reveal_path_in_file_manager(
			&runtime,
			&db,
			&profile_id,
			path.as_deref(),
		)
	})
	.await
}

#[tauri::command]
#[tracing::instrument(skip_all)]
pub async fn open_path_in_default_app(
	profile_id: String,
	path: String,
	runtime: State<'_, RuntimeHandle>,
	state: State<'_, DbPool>,
) -> Result<(), AppError> {
	let runtime = runtime.inner().clone();
	let db = state.inner().clone();
	super::run_blocking(move || {
		service::filesystem::open_path_in_default_app(
			&runtime,
			&db,
			&profile_id,
			&path,
		)
	})
	.await
}

#[tauri::command]
#[tracing::instrument(skip_all)]
pub async fn read_file_content(
	profile_id: String,
	path: String,
	runtime: State<'_, RuntimeHandle>,
	state: State<'_, DbPool>,
) -> Result<String, AppError> {
	let runtime = runtime.inner().clone();
	let db = state.inner().clone();
	super::run_blocking(move || {
		service::filesystem::read_file_content(
			&runtime,
			&db,
			&profile_id,
			&path,
		)
	})
	.await
}

#[tauri::command]
#[tracing::instrument(skip_all)]
pub async fn write_file_content(
	profile_id: String,
	path: String,
	content: String,
	runtime: State<'_, RuntimeHandle>,
	state: State<'_, DbPool>,
) -> Result<(), AppError> {
	let runtime = runtime.inner().clone();
	let db = state.inner().clone();
	super::run_blocking(move || {
		service::filesystem::write_file_content(
			&runtime,
			&db,
			&profile_id,
			&path,
			&content,
		)
	})
	.await
}

#[tauri::command]
#[tracing::instrument(skip_all)]
pub async fn get_file_preview(
	profile_id: String,
	path: String,
	app: AppHandle,
	runtime: State<'_, RuntimeHandle>,
	state: State<'_, DbPool>,
) -> Result<FilePreview, AppError> {
	let runtime = runtime.inner().clone();
	let db = state.inner().clone();
	let app_cache_root = app
		.path()
		.app_cache_dir()
		.map_err(|err| AppError::IoError(std::io::Error::other(err)))?;
	let file_cache_root = app_cache_root.join("file-preview");
	let office_cache_root = app_cache_root.join("office-preview");

	super::run_blocking(move || {
		service::filesystem::get_file_preview(
			&runtime,
			&db,
			&profile_id,
			&path,
			&file_cache_root,
			&office_cache_root,
		)
	})
	.await
}

#[tauri::command]
#[tracing::instrument(skip_all)]
pub async fn search_file(
	profile_id: String,
	query: String,
	runtime: State<'_, RuntimeHandle>,
	state: State<'_, DbPool>,
) -> Result<Vec<FileSearchResult>, AppError> {
	let runtime = runtime.inner().clone();
	let db = state.inner().clone();
	super::run_blocking(move || {
		service::filesystem::search_file_for_profile(
			&runtime,
			&db,
			&profile_id,
			&query,
		)
	})
	.await
}

#[tauri::command]
#[tracing::instrument(skip_all)]
pub async fn get_file_tree_git_status(
	profile_id: String,
	runtime: State<'_, RuntimeHandle>,
	state: State<'_, DbPool>,
) -> Result<Vec<FileTreeGitStatusEntry>, AppError> {
	let runtime = runtime.inner().clone();
	let db = state.inner().clone();
	super::run_blocking(move || {
		service::filesystem::get_file_tree_git_status_for_profile(
			&runtime,
			&db,
			&profile_id,
		)
	})
	.await
}

#[tauri::command]
#[tracing::instrument(skip_all)]
pub async fn resolve_terminal_file_path(
	profile_id: String,
	file_path: String,
	runtime: State<'_, RuntimeHandle>,
	state: State<'_, DbPool>,
) -> Result<ResolvedFilePath, AppError> {
	let runtime = runtime.inner().clone();
	let db = state.inner().clone();
	super::run_blocking(move || {
		service::filesystem::resolve_terminal_file_path(
			&runtime,
			&db,
			&profile_id,
			&file_path,
		)
	})
	.await
}
