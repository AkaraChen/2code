use crate::schema::{pty_session_output, pty_sessions};
use diesel::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Queryable, Selectable, Serialize)]
#[diesel(table_name = pty_sessions)]
#[diesel(check_for_backend(diesel::sqlite::Sqlite))]
pub struct PtySessionRecord {
	pub id: String,
	pub profile_id: String,
	pub title: String,
	pub shell: String,
	pub cwd: String,
	pub created_at: String,
	pub closed_at: Option<String>,
	pub cols: i32,
	pub rows: i32,
}

#[derive(Insertable)]
#[diesel(table_name = pty_sessions)]
pub struct NewPtySessionRecord<'a> {
	pub id: &'a str,
	pub profile_id: &'a str,
	pub title: &'a str,
	pub shell: &'a str,
	pub cwd: &'a str,
	pub cols: i32,
	pub rows: i32,
}

#[derive(Insertable)]
#[diesel(table_name = pty_session_output)]
pub struct NewPtySessionOutput<'a> {
	pub session_id: &'a str,
	pub data: &'a [u8],
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PtySessionMeta {
	pub profile_id: String,
	pub title: String,
}

#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PtyConfig {
	pub shell: String,
	pub cwd: String,
	pub rows: u16,
	pub cols: u16,
	#[serde(default)]
	pub startup_commands: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoreResult {
	pub new_session_id: String,
	pub history: Vec<u8>,
}
