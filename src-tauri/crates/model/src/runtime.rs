use serde::{Deserialize, Serialize};

/// Whether a persisted runtime identity is currently present.
///
/// Computed against the live projection by stored `workspace_id` /
/// `pane_id` only. Labels, paths, and `terminal_id` are never keys.
/// [`RuntimeIdentityState::Replaced`] is only for an explicit
/// caller-supplied new id.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum RuntimeIdentityState {
	Bound,
	Missing,
	Replaced,
}

/// Which terminal backend is selected for new sessions.
///
/// Application-level only: Herdr protocol/wire types do not belong here.
/// Production is Herdr-only.
#[derive(
	Clone, Copy, Debug, Default, Eq, PartialEq, Serialize, Deserialize,
)]
#[serde(rename_all = "camelCase")]
pub enum RuntimeBackend {
	#[default]
	Herdr,
}

impl std::fmt::Display for RuntimeBackend {
	fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
		match self {
			Self::Herdr => f.write_str("herdr"),
		}
	}
}

/// 2code session identity. Handlers keep using the session id string
/// at the IPC boundary; mapping onto Herdr pane/tab IDs is later work.
#[derive(Clone, Debug, Eq, Hash, PartialEq)]
pub struct SessionIdentity {
	pub id: String,
}

impl SessionIdentity {
	pub fn new(id: impl Into<String>) -> Self {
		Self { id: id.into() }
	}

	pub fn as_str(&self) -> &str {
		&self.id
	}
}

/// Which backend owns a live session identity.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SessionOwnership {
	pub session: SessionIdentity,
	pub backend: RuntimeBackend,
}

/// Result of creating a terminal session. IPC still returns the session id.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CreateSessionResult {
	pub session_id: String,
}

/// Which backend is active for new sessions.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeDiscovery {
	pub selected_backend: RuntimeBackend,
}

/// Decoded Herdr terminal frame for IPC. Not CLI wire JSON: no `type`,
/// `encoding`, or base64 payload.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HerdrTerminalFrame {
	pub seq: u64,
	pub full: bool,
	pub width: u16,
	pub height: u16,
	pub bytes: Vec<u8>,
}

/// Application scroll request. Converted to CLI `terminal.scroll` in
/// the Herdr helper; `lines` must be `> 0`.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TerminalScrollDirection {
	Up,
	Down,
}

/// Whether the GUI scroll came from a wheel or a page key.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TerminalScrollSource {
	Wheel,
	PageKey,
}

/// Herdr agent lifecycle projected onto a 2code session.
///
/// `status` is the raw Herdr `agent_status` string. `session_id` is the
/// 2code id after `pane_id` mapping. Not a wire event envelope.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionAgentStatus {
	pub session_id: String,
	pub status: String,
	pub agent_name: Option<String>,
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn identity_states_are_explicit_and_distinct() {
		assert_ne!(RuntimeIdentityState::Bound, RuntimeIdentityState::Missing);
		assert_ne!(
			RuntimeIdentityState::Missing,
			RuntimeIdentityState::Replaced
		);
		assert_ne!(RuntimeIdentityState::Bound, RuntimeIdentityState::Replaced);
	}

	#[test]
	fn default_backend_is_herdr() {
		assert_eq!(RuntimeBackend::default(), RuntimeBackend::Herdr);
	}

	#[test]
	fn backend_display_is_herdr() {
		assert_eq!(RuntimeBackend::Herdr.to_string(), "herdr");
	}

	#[test]
	fn discovery_serializes_without_wire_types() {
		let json = serde_json::to_value(RuntimeDiscovery {
			selected_backend: RuntimeBackend::Herdr,
		})
		.unwrap();
		assert_eq!(json["selectedBackend"], "herdr");
		assert!(json.get("local").is_none());
	}

	#[test]
	fn session_identity_is_the_2code_session_id() {
		let identity = SessionIdentity::new("sess-1");
		assert_eq!(identity.as_str(), "sess-1");
	}

	#[test]
	fn herdr_frame_serializes_without_wire_json() {
		let json = serde_json::to_value(HerdrTerminalFrame {
			seq: 1,
			full: true,
			width: 80,
			height: 24,
			bytes: b"hi".to_vec(),
		})
		.unwrap();
		assert_eq!(json["seq"], 1);
		assert_eq!(json["full"], true);
		assert!(json.get("type").is_none());
		assert!(json.get("encoding").is_none());
		assert!(json.get("bytes").is_some());
	}

	#[test]
	fn session_agent_status_serializes_without_wire_json() {
		let json = serde_json::to_value(SessionAgentStatus {
			session_id: "sess-1".into(),
			status: "working".into(),
			agent_name: Some("Claude Code".into()),
		})
		.unwrap();
		assert_eq!(json["sessionId"], "sess-1");
		assert_eq!(json["status"], "working");
		assert_eq!(json["agentName"], "Claude Code");
		assert!(json.get("type").is_none());
		assert!(json.get("pane_id").is_none());
		assert!(json.get("paneId").is_none());
		assert!(json.get("agent_status").is_none());
		assert!(json.get("display_agent").is_none());
	}

	#[test]
	fn scroll_enums_serialize_without_cli_wire_fields() {
		assert_eq!(
			serde_json::to_value(TerminalScrollDirection::Up).unwrap(),
			"up"
		);
		assert_eq!(
			serde_json::to_value(TerminalScrollSource::PageKey).unwrap(),
			"pageKey"
		);
	}
}
