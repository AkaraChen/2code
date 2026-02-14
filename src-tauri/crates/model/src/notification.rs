use serde::{Deserialize, Serialize};

/// Response from /notify endpoint — shared between server and CLI
#[derive(Debug, Serialize, Deserialize)]
pub struct NotifyResponse {
	pub played: bool,
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
