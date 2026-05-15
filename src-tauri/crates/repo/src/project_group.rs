use diesel::prelude::*;

use model::error::AppError;
use model::project_group::{NewProjectGroup, ProjectGroup};
use model::schema::project_groups;

pub fn insert(
	conn: &mut SqliteConnection,
	id: &str,
	name: &str,
) -> Result<ProjectGroup, AppError> {
	diesel::insert_into(project_groups::table)
		.values(&NewProjectGroup { id, name })
		.execute(conn)
		.map_err(|e| AppError::DbError(e.to_string()))?;

	project_groups::table
		.find(id)
		.select(ProjectGroup::as_select())
		.first(conn)
		.map_err(|e| AppError::DbError(e.to_string()))
}

pub fn list_all(
	conn: &mut SqliteConnection,
) -> Result<Vec<ProjectGroup>, AppError> {
	project_groups::table
		.order((project_groups::created_at.asc(), project_groups::name.asc()))
		.select(ProjectGroup::as_select())
		.load(conn)
		.map_err(|e| AppError::DbError(e.to_string()))
}

pub fn find_by_id(
	conn: &mut SqliteConnection,
	id: &str,
) -> Result<ProjectGroup, AppError> {
	project_groups::table
		.find(id)
		.select(ProjectGroup::as_select())
		.first(conn)
		.map_err(|_| AppError::NotFound(format!("Project group: {id}")))
}

pub fn delete_if_empty(
	conn: &mut SqliteConnection,
	id: &str,
) -> Result<bool, AppError> {
	let deleted = diesel::sql_query(
		"DELETE FROM project_groups \
		 WHERE id = ? \
		 AND NOT EXISTS (SELECT 1 FROM projects WHERE group_id = ?)",
	)
	.bind::<diesel::sql_types::Text, _>(id)
	.bind::<diesel::sql_types::Text, _>(id)
	.execute(conn)
	.map_err(|e| AppError::DbError(e.to_string()))?;

	Ok(deleted > 0)
}

pub fn delete_empty(conn: &mut SqliteConnection) -> Result<usize, AppError> {
	diesel::sql_query(
		"DELETE FROM project_groups \
		 WHERE NOT EXISTS (
		   SELECT 1 FROM projects WHERE projects.group_id = project_groups.id
		 )",
	)
	.execute(conn)
	.map_err(|e| AppError::DbError(e.to_string()))
}

#[cfg(test)]
mod tests {
	use super::*;
	use crate::project;
	use crate::test_utils::setup_db;

	#[test]
	fn insert_and_list() {
		let mut conn = setup_db();

		let group = insert(&mut conn, "g1", "Work").expect("insert group");
		assert_eq!(group.id, "g1");
		assert_eq!(group.name, "Work");

		let groups = list_all(&mut conn).expect("list groups");
		assert_eq!(groups.len(), 1);
		assert_eq!(groups[0].id, "g1");
	}

	#[test]
	fn find_missing_group_returns_not_found() {
		let mut conn = setup_db();
		let result = find_by_id(&mut conn, "missing");
		assert!(matches!(result, Err(AppError::NotFound(_))));
	}

	#[test]
	fn delete_if_empty_deletes_group_without_projects() {
		let mut conn = setup_db();
		insert(&mut conn, "g1", "Work").expect("insert group");

		assert!(delete_if_empty(&mut conn, "g1").expect("delete empty group"));
		assert!(matches!(
			find_by_id(&mut conn, "g1"),
			Err(AppError::NotFound(_))
		));
	}

	#[test]
	fn delete_if_empty_keeps_group_with_projects() {
		let mut conn = setup_db();
		insert(&mut conn, "g1", "Work").expect("insert group");
		project::insert(&mut conn, "p1", "Project", "/tmp/project")
			.expect("insert project");
		project::set_group(&mut conn, "p1", Some("g1")).expect("assign group");

		assert!(!delete_if_empty(&mut conn, "g1").expect("keep group"));
		assert_eq!(find_by_id(&mut conn, "g1").unwrap().name, "Work");
	}

	#[test]
	fn delete_if_empty_returns_false_for_missing_group() {
		let mut conn = setup_db();

		assert!(
			!delete_if_empty(&mut conn, "missing")
				.expect("missing group is not deleted")
		);
	}

	#[test]
	fn delete_empty_deletes_only_groups_without_projects() {
		let mut conn = setup_db();
		insert(&mut conn, "empty", "Empty").expect("insert empty group");
		insert(&mut conn, "used", "Used").expect("insert used group");
		project::insert(&mut conn, "p1", "Project", "/tmp/project")
			.expect("insert project");
		project::set_group(&mut conn, "p1", Some("used"))
			.expect("assign group");

		assert_eq!(delete_empty(&mut conn).expect("delete empty groups"), 1);

		let groups = list_all(&mut conn).expect("list groups");
		assert_eq!(groups.len(), 1);
		assert_eq!(groups[0].id, "used");
	}
}
