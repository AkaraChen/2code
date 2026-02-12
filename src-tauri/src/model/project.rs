use crate::schema::projects;
use diesel::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Queryable, Selectable, Serialize)]
#[diesel(table_name = projects)]
#[diesel(check_for_backend(diesel::sqlite::Sqlite))]
pub struct Project {
	pub id: String,
	pub name: String,
	pub folder: String,
	pub created_at: String,
}

#[derive(Insertable)]
#[diesel(table_name = projects)]
pub struct NewProject<'a> {
	pub id: &'a str,
	pub name: &'a str,
	pub folder: &'a str,
}

#[derive(AsChangeset)]
#[diesel(table_name = projects)]
pub struct UpdateProject {
	pub name: Option<String>,
	pub folder: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct GitAuthor {
	pub name: String,
	pub email: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct GitCommit {
	pub hash: String,
	pub full_hash: String,
	pub author: GitAuthor,
	pub date: String,
	pub message: String,
	pub files_changed: u32,
	pub insertions: u32,
	pub deletions: u32,
}
