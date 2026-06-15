use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum AgentStatus {
	Running,
	Waiting,
	Idle,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentStatusEvent {
	pub session_id: String,
	pub status: AgentStatus,
}

/// Response from /notify endpoint — shared between server and CLI
#[derive(Debug, Serialize, Deserialize)]
pub struct NotifyResponse {
	pub played: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct StatusResponse {
	pub emitted: bool,
}

/// Notification settings as stored in settings.json
/// Matches zustand persist middleware format:
/// { "notification-settings": { "state": { "enabled": bool, "sound": "Ping" }, "version": 0 } }
#[derive(Debug, Deserialize)]
pub struct NotificationEntry {
	pub state: NotificationState,
}

#[derive(Debug, Deserialize)]
pub struct NotificationState {
	pub enabled: bool,
	pub sound: String,
}
