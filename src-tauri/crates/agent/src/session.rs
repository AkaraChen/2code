use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicI32, Ordering};
use std::time::Duration;

use agent_client_protocol_schema::{
	ContentBlock, NewSessionRequest, NewSessionResponse, PromptRequest, PromptResponse,
	SessionNotification,
};
use futures::Stream;
use sandbox_agent_agent_management::agents::AgentProcessLaunchSpec;
use serde_json::Value;

use crate::models::{AgentSessionInfo, ContentPart, PromptResult};
use crate::runtime::{AgentSession, AgentSessionError};

const DEFAULT_TIMEOUT: Duration = Duration::from_secs(120);

/// A managed agent session that wraps AgentSession with ACP session lifecycle.
pub struct ManagedAgentSession {
	inner: AgentSession,
	pub acp_session_id: String,
	pub local_id: String,
	pub agent: String,
	event_counter: AtomicI32,
}

impl ManagedAgentSession {
	/// Spawn an agent process, then call ACP `session/new` to initialize a session.
	pub async fn create(
		agent: &str,
		cwd: PathBuf,
		launch_spec: AgentProcessLaunchSpec,
		extra_env: HashMap<String, String>,
	) -> Result<Self, AgentSessionError> {
		let session =
			AgentSession::spawn(agent, cwd.clone(), extra_env, launch_spec, DEFAULT_TIMEOUT)
				.await?;

		let local_id = session.id.clone();

		// Call ACP session/new to initialize a session with the agent
		let req = NewSessionRequest::new(&cwd);
		let params = serde_json::to_value(&req)?;

		tracing::info!(
			local_id = %local_id,
			agent = agent,
			cwd = %cwd.display(),
			params = %params,
			"acp session/new request"
		);

		let response = session.send("session/new", params).await?;

		tracing::info!(
			local_id = %local_id,
			agent = agent,
			response = %response,
			"acp session/new response"
		);

		// Extract sessionId from JSON-RPC response using SDK type
		let result_value = response.get("result").cloned().unwrap_or(response);
		let acp_session_id = match serde_json::from_value::<NewSessionResponse>(result_value) {
			Ok(new_session) => {
				tracing::info!(
					local_id = %local_id,
					acp_session_id = %new_session.session_id,
					modes = ?new_session.modes,
					config_options = ?new_session.config_options,
					"acp session/new parsed successfully"
				);
				new_session.session_id.to_string()
			}
			Err(e) => {
				tracing::warn!(
					local_id = %local_id,
					error = %e,
					"failed to parse NewSessionResponse, falling back to local_id"
				);
				local_id.clone()
			}
		};

		tracing::info!(
			local_id = %local_id,
			acp_session_id = %acp_session_id,
			agent = agent,
			"managed agent session created"
		);

		Ok(Self {
			inner: session,
			acp_session_id,
			local_id,
			agent: agent.to_string(),
			event_counter: AtomicI32::new(0),
		})
	}

	/// Send a prompt to the agent and return the result.
	pub async fn prompt(
		&self,
		content: Vec<ContentPart>,
	) -> Result<PromptResult, AgentSessionError> {
		let prompt: Vec<ContentBlock> = content
			.into_iter()
			.map(|part| match part {
				ContentPart::Text { text } => ContentBlock::from(text),
			})
			.collect();

		let req = PromptRequest::new(self.acp_session_id.clone(), prompt);
		let params = serde_json::to_value(&req)?;

		tracing::info!(
			local_id = %self.local_id,
			acp_session_id = %self.acp_session_id,
			params = %params,
			"acp session/prompt request"
		);

		let response = self.inner.send("session/prompt", params).await?;

		tracing::info!(
			local_id = %self.local_id,
			acp_session_id = %self.acp_session_id,
			response = %response,
			"acp session/prompt response"
		);

		self.event_counter.fetch_add(1, Ordering::Relaxed);

		// Parse the response using SDK type
		let result_value = response.get("result").cloned().unwrap_or(response);
		let prompt_result = match serde_json::from_value::<PromptResponse>(result_value) {
			Ok(resp) => {
				tracing::info!(
					local_id = %self.local_id,
					acp_session_id = %self.acp_session_id,
					stop_reason = ?resp.stop_reason,
					"acp session/prompt parsed successfully"
				);
				PromptResult {
					session_id: self.acp_session_id.clone(),
					stop_reason: format!("{:?}", resp.stop_reason),
					messages: vec![],
				}
			}
			Err(e) => {
				tracing::warn!(
					local_id = %self.local_id,
					acp_session_id = %self.acp_session_id,
					error = %e,
					"failed to parse PromptResponse"
				);
				PromptResult {
					session_id: self.acp_session_id.clone(),
					stop_reason: "unknown".to_string(),
					messages: vec![],
				}
			}
		};

		Ok(prompt_result)
	}

	/// Parse a raw JSON-RPC notification into a structured SessionNotification.
	pub fn parse_notification(value: &Value) -> Option<SessionNotification> {
		let method = value.get("method").and_then(|m| m.as_str());
		let params = value.get("params");

		tracing::debug!(
			method = ?method,
			raw = %value,
			"acp incoming notification (raw)"
		);

		let parsed = params
			.and_then(|p| serde_json::from_value::<SessionNotification>(p.clone()).ok());

		if let Some(ref notif) = parsed {
			tracing::info!(
				acp_session_id = %notif.session_id,
				update = ?notif.update,
				"acp notification parsed"
			);
		} else {
			tracing::debug!(
				method = ?method,
				"acp notification: not a SessionNotification (or parse failed)"
			);
		}

		parsed
	}

	/// Get the notification stream from the agent process.
	pub async fn notifications(&self) -> impl Stream<Item = Value> {
		self.inner.notifications().await
	}

	/// Get session info for returning to the frontend.
	pub fn info(&self) -> AgentSessionInfo {
		AgentSessionInfo {
			id: self.local_id.clone(),
			agent: self.agent.clone(),
			acp_session_id: self.acp_session_id.clone(),
		}
	}

	/// Gracefully shut down the agent session.
	pub async fn shutdown(&self) {
		tracing::info!(
			local_id = %self.local_id,
			acp_session_id = %self.acp_session_id,
			agent = %self.agent,
			"shutting down managed agent session"
		);
		self.inner.shutdown().await;
	}
}
