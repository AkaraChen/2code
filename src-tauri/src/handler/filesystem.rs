use std::path::Path;

use tauri::State;

use infra::db::DbPool;
use model::error::AppError;
use model::filesystem::{
	FileSearchResult, FileTreeGitStatusEntry, ResolvedFilePath,
};

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
/// Returns either an exact match (canonical absolute path) if the file exists
/// within the worktree, or a list of fuzzy-matched candidates based on the
/// filename when the exact path doesn't exist.
#[tauri::command]
pub async fn resolve_terminal_file_path(
	profile_id: String,
	file_path: String,
	state: State<'_, DbPool>,
) -> Result<ResolvedFilePath, AppError> {
	let db = state.inner().clone();
	super::run_blocking(move || {
		let worktree = profile_worktree_path(&db, &profile_id)?;
		resolve_file_path_in_worktree(Path::new(&worktree), &file_path)
	})
	.await
}

fn resolve_file_path_in_worktree(
	worktree_path: &Path,
	file_path: &str,
) -> Result<ResolvedFilePath, AppError> {
	let requested_path = Path::new(file_path);
	let resolved = if requested_path.is_absolute() {
		requested_path.to_path_buf()
	} else {
		let clean = file_path.strip_prefix("./").unwrap_or(file_path);
		worktree_path.join(clean)
	};

	if resolved.is_file() {
		let canonical_resolved =
			resolved.canonicalize().map_err(AppError::IoError)?;
		let canonical_worktree =
			worktree_path.canonicalize().map_err(AppError::IoError)?;

		if !canonical_resolved.starts_with(&canonical_worktree) {
			return Err(AppError::IoError(std::io::Error::other(
				"Path is outside the workspace",
			)));
		}

		return Ok(ResolvedFilePath::Exact {
			path: canonical_resolved.to_string_lossy().into_owned(),
		});
	}

	let filename = requested_path
		.file_name()
		.map(|value| value.to_string_lossy().into_owned())
		.unwrap_or_else(|| file_path.to_string());
	let candidates = infra::filesystem::search_files(worktree_path, &filename)?;

	Ok(ResolvedFilePath::Fuzzy { candidates })
}

#[cfg(test)]
mod tests {
	use std::sync::{Arc, Mutex};

	use diesel::prelude::*;
	use diesel_migrations::MigrationHarness;
	use model::profile::NewProfile;
	use model::project::NewProject;
	use uuid::Uuid;

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

	fn temp_worktree() -> std::path::PathBuf {
		let path = std::env::temp_dir()
			.join(format!("2code-filesystem-test-{}", Uuid::new_v4()));
		std::fs::create_dir_all(&path).expect("create temp worktree");
		path
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

	#[test]
	fn resolve_file_path_in_worktree_returns_exact_file_match() {
		let worktree = temp_worktree();
		let file_path = worktree.join("src/main.rs");
		std::fs::create_dir_all(file_path.parent().expect("parent"))
			.expect("create parent");
		std::fs::write(&file_path, "fn main() {}").expect("write file");

		let result =
			resolve_file_path_in_worktree(&worktree, "src/main.rs").unwrap();

		assert!(matches!(
			result,
			ResolvedFilePath::Exact { path } if path == file_path.canonicalize().unwrap().to_string_lossy()
		));
		std::fs::remove_dir_all(worktree).expect("cleanup temp worktree");
	}

	#[test]
	fn resolve_file_path_in_worktree_returns_fuzzy_candidates_when_missing() {
		let worktree = temp_worktree();
		let file_path = worktree.join("src/main.rs");
		std::fs::create_dir_all(file_path.parent().expect("parent"))
			.expect("create parent");
		std::fs::write(&file_path, "fn main() {}").expect("write file");

		let result =
			resolve_file_path_in_worktree(&worktree, "missing/main.rs")
				.unwrap();

		assert!(matches!(
			result,
			ResolvedFilePath::Fuzzy { candidates } if candidates.iter().any(|candidate| candidate.relative_path == "src/main.rs")
		));
		std::fs::remove_dir_all(worktree).expect("cleanup temp worktree");
	}

	#[test]
	fn resolve_file_path_in_worktree_rejects_exact_match_outside_worktree() {
		let temp_dir = temp_worktree();
		let worktree = temp_dir.join("worktree");
		let outside = temp_dir.join("outside.rs");
		std::fs::create_dir_all(&worktree).expect("create worktree");
		std::fs::write(&outside, "fn main() {}").expect("write outside");

		let result = resolve_file_path_in_worktree(
			&worktree,
			outside.to_string_lossy().as_ref(),
		);

		assert!(matches!(result, Err(AppError::IoError(_))));
		std::fs::remove_dir_all(temp_dir).expect("cleanup temp dir");
	}
}
