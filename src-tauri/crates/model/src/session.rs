use serde::{Deserialize, Serialize};

/// Derived GUI session DTO from live Herdr `session.snapshot`.
/// Not a sqlite `pty_sessions` row.
#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct TerminalSessionRecord {
	pub id: String,
	pub project_id: String,
	pub profile_id: String,
	pub title: String,
	pub shell: String,
	pub cwd: String,
	pub created_at: String,
	pub closed_at: Option<String>,
	pub cols: i32,
	pub rows: i32,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalSessionMeta {
	pub profile_id: String,
	pub title: String,
}

#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct TerminalConfig {
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
