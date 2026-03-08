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
	pub turn_index: i32,
}

#[derive(Insertable)]
#[diesel(table_name = agent_session_events)]
pub struct NewAgentSessionEvent<'a> {
	pub id: &'a str,
	pub event_index: i32,
	pub session_id: &'a str,
	pub sender: &'a str,
	pub payload_json: &'a str,
	pub turn_index: i32,
}

/// Input metadata for creating an agent session.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentSessionMeta {
	pub profile_id: String,
	pub agent: String,
}

/// Agent event types for channel streaming.
/// These events are sent from the backend to the frontend via Tauri Channel.
#[derive(Serialize, Clone, Debug)]
#[serde(tag = "type")]
pub enum AgentEvent {
	/// Standard ACP notification from the agent process
	Notification {
		/// The JSON-RPC method name
		method: String,
		/// Notification parameters as JSON string
		params: String,
	},
	/// Turn completed successfully
	TurnComplete {
		/// The ACP session ID
		session_id: String,
		/// The stop reason (e.g., "end_turn", "tool_use")
		stop_reason: String,
	},
	/// Error occurred during processing
	Error {
		/// The ACP session ID
		session_id: String,
		/// Error message
		message: String,
	},
}
