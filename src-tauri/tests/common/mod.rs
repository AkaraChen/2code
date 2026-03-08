#![allow(dead_code)]
use std::path::PathBuf;
use std::process::Command;
use std::sync::{Arc, Mutex};

use diesel::prelude::*;
use diesel::sqlite::SqliteConnection;
use diesel_migrations::MigrationHarness;

use infra::db::MIGRATIONS;
use model::profile::{NewProfile, Profile};
use model::project::{NewProject, Project};

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

/// Create a file-based SQLite connection for inspection with sqlite3 CLI.
/// Deletes any existing file at the path first.
pub fn setup_file_db(path: &str) -> SqliteConnection {
	// Delete existing file if present
	let _ = std::fs::remove_file(path);

	let mut conn = SqliteConnection::establish(path)
		.unwrap_or_else(|_| panic!("Failed to create db at {path}"));

	diesel::sql_query("PRAGMA foreign_keys=ON;")
		.execute(&mut conn)
		.expect("enable foreign keys");

	conn.run_pending_migrations(MIGRATIONS)
		.expect("run migrations");

	eprintln!("✅ Test database created at: {path}");
	conn
}

/// Create an in-memory DbPool (Arc<Mutex<SqliteConnection>>).
pub fn setup_db_pool() -> infra::db::DbPool {
	Arc::new(Mutex::new(setup_db()))
}

/// Insert a bare project + default profile into the DB without touching the filesystem.
/// Returns (project_id, profile_id). The project `folder` is set to the provided path.
pub fn insert_bare_project_and_profile(
	conn: &mut SqliteConnection,
	project_id: &str,
	profile_id: &str,
	folder: &str,
) {
	diesel::insert_into(model::schema::projects::table)
		.values(&NewProject {
			id: project_id,
			name: "Test Project",
			folder,
		})
		.execute(conn)
		.expect("insert project");

	diesel::insert_into(model::schema::profiles::table)
		.values(&NewProfile {
			id: profile_id,
			project_id,
			branch_name: "main",
			worktree_path: folder,
			is_default: true,
		})
		.execute(conn)
		.expect("insert default profile");
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
