use std::path::Path;

use tauri::State;

use infra::db::DbPool;
use model::error::AppError;
use model::filesystem::{FileSearchResult, FileTreeGitStatusEntry};

fn profile_worktree_path(
	db: &DbPool,
	profile_id: &str,
) -> Result<String, AppError> {
	let conn = &mut *db.lock().map_err(|_| AppError::LockError)?;
	Ok(repo::profile::find_by_id(conn, profile_id)?.worktree_path)
}

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
pub async fn list_file_tree_child_paths(
	root_path: String,
	parent_path: Option<String>,
) -> Result<Vec<String>, AppError> {
	super::run_blocking(move || {
		infra::filesystem::list_file_tree_child_paths(
			Path::new(&root_path),
			parent_path.as_deref(),
		)
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
		let worktree_path = profile_worktree_path(&db, &profile_id)?;
		infra::filesystem::search_files(Path::new(&worktree_path), &query)
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
		let worktree_path = profile_worktree_path(&db, &profile_id)?;
		infra::git::status(&worktree_path)
	})
	.await
}

/// Resolves a (possibly relative) file path against the profile's worktree.
/// Returns the canonical absolute path if the file exists within the worktree,
/// or an error if the path is outside the workspace or doesn't exist.
#[tauri::command]
pub async fn resolve_terminal_file_path(
	profile_id: String,
	file_path: String,
	state: State<'_, DbPool>,
) -> Result<String, AppError> {
	let db = state.inner().clone();
	super::run_blocking(move || {
		let worktree = profile_worktree_path(&db, &profile_id)?;
		let worktree_path = Path::new(&worktree);

		let resolved = if Path::new(&file_path).is_absolute() {
			Path::new(&file_path).to_path_buf()
		} else {
			// Strip leading ./ if present
			let clean = file_path.strip_prefix("./").unwrap_or(&file_path);
			worktree_path.join(clean)
		};

		// Check that the resolved path exists
		if !resolved.exists() {
			return Err(AppError::NotFound(format!("File: {}", file_path)));
		}

		// Canonicalize both paths to compare
		let canonical_resolved = resolved.canonicalize().map_err(|e| {
			AppError::IoError(e)
		})?;
		let canonical_worktree = worktree_path.canonicalize().map_err(|e| {
			AppError::IoError(e)
		})?;

		// Security: ensure the resolved path is within the worktree
		if !canonical_resolved.starts_with(&canonical_worktree) {
			return Err(AppError::IoError(std::io::Error::other(
				"Path is outside the workspace",
			)));
		}

		Ok(canonical_resolved.to_string_lossy().into_owned())
	})
	.await
}

#[cfg(test)]
mod tests {
	use std::sync::{Arc, Mutex};

	use diesel::prelude::*;
	use diesel_migrations::MigrationHarness;
	use model::profile::NewProfile;
	use model::project::NewProject;

	use super::*;

	fn setup_db() -> DbPool {
		let mut conn =
			SqliteConnection::establish(":memory:").expect("in-memory db");
		conn.run_pending_migrations(infra::db::MIGRATIONS)
			.expect("run migrations");

		diesel::insert_into(model::schema::projects::table)
			.values(&NewProject {
				id: "proj-1",
				name: "Project",
				folder: "/repo",
				group_id: None,
			})
			.execute(&mut conn)
			.expect("insert project");

		diesel::insert_into(model::schema::profiles::table)
			.values(&NewProfile {
				id: "profile-1",
				project_id: "proj-1",
				branch_name: "main",
				worktree_path: "/repo/worktree",
				is_default: true,
			})
			.execute(&mut conn)
			.expect("insert profile");

		Arc::new(Mutex::new(conn))
	}

	#[test]
	fn profile_worktree_path_reads_only_the_needed_field() {
		let db = setup_db();

		let worktree = profile_worktree_path(&db, "profile-1").unwrap();

		assert_eq!(worktree, "/repo/worktree");
	}

	#[test]
	fn profile_worktree_path_returns_not_found_for_missing_profile() {
		let db = setup_db();

		let result = profile_worktree_path(&db, "missing-profile");

		assert!(matches!(result, Err(AppError::NotFound(_))));
	}
}
