use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;

use acp_http_adapter::process::{AdapterError, AdapterRuntime, PostOutcome};
use acp_http_adapter::registry::LaunchSpec;
use futures::Stream;
use sandbox_agent_agent_management::agents::AgentProcessLaunchSpec;
use serde_json::{json, Value};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum AgentSessionError {
    #[error("failed to spawn agent: {0}")]
    Spawn(#[from] AdapterError),
    #[error("unexpected response type")]
    UnexpectedResponse,
}

pub struct AgentSession {
    pub id: String,
    pub agent: String,
    pub cwd: PathBuf,
    runtime: Arc<AdapterRuntime>,
    request_id: AtomicU64,
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

        let launch = LaunchSpec {
            program: launch_spec.program,
            args: launch_spec.args,
            env,
        };

        tracing::info!(
            agent = agent,
            cwd = %cwd.display(),
            "spawning agent session"
        );

        let runtime = Arc::new(AdapterRuntime::start(launch, timeout).await?);
        let id = uuid::Uuid::new_v4().to_string();

        Ok(Self {
            id,
            agent: agent.to_string(),
            cwd,
            runtime,
            request_id: AtomicU64::new(1),
        })
    }

    fn next_id(&self) -> u64 {
        self.request_id.fetch_add(1, Ordering::Relaxed)
    }

    /// Send a JSON-RPC request and wait for the response.
    pub async fn send(&self, method: &str, params: Value) -> Result<Value, AgentSessionError> {
        let id = self.next_id();
        let payload = json!({
            "jsonrpc": "2.0",
            "id": id,
            "method": method,
            "params": params,
        });

        match self.runtime.post(payload).await? {
            PostOutcome::Response(value) => Ok(value),
            PostOutcome::Accepted => Err(AgentSessionError::UnexpectedResponse),
        }
    }

    /// Send a JSON-RPC notification (fire-and-forget, no response expected).
    pub async fn notify(&self, method: &str, params: Value) -> Result<(), AgentSessionError> {
        let payload = json!({
            "jsonrpc": "2.0",
            "method": method,
            "params": params,
        });

        self.runtime.post(payload).await?;
        Ok(())
    }

    /// Get a stream of notifications pushed by the agent.
    pub async fn notifications(&self) -> impl Stream<Item = Value> {
        self.runtime.clone().value_stream(None).await
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
