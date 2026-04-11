use diesel::prelude::*;

use model::error::AppError;
use model::profile::{NewProfile, Profile};
use model::schema::{profiles, projects};

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
	branch_name: &str,
	worktree_path: &str,
) -> Result<Profile, AppError> {
	diesel::insert_into(profiles::table)
		.values(&NewProfile {
			id,
			project_id,
			branch_name,
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
	use crate::test_utils::setup_db;
	use model::project::NewProject;

	/// Insert a test project with its default profile (mirrors real app behavior).
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
		let result = delete(&mut conn, "default-proj-1");
		assert!(result.is_err());
	}

	#[test]
	fn cascade_delete_removes_profiles() {
		let mut conn = setup_db();
		insert_test_project(&mut conn, "proj-1", "/tmp/test");
		insert(&mut conn, "p1", "proj-1", "main", "/w/p1").unwrap();
		insert(&mut conn, "p2", "proj-1", "dev", "/w/p2").unwrap();

		diesel::delete(projects::table.find("proj-1"))
			.execute(&mut conn)
			.unwrap();

		let count: i64 = profiles::table
			.filter(profiles::project_id.eq("proj-1"))
			.count()
			.get_result(&mut conn)
			.unwrap();
		assert_eq!(count, 0);
	}
}
