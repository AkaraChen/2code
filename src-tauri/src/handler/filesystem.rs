use std::path::Path;

use tauri::State;

use infra::db::DbPool;
use model::error::AppError;
use model::filesystem::{FileSearchResult, FileTreeGitStatusEntry};

#[tauri::command]
pub async fn list_file_tree_paths(
	path: String,
) -> Result<Vec<String>, AppError> {
	super::run_blocking(move || {
		infra::filesystem::list_file_tree_paths(Path::new(&path))
	})
	.await
}

#[tauri::command]
pub async fn rename_file_tree_path(
	root_path: String,
	source_path: String,
	destination_path: String,
) -> Result<(), AppError> {
	super::run_blocking(move || {
		infra::filesystem::rename_file_tree_path(
			Path::new(&root_path),
			&source_path,
			&destination_path,
		)
	})
	.await
}

#[tauri::command]
pub async fn move_file_tree_paths(
	root_path: String,
	source_paths: Vec<String>,
	target_dir_path: Option<String>,
) -> Result<(), AppError> {
	super::run_blocking(move || {
		infra::filesystem::move_file_tree_paths(
			Path::new(&root_path),
			&source_paths,
			target_dir_path.as_deref(),
		)
	})
	.await
}

#[tauri::command]
pub async fn delete_file_tree_paths(
	root_path: String,
	paths: Vec<String>,
) -> Result<(), AppError> {
	super::run_blocking(move || {
		infra::filesystem::delete_file_tree_paths(Path::new(&root_path), &paths)
	})
	.await
}

#[tauri::command]
pub async fn read_file_content(path: String) -> Result<String, AppError> {
	super::run_blocking(move || {
		let file_path = Path::new(&path);
		if !file_path.exists() {
			return Err(AppError::NotFound(format!("File: {path}")));
		}
		if file_path.is_dir() {
			return Err(AppError::IoError(std::io::Error::other(
				"Path is a directory",
			)));
		}

		let metadata = std::fs::metadata(&path)?;
		if metadata.len() > 1_000_000 {
			return Err(AppError::IoError(std::io::Error::other(
				"File too large (> 1MB)",
			)));
		}

		let bytes = std::fs::read(&path)?;

		// Heuristic binary check: presence of null bytes
		if bytes.contains(&0) {
			return Err(AppError::IoError(std::io::Error::other(
				"Binary file",
			)));
		}

		String::from_utf8(bytes).map_err(|_| {
			AppError::IoError(std::io::Error::other("Invalid UTF-8"))
		})
	})
	.await
}

#[tauri::command]
pub async fn write_file_content(
	path: String,
	content: String,
) -> Result<(), AppError> {
	super::run_blocking(move || {
		let file_path = Path::new(&path);
		if !file_path.exists() {
			return Err(AppError::NotFound(format!("File: {path}")));
		}
		if file_path.is_dir() {
			return Err(AppError::IoError(std::io::Error::other(
				"Path is a directory",
			)));
		}
		if content.len() > 1_000_000 {
			return Err(AppError::IoError(std::io::Error::other(
				"File too large (> 1MB)",
			)));
		}

		std::fs::write(&path, content)?;
		Ok(())
	})
	.await
}

#[tauri::command]
pub async fn search_file(
	profile_id: String,
	query: String,
	state: State<'_, DbPool>,
) -> Result<Vec<FileSearchResult>, AppError> {
	let db = state.inner().clone();
	super::run_blocking(move || {
		let conn = &mut *db.lock().map_err(|_| AppError::LockError)?;
		service::filesystem::search_file(conn, &profile_id, &query)
	})
	.await
}

#[tauri::command]
pub async fn get_file_tree_git_status(
	profile_id: String,
	state: State<'_, DbPool>,
) -> Result<Vec<FileTreeGitStatusEntry>, AppError> {
	let db = state.inner().clone();
	super::run_blocking(move || {
		let conn = &mut *db.lock().map_err(|_| AppError::LockError)?;
		service::filesystem::get_file_tree_git_status(conn, &profile_id)
	})
	.await
}
