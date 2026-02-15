use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicI32, Ordering};
use std::sync::Arc;
use std::time::Duration;

use agent::{
	AgentManagerWrapper, AgentSessionInfo, AgentSessionMap, AgentStatusInfo,
	ContentPart, CredentialInfo, ManagedAgentSession, NotificationTaskMap,
};
use futures::StreamExt;
use infra::db::DbPool;
use model::agent::{AgentRestoreResult, AgentSessionMeta, AgentSessionRecord};
use tauri::{AppHandle, Emitter, State};
use tokio::time::timeout;

/// Maps session_id to current turn_index counter
pub type TurnIndexMap = Arc<tokio::sync::Mutex<HashMap<String, Arc<AtomicI32>>>>;

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
	let notif_app = app.clone();
	let notif_session = session.clone();
	let notif_id = local_id.clone();
	let task_handle = tokio::spawn(async move {
		let mut stream =
			std::pin::pin!(notif_session.notifications().await);
		while let Some(notification) = stream.next().await {
			if let Some(parsed) =
				ManagedAgentSession::parse_notification(&notification)
			{
				tracing::info!(
					session_id = %notif_id,
					acp_session_id = %parsed.session_id,
					update = ?parsed.update,
					"agent notification (structured)"
				);
			} else {
				tracing::info!(
					session_id = %notif_id,
					raw = %notification,
					"agent notification (raw, unrecognized)"
				);
			}

			let event_name = format!("agent-event-{notif_id}");
			if let Err(e) = notif_app.emit(&event_name, &notification) {
				tracing::warn!(
					session_id = %notif_id,
					error = %e,
					"failed to emit agent notification event"
				);
			}
		}
		tracing::info!(session_id = %notif_id, "agent notification stream ended");
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
	turn_index_map: State<'_, TurnIndexMap>,
	db: State<'_, DbPool>,
) -> Result<(), String> {
	let session = {
		let map = sessions.lock().await;
		map.get(&session_id)
			.cloned()
			.ok_or_else(|| format!("session not found: {session_id}"))?
	};

	// Increment turn index for this session
	let turn_idx = {
		let mut map = turn_index_map.lock().await;
		let counter = map
			.entry(session_id.clone())
			.or_insert_with(|| Arc::new(AtomicI32::new(0)));
		counter.fetch_add(1, Ordering::SeqCst) + 1
	};

	// Get next event index
	let event_idx = {
		let mut conn = db
			.lock()
			.map_err(|_| "Failed to acquire DB lock".to_string())?;
		repo::agent::next_event_index(&mut conn, &session_id)
			.map_err(|e| format!("{e}"))?
	};

	// Persist user message with turn_index
	let payload = serde_json::json!({ "text": content }).to_string();
	if let Err(e) = service::agent::persist_event(
		db.inner(),
		&session_id,
		event_idx,
		"user",
		&payload,
		turn_idx,
	) {
		tracing::warn!(
			session_id = %session_id,
			turn_index = turn_idx,
			error = %e,
			"failed to persist user message"
		);
	}

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
	turn_index_map: State<'_, TurnIndexMap>,
	db: State<'_, DbPool>,
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
	let session = sessions.lock().await.remove(&session_id);

	// Step 2.5: Remove turn index counter
	turn_index_map.lock().await.remove(&session_id);

	// Step 2.6: Mark session as destroyed in database
	if let Err(e) = service::agent::close_session(
		db.inner(),
		&sessions,
		&session_id,
	)
	.await
	{
		tracing::warn!(
			session_id = %session_id,
			error = %e,
			"failed to mark session as destroyed in database"
		);
	}

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

// ============================================================
// Persistence commands (for agent tab restoration)
// ============================================================

/// Create a persistent agent session with database storage.
#[tauri::command]
pub async fn create_agent_session_persistent(
	meta: AgentSessionMeta,
	cwd: String,
	app: AppHandle,
	db: State<'_, DbPool>,
	manager: State<'_, Arc<AgentManagerWrapper>>,
	sessions: State<'_, AgentSessionMap>,
	tasks: State<'_, NotificationTaskMap>,
	turn_index_map: State<'_, TurnIndexMap>,
) -> Result<AgentSessionInfo, String> {
	let manager_clone = manager.inner().clone();
	let db_pool = db.inner().clone();
	let sessions_clone = sessions.inner().clone();

	// Resolve launch spec (blocking I/O)
	let agent_clone = meta.agent.clone();
	let launch_spec = tokio::task::spawn_blocking(move || {
		manager_clone.resolve_launch(&agent_clone)
	})
	.await
	.map_err(|e| e.to_string())?
	.map_err(|e| format!("{e}"))?;

	// Create session with database persistence
	let session_id = service::agent::create_session(
		&db_pool,
		&sessions_clone,
		&meta.agent,
		&meta.profile_id,
		PathBuf::from(&cwd),
		launch_spec,
		HashMap::new(),
	)
	.await
	.map_err(|e| format!("{e}"))?;

	// Get session info
	let session = {
		let map = sessions_clone.lock().await;
		map.get(&session_id)
			.cloned()
			.ok_or_else(|| format!("session not found: {session_id}"))?
	};
	let info = session.info();

	// Initialize turn index counter for this session
	{
		let mut map = turn_index_map.lock().await;
		map.insert(session_id.clone(), Arc::new(AtomicI32::new(0)));
	}

	// Spawn notification stream listener
	let notif_app = app.clone();
	let notif_session = session.clone();
	let notif_id = session_id.clone();
	let notif_db = db_pool.clone();
	let notif_turn_map = turn_index_map.inner().clone();

	let task_handle = tokio::spawn(async move {
		let mut event_index = 0i32;
		let mut stream =
			std::pin::pin!(notif_session.notifications().await);

		while let Some(notification) = stream.next().await {
			if let Some(parsed) =
				ManagedAgentSession::parse_notification(&notification)
			{
				tracing::info!(
					session_id = %notif_id,
					acp_session_id = %parsed.session_id,
					update = ?parsed.update,
					"agent notification (structured)"
				);
			} else {
				tracing::info!(
					session_id = %notif_id,
					raw = %notification,
					"agent notification (raw, unrecognized)"
				);
			}

			// Get current turn index
			let turn_idx = {
				let map = notif_turn_map.lock().await;
				map.get(&notif_id)
					.map(|counter| counter.load(Ordering::SeqCst))
					.unwrap_or(0)
			};

			// Persist event to database
			let payload_json = notification.to_string();
			if let Err(e) = service::agent::persist_event(
				&notif_db,
				&notif_id,
				event_index,
				"agent",
				&payload_json,
				turn_idx,
			) {
				tracing::warn!(
					session_id = %notif_id,
					event_index,
					turn_index = turn_idx,
					error = %e,
					"failed to persist agent event"
				);
			}

			event_index += 1;

			// Emit event to frontend
			let event_name = format!("agent-event-{notif_id}");
			if let Err(e) = notif_app.emit(&event_name, &notification) {
				tracing::warn!(
					session_id = %notif_id,
					error = %e,
					"failed to emit agent notification event"
				);
			}
		}
		tracing::info!(session_id = %notif_id, "agent notification stream ended");
	});

	// Store task handle for later abortion
	tasks.lock().await.insert(session_id.clone(), task_handle);

	Ok(info)
}

/// Restore an agent session from a persisted record.
#[tauri::command]
pub async fn restore_agent_session(
	old_session_id: String,
	cwd: String,
	app: AppHandle,
	db: State<'_, DbPool>,
	manager: State<'_, Arc<AgentManagerWrapper>>,
	sessions: State<'_, AgentSessionMap>,
	tasks: State<'_, NotificationTaskMap>,
	turn_index_map: State<'_, TurnIndexMap>,
) -> Result<AgentRestoreResult, String> {
	let manager_clone = manager.inner().clone();
	let db_pool = db.inner().clone();
	let sessions_clone = sessions.inner().clone();

	// Get old session record to determine agent type
	let old_session = {
		let mut conn = db_pool
			.lock()
			.map_err(|_| "Failed to acquire DB lock".to_string())?;
		repo::agent::get_session(&mut conn, &old_session_id)
			.map_err(|e| format!("{e}"))?
	};

	// Resolve launch spec
	let agent_clone = old_session.agent.clone();
	let launch_spec = tokio::task::spawn_blocking(move || {
		manager_clone.resolve_launch(&agent_clone)
	})
	.await
	.map_err(|e| e.to_string())?
	.map_err(|e| format!("{e}"))?;

	// Restore session with database
	let restore_result = service::agent::restore_session(
		&db_pool,
		&sessions_clone,
		&old_session_id,
		PathBuf::from(&cwd),
		launch_spec,
		HashMap::new(),
	)
	.await
	.map_err(|e| format!("{e}"))?;

	let new_session_id = restore_result.info.id.clone();

	// Set turn index to max(turn_index) + 1 from restored events
	let max_turn_idx = restore_result
		.events
		.iter()
		.map(|e| e.turn_index)
		.max()
		.unwrap_or(0);
	{
		let mut map = turn_index_map.lock().await;
		map.insert(
			new_session_id.clone(),
			Arc::new(AtomicI32::new(max_turn_idx)),
		);
	}

	// Get session and spawn notification listener
	let session = {
		let map = sessions_clone.lock().await;
		map.get(&new_session_id)
			.cloned()
			.ok_or_else(|| {
				format!("restored session not found: {new_session_id}")
			})?
	};

	// Spawn notification stream listener
	let notif_app = app.clone();
	let notif_session = session.clone();
	let notif_id = new_session_id.clone();
	let notif_db = db_pool.clone();
	let notif_turn_map = turn_index_map.inner().clone();

	// Start event_index from where we left off
	let mut event_index = restore_result.events.len() as i32;

	let task_handle = tokio::spawn(async move {
		let mut stream =
			std::pin::pin!(notif_session.notifications().await);

		while let Some(notification) = stream.next().await {
			if let Some(parsed) =
				ManagedAgentSession::parse_notification(&notification)
			{
				tracing::info!(
					session_id = %notif_id,
					acp_session_id = %parsed.session_id,
					update = ?parsed.update,
					"agent notification (structured)"
				);
			} else {
				tracing::info!(
					session_id = %notif_id,
					raw = %notification,
					"agent notification (raw, unrecognized)"
				);
			}

			// Get current turn index
			let turn_idx = {
				let map = notif_turn_map.lock().await;
				map.get(&notif_id)
					.map(|counter| counter.load(Ordering::SeqCst))
					.unwrap_or(0)
			};

			// Persist event to database
			let payload_json = notification.to_string();
			if let Err(e) = service::agent::persist_event(
				&notif_db,
				&notif_id,
				event_index,
				"agent",
				&payload_json,
				turn_idx,
			) {
				tracing::warn!(
					session_id = %notif_id,
					event_index,
					turn_index = turn_idx,
					error = %e,
					"failed to persist agent event"
				);
			}

			event_index += 1;

			// Emit event to frontend
			let event_name = format!("agent-event-{notif_id}");
			if let Err(e) = notif_app.emit(&event_name, &notification) {
				tracing::warn!(
					session_id = %notif_id,
					error = %e,
					"failed to emit agent notification event"
				);
			}
		}
		tracing::info!(session_id = %notif_id, "agent notification stream ended");
	});

	// Store task handle
	tasks.lock().await.insert(new_session_id, task_handle);

	Ok(restore_result)
}

/// List all agent sessions for a project.
#[tauri::command]
pub fn list_project_agent_sessions(
	project_id: String,
	db: State<'_, DbPool>,
) -> Result<Vec<AgentSessionRecord>, String> {
	service::agent::list_project_sessions(db.inner(), &project_id)
		.map_err(|e| format!("{e}"))
}

/// Delete an agent session record from the database.
#[tauri::command]
pub fn delete_agent_session_record(
	session_id: String,
	db: State<'_, DbPool>,
) -> Result<(), String> {
	service::agent::delete_session(db.inner(), &session_id)
		.map_err(|e| format!("{e}"))
}

/// Persist a single agent event to the database (called from frontend).
#[tauri::command]
pub fn persist_agent_event(
	session_id: String,
	event_index: i32,
	sender: String,
	payload: String,
	turn_index: i32,
	db: State<'_, DbPool>,
) -> Result<(), String> {
	service::agent::persist_event(
		db.inner(),
		&session_id,
		event_index,
		&sender,
		&payload,
		turn_index,
	)
	.map_err(|e| format!("{e}"))
}
