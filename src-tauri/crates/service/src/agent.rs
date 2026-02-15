use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use agent::{AgentProcessLaunchSpec, AgentSessionMap, ManagedAgentSession};

use infra::db::DbPool;
use model::agent::{
	AgentRestoreResult, AgentSessionRecord, AgentSessionRestoreInfo,
	NewAgentSession, NewAgentSessionEvent,
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

/// Restore an agent session from a persisted record.
///
/// Flow:
/// 1. Read old session record and events
/// 2. Spawn agent process + ACP session/load (reuse acp_session_id)
/// 3. Create new session record
/// 4. Delete old session record
/// 5. Store in runtime map
///
/// Returns info + events for frontend reconstruction.
pub async fn restore_session(
	db: &DbPool,
	sessions: &AgentSessionMap,
	old_session_id: &str,
	cwd: PathBuf,
	launch_spec: AgentProcessLaunchSpec,
	extra_env: HashMap<String, String>,
) -> Result<AgentRestoreResult, AppError> {
	// Read old session and events
	let (old_session, events) = {
		let mut conn = db.lock().map_err(|_| AppError::LockError)?;

		let old = repo::agent::get_session(&mut conn, old_session_id)?;
		let evts = repo::agent::get_session_events(&mut conn, old_session_id)?;

		(old, evts)
	};

	// Create managed session with session/load to restore ACP session state
	let managed_session = ManagedAgentSession::load(
		&old_session.agent,
		cwd,
		&old_session.acp_session_id,
		launch_spec,
		extra_env,
	)
	.await
	.map_err(|e| {
		AppError::PtyError(format!("Failed to restore agent session: {e}"))
	})?;

	let new_local_id = managed_session.local_id.clone();
	let acp_session_id = managed_session.acp_session_id.clone();

	// Insert new session record
	{
		let mut conn = db.lock().map_err(|_| AppError::LockError)?;

		let new_record = NewAgentSession {
			id: &new_local_id,
			agent: &old_session.agent,
			acp_session_id: &acp_session_id,
			profile_id: &old_session.profile_id,
			session_init_json: old_session.session_init_json.as_deref(),
		};

		repo::agent::insert_session(&mut conn, &new_record)?;

		// Delete old session record (cascade deletes events)
		repo::agent::delete_session(&mut conn, old_session_id)?;
	}

	// Store in runtime map
	sessions
		.lock()
		.await
		.insert(new_local_id.clone(), Arc::new(managed_session));

	tracing::info!(
		target: "agent",
		old_session_id = %old_session_id,
		new_session_id = %new_local_id,
		acp_session_id = %acp_session_id,
		agent = %old_session.agent,
		event_count = events.len(),
		"service: restored agent session"
	);

	Ok(AgentRestoreResult {
		info: AgentSessionRestoreInfo {
			id: new_local_id,
			agent: old_session.agent,
			acp_session_id,
		},
		events,
	})
}

/// Persist a single event to the database.
pub fn persist_event(
	db: &DbPool,
	session_id: &str,
	event_index: i32,
	sender: &str,
	payload_json: &str,
) -> Result<(), AppError> {
	let mut conn = db.lock().map_err(|_| AppError::LockError)?;

	let event_id = format!(
		"{session_id}-evt-{}",
		SystemTime::now()
			.duration_since(UNIX_EPOCH)
			.unwrap_or_default()
			.as_millis()
	);

	let record = NewAgentSessionEvent {
		id: &event_id,
		event_index,
		session_id,
		sender,
		payload_json,
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

/// Close a session: remove from map, shutdown agent, mark destroyed.
pub async fn close_session(
	db: &DbPool,
	sessions: &AgentSessionMap,
	session_id: &str,
) -> Result<(), AppError> {
	// Remove from runtime map and shutdown
	let removed = sessions.lock().await.remove(session_id);

	if let Some(session) = removed {
		// Shutdown agent process (best effort)
		session.shutdown().await;
	}

	// Mark destroyed in DB
	{
		let mut conn = db.lock().map_err(|_| AppError::LockError)?;

		repo::agent::mark_destroyed(&mut conn, session_id)?;
	}

	tracing::info!(
		target: "agent",
		%session_id,
		"service: closed and marked destroyed"
	);

	Ok(())
}

/// Hard delete a session record from the database.
pub fn delete_session(
	db: &DbPool,
	session_id: &str,
) -> Result<(), AppError> {
	let mut conn = db.lock().map_err(|_| AppError::LockError)?;

	repo::agent::delete_session(&mut conn, session_id)
}

/// Mark all active sessions as destroyed (orphan cleanup).
/// Called on app startup and exit.
pub fn mark_all_destroyed(db: &DbPool) -> Result<usize, AppError> {
	let mut conn = db.lock().map_err(|_| AppError::LockError)?;

	repo::agent::mark_all_active_destroyed(&mut conn)
}
