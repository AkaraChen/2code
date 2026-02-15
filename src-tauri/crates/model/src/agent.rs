use crate::schema::{agent_session_events, agent_sessions};
use diesel::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Queryable, Selectable, Serialize)]
#[diesel(table_name = agent_sessions)]
#[diesel(check_for_backend(diesel::sqlite::Sqlite))]
pub struct AgentSessionRecord {
	pub id: String,
	pub agent: String,
	pub acp_session_id: String,
	pub profile_id: String,
	pub created_at: i32,
	pub destroyed_at: Option<i32>,
	pub session_init_json: Option<String>,
}

#[derive(Insertable)]
#[diesel(table_name = agent_sessions)]
pub struct NewAgentSession<'a> {
	pub id: &'a str,
	pub agent: &'a str,
	pub acp_session_id: &'a str,
	pub profile_id: &'a str,
	pub session_init_json: Option<&'a str>,
}

#[derive(Queryable, Selectable, Serialize, Deserialize)]
#[diesel(table_name = agent_session_events)]
#[diesel(check_for_backend(diesel::sqlite::Sqlite))]
pub struct AgentSessionEventRecord {
	pub id: String,
	pub event_index: i32,
	pub session_id: String,
	pub created_at: i32,
	pub sender: String,
	pub payload_json: String,
}

#[derive(Insertable)]
#[diesel(table_name = agent_session_events)]
pub struct NewAgentSessionEvent<'a> {
	pub id: &'a str,
	pub event_index: i32,
	pub session_id: &'a str,
	pub sender: &'a str,
	pub payload_json: &'a str,
}

/// Lightweight info returned to the frontend for restored sessions.
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentRestoreResult {
	pub info: AgentSessionRestoreInfo,
	pub events: Vec<AgentSessionEventRecord>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentSessionRestoreInfo {
	pub id: String,
	pub agent: String,
	pub acp_session_id: String,
}
