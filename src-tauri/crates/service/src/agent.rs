use std::collections::{BTreeMap, HashMap};
use std::path::PathBuf;
use std::sync::Arc;

use agent::{
	AgentManagerWrapper, AgentProcessLaunchSpec, AgentSessionMap,
	ManagedAgentSession,
};

use infra::db::DbPool;
use model::agent::{
	AgentSessionRecord, NewAgentSession, NewAgentSessionEvent,
};
use model::error::AppError;

/// Create a new agent session with database persistence.
///
/// Flow:
/// 1. Spawn agent process + ACP session/new
/// 2. Insert session record into DB
/// 3. Store in runtime map
///
/// Returns the local session ID.
pub async fn create_session(
	db: &DbPool,
	sessions: &AgentSessionMap,
	agent: &str,
	profile_id: &str,
	cwd: PathBuf,
	launch_spec: AgentProcessLaunchSpec,
	extra_env: HashMap<String, String>,
) -> Result<String, AppError> {
	// Create managed session (spawn process + ACP session/new)
	let managed_session = ManagedAgentSession::create(
		agent,
		cwd.clone(),
		launch_spec,
		extra_env,
	)
	.await
	.map_err(|e| AppError::PtyError(format!("Failed to create agent session: {e}")))?;

	let local_id = managed_session.local_id.clone();
	let acp_session_id = managed_session.acp_session_id.clone();

	// Persist to database
	{
		let mut conn = db.lock().map_err(|_| AppError::LockError)?;

		let record = NewAgentSession {
			id: &local_id,
			agent,
			acp_session_id: &acp_session_id,
			profile_id,
			session_init_json: None, // TODO: capture session init if needed
		};

		repo::agent::insert_session(&mut conn, &record)?;
	}

	// Store in runtime map
	sessions
		.lock()
		.await
		.insert(local_id.clone(), Arc::new(managed_session));

	tracing::info!(
		target: "agent",
		session_id = %local_id,
		acp_session_id = %acp_session_id,
		agent = %agent,
		profile_id = %profile_id,
		"service: created and persisted agent session"
	);

	Ok(local_id)
}

/// Reconnect a single agent session on demand (called by frontend when user opens a tab).
///
/// Flow:
/// 1. Load the old session record from DB
/// 2. Spawn agent process (try session/load → fallback to session/create)
/// 3. Create new DB record, transfer events, delete old record
/// 4. Store in runtime map
///
/// Returns the new session ID (process is live and ready for notifications).
pub async fn reconnect_session(
	db: &DbPool,
	sessions: &AgentSessionMap,
	manager: &AgentManagerWrapper,
	old_session_id: &str,
) -> Result<String, AppError> {
	// 1. Load old record
	let old = {
		let mut conn = db.lock().map_err(|_| AppError::LockError)?;
		repo::agent::get_session(&mut conn, old_session_id)?
	};

	// 2. Resolve cwd from profile's worktree_path
	let cwd = {
		let mut conn = db.lock().map_err(|_| AppError::LockError)?;
		let profile = repo::profile::find_by_id(&mut conn, &old.profile_id)?;
		PathBuf::from(&profile.worktree_path)
	};

	// 3. Resolve launch spec
	let launch_spec = manager
		.resolve_launch(&old.agent)
		.map_err(|e| AppError::PtyError(format!("Failed to resolve agent launch: {e}")))?;

	// 4. Spawn agent process — try session/load first, fallback to session/create.
	//    session/load is optional per ACP spec (requires loadSession capability).
	//    Agents like claude-code-acp don't support it; we fall back to session/new.
	let managed_session = match ManagedAgentSession::load(
		&old.agent,
		cwd.clone(),
		&old.acp_session_id,
		launch_spec.clone(),
		HashMap::new(),
	)
	.await
	{
		Ok(s) => {
			tracing::info!(
				target: "agent",
				session_id = %old.id,
				agent = %old.agent,
				"reconnect: session/load succeeded"
			);
			s
		}
		Err(e) => {
			tracing::warn!(
				target: "agent",
				session_id = %old.id,
				agent = %old.agent,
				error = %e,
				"reconnect: session/load failed, falling back to session/create"
			);
			ManagedAgentSession::create(
				&old.agent,
				cwd,
				launch_spec,
				HashMap::new(),
			)
			.await
			.map_err(|e2| {
				AppError::PtyError(format!(
					"Failed to reconnect agent session (both load and create failed): {e2}"
				))
			})?
		}
	};

	let new_id = managed_session.local_id.clone();
	let acp_session_id = managed_session.acp_session_id.clone();

	// 5. Insert new record, transfer events, delete old record
	{
		let mut conn = db.lock().map_err(|_| AppError::LockError)?;

		let new_record = NewAgentSession {
			id: &new_id,
			agent: &old.agent,
			acp_session_id: &acp_session_id,
			profile_id: &old.profile_id,
			session_init_json: old.session_init_json.as_deref(),
		};
		repo::agent::insert_session(&mut conn, &new_record)?;

		let event_count =
			repo::agent::transfer_events(&mut conn, &old.id, &new_id)?;
		tracing::info!(
			target: "agent",
			old_id = %old.id, %new_id, event_count,
			"reconnect: transferred events"
		);

		repo::agent::delete_session(&mut conn, &old.id)?;
	}

	// 5.5. Build history from transferred events for first-prompt injection
	let history = build_history_text(db, &new_id).unwrap_or_default();
	if !history.is_empty() {
		managed_session.set_pending_history(history).await;
	}

	// 6. Store live session in runtime map
	sessions
		.lock()
		.await
		.insert(new_id.clone(), Arc::new(managed_session));

	tracing::info!(
		target: "agent",
		old_id = %old.id, %new_id, %acp_session_id,
		agent = %old.agent,
		"reconnect: agent session reconnected"
	);

	Ok(new_id)
}

/// Build a conversation history summary from persisted events.
///
/// Groups events by `turn_index`, extracts user text and agent message chunks,
/// and formats them as a readable conversation history. Used to inject context
/// into the first prompt after session reconnect.
pub fn build_history_text(
	db: &DbPool,
	session_id: &str,
) -> Result<String, AppError> {
	let events = {
		let mut conn = db.lock().map_err(|_| AppError::LockError)?;
		repo::agent::get_session_events(&mut conn, session_id)?
	};

	if events.is_empty() {
		return Ok(String::new());
	}

	// Group events by turn_index (BTreeMap keeps turns sorted)
	let mut turns: BTreeMap<i32, Vec<&model::agent::AgentSessionEventRecord>> =
		BTreeMap::new();
	for event in &events {
		turns.entry(event.turn_index).or_default().push(event);
	}

	let mut history_parts = Vec::new();

	for turn_events in turns.values() {
		let mut user_text = String::new();
		let mut agent_text = String::new();

		for event in turn_events {
			if event.sender == "user" {
				// User payload: {"text": "..."}
				if let Ok(obj) =
					serde_json::from_str::<serde_json::Value>(&event.payload_json)
				{
					if let Some(text) = obj.get("text").and_then(|v| v.as_str()) {
						user_text = text.to_string();
					}
				}
			} else if event.sender == "agent" {
				// Agent payload: JSON-RPC notification
				// {"method":"session/update","params":{"sessionId":"...","update":{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"..."}}}}
				if let Ok(obj) =
					serde_json::from_str::<serde_json::Value>(&event.payload_json)
				{
					let update_type = obj
						.pointer("/params/update/sessionUpdate")
						.and_then(|v| v.as_str());
					if update_type == Some("agent_message_chunk") {
						if let Some(text) = obj
							.pointer("/params/update/content/text")
							.and_then(|v| v.as_str())
						{
							agent_text.push_str(text);
						}
					}
				}
			}
		}

		// Only include turns with both user and agent text
		if !user_text.is_empty() && !agent_text.is_empty() {
			history_parts
				.push(format!("[User]: {user_text}\n[Assistant]: {agent_text}"));
		} else if !user_text.is_empty() {
			history_parts.push(format!("[User]: {user_text}"));
		}
	}

	if history_parts.is_empty() {
		return Ok(String::new());
	}

	let history = format!(
		"<conversation_history>\n{}\n</conversation_history>\n\nThe above is the conversation history from a previous session. Use it as context for the conversation going forward.",
		history_parts.join("\n\n")
	);

	Ok(history)
}

/// Persist a single event to the database.
pub fn persist_event(
	db: &DbPool,
	session_id: &str,
	event_index: i32,
	sender: &str,
	payload_json: &str,
	turn_index: i32,
) -> Result<(), AppError> {
	let mut conn = db.lock().map_err(|_| AppError::LockError)?;

	let event_id = format!("{session_id}-{event_index}");

	let record = NewAgentSessionEvent {
		id: &event_id,
		event_index,
		session_id,
		sender,
		payload_json,
		turn_index,
	};

	repo::agent::append_event(&mut conn, &record)
}

/// List all active sessions for a project (via profile JOIN).
pub fn list_project_sessions(
	db: &DbPool,
	project_id: &str,
) -> Result<Vec<AgentSessionRecord>, AppError> {
	let mut conn = db.lock().map_err(|_| AppError::LockError)?;

	repo::agent::list_by_project(&mut conn, project_id)
}

/// Mark a session as destroyed in the database.
/// The handler owns the runtime lifecycle (map removal + process shutdown).
pub async fn close_session(
	db: &DbPool,
	session_id: &str,
) -> Result<(), AppError> {
	// Mark destroyed in DB
	{
		let mut conn = db.lock().map_err(|_| AppError::LockError)?;
		repo::agent::mark_destroyed(&mut conn, session_id)?;
	}

	tracing::info!(
		target: "agent",
		%session_id,
		"service: marked session destroyed"
	);

	Ok(())
}

/// Hard delete a session record from the database.
pub fn delete_session(
	db: &DbPool,
	session_id: &str,
) -> Result<(), AppError> {
	let mut conn = db.lock().map_err(|_| AppError::LockError)?;

	// Capture stats before hard delete
	let _ = crate::stats::capture_agent_stats(&mut conn, session_id);
	repo::agent::delete_session(&mut conn, session_id)
}

/// Mark all active sessions as destroyed (orphan cleanup).
/// Called on app startup and exit.
pub fn mark_all_destroyed(db: &DbPool) -> Result<usize, AppError> {
	let mut conn = db.lock().map_err(|_| AppError::LockError)?;

	repo::agent::mark_all_active_destroyed(&mut conn)
}
