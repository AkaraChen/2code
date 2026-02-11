use diesel::prelude::*;
use pinyin::ToPinyin;
use slug::slugify;
use std::path::PathBuf;
use std::process::Command;
use tauri::State;
use uuid::Uuid;

use super::models::{NewProfile, Profile, UpdateProfile};
use crate::config;
use crate::db::DbPool;
use crate::error::{AppError, AppResult};
use crate::schema::{profiles, projects};

/// Sanitize user input into a valid git branch name.
/// Splits on `/` to preserve namespace separators (e.g. "feature/auth"),
/// slugifies each segment (handling CJK via pinyin), then rejoins.
fn sanitize_branch_name(input: &str) -> String {
	input
		.split('/')
		.map(|seg| {
			let mut parts: Vec<String> = Vec::new();
			let mut buf = String::new();
			for c in seg.chars() {
				if let Some(py) = c.to_pinyin() {
					if !buf.is_empty() {
						parts.push(buf.clone());
						buf.clear();
					}
					parts.push(py.plain().to_string());
				} else {
					buf.push(c);
				}
			}
			if !buf.is_empty() {
				parts.push(buf);
			}
			slugify(&parts.join(" "))
		})
		.filter(|s| !s.is_empty())
		.collect::<Vec<_>>()
		.join("/")
}

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

/// Try `git worktree add -b <branch> <path>` (new branch).
/// If the branch already exists, fall back to checking it out.
/// If a ref conflict blocks creation (e.g. `feat` exists, blocking `feat/auth`),
/// delete the conflicting branch and retry once.
fn create_worktree(
	branch_name: &str,
	worktree_str: &str,
	project_folder: &str,
) -> AppResult<()> {
	let output = Command::new("git")
		.args(["worktree", "add", "-b", branch_name, worktree_str])
		.current_dir(project_folder)
		.output()?;

	if output.status.success() {
		return Ok(());
	}

	let stderr = String::from_utf8_lossy(&output.stderr);

	// Branch already exists — let the user know
	if stderr.contains("already exists") {
		return Err(AppError::GitError(format!(
			"Branch '{branch_name}' already exists"
		)));
	}

	// Ref conflict: e.g. 'refs/heads/feat' blocks 'refs/heads/feat/auth'.
	// Try to delete the conflicting branch and retry once.
	if stderr.contains("cannot lock ref") {
		if let Some(conflicting) = extract_conflicting_ref(&stderr) {
			let _ = Command::new("git")
				.args(["branch", "-D", &conflicting])
				.current_dir(project_folder)
				.output();

			// Retry
			let retry = Command::new("git")
				.args(["worktree", "add", "-b", branch_name, worktree_str])
				.current_dir(project_folder)
				.output()?;
			if retry.status.success() {
				return Ok(());
			}
			let retry_err = String::from_utf8_lossy(&retry.stderr);
			return Err(AppError::GitError(format!(
				"git worktree add failed: {retry_err}"
			)));
		}
	}

	Err(AppError::GitError(format!(
		"git worktree add failed: {stderr}"
	)))
}

/// Parse "'refs/heads/feat' exists" from git error to extract "feat".
fn extract_conflicting_ref(stderr: &str) -> Option<String> {
	// Look for: 'refs/heads/XXX' exists
	let suffix = "' exists";
	let exists_pos = stderr.find(suffix)?;
	let before = &stderr[..exists_pos];
	let marker = "refs/heads/";
	let marker_pos = before.rfind(marker)? + marker.len();
	let name = &before[marker_pos..];
	if name.is_empty() {
		return None;
	}
	Some(name.to_string())
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

	let branch_name = sanitize_branch_name(&branch_name);
	if branch_name.is_empty() {
		return Err(AppError::GitError("Invalid branch name".to_string()));
	}

	let id = Uuid::new_v4().to_string();
	let worktree_base = resolve_worktree_base()?;
	std::fs::create_dir_all(&worktree_base)?;
	let worktree_path = worktree_base.join(&id);
	let worktree_str = worktree_path.to_string_lossy().to_string();

	create_worktree(&branch_name, &worktree_str, &project_folder)?;

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

	// Clean up the branch that was created for this profile.
	// Use -D (force) since the branch may not be fully merged.
	let branch_output = Command::new("git")
		.args(["branch", "-D", &profile.branch_name])
		.current_dir(&project_folder)
		.output();

	match branch_output {
		Ok(o) if !o.status.success() => {
			let stderr = String::from_utf8_lossy(&o.stderr);
			log::warn!("git branch delete failed: {stderr}");
		}
		Err(e) => {
			log::warn!("git branch delete error: {e}");
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

	// --- branch name sanitization ---

	#[test]
	fn sanitize_simple_english() {
		assert_eq!(sanitize_branch_name("feature/auth"), "feature/auth");
	}

	#[test]
	fn sanitize_with_spaces() {
		assert_eq!(sanitize_branch_name("my feature"), "my-feature");
	}

	#[test]
	fn sanitize_chinese() {
		assert_eq!(sanitize_branch_name("新功能/登录"), "xin-gong-neng/deng-lu");
	}

	#[test]
	fn sanitize_mixed() {
		assert_eq!(sanitize_branch_name("feat/用户认证"), "feat/yong-hu-ren-zheng");
	}

	#[test]
	fn sanitize_special_chars() {
		assert_eq!(sanitize_branch_name("fix: bug #123"), "fix-bug-123");
	}

	#[test]
	fn sanitize_empty_segments() {
		assert_eq!(sanitize_branch_name("feature//auth"), "feature/auth");
	}

	#[test]
	fn sanitize_empty_input() {
		assert_eq!(sanitize_branch_name(""), "");
	}

	// --- conflicting ref extraction ---

	#[test]
	fn extract_ref_from_typical_error() {
		let stderr = "fatal: cannot lock ref 'refs/heads/feat/auth': 'refs/heads/feat' exists; cannot create 'refs/heads/feat/auth'";
		assert_eq!(extract_conflicting_ref(stderr), Some("feat".to_string()));
	}

	#[test]
	fn extract_ref_nested() {
		let stderr = "fatal: cannot lock ref 'refs/heads/a/b/c': 'refs/heads/a/b' exists;";
		assert_eq!(extract_conflicting_ref(stderr), Some("a/b".to_string()));
	}

	#[test]
	fn extract_ref_no_match() {
		assert_eq!(extract_conflicting_ref("some other error"), None);
	}
}
