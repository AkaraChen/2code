pub mod manager;
pub mod models;
pub mod runtime;
pub mod session;

use std::collections::HashMap;
use std::sync::Arc;

use tokio::sync::Mutex;

pub use manager::{
	AgentManagerWrapper, AgentStatusInfo, CredentialEntry, CredentialInfo,
};
pub use models::{
	AgentSessionEvent, AgentSessionInfo, ContentPart, PromptResult,
};
pub use runtime::{AgentSession, AgentSessionError};
pub use sandbox_agent_agent_management::agents::{
	AgentProcessLaunchSpec, InstallSource,
};
pub use session::ManagedAgentSession;

/// Map of local session ID → active ManagedAgentSession.
pub type AgentSessionMap =
	Arc<Mutex<HashMap<String, Arc<ManagedAgentSession>>>>;

pub fn create_agent_session_map() -> AgentSessionMap {
	Arc::new(Mutex::new(HashMap::new()))
}
