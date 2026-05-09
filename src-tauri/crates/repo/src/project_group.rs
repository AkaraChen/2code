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

#[cfg(test)]
mod tests {
	use super::*;
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
}
