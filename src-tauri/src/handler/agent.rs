use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use agent::{
	AgentManagerWrapper, AgentModeState, AgentModelState, AgentSessionInfo,
	AgentSessionMap, AgentStatusInfo, ContentPart, CredentialInfo,
	ManagedAgentSession, NotificationTaskMap,
};
use futures::StreamExt;
use infra::db::{DbPool, DbPoolExt};
use model::agent::{
	AgentSessionEventRecord, AgentSessionMeta, AgentSessionRecord,
};
use model::distribution::Distribution;
use model::error::AppError;
use tauri::{AppHandle, Emitter, State};
use tokio::time::timeout;

/// Spawn a notification listener task for an agent session.
/// This reads ACP notifications from the agent process, persists them to DB,
/// and emits Tauri events to the frontend.
///
/// Must be called after the session is stored in the session map.
pub fn spawn_notification_listener(
	session_id: String,
	session: Arc<ManagedAgentSession>,
	app: AppHandle,
	db: DbPool,
	notification_tasks: NotificationTaskMap,
) {
	let notif_id = session_id.clone();
	let task_session_id = session_id.clone();

	// Compute initial event_index from existing events in DB
	let initial_event_index = {
		if let Ok(mut conn) = db.lock() {
			repo::agent::next_event_index(&mut conn, &session_id).unwrap_or(0)
		} else {
			0
		}
	};

	let task_handle = tokio::spawn(async move {
		let mut event_index = initial_event_index;
		let mut stream = std::pin::pin!(session.notifications().await);

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

			// Get current turn index from database
			let turn_idx = {
				if let Ok(mut conn) = db.lock() {
					repo::agent::get_max_turn_index(&mut conn, &notif_id)
						.unwrap_or(0)
				} else {
					0
				}
			};

			// Persist event to database
			let payload_json = notification.to_string();
			if let Err(e) = service::agent::persist_event(
				&db,
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
			if let Err(e) = app.emit(&event_name, &notification) {
				tracing::warn!(
					session_id = %notif_id,
					error = %e,
					"failed to emit agent notification event"
				);
			}

			// Emit dedicated mode-update event if this notification is a
			// current_mode_update so the frontend can refresh its mode selector.
			if let Some(update) = notification
				.pointer("/params/update")
				.filter(|u| {
					u.get("sessionUpdate")
						.and_then(|v| v.as_str())
						== Some("current_mode_update")
				})
			{
				if let Some(mode_id) = update
					.get("modeId")
					.and_then(|v| v.as_str())
				{
					let mode_event = format!("agent-mode-update-{notif_id}");
					if let Err(e) = app.emit(&mode_event, mode_id) {
						tracing::warn!(
							session_id = %notif_id,
							error = %e,
							"failed to emit mode-update event"
						);
					}
				}
			}
		}
		tracing::info!(session_id = %notif_id, "agent notification stream ended");
	});

	// Store task handle (fire-and-forget insertion)
	let tasks = notification_tasks.clone();
	tokio::spawn(async move {
		tasks.lock().await.insert(task_session_id, task_handle);
	});
}

#[tauri::command]
pub fn list_agent_status(
	state: State<'_, Arc<AgentManagerWrapper>>,
) -> Result<Vec<AgentStatusInfo>, AppError> {
	Ok(state.list_status())
}

#[tauri::command]
pub async fn install_agent(
	agent: String,
	state: State<'_, Arc<AgentManagerWrapper>>,
) -> Result<(), AppError> {
	let manager = state.inner().clone();
	tokio::task::spawn_blocking(move || manager.install(&agent))
		.await
		.map_err(|e| AppError::PtyError(e.to_string()))?
		.map_err(|e| AppError::PtyError(format!("{e}")))?;
	Ok(())
}

#[tauri::command]
pub fn detect_credentials(
	state: State<'_, Arc<AgentManagerWrapper>>,
) -> CredentialInfo {
	state.detect_credentials()
}

#[tauri::command]
pub async fn send_agent_prompt(
	session_id: String,
	content: String,
	app: AppHandle,
	sessions: State<'_, AgentSessionMap>,
	db: State<'_, DbPool>,
) -> Result<(), AppError> {
	let session = {
		let map = sessions.lock().await;
		map.get(&session_id).cloned().ok_or_else(|| {
			AppError::NotFound(format!("session: {session_id}"))
		})?
	};

	// Get next turn index and event index from database in one lock scope
	let (turn_idx, event_idx) = {
		let mut conn = db.conn()?;
		let turn = repo::agent::get_max_turn_index(&mut conn, &session_id)? + 1;
		let idx = repo::agent::next_event_index(&mut conn, &session_id)?;
		(turn, idx)
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

	// Check for pending history injection (first prompt after reconnect)
	let pending = session.take_pending_history().await;

	// Build prompt content blocks
	let mut prompt_parts = Vec::new();
	if let Some(history) = pending {
		prompt_parts.push(ContentPart::Text { text: history });
	}
	prompt_parts.push(ContentPart::Text {
		text: content.clone(),
	});

	// Spawn async task for the prompt so we return immediately
	let sid = session_id.clone();
	tokio::spawn(async move {
		let result = session.prompt(prompt_parts).await;
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
pub async fn get_agent_session_models(
	session_id: String,
	sessions: State<'_, AgentSessionMap>,
) -> Result<AgentModelState, AppError> {
	let session = {
		let map = sessions.lock().await;
		map.get(&session_id).cloned().ok_or_else(|| {
			AppError::NotFound(format!("session: {session_id}"))
		})?
	};

	Ok(session.model_state().await)
}

#[tauri::command]
pub async fn set_agent_session_model(
	session_id: String,
	model_id: String,
	sessions: State<'_, AgentSessionMap>,
	db: State<'_, DbPool>,
) -> Result<AgentModelState, AppError> {
	let session = {
		let map = sessions.lock().await;
		map.get(&session_id).cloned().ok_or_else(|| {
			AppError::NotFound(format!("session: {session_id}"))
		})?
	};

	let model_state = session
		.set_model(&model_id)
		.await
		.map_err(|e| AppError::PtyError(format!("Failed to set model: {e}")))?;

	if let Err(e) = service::agent::set_session_model_init(
		db.inner(),
		&session_id,
		&model_id,
	) {
		tracing::warn!(
			session_id = %session_id,
			model_id = %model_id,
			error = %e,
			"failed to persist selected model"
		);
	}

	Ok(model_state)
}

#[tauri::command]
pub async fn get_agent_session_modes(
	session_id: String,
	sessions: State<'_, AgentSessionMap>,
) -> Result<AgentModeState, AppError> {
	let session = {
		let map = sessions.lock().await;
		map.get(&session_id).cloned().ok_or_else(|| {
			AppError::NotFound(format!("session: {session_id}"))
		})?
	};

	Ok(session.mode_state().await)
}

#[tauri::command]
pub async fn set_agent_session_mode(
	session_id: String,
	mode_id: String,
	sessions: State<'_, AgentSessionMap>,
) -> Result<AgentModeState, AppError> {
	let session = {
		let map = sessions.lock().await;
		map.get(&session_id).cloned().ok_or_else(|| {
			AppError::NotFound(format!("session: {session_id}"))
		})?
	};

	let mode_state = session
		.set_mode(&mode_id)
		.await
		.map_err(|e| AppError::PtyError(format!("Failed to set mode: {e}")))?;

	Ok(mode_state)
}

#[tauri::command]
pub async fn close_agent_session(
	session_id: String,
	sessions: State<'_, AgentSessionMap>,
	tasks: State<'_, NotificationTaskMap>,
	db: State<'_, DbPool>,
) -> Result<(), AppError> {
	// Abort notification task first — this interrupts stream.next().await
	// and releases Arc references before we remove the session.
	if let Some(task) = tasks.lock().await.remove(&session_id) {
		task.abort();
		let _ = task.await;
		tracing::info!(
			session_id = %session_id,
			"notification stream task aborted and fully exited"
		);
	}

	// Remove session from runtime map
	let session = sessions.lock().await.remove(&session_id);

	// Mark session as destroyed in database
	if let Err(e) = service::agent::close_session(db.inner(), &session_id).await
	{
		tracing::warn!(
			session_id = %session_id,
			error = %e,
			"failed to mark session as destroyed in database"
		);
	}

	// Shutdown session with timeout (external dependency may deadlock)
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
			}
		}
	}

	Ok(())
}

// ============================================================
// Persistence commands (for agent tab restoration)
// ============================================================

/// Create a persistent agent session using the marketplace agent's distribution spec.
///
/// Looks up `meta.agent` in the `marketplace_agents` table, resolves the
/// distribution to `(program, args, env)`, spawns the process, and persists
/// the session to the database.
#[tauri::command]
pub async fn create_agent_session_persistent(
	meta: AgentSessionMeta,
	cwd: String,
	app: AppHandle,
	db: State<'_, DbPool>,
	sessions: State<'_, AgentSessionMap>,
	tasks: State<'_, NotificationTaskMap>,
) -> Result<AgentSessionInfo, AppError> {
	let db_pool = db.inner().clone();
	let sessions_clone = sessions.inner().clone();

	// Look up marketplace agent and resolve launch spec from distribution_json
	let (program, args, base_env) = {
		let mut conn = db.conn()?;
		let agent_record = repo::marketplace::find(&mut conn, &meta.agent)?
			.ok_or_else(|| {
				AppError::NotFound(format!("marketplace agent: {}", meta.agent))
			})?;
		Distribution::from_json(&agent_record.distribution_json)?
			.resolve_launch()?
	};

	// Create session with database persistence
	let session_id = service::agent::create_session_from_raw(
		&db_pool,
		&sessions_clone,
		&meta.agent,
		&meta.profile_id,
		PathBuf::from(&cwd),
		program,
		args,
		base_env,
	)
	.await?;

	// Get session info
	let session = {
		let map = sessions_clone.lock().await;
		map.get(&session_id).cloned().ok_or_else(|| {
			AppError::NotFound(format!("session: {session_id}"))
		})?
	};
	let info = session.info();

	// Spawn notification stream listener
	spawn_notification_listener(
		session_id,
		session,
		app,
		db_pool,
		tasks.inner().clone(),
	);

	Ok(info)
}

/// Reconnect an old (destroyed) agent session on demand.
/// Called by the frontend when the user opens an agent tab after app restart.
///
/// Looks up the marketplace agent's distribution spec from the DB, spawns the
/// agent process, transfers events from old to new session, sets up the
/// notification listener, and returns the new session info.
#[tauri::command]
pub async fn reconnect_agent_session(
	old_session_id: String,
	app: AppHandle,
	db: State<'_, DbPool>,
	sessions: State<'_, AgentSessionMap>,
	tasks: State<'_, NotificationTaskMap>,
) -> Result<AgentSessionInfo, AppError> {
	let db_pool = db.inner().clone();
	let sessions_clone = sessions.inner().clone();

	// Reconnect: spawn process, transfer events, swap DB records
	let new_session_id = service::agent::reconnect_session(
		&db_pool,
		&sessions_clone,
		&old_session_id,
	)
	.await?;

	// Get session info
	let session = {
		let map = sessions_clone.lock().await;
		map.get(&new_session_id).cloned().ok_or_else(|| {
			AppError::NotFound(format!(
				"session after reconnect: {new_session_id}"
			))
		})?
	};
	let info = session.info();

	// Spawn notification listener
	spawn_notification_listener(
		new_session_id,
		session,
		app,
		db_pool,
		tasks.inner().clone(),
	);

	Ok(info)
}

/// List all agent sessions for a project.
#[tauri::command]
pub fn list_project_agent_sessions(
	project_id: String,
	db: State<'_, DbPool>,
) -> Result<Vec<AgentSessionRecord>, AppError> {
	service::agent::list_project_sessions(db.inner(), &project_id)
}

/// Delete an agent session record from the database.
#[tauri::command]
pub fn delete_agent_session_record(
	session_id: String,
	db: State<'_, DbPool>,
) -> Result<(), AppError> {
	service::agent::delete_session(db.inner(), &session_id)
}

/// List all events for an agent session (read-only).
#[tauri::command]
pub fn list_agent_session_events(
	session_id: String,
	db: State<'_, DbPool>,
) -> Result<Vec<AgentSessionEventRecord>, AppError> {
	let mut conn = db.conn()?;
	repo::agent::get_session_events(&mut conn, &session_id)
}
