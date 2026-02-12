use crate::schema::{pty_output_chunks, pty_sessions};
use diesel::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Queryable, Selectable, Serialize)]
#[diesel(table_name = pty_sessions)]
#[diesel(check_for_backend(diesel::sqlite::Sqlite))]
pub struct PtySessionRecord {
	pub id: String,
	pub project_id: String,
	pub title: String,
	pub shell: String,
	pub cwd: String,
	pub created_at: String,
	pub closed_at: Option<String>,
}

#[derive(Insertable)]
#[diesel(table_name = pty_sessions)]
pub struct NewPtySessionRecord<'a> {
	pub id: &'a str,
	pub project_id: &'a str,
	pub title: &'a str,
	pub shell: &'a str,
	pub cwd: &'a str,
}

#[derive(Insertable)]
#[diesel(table_name = pty_output_chunks)]
pub struct NewPtyOutputChunk<'a> {
	pub session_id: &'a str,
	pub data: &'a [u8],
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PtySessionMeta {
	pub project_id: String,
	pub title: String,
}

#[derive(Deserialize)]
pub struct PtyConfig {
	pub shell: String,
	pub cwd: String,
	pub rows: u16,
	pub cols: u16,
}
