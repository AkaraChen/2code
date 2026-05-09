use crate::schema::project_groups;
use diesel::prelude::*;
use serde::Serialize;

#[derive(Queryable, Selectable, Serialize)]
#[diesel(table_name = project_groups)]
#[diesel(check_for_backend(diesel::sqlite::Sqlite))]
pub struct ProjectGroup {
	pub id: String,
	pub name: String,
	pub created_at: String,
}

#[derive(Insertable)]
#[diesel(table_name = project_groups)]
pub struct NewProjectGroup<'a> {
	pub id: &'a str,
	pub name: &'a str,
}
