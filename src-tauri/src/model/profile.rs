use crate::schema::profiles;
use diesel::prelude::*;
use serde::Serialize;

#[derive(Queryable, Selectable, Serialize)]
#[diesel(table_name = profiles)]
#[diesel(check_for_backend(diesel::sqlite::Sqlite))]
pub struct Profile {
	pub id: String,
	pub project_id: String,
	pub branch_name: String,
	pub worktree_path: String,
	pub created_at: String,
	pub is_default: bool,
}

#[derive(Insertable)]
#[diesel(table_name = profiles)]
pub struct NewProfile<'a> {
	pub id: &'a str,
	pub project_id: &'a str,
	pub branch_name: &'a str,
	pub worktree_path: &'a str,
	pub is_default: bool,
}

#[derive(AsChangeset)]
#[diesel(table_name = profiles)]
pub struct UpdateProfile {
	pub branch_name: Option<String>,
}
