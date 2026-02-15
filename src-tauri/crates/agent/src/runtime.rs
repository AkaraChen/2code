use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use acp_client::{AcpClient, AdapterError};
use futures::Stream;
use sandbox_agent_agent_management::agents::AgentProcessLaunchSpec;
use serde_json::Value;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum AgentSessionError {
	#[error("failed to spawn agent: {0}")]
	Spawn(#[from] AdapterError),
	#[error("failed to parse response: {0}")]
	ParseError(#[from] serde_json::Error),
	#[error("unexpected response from agent")]
	UnexpectedResponse,
}

pub struct AgentSession {
	pub id: String,
	pub agent: String,
	pub cwd: PathBuf,
	runtime: Arc<AcpClient>,
}

impl AgentSession {
	/// Spawn an agent ACP process in the given working directory.
	pub async fn spawn(
		agent: &str,
		cwd: PathBuf,
		extra_env: HashMap<String, String>,
		launch_spec: AgentProcessLaunchSpec,
		timeout: Duration,
	) -> Result<Self, AgentSessionError> {
		let mut env = launch_spec.env;
		env.insert("PWD".to_string(), cwd.display().to_string());
		// Extra env (API keys etc.) override launch_spec env
		env.extend(extra_env);

		tracing::info!(
			agent = agent,
			cwd = %cwd.display(),
			"spawning agent session"
		);

		let runtime = Arc::new(
			AcpClient::spawn_with_timeout(
				launch_spec.program,
				launch_spec.args,
				env,
				timeout,
			)
			.await?,
		);
		let id = uuid::Uuid::new_v4().to_string();

		Ok(Self {
			id,
			agent: agent.to_string(),
			cwd,
			runtime,
		})
	}

	/// Send a JSON-RPC request and wait for the response.
	pub async fn send(
		&self,
		method: &str,
		params: Value,
	) -> Result<Value, AgentSessionError> {
		tracing::debug!(
			session_id = %self.id,
			method = method,
			"sending acp request"
		);

		let response = self.runtime.request(method, params).await?;

		tracing::debug!(
			session_id = %self.id,
			method = method,
			"received acp response"
		);

		Ok(response)
	}

	/// Send a JSON-RPC notification (fire-and-forget, no response expected).
	pub async fn notify(
		&self,
		method: &str,
		params: Value,
	) -> Result<(), AgentSessionError> {
		tracing::debug!(
			session_id = %self.id,
			method = method,
			"sending acp notification"
		);

		self.runtime.notify(method, params).await?;
		Ok(())
	}

	/// Get a stream of notifications pushed by the agent.
	pub async fn notifications(&self) -> impl Stream<Item = Value> {
		self.runtime.notifications()
	}

	/// Gracefully shut down the agent process.
	pub async fn shutdown(&self) {
		tracing::info!(
			session_id = %self.id,
			agent = %self.agent,
			"shutting down agent session"
		);
		self.runtime.shutdown().await;
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn test_agent_session_error_display_parse() {
		let bad_json: Result<serde_json::Value, _> =
			serde_json::from_str("not json");
		let serde_err = bad_json.unwrap_err();
		let err = AgentSessionError::ParseError(serde_err);
		assert!(err.to_string().starts_with("failed to parse response:"));
	}

	#[test]
	fn test_agent_session_error_is_send_sync() {
		fn assert_send<T: Send>() {}
		fn assert_sync<T: Sync>() {}
		assert_send::<AgentSessionError>();
		assert_sync::<AgentSessionError>();
	}
}
