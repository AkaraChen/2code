use serde::{Deserialize, Serialize};
use serde_json::Value;

/// Parameters for spawning a new agent session.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NewSessionParams {
	pub cwd: String,
	#[serde(default)]
	pub mcp_servers: Vec<Value>,
}

/// Result of creating a new ACP session (returned by agent's session/new).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NewSessionResult {
	pub session_id: String,
}

/// A content part in a prompt message.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum ContentPart {
	Text { text: String },
}

/// Parameters for sending a prompt to an agent session.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PromptParams {
	pub session_id: String,
	pub prompt: Vec<ContentPart>,
}

/// Result of a prompt request (returned by agent's session/prompt).
/// Note: `messages` is always empty here — actual message content arrives via
/// the ACP notification stream (SessionNotification/AgentMessageChunk), not in
/// the prompt response.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PromptResult {
	pub session_id: String,
	#[serde(default)]
	pub stop_reason: String,
	#[serde(default)]
	pub messages: Vec<Value>,
}

/// Information about an active agent session (returned to frontend).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentSessionInfo {
	pub id: String,
	pub agent: String,
	pub acp_session_id: String,
}

/// A recorded event in an agent session (for persistence and frontend).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentSessionEvent {
	pub event_index: i32,
	pub sender: String,
	pub payload: Value,
	pub created_at: i64,
}
