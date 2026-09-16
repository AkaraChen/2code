use std::path::Path;

use infra::db::DbPool;
use model::error::AppError;
use model::filesystem::{
	FilePreview, FileSearchResult, FileTreeGitStatusEntry, ResolvedFilePath,
};

use crate::runtime::RuntimeRouter;

pub fn search_file_for_profile(
	runtime: &RuntimeRouter,
	db: &DbPool,
	profile_id: &str,
	query: &str,
) -> Result<Vec<FileSearchResult>, AppError> {
	let root = get_profile_worktree_path(runtime, db, profile_id)?;
	infra::filesystem::search_files(&root, query)
}

pub fn get_file_tree_git_status_for_profile(
	runtime: &RuntimeRouter,
	db: &DbPool,
	profile_id: &str,
) -> Result<Vec<FileTreeGitStatusEntry>, AppError> {
	let root = get_profile_worktree_path(runtime, db, profile_id)?;
	infra::git::status(&root.to_string_lossy())
}

/// Resolve profile ID to its reconciled worktree path (short DB lock).
pub fn get_profile_worktree_path(
	runtime: &RuntimeRouter,
	db: &DbPool,
	profile_id: &str,
) -> Result<std::path::PathBuf, AppError> {
	Ok(std::path::PathBuf::from(
		crate::project::reconcile_profile_checkout(runtime, db, profile_id)?,
	))
}

fn get_canonical_profile_worktree_path(
	runtime: &RuntimeRouter,
	db: &DbPool,
	profile_id: &str,
) -> Result<std::path::PathBuf, AppError> {
	let root = get_profile_worktree_path(runtime, db, profile_id)?;
	root.canonicalize().map_err(AppError::IoError)
}

// Profile-scoped wrappers for tree operations (resolve trusted root from profile ID,
// then delegate to infra which enforces relative path validation and root boundary).
pub fn list_file_tree_child_paths(
	runtime: &RuntimeRouter,
	db: &DbPool,
	profile_id: &str,
	parent_path: Option<&str>,
) -> Result<Vec<String>, AppError> {
	let root = get_canonical_profile_worktree_path(runtime, db, profile_id)?;
	infra::filesystem::list_file_tree_child_paths(&root, parent_path)
}

pub fn rename_file_tree_path(
	runtime: &RuntimeRouter,
	db: &DbPool,
	profile_id: &str,
	source_path: &str,
	destination_path: &str,
) -> Result<(), AppError> {
	let root = get_canonical_profile_worktree_path(runtime, db, profile_id)?;
	infra::filesystem::rename_file_tree_path(
		&root,
		source_path,
		destination_path,
	)
}

pub fn move_file_tree_paths(
	runtime: &RuntimeRouter,
	db: &DbPool,
	profile_id: &str,
	source_paths: &[String],
	target_dir_path: Option<&str>,
) -> Result<(), AppError> {
	let root = get_canonical_profile_worktree_path(runtime, db, profile_id)?;
	infra::filesystem::move_file_tree_paths(
		&root,
		source_paths,
		target_dir_path,
	)
}

pub fn delete_file_tree_paths(
	runtime: &RuntimeRouter,
	db: &DbPool,
	profile_id: &str,
	paths: &[String],
) -> Result<(), AppError> {
	let root = get_canonical_profile_worktree_path(runtime, db, profile_id)?;
	infra::filesystem::delete_file_tree_paths(&root, paths)
}

pub fn create_file_tree_path(
	runtime: &RuntimeRouter,
	db: &DbPool,
	profile_id: &str,
	path: &str,
	kind: &str,
) -> Result<(), AppError> {
	let root = get_canonical_profile_worktree_path(runtime, db, profile_id)?;
	infra::filesystem::create_file_tree_path(&root, path, kind)
}

pub fn reveal_path_in_file_manager(
	runtime: &RuntimeRouter,
	db: &DbPool,
	profile_id: &str,
	path: Option<&str>,
) -> Result<(), AppError> {
	let worktree_root = get_profile_worktree_path(runtime, db, profile_id)?;
	let path = infra::filesystem::resolve_existing_worktree_path_or_root(
		&worktree_root,
		path,
	)?;
	infra::filesystem::reveal_path_in_file_manager(&path)
}

pub fn open_path_in_default_app(
	runtime: &RuntimeRouter,
	db: &DbPool,
	profile_id: &str,
	path: &str,
) -> Result<(), AppError> {
	let worktree_root = get_profile_worktree_path(runtime, db, profile_id)?;
	let path = infra::filesystem::resolve_existing_worktree_path(
		&worktree_root,
		path,
		"File tree path",
	)?;
	infra::filesystem::open_path_in_default_app(&path)
}

pub fn read_file_content(
	runtime: &RuntimeRouter,
	db: &DbPool,
	profile_id: &str,
	path: &str,
) -> Result<String, AppError> {
	let worktree_root = get_profile_worktree_path(runtime, db, profile_id)?;
	let file_path = infra::filesystem::resolve_existing_worktree_path(
		&worktree_root,
		path,
		"File path",
	)?;
	infra::filesystem::read_file_content(&file_path, path)
}

pub fn write_file_content(
	runtime: &RuntimeRouter,
	db: &DbPool,
	profile_id: &str,
	path: &str,
	content: &str,
) -> Result<(), AppError> {
	let worktree_root = get_profile_worktree_path(runtime, db, profile_id)?;
	let file_path = infra::filesystem::resolve_existing_worktree_path(
		&worktree_root,
		path,
		"File path",
	)?;
	infra::filesystem::write_file_content(&file_path, path, content)
}

pub fn get_file_preview(
	runtime: &RuntimeRouter,
	db: &DbPool,
	profile_id: &str,
	path: &str,
	file_cache_root: &Path,
	office_cache_root: &Path,
) -> Result<FilePreview, AppError> {
	let worktree_root = get_profile_worktree_path(runtime, db, profile_id)?;
	let file_path = infra::filesystem::resolve_existing_worktree_path(
		&worktree_root,
		path,
		"File path",
	)?;
	let metadata = infra::office::ensure_previewable_file(&file_path)?;
	let canonical_path = file_path.canonicalize().map_err(AppError::IoError)?;

	if let Some(mime_type) =
		infra::office::previewable_image_mime_type(&canonical_path)
	{
		let cached_path = infra::office::cache_preview_file(
			file_cache_root,
			&canonical_path,
			&metadata,
		)?;
		return Ok(FilePreview {
			kind: "image".to_string(),
			file_path: cached_path.to_string_lossy().into_owned(),
			mime_type: mime_type.to_string(),
			source_path: None,
			archive_entries: None,
		});
	}

	if infra::office::is_pdf_file(&canonical_path) {
		let cached_path = infra::office::cache_preview_file(
			file_cache_root,
			&canonical_path,
			&metadata,
		)?;
		return Ok(FilePreview {
			kind: "pdf".to_string(),
			file_path: cached_path.to_string_lossy().into_owned(),
			mime_type: "application/pdf".to_string(),
			source_path: None,
			archive_entries: None,
		});
	}

	if infra::archive::is_archive_file(&canonical_path) {
		let archive_entries =
			infra::archive::list_archive_entries(&canonical_path, &metadata)?;
		return Ok(FilePreview {
			kind: "archive".to_string(),
			file_path: canonical_path.to_string_lossy().into_owned(),
			mime_type: "application/x-archive".to_string(),
			source_path: None,
			archive_entries: Some(archive_entries),
		});
	}

	if infra::office::is_office_file(&canonical_path) {
		let pdf_path = infra::office::convert_office_file_to_pdf(
			&canonical_path,
			office_cache_root,
			&metadata,
		)?;
		return Ok(FilePreview {
			kind: "office-pdf".to_string(),
			file_path: pdf_path.to_string_lossy().into_owned(),
			mime_type: "application/pdf".to_string(),
			source_path: Some(canonical_path.to_string_lossy().into_owned()),
			archive_entries: None,
		});
	}

	Err(AppError::IoError(std::io::Error::other(
		"File type is not previewable",
	)))
}

pub fn resolve_terminal_file_path(
	runtime: &RuntimeRouter,
	db: &DbPool,
	profile_id: &str,
	file_path: &str,
) -> Result<ResolvedFilePath, AppError> {
	let worktree = get_profile_worktree_path(runtime, db, profile_id)?;
	infra::filesystem::resolve_file_path_in_worktree(&worktree, file_path)
}

#[cfg(test)]
mod tests {
	use std::sync::{Arc, Mutex};

	use diesel::prelude::*;
	use diesel_migrations::MigrationHarness;
	use infra::db::DbPool;
	use model::error::AppError;
	use model::runtime::RuntimeBackend;
	use tempfile::tempdir;

	use super::*;
	use crate::pty::{create_flush_senders, PtyContext};
	use crate::runtime::{HerdrStubAdapter, LocalAdapter, RuntimeRouter};
	use crate::PtyEventEmitter;

	struct TestEmitter;

	impl PtyEventEmitter for TestEmitter {
		fn emit_output(&self, _session_id: &str, _bytes: &[u8]) -> bool {
			true
		}

		fn emit_exit(&self, _session_id: &str) {}
	}

	fn setup_db() -> SqliteConnection {
		let mut conn =
			SqliteConnection::establish(":memory:").expect("in-memory db");
		conn.run_pending_migrations(infra::db::MIGRATIONS)
			.expect("run migrations");
		conn
	}

	fn pool_from(conn: SqliteConnection) -> DbPool {
		Arc::new(Mutex::new(conn))
	}

	fn local_router(db: &DbPool) -> RuntimeRouter {
		let logs = std::env::temp_dir().join("2code-fs-runtime-logs");
		std::fs::create_dir_all(&logs).ok();
		let ctx = PtyContext {
			db: db.clone(),
			sessions: infra::pty::create_session_map(),
			flush_senders: create_flush_senders(),
			read_threads: infra::pty::create_thread_tracker(),
			emitter: Arc::new(TestEmitter),
			output_dir: logs,
		};
		RuntimeRouter::with_backend(
			RuntimeBackend::Local,
			LocalAdapter::new(ctx),
			HerdrStubAdapter::new(),
		)
	}

	fn insert_project(
		conn: &mut SqliteConnection,
		worktree_path: &str,
	) -> String {
		repo::project::insert(conn, "proj-1", "Project", worktree_path)
			.expect("insert project");
		model::profile::Profile::local_default_id("proj-1")
	}

	#[test]
	fn sqlite_search_helpers_are_gone() {
		let src = include_str!("filesystem.rs")
			.split("#[cfg(test)]")
			.next()
			.unwrap();
		assert!(!src.contains("pub fn search_file("));
		assert!(!src.contains("pub fn get_file_tree_git_status("));
		assert!(src.contains("search_file_for_profile"));
		assert!(src.contains("get_file_tree_git_status_for_profile"));
		assert!(src.contains("reconcile_profile_checkout"));
		assert!(!src.contains("find_by_id"));
	}

	#[test]
	fn search_file_for_profile_uses_local_sqlite_worktree() {
		let dir = tempdir().expect("tempdir");
		std::fs::create_dir_all(dir.path().join("src")).expect("mkdir src");
		std::fs::write(dir.path().join("src/main.rs"), "fn main() {}")
			.expect("write main");
		std::fs::write(dir.path().join("README.md"), "# readme")
			.expect("write readme");

		let mut conn = setup_db();
		let profile_id =
			insert_project(&mut conn, &dir.path().to_string_lossy());
		let db = pool_from(conn);
		let runtime = local_router(&db);

		let results =
			search_file_for_profile(&runtime, &db, &profile_id, "main")
				.expect("search files");

		assert_eq!(results.len(), 1);
		assert_eq!(results[0].name, "main.rs");
		assert_eq!(results[0].relative_path, "src/main.rs");
	}

	#[test]
	fn search_file_for_profile_returns_not_found_for_unknown_local_profiles() {
		let db = pool_from(setup_db());
		let runtime = local_router(&db);

		let result =
			search_file_for_profile(&runtime, &db, "missing-profile", "main");

		assert!(matches!(result, Err(AppError::NotFound(_))));
	}
}
