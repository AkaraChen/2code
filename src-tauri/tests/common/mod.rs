use std::path::{Path, PathBuf};
use std::sync::Arc;

use diesel::prelude::*;
use diesel::sqlite::SqliteConnection;
use diesel_migrations::MigrationHarness;
use serde_json::Value;

use infra::db::{DbPool, MIGRATIONS};
use infra::herdr::transport::{
	WorkspaceCreateRequest, WorkspaceCreateResult, WorktreeCreateRequest,
	WorktreeCreateResult, WorktreeListEntry, WorktreeOpenResult,
	WorktreeRemoveResult,
};
use infra::no_window::command_without_windows_console;
use model::error::AppError;
use model::profile::Profile;
use model::project::Project;
use service::runtime::{HerdrStubAdapter, HerdrWorktreeClient, RuntimeRouter};

/// Lists a single open Herdr workspace `w1` at the given folder.
struct FolderWorktrees {
	folder: PathBuf,
}

impl FolderWorktrees {
	fn entry(&self) -> WorktreeListEntry {
		WorktreeListEntry {
			path: self.folder.to_string_lossy().into_owned(),
			branch: Some("main".into()),
			workspace_id: Some("w1".into()),
			is_linked_worktree: false,
		}
	}
}

impl HerdrWorktreeClient for FolderWorktrees {
	fn worktree_create(
		&self,
		_request: WorktreeCreateRequest<'_>,
	) -> Result<WorktreeCreateResult, AppError> {
		Err(AppError::TerminalError(
			"integration FolderWorktrees does not create".into(),
		))
	}

	fn worktree_list(
		&self,
		_cwd: Option<&Path>,
		workspace_id: Option<&str>,
	) -> Result<Vec<WorktreeListEntry>, AppError> {
		if let Some(workspace_id) = workspace_id {
			if workspace_id != "w1" {
				return Ok(Vec::new());
			}
		}
		Ok(vec![self.entry()])
	}

	fn worktree_open(
		&self,
		_cwd: &Path,
		_path: &Path,
	) -> Result<WorktreeOpenResult, AppError> {
		Err(AppError::TerminalError(
			"integration FolderWorktrees does not open".into(),
		))
	}

	fn worktree_remove(
		&self,
		_workspace_id: &str,
		_force: bool,
	) -> Result<WorktreeRemoveResult, AppError> {
		Err(AppError::TerminalError(
			"integration FolderWorktrees does not remove".into(),
		))
	}

	fn workspace_create(
		&self,
		_request: WorkspaceCreateRequest<'_>,
	) -> Result<WorkspaceCreateResult, AppError> {
		Err(AppError::TerminalError(
			"integration FolderWorktrees does not create workspaces".into(),
		))
	}

	fn workspace_close(&self, _workspace_id: &str) -> Result<(), AppError> {
		Ok(())
	}

	fn session_snapshot(&self) -> Result<Value, AppError> {
		Ok(serde_json::json!({
			"type": "session_snapshot",
			"snapshot": {
				"workspaces": [],
				"tabs": [],
				"panes": []
			}
		}))
	}
}

/// Create an in-memory SQLite connection with migrations and foreign keys enabled.
pub fn setup_db() -> SqliteConnection {
	let mut conn =
		SqliteConnection::establish(":memory:").expect("in-memory db");
	diesel::sql_query("PRAGMA foreign_keys=ON;")
		.execute(&mut conn)
		.ok();
	conn.run_pending_migrations(MIGRATIONS)
		.expect("run migrations");
	conn
}

pub fn pool_from(conn: SqliteConnection) -> DbPool {
	Arc::new(std::sync::Mutex::new(conn))
}

/// Herdr-only runtime whose catalog lists `w1` at `folder`.
pub fn herdr_from(
	conn: SqliteConnection,
	folder: &Path,
) -> (RuntimeRouter, DbPool) {
	let db = pool_from(conn);
	let worktrees: Arc<dyn HerdrWorktreeClient> = Arc::new(FolderWorktrees {
		folder: folder.to_path_buf(),
	});
	let runtime =
		RuntimeRouter::new(HerdrStubAdapter::with_worktree_client(worktrees));
	(runtime, db)
}

/// Create a temporary git repository with user config set.
/// Returns the path to the repo directory.
pub fn create_temp_git_repo() -> PathBuf {
	let dir = std::env::temp_dir()
		.join(format!("2code-integ-{}", uuid::Uuid::new_v4()));
	std::fs::create_dir_all(&dir).unwrap();
	command_without_windows_console("git")
		.args(["init"])
		.current_dir(&dir)
		.output()
		.unwrap();
	command_without_windows_console("git")
		.args(["config", "user.email", "test@test.com"])
		.current_dir(&dir)
		.output()
		.unwrap();
	command_without_windows_console("git")
		.args(["config", "user.name", "Test User"])
		.current_dir(&dir)
		.output()
		.unwrap();
	dir
}

/// Add a file and commit it in the given git repo directory.
pub fn add_commit(
	dir: &std::path::Path,
	filename: &str,
	content: &str,
	msg: &str,
) {
	std::fs::write(dir.join(filename), content).unwrap();
	command_without_windows_console("git")
		.args(["add", filename])
		.current_dir(dir)
		.output()
		.unwrap();
	command_without_windows_console("git")
		.args(["commit", "-m", msg])
		.current_dir(dir)
		.output()
		.unwrap();
}

/// Remove a temporary directory (best-effort).
pub fn cleanup(dir: &std::path::Path) {
	let _ = std::fs::remove_dir_all(dir);
}

/// Create a git repo, insert a sqlite project, and return a live Herdr
/// profile DTO (`w1`) for the folder. sqlite `profiles` is not a table.
pub fn create_project_with_git_repo(
	conn: &mut SqliteConnection,
) -> (Project, Profile, PathBuf) {
	let dir = create_temp_git_repo();
	add_commit(&dir, "README.md", "# Test", "Initial commit");

	let folder = dir.to_string_lossy().to_string();
	let project =
		service::project::create_from_folder(conn, "Test Project", &folder)
			.expect("create project from folder");

	let profile = Profile {
		id: "w1".to_string(),
		project_id: project.id.clone(),
		branch_name: "main".to_string(),
		worktree_path: folder,
		created_at: String::new(),
		is_default: true,
		notes: String::new(),
	};

	(project, profile, dir)
}
