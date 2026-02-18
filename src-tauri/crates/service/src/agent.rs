use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

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

/// Restore all destroyed agent sessions at startup.
/// For each: spawn process → create new record → transfer events → delete old record.
pub async fn restore_all_sessions(
	db: &DbPool,
	sessions: &AgentSessionMap,
	manager: &AgentManagerWrapper,
) -> usize {
	let all_sessions = {
		let Ok(mut conn) = db.lock() else { return 0 };
		repo::agent::list_all(&mut conn).unwrap_or_default()
	};

	if all_sessions.is_empty() {
		return 0;
	}

	tracing::info!(target: "agent", count = all_sessions.len(), "restore_all: found sessions to restore");
	let mut restored = 0;

	for old in &all_sessions {
		match restore_single_agent_session(db, sessions, manager, old).await {
			Ok(_) => {
				restored += 1;
			}
			Err(e) => {
				tracing::warn!(
					target: "agent",
					session_id = %old.id,
					error = %e,
					"restore_all: failed, deleting stale record"
				);
				if let Ok(mut conn) = db.lock() {
					let _ = repo::agent::delete_session(&mut conn, &old.id);
				}
			}
		}
	}

	restored
}

async fn restore_single_agent_session(
	db: &DbPool,
	sessions: &AgentSessionMap,
	manager: &AgentManagerWrapper,
	old: &AgentSessionRecord,
) -> Result<(), AppError> {
	// 1. Resolve cwd from profile's worktree_path
	let cwd = {
		let mut conn = db.lock().map_err(|_| AppError::LockError)?;
		let profile = repo::profile::find_by_id(&mut conn, &old.profile_id)?;
		PathBuf::from(&profile.worktree_path)
	};

	// 2. Resolve launch spec
	let launch_spec = manager
		.resolve_launch(&old.agent)
		.map_err(|e| AppError::PtyError(format!("Failed to resolve agent launch: {e}")))?;

	// 3. Spawn agent process with ACP session/load
	let managed_session = ManagedAgentSession::load(
		&old.agent,
		cwd,
		&old.acp_session_id,
		launch_spec,
		HashMap::new(),
	)
	.await
	.map_err(|e| AppError::PtyError(format!("Failed to restore agent session: {e}")))?;

	let new_id = managed_session.local_id.clone();
	let acp_session_id = managed_session.acp_session_id.clone();

	// 4. Insert new record, transfer events, delete old record
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

		// Transfer events to new session ID before deleting old record
		let event_count =
			repo::agent::transfer_events(&mut conn, &old.id, &new_id)?;
		tracing::info!(
			target: "agent",
			old_id = %old.id, %new_id, event_count,
			"restore: transferred events"
		);

		repo::agent::delete_session(&mut conn, &old.id)?;
	}

	// 5. Store live session in runtime map
	sessions
		.lock()
		.await
		.insert(new_id.clone(), Arc::new(managed_session));

	tracing::info!(
		target: "agent",
		old_id = %old.id, %new_id, %acp_session_id,
		agent = %old.agent,
		"restore_all: restored agent session"
	);

	Ok(())
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
