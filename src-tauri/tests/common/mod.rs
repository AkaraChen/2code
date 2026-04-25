use std::path::PathBuf;
use std::process::Command;

use diesel::prelude::*;
use diesel::sqlite::SqliteConnection;
use diesel_migrations::MigrationHarness;

use infra::db::MIGRATIONS;
use model::profile::Profile;
use model::project::Project;

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

/// Create a temporary git repository with user config set.
/// Returns the path to the repo directory.
pub fn create_temp_git_repo() -> PathBuf {
	let dir = std::env::temp_dir()
		.join(format!("2code-integ-{}", uuid::Uuid::new_v4()));
	std::fs::create_dir_all(&dir).unwrap();
	Command::new("git")
		.args(["init"])
		.current_dir(&dir)
		.output()
		.unwrap();
	Command::new("git")
		.args(["config", "user.email", "test@test.com"])
		.current_dir(&dir)
		.output()
		.unwrap();
	Command::new("git")
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
	Command::new("git")
		.args(["add", filename])
		.current_dir(dir)
		.output()
		.unwrap();
	Command::new("git")
		.args(["commit", "-m", msg])
		.current_dir(dir)
		.output()
		.unwrap();
}

/// Remove a temporary directory (best-effort).
pub fn cleanup(dir: &std::path::Path) {
	let _ = std::fs::remove_dir_all(dir);
}

/// Resolve a profile id to its worktree folder. Test convenience for the
/// two-phase pattern (handlers do this lookup synchronously inside the mutex,
/// then drop the lock before running git ops).
#[allow(dead_code)]
pub fn folder_for(conn: &mut SqliteConnection, profile_id: &str) -> String {
	service::project::resolve_profile_folder(conn, profile_id)
		.expect("resolve profile folder")
}

/// Create a git repo, insert a project + default profile into the DB, and return all three.
/// The project folder points to the temp git repo.
pub fn create_project_with_git_repo(
	conn: &mut SqliteConnection,
) -> (Project, Profile, PathBuf) {
	let dir = create_temp_git_repo();
	add_commit(&dir, "README.md", "# Test", "Initial commit");

	let folder = dir.to_string_lossy().to_string();
	let project =
		service::project::create_from_folder(conn, "Test Project", &folder)
			.expect("create project from folder");

	let projects_with_profiles =
		service::project::list(conn).expect("list projects");
	let pwp = projects_with_profiles
		.into_iter()
		.find(|p| p.id == project.id)
		.expect("find project");
	let default_profile = pwp
		.profiles
		.into_iter()
		.find(|p| p.is_default)
		.expect("find default profile");

	(project, default_profile, dir)
}
