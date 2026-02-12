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
		})
		.execute(conn)
		.map_err(|e| AppError::DbError(e.to_string()))?;

	profiles::table
		.find(id)
		.select(Profile::as_select())
		.first(conn)
		.map_err(|e| AppError::DbError(e.to_string()))
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

/// Delete a profile record and return the profile + project folder.
pub fn delete(
	conn: &mut SqliteConnection,
	id: &str,
) -> Result<(Profile, String), AppError> {
	let profile = find_by_id(conn, id)?;
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
		assert_eq!(profiles.len(), 2);
	}

	#[test]
	fn list_empty() {
		let mut conn = setup_db();
		insert_test_project(&mut conn, "proj-1", "/tmp/test");
		let profiles = list_by_project(&mut conn, "proj-1").unwrap();
		assert!(profiles.is_empty());
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
