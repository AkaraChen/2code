use crate::schema::snippets;
use diesel::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Queryable, Selectable, Serialize)]
#[diesel(table_name = snippets)]
#[diesel(check_for_backend(diesel::sqlite::Sqlite))]
pub struct Snippet {
	pub id: String,
	pub name: String,
	pub trigger: String,
	pub content: String,
	pub created_at: String,
}

#[derive(Insertable)]
#[diesel(table_name = snippets)]
pub struct NewSnippet<'a> {
	pub id: &'a str,
	pub name: &'a str,
	pub trigger: &'a str,
	pub content: &'a str,
}

#[derive(AsChangeset, Deserialize)]
#[diesel(table_name = snippets)]
pub struct UpdateSnippet {
	pub name: Option<String>,
	pub trigger: Option<String>,
	pub content: Option<String>,
}
