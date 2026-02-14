use std::sync::Arc;

use agent::{AgentManagerWrapper, AgentStatusInfo, CredentialInfo};
use tauri::State;

#[tauri::command]
pub fn list_agent_status(
	state: State<'_, Arc<AgentManagerWrapper>>,
) -> Result<Vec<AgentStatusInfo>, String> {
	Ok(state.list_status())
}

#[tauri::command]
pub async fn install_agent(
	agent: String,
	state: State<'_, Arc<AgentManagerWrapper>>,
) -> Result<(), String> {
	let manager = state.inner().clone();
	tokio::task::spawn_blocking(move || manager.install(&agent))
		.await
		.map_err(|e| e.to_string())?
		.map_err(|e| format!("{e}"))?;
	Ok(())
}

#[tauri::command]
pub fn detect_credentials(
	state: State<'_, Arc<AgentManagerWrapper>>,
) -> CredentialInfo {
	state.detect_credentials()
}
