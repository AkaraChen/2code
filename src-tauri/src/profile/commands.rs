use diesel::prelude::*;
use std::path::PathBuf;
use std::process::Command;
use tauri::State;
use uuid::Uuid;

use super::models::{NewProfile, Profile, UpdateProfile};
use crate::config;
use crate::db::DbPool;
use crate::error::{AppError, AppResult};
use crate::schema::{profiles, projects};

fn resolve_worktree_base() -> AppResult<PathBuf> {
	let home = dirs::home_dir().ok_or_else(|| {
		AppError::IoError(std::io::Error::new(
			std::io::ErrorKind::NotFound,
			"Could not resolve home directory",
		))
	})?;
	Ok(home.join(".2code").join("workspace"))
}

fn get_project_folder(
	conn: &mut SqliteConnection,
	project_id: &str,
) -> AppResult<String> {
	projects::table
		.find(project_id)
		.select(projects::folder)
		.first::<String>(conn)
		.map_err(|_| AppError::NotFound(format!("Project: {project_id}")))
}

fn insert_profile(
	conn: &mut SqliteConnection,
	id: &str,
	project_id: &str,
	branch_name: &str,
	worktree_path: &str,
) -> AppResult<Profile> {
	diesel::insert_into(profiles::table)
		.values(&NewProfile {
			id,
			project_id,
			branch_name,
			worktree_path,
		})
		.execute(conn)
		.map_err(|e| AppError::DbError(e.to_string()))?;

	profiles::table
		.find(id)
		.select(Profile::as_select())
		.first(conn)
		.map_err(|e| AppError::DbError(e.to_string()))
}

fn do_list_profiles(
	conn: &mut SqliteConnection,
	project_id: &str,
) -> AppResult<Vec<Profile>> {
	profiles::table
		.filter(profiles::project_id.eq(project_id))
		.select(Profile::as_select())
		.load(conn)
		.map_err(|e| AppError::DbError(e.to_string()))
}

fn do_get_profile(conn: &mut SqliteConnection, id: &str) -> AppResult<Profile> {
	profiles::table
		.find(id)
		.select(Profile::as_select())
		.first(conn)
		.map_err(|_| AppError::NotFound(format!("Profile: {id}")))
}

fn do_update_profile(
	conn: &mut SqliteConnection,
	id: &str,
	branch_name: Option<String>,
) -> AppResult<Profile> {
	let target = profiles::table.find(id);

	if branch_name.is_none() {
		return target
			.select(Profile::as_select())
			.first(conn)
			.map_err(|_| AppError::NotFound(format!("Profile: {id}")));
	}

	let changeset = UpdateProfile { branch_name };
	let rows = diesel::update(target)
		.set(&changeset)
		.execute(conn)
		.map_err(|e| AppError::DbError(e.to_string()))?;

	if rows == 0 {
		return Err(AppError::NotFound(format!("Profile: {id}")));
	}

	target
		.select(Profile::as_select())
		.first(conn)
		.map_err(|e| AppError::DbError(e.to_string()))
}

fn do_delete_profile(
	conn: &mut SqliteConnection,
	id: &str,
) -> AppResult<(Profile, String)> {
	let profile = do_get_profile(conn, id)?;
	let project_folder = get_project_folder(conn, &profile.project_id)?;

	diesel::delete(profiles::table.find(id))
		.execute(conn)
		.map_err(|e| AppError::DbError(e.to_string()))?;

	Ok((profile, project_folder))
}

// --- Tauri Commands ---

#[tauri::command]
pub fn create_profile(
	project_id: String,
	branch_name: String,
	state: State<'_, DbPool>,
) -> AppResult<Profile> {
	let conn = &mut *state.lock().map_err(|_| AppError::LockError)?;
	let project_folder = get_project_folder(conn, &project_id)?;

	let id = Uuid::new_v4().to_string();
	let worktree_base = resolve_worktree_base()?;
	std::fs::create_dir_all(&worktree_base)?;
	let worktree_path = worktree_base.join(&id);
	let worktree_str = worktree_path.to_string_lossy().to_string();

	let output = Command::new("git")
		.args(["worktree", "add", &worktree_str, &branch_name])
		.current_dir(&project_folder)
		.output()?;

	if !output.status.success() {
		let stderr = String::from_utf8_lossy(&output.stderr);
		return Err(AppError::GitError(format!(
			"git worktree add failed: {stderr}"
		)));
	}

	let profile =
		insert_profile(conn, &id, &project_id, &branch_name, &worktree_str)?;

	if let Ok(cfg) = config::load_project_config(&project_folder) {
		config::execute_scripts(&cfg.setup_script, &worktree_path);
	}

	Ok(profile)
}

#[tauri::command]
pub fn list_profiles(
	project_id: String,
	state: State<'_, DbPool>,
) -> AppResult<Vec<Profile>> {
	let conn = &mut *state.lock().map_err(|_| AppError::LockError)?;
	do_list_profiles(conn, &project_id)
}

#[tauri::command]
pub fn get_profile(id: String, state: State<'_, DbPool>) -> AppResult<Profile> {
	let conn = &mut *state.lock().map_err(|_| AppError::LockError)?;
	do_get_profile(conn, &id)
}

#[tauri::command]
pub fn update_profile(
	id: String,
	branch_name: Option<String>,
	state: State<'_, DbPool>,
) -> AppResult<Profile> {
	let conn = &mut *state.lock().map_err(|_| AppError::LockError)?;
	do_update_profile(conn, &id, branch_name)
}

#[tauri::command]
pub fn delete_profile(id: String, state: State<'_, DbPool>) -> AppResult<()> {
	let conn = &mut *state.lock().map_err(|_| AppError::LockError)?;
	let (profile, project_folder) = do_delete_profile(conn, &id)?;
	let worktree_path = PathBuf::from(&profile.worktree_path);

	if let Ok(cfg) = config::load_project_config(&project_folder) {
		config::execute_scripts(&cfg.teardown_script, &worktree_path);
	}

	let output = Command::new("git")
		.args(["worktree", "remove", &profile.worktree_path, "--force"])
		.current_dir(&project_folder)
		.output();

	match output {
		Ok(o) if !o.status.success() => {
			let stderr = String::from_utf8_lossy(&o.stderr);
			log::warn!("git worktree remove failed: {stderr}");
		}
		Err(e) => {
			log::warn!("git worktree remove error: {e}");
		}
		_ => {}
	}

	Ok(())
}

#[cfg(test)]
mod tests {
	use super::*;
	use crate::db::MIGRATIONS;
	use crate::project::models::NewProject;
	use crate::schema::projects;
	use diesel::SqliteConnection;
	use diesel_migrations::MigrationHarness;

	fn setup_db() -> SqliteConnection {
		let mut conn =
			SqliteConnection::establish(":memory:").expect("in-memory db");
		diesel::sql_query("PRAGMA foreign_keys=ON;")
			.execute(&mut conn)
			.ok();
		conn.run_pending_migrations(MIGRATIONS)
			.expect("run migrations");
		conn
	}

	fn insert_test_project(
		conn: &mut SqliteConnection,
		id: &str,
		folder: &str,
	) {
		diesel::insert_into(projects::table)
			.values(&NewProject {
				id,
				name: "Test Project",
				folder,
			})
			.execute(conn)
			.expect("insert project");
	}

	// --- create (DB insert) ---

	#[test]
	fn insert_profile_success() {
		let mut conn = setup_db();
		insert_test_project(&mut conn, "proj-1", "/tmp/test");

		let profile = insert_profile(
			&mut conn,
			"prof-1",
			"proj-1",
			"feature/login",
			"/home/user/.2code/workspace/prof-1",
		)
		.unwrap();

		assert_eq!(profile.id, "prof-1");
		assert_eq!(profile.project_id, "proj-1");
		assert_eq!(profile.branch_name, "feature/login");
		assert_eq!(profile.worktree_path, "/home/user/.2code/workspace/prof-1");
	}

	#[test]
	fn insert_profile_project_not_found() {
		let mut conn = setup_db();
		let result = get_project_folder(&mut conn, "nonexistent");
		assert!(result.is_err());
	}

	// --- list ---

	#[test]
	fn list_profiles_with_results() {
		let mut conn = setup_db();
		insert_test_project(&mut conn, "proj-1", "/tmp/test");
		insert_profile(&mut conn, "p1", "proj-1", "main", "/w/p1").unwrap();
		insert_profile(&mut conn, "p2", "proj-1", "dev", "/w/p2").unwrap();

		let profiles = do_list_profiles(&mut conn, "proj-1").unwrap();
		assert_eq!(profiles.len(), 2);
	}

	#[test]
	fn list_profiles_empty() {
		let mut conn = setup_db();
		insert_test_project(&mut conn, "proj-1", "/tmp/test");

		let profiles = do_list_profiles(&mut conn, "proj-1").unwrap();
		assert!(profiles.is_empty());
	}

	#[test]
	fn list_profiles_nonexistent_project() {
		let mut conn = setup_db();
		let profiles = do_list_profiles(&mut conn, "nonexistent").unwrap();
		assert!(profiles.is_empty());
	}

	// --- get ---

	#[test]
	fn get_profile_found() {
		let mut conn = setup_db();
		insert_test_project(&mut conn, "proj-1", "/tmp/test");
		insert_profile(&mut conn, "p1", "proj-1", "main", "/w/p1").unwrap();

		let profile = do_get_profile(&mut conn, "p1").unwrap();
		assert_eq!(profile.id, "p1");
		assert_eq!(profile.branch_name, "main");
	}

	#[test]
	fn get_profile_not_found() {
		let mut conn = setup_db();
		let result = do_get_profile(&mut conn, "nonexistent");
		assert!(result.is_err());
	}

	// --- update ---

	#[test]
	fn update_profile_branch_name() {
		let mut conn = setup_db();
		insert_test_project(&mut conn, "proj-1", "/tmp/test");
		insert_profile(&mut conn, "p1", "proj-1", "main", "/w/p1").unwrap();

		let updated =
			do_update_profile(&mut conn, "p1", Some("develop".to_string()))
				.unwrap();
		assert_eq!(updated.branch_name, "develop");
	}

	#[test]
	fn update_profile_no_fields() {
		let mut conn = setup_db();
		insert_test_project(&mut conn, "proj-1", "/tmp/test");
		insert_profile(&mut conn, "p1", "proj-1", "main", "/w/p1").unwrap();

		let unchanged = do_update_profile(&mut conn, "p1", None).unwrap();
		assert_eq!(unchanged.branch_name, "main");
	}

	#[test]
	fn update_profile_not_found() {
		let mut conn = setup_db();
		let result = do_update_profile(
			&mut conn,
			"nonexistent",
			Some("new-branch".to_string()),
		);
		assert!(result.is_err());
	}

	// --- delete ---

	#[test]
	fn delete_profile_success() {
		let mut conn = setup_db();
		insert_test_project(&mut conn, "proj-1", "/tmp/test");
		insert_profile(&mut conn, "p1", "proj-1", "main", "/w/p1").unwrap();

		let (profile, folder) = do_delete_profile(&mut conn, "p1").unwrap();
		assert_eq!(profile.id, "p1");
		assert_eq!(folder, "/tmp/test");

		// Verify it's gone
		let result = do_get_profile(&mut conn, "p1");
		assert!(result.is_err());
	}

	#[test]
	fn delete_profile_not_found() {
		let mut conn = setup_db();
		let result = do_delete_profile(&mut conn, "nonexistent");
		assert!(result.is_err());
	}

	// --- cascade delete ---

	#[test]
	fn cascade_delete_removes_profiles() {
		let mut conn = setup_db();
		insert_test_project(&mut conn, "proj-1", "/tmp/test");
		insert_profile(&mut conn, "p1", "proj-1", "main", "/w/p1").unwrap();
		insert_profile(&mut conn, "p2", "proj-1", "dev", "/w/p2").unwrap();

		// Delete the project
		diesel::delete(projects::table.find("proj-1"))
			.execute(&mut conn)
			.unwrap();

		// Profiles should be gone
		let profiles = do_list_profiles(&mut conn, "proj-1").unwrap();
		assert!(profiles.is_empty());
	}

	// --- worktree base resolution ---

	#[test]
	fn resolve_worktree_base_returns_valid_path() {
		let base = resolve_worktree_base().unwrap();
		assert!(base.ends_with(".2code/workspace"));
	}
}
