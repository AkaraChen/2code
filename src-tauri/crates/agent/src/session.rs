use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicI32, Ordering};
use std::time::Duration;

use agent_client_protocol_schema::{
	ContentBlock, LoadSessionRequest, LoadSessionResponse, NewSessionRequest,
	NewSessionResponse, PromptRequest, PromptResponse, SessionNotification,
};
use futures::Stream;
use sandbox_agent_agent_management::agents::AgentProcessLaunchSpec;
use serde_json::Value;

use crate::models::{
	AgentModeState, AgentModelOption, AgentModelState, AgentSessionInfo,
	AgentSessionMode, ContentPart, PromptResult,
};
use crate::runtime::{AgentSession, AgentSessionError};

const DEFAULT_TIMEOUT: Option<Duration> = None; // No timeout - wait indefinitely

#[derive(Debug, Clone, Default)]
struct SessionModelRuntimeState {
	current_model_id: Option<String>,
	available_models: Vec<AgentModelOption>,
	config_id: Option<String>,
}

impl SessionModelRuntimeState {
	fn to_public(&self) -> AgentModelState {
		AgentModelState {
			supported: self.current_model_id.is_some()
				|| !self.available_models.is_empty()
				|| self.config_id.is_some(),
			current_model_id: self.current_model_id.clone(),
			available_models: self.available_models.clone(),
		}
	}
}

#[derive(Debug, Clone, Default)]
struct SessionModeRuntimeState {
	current_mode_id: Option<String>,
	available_modes: Vec<AgentSessionMode>,
}

impl SessionModeRuntimeState {
	fn to_public(&self) -> AgentModeState {
		AgentModeState {
			supported: !self.available_modes.is_empty(),
			current_mode_id: self.current_mode_id.clone(),
			available_modes: self.available_modes.clone(),
		}
	}
}

/// A managed agent session that wraps AgentSession with ACP session lifecycle.
pub struct ManagedAgentSession {
	inner: AgentSession,
	pub acp_session_id: String,
	pub local_id: String,
	pub agent: String,
	event_counter: AtomicI32,
	/// Conversation history from a previous session, injected on the first prompt after reconnect.
	pending_history: tokio::sync::Mutex<Option<String>>,
	model_state: tokio::sync::Mutex<SessionModelRuntimeState>,
	mode_state: tokio::sync::Mutex<SessionModeRuntimeState>,
}

impl ManagedAgentSession {
	/// Spawn an agent process, then call ACP `session/new` to initialize a session.
	pub async fn create(
		agent: &str,
		cwd: PathBuf,
		launch_spec: AgentProcessLaunchSpec,
		extra_env: HashMap<String, String>,
	) -> Result<Self, AgentSessionError> {
		let session = AgentSession::spawn(
			agent,
			cwd.clone(),
			extra_env,
			launch_spec,
			DEFAULT_TIMEOUT,
		)
		.await?;

		Self::init_new_session(session, agent, cwd).await
	}

	/// Spawn an agent process from raw launch params, then call ACP `session/new`.
	/// Used for marketplace agents whose distribution spec is stored in the DB.
	pub async fn create_from_raw(
		agent: &str,
		cwd: PathBuf,
		program: PathBuf,
		args: Vec<String>,
		base_env: HashMap<String, String>,
		extra_env: HashMap<String, String>,
	) -> Result<Self, AgentSessionError> {
		let session = AgentSession::spawn_from_raw(
			agent,
			cwd.clone(),
			extra_env,
			program,
			args,
			base_env,
			DEFAULT_TIMEOUT,
		)
		.await?;

		Self::init_new_session(session, agent, cwd).await
	}

	/// Internal: call ACP `session/new` on an already-spawned session.
	async fn init_new_session(
		session: AgentSession,
		agent: &str,
		cwd: PathBuf,
	) -> Result<Self, AgentSessionError> {
		let local_id = session.id.clone();

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

		let result_value = response.get("result").cloned().unwrap_or(response);
		let model_state = parse_model_state_from_response(&result_value);
		let mode_state = parse_mode_state_from_response(&result_value);
		let acp_session_id = match serde_json::from_value::<NewSessionResponse>(
			result_value.clone(),
		) {
			Ok(new_session) => {
				tracing::info!(
					local_id = %local_id,
					acp_session_id = %new_session.session_id,
					modes = ?new_session.modes,
					config_options = ?new_session.config_options,
					model_supported = model_state.to_public().supported,
					mode_supported = mode_state.to_public().supported,
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
			model_supported = model_state.to_public().supported,
			mode_supported = mode_state.to_public().supported,
			"managed agent session created"
		);

		Ok(Self {
			inner: session,
			acp_session_id,
			local_id,
			agent: agent.to_string(),
			event_counter: AtomicI32::new(0),
			pending_history: tokio::sync::Mutex::new(None),
			model_state: tokio::sync::Mutex::new(model_state),
			mode_state: tokio::sync::Mutex::new(mode_state),
		})
	}

	/// Spawn an agent process, then call ACP `session/load` to restore an existing session.
	pub async fn load(
		agent: &str,
		cwd: PathBuf,
		acp_session_id: &str,
		launch_spec: AgentProcessLaunchSpec,
		extra_env: HashMap<String, String>,
	) -> Result<Self, AgentSessionError> {
		let session = AgentSession::spawn(
			agent,
			cwd.clone(),
			extra_env,
			launch_spec,
			DEFAULT_TIMEOUT,
		)
		.await?;

		Self::init_load_session(session, agent, cwd, acp_session_id).await
	}

	/// Spawn an agent process from raw launch params, then call ACP `session/load`.
	pub async fn load_from_raw(
		agent: &str,
		cwd: PathBuf,
		acp_session_id: &str,
		program: PathBuf,
		args: Vec<String>,
		base_env: HashMap<String, String>,
		extra_env: HashMap<String, String>,
	) -> Result<Self, AgentSessionError> {
		let session = AgentSession::spawn_from_raw(
			agent,
			cwd.clone(),
			extra_env,
			program,
			args,
			base_env,
			DEFAULT_TIMEOUT,
		)
		.await?;

		Self::init_load_session(session, agent, cwd, acp_session_id).await
	}

	/// Internal: call ACP `session/load` on an already-spawned session.
	async fn init_load_session(
		session: AgentSession,
		agent: &str,
		cwd: PathBuf,
		acp_session_id: &str,
	) -> Result<Self, AgentSessionError> {
		let local_id = session.id.clone();

		let req = LoadSessionRequest::new(acp_session_id.to_string(), &cwd);
		let params = serde_json::to_value(&req)?;

		tracing::info!(
			local_id = %local_id,
			agent = agent,
			acp_session_id = acp_session_id,
			cwd = %cwd.display(),
			"acp session/load request"
		);

		let response = session.send("session/load", params).await?;

		tracing::info!(
			local_id = %local_id,
			agent = agent,
			response = %response,
			"acp session/load response"
		);

		if let Some(err) = response.get("error") {
			tracing::warn!(
				local_id = %local_id,
				error = %err,
				"acp session/load returned error"
			);
			return Err(AgentSessionError::UnexpectedResponse);
		}

		let result_value = response.get("result").cloned().unwrap_or(response);
		let model_state = parse_model_state_from_response(&result_value);
		let mode_state = parse_mode_state_from_response(&result_value);
		match serde_json::from_value::<LoadSessionResponse>(result_value) {
			Ok(load_resp) => {
				tracing::info!(
					local_id = %local_id,
					acp_session_id = acp_session_id,
					modes = ?load_resp.modes,
					model_supported = model_state.to_public().supported,
					mode_supported = mode_state.to_public().supported,
					"acp session/load parsed successfully"
				);
			}
			Err(e) => {
				tracing::warn!(
					local_id = %local_id,
					error = %e,
					"failed to parse LoadSessionResponse (continuing anyway)"
				);
			}
		}

		tracing::info!(
			local_id = %local_id,
			acp_session_id = acp_session_id,
			agent = agent,
			model_supported = model_state.to_public().supported,
			mode_supported = mode_state.to_public().supported,
			"managed agent session loaded"
		);

		Ok(Self {
			inner: session,
			acp_session_id: acp_session_id.to_string(),
			local_id,
			agent: agent.to_string(),
			event_counter: AtomicI32::new(0),
			pending_history: tokio::sync::Mutex::new(None),
			model_state: tokio::sync::Mutex::new(model_state),
			mode_state: tokio::sync::Mutex::new(mode_state),
		})
	}

	/// Read current model state for this managed session.
	pub async fn model_state(&self) -> AgentModelState {
		self.model_state.lock().await.to_public()
	}

	/// Read current mode state for this managed session.
	pub async fn mode_state(&self) -> AgentModeState {
		self.mode_state.lock().await.to_public()
	}

	/// Update the mode state from a `current_mode_update` notification.
	pub async fn apply_mode_update(&self, mode_id: &str) -> AgentModeState {
		let mut guard = self.mode_state.lock().await;
		guard.current_mode_id = Some(mode_id.to_string());
		guard.to_public()
	}

	/// Switch to a different model.
	///
	/// ACP compatibility strategy:
	/// 1) Try unstable `session/set_model` first.
	/// 2) Fallback to stable `session/set_config_option` with model-like selector.
	pub async fn set_model(
		&self,
		model_id: &str,
	) -> Result<AgentModelState, AgentSessionError> {
		let request = serde_json::json!({
			"sessionId": self.acp_session_id,
			"modelId": model_id,
		});

		let direct_result = self.inner.send("session/set_model", request).await;
		if let Ok(response) = direct_result {
			if response.get("error").is_none() {
				let parsed = parse_model_state_from_response(
					&response.get("result").cloned().unwrap_or(response),
				);
				return Ok(self
					.commit_model_state(parsed, Some(model_id))
					.await);
			}
		}

		let config_id = {
			let guard = self.model_state.lock().await;
			guard
				.config_id
				.clone()
				.unwrap_or_else(|| "model".to_string())
		};
		let request = serde_json::json!({
			"sessionId": self.acp_session_id,
			"configId": config_id,
			"value": model_id,
		});

		let response = self
			.inner
			.send("session/set_config_option", request)
			.await?;

		if let Some(err) = response.get("error") {
			tracing::warn!(
				local_id = %self.local_id,
				acp_session_id = %self.acp_session_id,
				error = %err,
				"failed to set model via session/set_config_option"
			);
			return Err(AgentSessionError::UnexpectedResponse);
		}

		let parsed = parse_model_state_from_response(
			&response.get("result").cloned().unwrap_or(response),
		);
		Ok(self.commit_model_state(parsed, Some(model_id)).await)
	}

	/// Switch to a different session mode.
	pub async fn set_mode(
		&self,
		mode_id: &str,
	) -> Result<AgentModeState, AgentSessionError> {
		let request = serde_json::json!({
			"sessionId": self.acp_session_id,
			"modeId": mode_id,
		});

		tracing::info!(
			local_id = %self.local_id,
			acp_session_id = %self.acp_session_id,
			mode_id = mode_id,
			"acp session/set_mode request"
		);

		let response = self.inner.send("session/set_mode", request).await?;

		if let Some(err) = response.get("error") {
			tracing::warn!(
				local_id = %self.local_id,
				acp_session_id = %self.acp_session_id,
				error = %err,
				"failed to set mode via session/set_mode"
			);
			return Err(AgentSessionError::UnexpectedResponse);
		}

		// Optimistically update internal state
		let mode_state = self.apply_mode_update(mode_id).await;

		tracing::info!(
			local_id = %self.local_id,
			acp_session_id = %self.acp_session_id,
			mode_id = mode_id,
			"acp session/set_mode success"
		);

		Ok(mode_state)
	}

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

		if let Some(err) = response.get("error") {
			tracing::warn!(
				local_id = %self.local_id,
				acp_session_id = %self.acp_session_id,
				error = %err,
				"acp session/prompt returned error"
			);
			return Err(AgentSessionError::UnexpectedResponse);
		}

		self.event_counter.fetch_add(1, Ordering::Relaxed);

		let result_value = response.get("result").cloned().unwrap_or(response);
		let prompt_result =
			match serde_json::from_value::<PromptResponse>(result_value) {
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

		let parsed = params.and_then(|p| {
			serde_json::from_value::<SessionNotification>(p.clone()).ok()
		});

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

	/// Set pending history to be injected on the next prompt (first prompt after reconnect).
	pub async fn set_pending_history(&self, history: String) {
		*self.pending_history.lock().await = Some(history);
	}

	/// Take pending history (consumed on first call, returns None afterwards).
	pub async fn take_pending_history(&self) -> Option<String> {
		self.pending_history.lock().await.take()
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

	async fn commit_model_state(
		&self,
		parsed: SessionModelRuntimeState,
		fallback_model_id: Option<&str>,
	) -> AgentModelState {
		let mut next = parsed;
		let mut guard = self.model_state.lock().await;
		if next.available_models.is_empty() {
			next.available_models = guard.available_models.clone();
		}
		if next.config_id.is_none() {
			next.config_id = guard.config_id.clone();
		}
		if next.current_model_id.is_none() {
			next.current_model_id = fallback_model_id.map(ToOwned::to_owned);
		}
		*guard = next.clone();
		next.to_public()
	}
}

fn parse_model_state_from_response(result: &Value) -> SessionModelRuntimeState {
	let mut state = SessionModelRuntimeState::default();

	if let Some(models) = result.get("models") {
		if let Some(current) =
			models.get("currentModelId").and_then(Value::as_str)
		{
			state.current_model_id = Some(current.to_string());
		}
		if let Some(available) =
			models.get("availableModels").and_then(Value::as_array)
		{
			state.available_models = available
				.iter()
				.filter_map(|item| {
					let model_id =
						item.get("modelId").and_then(Value::as_str)?;
					let name = item
						.get("name")
						.and_then(Value::as_str)
						.unwrap_or(model_id);
					let description = item
						.get("description")
						.and_then(Value::as_str)
						.map(ToOwned::to_owned);
					Some(AgentModelOption {
						model_id: model_id.to_string(),
						name: name.to_string(),
						description,
					})
				})
				.collect();
		}
	}

	if let Some(config_options) =
		result.get("configOptions").and_then(Value::as_array)
	{
		for option in config_options {
			let id = option.get("id").and_then(Value::as_str);
			let category = option.get("category").and_then(Value::as_str);
			let is_model_selector = category == Some("model")
				|| id.map(|v| v == "model").unwrap_or(false);
			if !is_model_selector {
				continue;
			}

			let Some(config_id) = id else { continue };
			state.config_id = Some(config_id.to_string());

			if state.current_model_id.is_none() {
				state.current_model_id = option
					.get("currentValue")
					.and_then(Value::as_str)
					.map(ToOwned::to_owned);
			}

			if state.available_models.is_empty() {
				let mut options = Vec::new();
				if let Some(raw_options) =
					option.get("options").and_then(Value::as_array)
				{
					for raw_option in raw_options {
						if let Some(value) =
							raw_option.get("value").and_then(Value::as_str)
						{
							let name = raw_option
								.get("name")
								.and_then(Value::as_str)
								.unwrap_or(value);
							let description = raw_option
								.get("description")
								.and_then(Value::as_str)
								.map(ToOwned::to_owned);
							options.push(AgentModelOption {
								model_id: value.to_string(),
								name: name.to_string(),
								description,
							});
							continue;
						}

						if let Some(group_options) =
							raw_option.get("options").and_then(Value::as_array)
						{
							for group_option in group_options {
								let Some(value) = group_option
									.get("value")
									.and_then(Value::as_str)
								else {
									continue;
								};
								let name = group_option
									.get("name")
									.and_then(Value::as_str)
									.unwrap_or(value);
								let description = group_option
									.get("description")
									.and_then(Value::as_str)
									.map(ToOwned::to_owned);
								options.push(AgentModelOption {
									model_id: value.to_string(),
									name: name.to_string(),
									description,
								});
							}
						}
					}
				}
				state.available_models = options;
			}
		}
	}

	state
}

fn parse_mode_state_from_response(result: &Value) -> SessionModeRuntimeState {
	let mut state = SessionModeRuntimeState::default();

	if let Some(modes) = result.get("modes") {
		if let Some(current) =
			modes.get("currentModeId").and_then(Value::as_str)
		{
			state.current_mode_id = Some(current.to_string());
		}
		if let Some(available) =
			modes.get("availableModes").and_then(Value::as_array)
		{
			state.available_modes = available
				.iter()
				.filter_map(|item| {
					let id = item.get("id").and_then(Value::as_str)?;
					let name =
						item.get("name").and_then(Value::as_str).unwrap_or(id);
					let description = item
						.get("description")
						.and_then(Value::as_str)
						.map(ToOwned::to_owned);
					Some(AgentSessionMode {
						id: id.to_string(),
						name: name.to_string(),
						description,
					})
				})
				.collect();
		}
	}

	state
}

#[cfg(test)]
mod tests {
	use super::*;
	use serde_json::json;

	#[test]
	fn test_parse_model_state_from_models_field() {
		let payload = json!({
			"models": {
				"currentModelId": "gpt-5",
				"availableModels": [
					{ "modelId": "gpt-5", "name": "GPT-5" },
					{ "modelId": "gpt-4.1", "name": "GPT-4.1", "description": "Fast" }
				]
			}
		});

		let state = parse_model_state_from_response(&payload);
		assert_eq!(state.current_model_id.as_deref(), Some("gpt-5"));
		assert_eq!(state.available_models.len(), 2);
		assert_eq!(
			state.available_models[1].description.as_deref(),
			Some("Fast")
		);
	}

	#[test]
	fn test_parse_model_state_from_config_options_field() {
		let payload = json!({
			"configOptions": [
				{
					"id": "model",
					"name": "Model",
					"category": "model",
					"type": "select",
					"currentValue": "claude-sonnet-4",
					"options": [
						{ "value": "claude-sonnet-4", "name": "Claude Sonnet 4" },
						{
							"group": "legacy",
							"name": "Legacy",
							"options": [
								{ "value": "claude-3.5-sonnet", "name": "Claude 3.5 Sonnet" }
							]
						}
					]
				}
			]
		});

		let state = parse_model_state_from_response(&payload);
		assert_eq!(state.current_model_id.as_deref(), Some("claude-sonnet-4"));
		assert_eq!(state.config_id.as_deref(), Some("model"));
		assert_eq!(state.available_models.len(), 2);
	}

	#[test]
	fn test_parse_notification_valid() {
		let value = json!({
			"jsonrpc": "2.0",
			"method": "session/update",
			"params": {
				"sessionId": "mock-session-001",
				"update": {
					"sessionUpdate": "agent_message_chunk",
					"content": {
						"type": "text",
						"text": "Hello"
					}
				}
			}
		});
		let result = ManagedAgentSession::parse_notification(&value);
		assert!(result.is_some());
		let notif = result.unwrap();
		assert_eq!(notif.session_id.to_string(), "mock-session-001");
	}

	#[test]
	fn test_parse_notification_missing_params() {
		let value = json!({
			"jsonrpc": "2.0",
			"method": "session/update"
		});
		let result = ManagedAgentSession::parse_notification(&value);
		assert!(result.is_none());
	}

	#[test]
	fn test_parse_notification_invalid_params() {
		let value = json!({
			"jsonrpc": "2.0",
			"method": "session/update",
			"params": {
				"invalid": "data"
			}
		});
		let result = ManagedAgentSession::parse_notification(&value);
		assert!(result.is_none());
	}

	#[test]
	fn test_parse_notification_no_method() {
		let value = json!({
			"jsonrpc": "2.0",
			"params": {
				"sessionId": "mock-session-001",
				"update": {
					"sessionUpdate": "agent_message_chunk",
					"content": {
						"type": "text",
						"text": "Hello"
					}
				}
			}
		});
		let result = ManagedAgentSession::parse_notification(&value);
		assert!(result.is_some());
	}

	#[test]
	fn test_parse_notification_null_params() {
		let value = json!({
			"jsonrpc": "2.0",
			"method": "session/update",
			"params": null
		});
		let result = ManagedAgentSession::parse_notification(&value);
		assert!(result.is_none());
	}
}
