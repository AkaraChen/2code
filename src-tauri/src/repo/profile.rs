use diesel::prelude::*;

use crate::error::AppError;
use crate::model::profile::{NewProfile, Profile, UpdateProfile};
use crate::schema::{profiles, projects};

pub fn insert(
	conn: &mut SqliteConnection,
	id: &str,
	project_id: &str,
	branch_name: &str,
	worktree_path: &str,
) -> Result<Profile, AppError> {
	diesel::insert_into(profiles::table)
		.values(&NewProfile {
			id,
			project_id,
			branch_name,
			worktree_path,
			is_default: false,
		})
		.execute(conn)
		.map_err(|e| AppError::DbError(e.to_string()))?;

	profiles::table
		.find(id)
		.select(Profile::as_select())
		.first(conn)
		.map_err(|e| AppError::DbError(e.to_string()))
}

pub fn insert_default(
	conn: &mut SqliteConnection,
	id: &str,
	project_id: &str,
	worktree_path: &str,
) -> Result<Profile, AppError> {
	let branch_name = crate::infra::git::branch(worktree_path)
		.unwrap_or_else(|_| "main".to_string());
	diesel::insert_into(profiles::table)
		.values(&NewProfile {
			id,
			project_id,
			branch_name: &branch_name,
			worktree_path,
			is_default: true,
		})
		.execute(conn)
		.map_err(|e| AppError::DbError(e.to_string()))?;

	profiles::table
		.find(id)
		.select(Profile::as_select())
		.first(conn)
		.map_err(|e| AppError::DbError(e.to_string()))
}

pub fn find_default_by_project(
	conn: &mut SqliteConnection,
	project_id: &str,
) -> Result<Profile, AppError> {
	profiles::table
		.filter(profiles::project_id.eq(project_id))
		.filter(profiles::is_default.eq(true))
		.select(Profile::as_select())
		.first(conn)
		.map_err(|_| {
			AppError::NotFound(format!(
				"Default profile for project: {project_id}"
			))
		})
}

pub fn find_by_id(
	conn: &mut SqliteConnection,
	id: &str,
) -> Result<Profile, AppError> {
	profiles::table
		.find(id)
		.select(Profile::as_select())
		.first(conn)
		.map_err(|_| AppError::NotFound(format!("Profile: {id}")))
}

pub fn list_by_project(
	conn: &mut SqliteConnection,
	project_id: &str,
) -> Result<Vec<Profile>, AppError> {
	profiles::table
		.filter(profiles::project_id.eq(project_id))
		.select(Profile::as_select())
		.load(conn)
		.map_err(|e| AppError::DbError(e.to_string()))
}

pub fn update(
	conn: &mut SqliteConnection,
	id: &str,
	branch_name: Option<String>,
) -> Result<Profile, AppError> {
	let target = profiles::table.find(id);

	let profile = target
		.select(Profile::as_select())
		.first(conn)
		.map_err(|_| AppError::NotFound(format!("Profile: {id}")))?;

	if profile.is_default {
		return Err(AppError::DbError(
			"Cannot update default profile".to_string(),
		));
	}

	if branch_name.is_none() {
		return Ok(profile);
	}

	let changeset = UpdateProfile { branch_name };
	diesel::update(target)
		.set(&changeset)
		.execute(conn)
		.map_err(|e| AppError::DbError(e.to_string()))?;

	target
		.select(Profile::as_select())
		.first(conn)
		.map_err(|e| AppError::DbError(e.to_string()))
}

/// Delete a profile record and return the profile + project folder.
/// Default profiles cannot be deleted directly — they are removed via cascade when the project is deleted.
pub fn delete(
	conn: &mut SqliteConnection,
	id: &str,
) -> Result<(Profile, String), AppError> {
	let profile = find_by_id(conn, id)?;

	if profile.is_default {
		return Err(AppError::DbError(
			"Cannot delete default profile".to_string(),
		));
	}

	let project_folder = get_project_folder(conn, &profile.project_id)?;

	diesel::delete(profiles::table.find(id))
		.execute(conn)
		.map_err(|e| AppError::DbError(e.to_string()))?;

	Ok((profile, project_folder))
}

pub fn get_project_folder(
	conn: &mut SqliteConnection,
	project_id: &str,
) -> Result<String, AppError> {
	projects::table
		.find(project_id)
		.select(projects::folder)
		.first::<String>(conn)
		.map_err(|_| AppError::NotFound(format!("Project: {project_id}")))
}

#[cfg(test)]
mod tests {
	use super::*;
	use crate::infra::db::MIGRATIONS;
	use crate::model::project::NewProject;
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

	/// Insert a test project with its default profile (mirrors real app behavior).
	fn insert_test_project(
		conn: &mut SqliteConnection,
		id: &str,
		folder: &str,
	) {
		diesel::insert_into(crate::schema::projects::table)
			.values(&NewProject {
				id,
				name: "Test Project",
				folder,
			})
			.execute(conn)
			.expect("insert project");

		let default_id = format!("default-{id}");
		diesel::insert_into(profiles::table)
			.values(&NewProfile {
				id: &default_id,
				project_id: id,
				branch_name: "main",
				worktree_path: folder,
				is_default: true,
			})
			.execute(conn)
			.expect("insert default profile");
	}

	#[test]
	fn insert_success() {
		let mut conn = setup_db();
		insert_test_project(&mut conn, "proj-1", "/tmp/test");

		let profile = insert(
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
		assert!(!profile.is_default);
	}

	#[test]
	fn project_not_found() {
		let mut conn = setup_db();
		let result = get_project_folder(&mut conn, "nonexistent");
		assert!(result.is_err());
	}

	#[test]
	fn list_with_results() {
		let mut conn = setup_db();
		insert_test_project(&mut conn, "proj-1", "/tmp/test");
		insert(&mut conn, "p1", "proj-1", "main", "/w/p1").unwrap();
		insert(&mut conn, "p2", "proj-1", "dev", "/w/p2").unwrap();

		let profiles = list_by_project(&mut conn, "proj-1").unwrap();
		// default profile + 2 inserted
		assert_eq!(profiles.len(), 3);
	}

	#[test]
	fn list_only_default() {
		let mut conn = setup_db();
		insert_test_project(&mut conn, "proj-1", "/tmp/test");
		let profiles = list_by_project(&mut conn, "proj-1").unwrap();
		assert_eq!(profiles.len(), 1);
		assert!(profiles[0].is_default);
	}

	#[test]
	fn get_found() {
		let mut conn = setup_db();
		insert_test_project(&mut conn, "proj-1", "/tmp/test");
		insert(&mut conn, "p1", "proj-1", "main", "/w/p1").unwrap();

		let profile = find_by_id(&mut conn, "p1").unwrap();
		assert_eq!(profile.id, "p1");
		assert_eq!(profile.branch_name, "main");
	}

	#[test]
	fn get_not_found() {
		let mut conn = setup_db();
		let result = find_by_id(&mut conn, "nonexistent");
		assert!(result.is_err());
	}

	#[test]
	fn find_default_by_project_success() {
		let mut conn = setup_db();
		insert_test_project(&mut conn, "proj-1", "/tmp/test");

		let default = find_default_by_project(&mut conn, "proj-1").unwrap();
		assert!(default.is_default);
		assert_eq!(default.project_id, "proj-1");
		assert_eq!(default.worktree_path, "/tmp/test");
	}

	#[test]
	fn update_branch_name() {
		let mut conn = setup_db();
		insert_test_project(&mut conn, "proj-1", "/tmp/test");
		insert(&mut conn, "p1", "proj-1", "main", "/w/p1").unwrap();

		let updated =
			update(&mut conn, "p1", Some("develop".to_string())).unwrap();
		assert_eq!(updated.branch_name, "develop");
	}

	#[test]
	fn update_no_fields() {
		let mut conn = setup_db();
		insert_test_project(&mut conn, "proj-1", "/tmp/test");
		insert(&mut conn, "p1", "proj-1", "main", "/w/p1").unwrap();

		let unchanged = update(&mut conn, "p1", None).unwrap();
		assert_eq!(unchanged.branch_name, "main");
	}

	#[test]
	fn update_not_found() {
		let mut conn = setup_db();
		let result = update(&mut conn, "nonexistent", Some("new".to_string()));
		assert!(result.is_err());
	}

	#[test]
	fn update_default_profile_rejected() {
		let mut conn = setup_db();
		insert_test_project(&mut conn, "proj-1", "/tmp/test");
		let default = find_default_by_project(&mut conn, "proj-1").unwrap();
		let result = update(&mut conn, &default.id, Some("new".to_string()));
		assert!(result.is_err());
	}

	#[test]
	fn delete_success() {
		let mut conn = setup_db();
		insert_test_project(&mut conn, "proj-1", "/tmp/test");
		insert(&mut conn, "p1", "proj-1", "main", "/w/p1").unwrap();

		let (profile, folder) = delete(&mut conn, "p1").unwrap();
		assert_eq!(profile.id, "p1");
		assert_eq!(folder, "/tmp/test");
		assert!(find_by_id(&mut conn, "p1").is_err());
	}

	#[test]
	fn delete_not_found() {
		let mut conn = setup_db();
		let result = delete(&mut conn, "nonexistent");
		assert!(result.is_err());
	}

	#[test]
	fn delete_default_profile_rejected() {
		let mut conn = setup_db();
		insert_test_project(&mut conn, "proj-1", "/tmp/test");
		let default = find_default_by_project(&mut conn, "proj-1").unwrap();
		let result = delete(&mut conn, &default.id);
		assert!(result.is_err());
	}

	#[test]
	fn cascade_delete_removes_profiles() {
		let mut conn = setup_db();
		insert_test_project(&mut conn, "proj-1", "/tmp/test");
		insert(&mut conn, "p1", "proj-1", "main", "/w/p1").unwrap();
		insert(&mut conn, "p2", "proj-1", "dev", "/w/p2").unwrap();

		diesel::delete(crate::schema::projects::table.find("proj-1"))
			.execute(&mut conn)
			.unwrap();

		let profiles = list_by_project(&mut conn, "proj-1").unwrap();
		assert!(profiles.is_empty());
	}
}
