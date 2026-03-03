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

/// A selectable model exposed by an agent session.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentModelOption {
	pub model_id: String,
	pub name: String,
	#[serde(default)]
	pub description: Option<String>,
}

/// Current model state for a managed agent session.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct AgentModelState {
	pub supported: bool,
	#[serde(default)]
	pub current_model_id: Option<String>,
	#[serde(default)]
	pub available_models: Vec<AgentModelOption>,
}

/// A named operating mode exposed by an agent session (e.g. ask, architect, code).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentSessionMode {
	pub id: String,
	pub name: String,
	#[serde(default)]
	pub description: Option<String>,
}

/// Current session mode state returned by the agent.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct AgentModeState {
	/// Whether the agent supports session modes at all.
	pub supported: bool,
	#[serde(default)]
	pub current_mode_id: Option<String>,
	#[serde(default)]
	pub available_modes: Vec<AgentSessionMode>,
}

/// A recorded event in an agent session (for persistence and frontend).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentSessionEvent {
	pub event_index: i32,
	pub sender: String,
	pub payload: Value,
	pub created_at: i64,
}

#[cfg(test)]
mod tests {
	use super::*;
	use serde_json::json;

	#[test]
	fn test_content_part_serialization() {
		let part = ContentPart::Text {
			text: "hello world".to_string(),
		};
		let json = serde_json::to_value(&part).unwrap();
		assert_eq!(json, json!({"type": "text", "text": "hello world"}));
	}

	#[test]
	fn test_content_part_deserialization() {
		let json = json!({"type": "text", "text": "hello world"});
		let part: ContentPart = serde_json::from_value(json).unwrap();
		match part {
			ContentPart::Text { text } => assert_eq!(text, "hello world"),
		}
	}

	#[test]
	fn test_content_part_roundtrip() {
		let original = ContentPart::Text {
			text: "roundtrip test".to_string(),
		};
		let serialized = serde_json::to_string(&original).unwrap();
		let deserialized: ContentPart =
			serde_json::from_str(&serialized).unwrap();
		match deserialized {
			ContentPart::Text { text } => {
				assert_eq!(text, "roundtrip test")
			}
		}
	}

	#[test]
	fn test_prompt_result_default_fields() {
		let json = json!({"session_id": "s1"});
		let result: PromptResult = serde_json::from_value(json).unwrap();
		assert_eq!(result.session_id, "s1");
		assert_eq!(result.stop_reason, "");
		assert!(result.messages.is_empty());
	}

	#[test]
	fn test_prompt_result_full() {
		let json = json!({
			"session_id": "s1",
			"stop_reason": "endTurn",
			"messages": [{"role": "assistant", "content": "hi"}]
		});
		let result: PromptResult = serde_json::from_value(json).unwrap();
		assert_eq!(result.session_id, "s1");
		assert_eq!(result.stop_reason, "endTurn");
		assert_eq!(result.messages.len(), 1);
	}

	#[test]
	fn test_agent_session_info_roundtrip() {
		let info = AgentSessionInfo {
			id: "local-123".to_string(),
			agent: "claude".to_string(),
			acp_session_id: "acp-456".to_string(),
		};
		let json = serde_json::to_value(&info).unwrap();
		let deserialized: AgentSessionInfo =
			serde_json::from_value(json).unwrap();
		assert_eq!(deserialized.id, "local-123");
		assert_eq!(deserialized.agent, "claude");
		assert_eq!(deserialized.acp_session_id, "acp-456");
	}

	#[test]
	fn test_agent_session_event_serialization() {
		let event = AgentSessionEvent {
			event_index: 0,
			sender: "agent".to_string(),
			payload: json!({"text": "hello"}),
			created_at: 1700000000,
		};
		let json = serde_json::to_value(&event).unwrap();
		assert_eq!(json["event_index"], 0);
		assert_eq!(json["sender"], "agent");
		assert_eq!(json["payload"]["text"], "hello");
		assert_eq!(json["created_at"], 1700000000i64);
	}

	#[test]
	fn test_new_session_params_serialization() {
		let params = NewSessionParams {
			cwd: "/tmp/test".to_string(),
			mcp_servers: vec![],
		};
		let json = serde_json::to_value(&params).unwrap();
		assert_eq!(json["cwd"], "/tmp/test");
		assert_eq!(json["mcp_servers"], json!([]));
	}

	#[test]
	fn test_new_session_result_deserialization() {
		let json = json!({"session_id": "mock-001"});
		let result: NewSessionResult = serde_json::from_value(json).unwrap();
		assert_eq!(result.session_id, "mock-001");
	}

	#[test]
	fn test_prompt_params_serialization() {
		let params = PromptParams {
			session_id: "s1".to_string(),
			prompt: vec![ContentPart::Text {
				text: "hello".to_string(),
			}],
		};
		let json = serde_json::to_value(&params).unwrap();
		assert_eq!(json["session_id"], "s1");
		assert_eq!(json["prompt"][0]["type"], "text");
		assert_eq!(json["prompt"][0]["text"], "hello");
	}
}
