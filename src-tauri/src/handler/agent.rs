use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use agent::{
	AgentManagerWrapper, AgentSessionInfo, AgentSessionMap, AgentStatusInfo,
	ContentPart, CredentialInfo, ManagedAgentSession,
};
use futures::StreamExt;
use tauri::{AppHandle, Emitter, State};
use tokio::sync::Mutex;
use tokio::task::JoinHandle;
use tokio::time::timeout;

type NotificationTaskMap = Arc<Mutex<HashMap<String, JoinHandle<()>>>>;

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

#[tauri::command]
pub async fn spawn_agent_session(
	agent: String,
	cwd: String,
	app: AppHandle,
	manager: State<'_, Arc<AgentManagerWrapper>>,
	sessions: State<'_, AgentSessionMap>,
	tasks: State<'_, NotificationTaskMap>,
) -> Result<AgentSessionInfo, String> {
	let manager = manager.inner().clone();
	let sessions = sessions.inner().clone();

	// Resolve launch spec (blocking I/O)
	let agent_clone = agent.clone();
	let launch_spec = tokio::task::spawn_blocking(move || {
		manager.resolve_launch(&agent_clone)
	})
	.await
	.map_err(|e| e.to_string())?
	.map_err(|e| format!("{e}"))?;

	// Create managed session (spawn process + ACP session/new)
	let session = ManagedAgentSession::create(
		&agent,
		PathBuf::from(&cwd),
		launch_spec,
		HashMap::new(),
	)
	.await
	.map_err(|e| format!("{e}"))?;

	let session = Arc::new(session);
	let info = session.info();
	let local_id = info.id.clone();

	// Store session
	sessions
		.lock()
		.await
		.insert(local_id.clone(), session.clone());

	// Spawn notification stream listener
	let app_for_notifications = app.clone();
	let session_for_notifications = session.clone();
	let id_for_notifications = local_id.clone();
	let task_handle = tokio::spawn(async move {
		let mut stream =
			std::pin::pin!(session_for_notifications.notifications().await);
		while let Some(notification) = stream.next().await {
			// Try to parse as structured ACP notification for logging
			if let Some(parsed) =
				ManagedAgentSession::parse_notification(&notification)
			{
				tracing::info!(
					session_id = %id_for_notifications,
					acp_session_id = %parsed.session_id,
					update = ?parsed.update,
					"agent notification (structured)"
				);
			} else {
				tracing::info!(
					session_id = %id_for_notifications,
					raw = %notification,
					"agent notification (raw, unrecognized)"
				);
			}

			let event_name = format!("agent-event-{}", id_for_notifications);
			if let Err(e) =
				app_for_notifications.emit(&event_name, &notification)
			{
				tracing::warn!(
					session_id = %id_for_notifications,
					error = %e,
					"failed to emit agent notification event"
				);
			}
		}
		tracing::info!(
			session_id = %id_for_notifications,
			"agent notification stream ended"
		);
	});

	// Store task handle for later abortion
	tasks.lock().await.insert(local_id.clone(), task_handle);

	Ok(info)
}

#[tauri::command]
pub async fn send_agent_prompt(
	session_id: String,
	content: String,
	app: AppHandle,
	sessions: State<'_, AgentSessionMap>,
) -> Result<(), String> {
	let session = {
		let map = sessions.lock().await;
		map.get(&session_id)
			.cloned()
			.ok_or_else(|| format!("session not found: {session_id}"))?
	};

	// Spawn async task for the prompt so we return immediately
	let sid = session_id.clone();
	tokio::spawn(async move {
		let result = session
			.prompt(vec![ContentPart::Text { text: content }])
			.await;
		match result {
			Ok(prompt_result) => {
				let event_name = format!("agent-turn-complete-{sid}");
				if let Err(e) = app.emit(&event_name, &prompt_result) {
					tracing::warn!(
						session_id = %sid,
						error = %e,
						"failed to emit turn-complete event"
					);
				}
			}
			Err(e) => {
				let event_name = format!("agent-error-{sid}");
				if let Err(emit_err) = app.emit(&event_name, &format!("{e}")) {
					tracing::warn!(
						session_id = %sid,
						error = %emit_err,
						"failed to emit agent-error event"
					);
				}
			}
		}
	});

	Ok(())
}

#[tauri::command]
pub async fn close_agent_session(
	session_id: String,
	sessions: State<'_, AgentSessionMap>,
	tasks: State<'_, NotificationTaskMap>,
) -> Result<(), String> {
	// Step 1: Abort notification task and WAIT for exit
	// This immediately interrupts stream.next().await and releases Arc reference
	if let Some(task) = tasks.lock().await.remove(&session_id) {
		task.abort();
		// CRITICAL: Wait for the task to fully exit to ensure
		// all Arc references (session_for_notifications, stream) are dropped
		let _ = task.await;
		tracing::info!(
			session_id = %session_id,
			"notification stream task aborted and fully exited"
		);
	}

	// Step 2: Remove session from map
	let session = {
		let mut map = sessions.lock().await;
		map.remove(&session_id)
	};

	// Step 3: Shutdown session with timeout (external dependency may deadlock)
	if let Some(session) = session {
		match timeout(Duration::from_secs(3), session.shutdown()).await {
			Ok(_) => {
				tracing::info!(
					session_id = %session_id,
					"agent session shutdown completed"
				);
			}
			Err(_) => {
				tracing::warn!(
					session_id = %session_id,
					"agent session shutdown timed out after 3s, forcing cleanup"
				);
				// Session is already removed from map, so it won't be reused
				// The timeout prevents blocking the frontend
			}
		}
	}

	Ok(())
}
