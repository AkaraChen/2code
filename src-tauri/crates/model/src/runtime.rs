use serde::{Deserialize, Serialize};

/// Dedicated 2code Herdr session namespace. Never the user default.
pub const HERDR_NAMESPACE: &str = "2code";

/// Whether a persisted runtime identity is currently present.
///
/// Computed against the live projection. Mapping rows keep the stored
/// `workspace_id` / `pane_id` and never rebind by label, path, or
/// `terminal_id`.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum RuntimeIdentityState {
	Bound,
	Missing,
	Replaced,
}

/// Which terminal backend is selected for new sessions.
///
/// Application-level only: Herdr protocol/wire types do not belong here.
/// Production default is Local until a later task switches cutover.
#[derive(
	Clone, Copy, Debug, Default, Eq, PartialEq, Serialize, Deserialize,
)]
#[serde(rename_all = "camelCase")]
pub enum RuntimeBackend {
	#[default]
	Local,
	Herdr,
}

impl std::fmt::Display for RuntimeBackend {
	fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
		match self {
			Self::Local => f.write_str("local"),
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

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn herdr_namespace_is_dedicated_2code() {
		assert_eq!(HERDR_NAMESPACE, "2code");
		assert_ne!(HERDR_NAMESPACE, "default");
	}

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
	fn default_backend_is_local() {
		assert_eq!(RuntimeBackend::default(), RuntimeBackend::Local);
	}

	#[test]
	fn herdr_is_not_the_default_backend() {
		assert_ne!(RuntimeBackend::default(), RuntimeBackend::Herdr);
	}

	#[test]
	fn backend_display_is_herdr_agnostic() {
		assert_eq!(RuntimeBackend::Local.to_string(), "local");
		assert_eq!(RuntimeBackend::Herdr.to_string(), "herdr");
	}

	#[test]
	fn discovery_serializes_without_wire_types() {
		let json = serde_json::to_value(RuntimeDiscovery {
			selected_backend: RuntimeBackend::Local,
		})
		.unwrap();
		assert_eq!(json["selectedBackend"], "local");
	}

	#[test]
	fn session_identity_is_the_2code_session_id() {
		let identity = SessionIdentity::new("sess-1");
		assert_eq!(identity.as_str(), "sess-1");
	}
}
