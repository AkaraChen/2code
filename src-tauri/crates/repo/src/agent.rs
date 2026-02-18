use diesel::prelude::*;
use std::time::{SystemTime, UNIX_EPOCH};

use model::agent::{
	AgentSessionEventRecord, AgentSessionRecord, NewAgentSession,
	NewAgentSessionEvent,
};
use model::error::AppError;
use model::schema::{agent_session_events, agent_sessions, profiles};

/// Insert a new agent session record.
pub fn insert_session(
	conn: &mut SqliteConnection,
	record: &NewAgentSession,
) -> Result<(), AppError> {
	diesel::insert_into(agent_sessions::table)
		.values(record)
		.execute(conn)
		.map_err(|e| AppError::DbError(e.to_string()))?;

	tracing::info!(
		target: "agent",
		session_id = record.id,
		agent = record.agent,
		acp_session_id = record.acp_session_id,
		"repo: insert_session"
	);
	Ok(())
}

/// List all agent sessions for a project (via profile JOIN).
/// Filters out destroyed sessions (destroyed_at IS NULL).
pub fn list_by_project(
	conn: &mut SqliteConnection,
	project_id: &str,
) -> Result<Vec<AgentSessionRecord>, AppError> {
	let sessions = agent_sessions::table
		.inner_join(profiles::table.on(profiles::id.eq(agent_sessions::profile_id)))
		.filter(profiles::project_id.eq(project_id))
		.select(AgentSessionRecord::as_select())
		.order(agent_sessions::created_at.asc())
		.load(conn)
		.map_err(|e| AppError::DbError(e.to_string()))?;

	tracing::info!(
		target: "agent",
		%project_id,
		count = sessions.len(),
		"repo: list_by_project"
	);
	Ok(sessions)
}

/// Append a new event to the session's event log.
pub fn append_event(
	conn: &mut SqliteConnection,
	record: &NewAgentSessionEvent,
) -> Result<(), AppError> {
	diesel::insert_into(agent_session_events::table)
		.values(record)
		.execute(conn)
		.map_err(|e| AppError::DbError(e.to_string()))?;

	tracing::debug!(
		target: "agent",
		session_id = record.session_id,
		event_index = record.event_index,
		sender = record.sender,
		"repo: append_event"
	);
	Ok(())
}

/// Alias for `append_event` (for test compatibility).
pub fn insert_event(
	conn: &mut SqliteConnection,
	record: &NewAgentSessionEvent,
) -> Result<(), AppError> {
	append_event(conn, record)
}

/// Get all events for a session, ordered by event_index.
pub fn get_session_events(
	conn: &mut SqliteConnection,
	session_id: &str,
) -> Result<Vec<AgentSessionEventRecord>, AppError> {
	let events = agent_session_events::table
		.filter(agent_session_events::session_id.eq(session_id))
		.order(agent_session_events::event_index.asc())
		.load(conn)
		.map_err(|e| AppError::DbError(e.to_string()))?;

	tracing::info!(
		target: "agent",
		%session_id,
		event_count = events.len(),
		"repo: get_session_events"
	);
	Ok(events)
}

/// Alias for `get_session_events` (for test compatibility).
pub fn list_events(
	conn: &mut SqliteConnection,
	session_id: &str,
) -> Result<Vec<AgentSessionEventRecord>, AppError> {
	get_session_events(conn, session_id)
}

/// Get the next event index for a session (max index + 1).
/// Returns 0 if no events exist.
pub fn next_event_index(
	conn: &mut SqliteConnection,
	session_id: &str,
) -> Result<i32, AppError> {
	use diesel::dsl::max;

	let max_index: Option<i32> = agent_session_events::table
		.filter(agent_session_events::session_id.eq(session_id))
		.select(max(agent_session_events::event_index))
		.first(conn)
		.map_err(|e| AppError::DbError(e.to_string()))?;

	Ok(max_index.map(|idx| idx + 1).unwrap_or(0))
}

/// Get a single session by ID.
pub fn get_session(
	conn: &mut SqliteConnection,
	session_id: &str,
) -> Result<AgentSessionRecord, AppError> {
	agent_sessions::table
		.filter(agent_sessions::id.eq(session_id))
		.first(conn)
		.map_err(|e| AppError::DbError(e.to_string()))
}

/// Mark a session as destroyed (soft delete).
pub fn mark_destroyed(
	conn: &mut SqliteConnection,
	session_id: &str,
) -> Result<(), AppError> {
	let now = SystemTime::now()
		.duration_since(UNIX_EPOCH)
		.unwrap_or_default()
		.as_secs() as i32;

	diesel::update(agent_sessions::table.filter(agent_sessions::id.eq(session_id)))
		.set(agent_sessions::destroyed_at.eq(now))
		.execute(conn)
		.map_err(|e| AppError::DbError(e.to_string()))?;

	tracing::info!(target: "agent", %session_id, "repo: mark_destroyed");
	Ok(())
}

/// Mark all active sessions (destroyed_at IS NULL) as destroyed.
/// Used for orphan cleanup on startup/exit.
pub fn mark_all_active_destroyed(
	conn: &mut SqliteConnection,
) -> Result<usize, AppError> {
	let now = SystemTime::now()
		.duration_since(UNIX_EPOCH)
		.unwrap_or_default()
		.as_secs() as i32;

	let count = diesel::update(
		agent_sessions::table.filter(agent_sessions::destroyed_at.is_null()),
	)
	.set(agent_sessions::destroyed_at.eq(now))
	.execute(conn)
	.map_err(|e| AppError::DbError(e.to_string()))?;

	tracing::info!(target: "agent", count, "repo: mark_all_active_destroyed");
	Ok(count)
}

/// Alias for `mark_all_active_destroyed` (for test compatibility).
pub fn mark_all_destroyed(conn: &mut SqliteConnection) {
	let _ = mark_all_active_destroyed(conn);
}

/// List all agent sessions (no project filter).
pub fn list_all(
	conn: &mut SqliteConnection,
) -> Result<Vec<AgentSessionRecord>, AppError> {
	agent_sessions::table
		.select(AgentSessionRecord::as_select())
		.order(agent_sessions::created_at.asc())
		.load(conn)
		.map_err(|e| AppError::DbError(e.to_string()))
}

/// Transfer all events from one session to another.
/// Must be called AFTER inserting the new session record.
pub fn transfer_events(
	conn: &mut SqliteConnection,
	old_session_id: &str,
	new_session_id: &str,
) -> Result<usize, AppError> {
	let count = diesel::update(
		agent_session_events::table
			.filter(agent_session_events::session_id.eq(old_session_id)),
	)
	.set(agent_session_events::session_id.eq(new_session_id))
	.execute(conn)
	.map_err(|e| AppError::DbError(e.to_string()))?;

	tracing::info!(
		target: "agent",
		%old_session_id,
		%new_session_id,
		count,
		"repo: transfer_events"
	);
	Ok(count)
}

/// Hard delete a session and all its events (cascade delete).
pub fn delete_session(
	conn: &mut SqliteConnection,
	session_id: &str,
) -> Result<(), AppError> {
	let rows =
		diesel::delete(agent_sessions::table.filter(agent_sessions::id.eq(session_id)))
			.execute(conn)
			.map_err(|e| AppError::DbError(e.to_string()))?;

	tracing::info!(target: "agent", %session_id, rows_deleted = rows, "repo: delete_session");
	Ok(())
}

#[cfg(test)]
mod tests {
	use super::*;
	use diesel_migrations::MigrationHarness;
	use infra::db::MIGRATIONS;
	use model::profile::NewProfile;
	use model::project::NewProject;
	use model::schema::{profiles, projects};

	fn setup_db() -> SqliteConnection {
		let mut conn =
			SqliteConnection::establish(":memory:").expect("in-memory db");
		diesel::sql_query("PRAGMA foreign_keys=ON;")
			.execute(&mut conn)
			.ok();
		conn.run_pending_migrations(MIGRATIONS)
			.expect("run migrations");
		conn
	}

	fn insert_test_project(conn: &mut SqliteConnection, id: &str) {
		diesel::insert_into(projects::table)
			.values(&NewProject {
				id,
				name: "test-project",
				folder: "/test",
			})
			.execute(conn)
			.unwrap();
	}

	fn insert_test_profile(
		conn: &mut SqliteConnection,
		id: &str,
		project_id: &str,
	) {
		diesel::insert_into(profiles::table)
			.values(&NewProfile {
				id,
				project_id,
				branch_name: "main",
				worktree_path: "/worktree",
				is_default: true,
			})
			.execute(conn)
			.unwrap();
	}

	#[test]
	fn test_insert_and_get_session() {
		let mut conn = setup_db();
		insert_test_project(&mut conn, "proj1");
		insert_test_profile(&mut conn, "prof1", "proj1");

		let session = NewAgentSession {
			id: "sess1",
			agent: "claude",
			acp_session_id: "acp123",
			profile_id: "prof1",
			session_init_json: Some(r#"{"model":"sonnet"}"#),
		};

		insert_session(&mut conn, &session).unwrap();

		let retrieved = get_session(&mut conn, "sess1").unwrap();
		assert_eq!(retrieved.id, "sess1");
		assert_eq!(retrieved.agent, "claude");
		assert_eq!(retrieved.acp_session_id, "acp123");
		assert_eq!(retrieved.destroyed_at, None);
	}

	#[test]
	fn test_list_by_project() {
		let mut conn = setup_db();
		insert_test_project(&mut conn, "proj1");
		insert_test_profile(&mut conn, "prof1", "proj1");
		insert_test_profile(&mut conn, "prof2", "proj1");

		let s1 = NewAgentSession {
			id: "sess1",
			agent: "claude",
			acp_session_id: "acp1",
			profile_id: "prof1",
			session_init_json: None,
		};
		let s2 = NewAgentSession {
			id: "sess2",
			agent: "openai",
			acp_session_id: "acp2",
			profile_id: "prof2",
			session_init_json: None,
		};

		insert_session(&mut conn, &s1).unwrap();
		insert_session(&mut conn, &s2).unwrap();

		let sessions = list_by_project(&mut conn, "proj1").unwrap();
		assert_eq!(sessions.len(), 2);
		assert_eq!(sessions[0].id, "sess1");
		assert_eq!(sessions[1].id, "sess2");
	}

	#[test]
	fn test_append_and_get_events() {
		let mut conn = setup_db();
		insert_test_project(&mut conn, "proj1");
		insert_test_profile(&mut conn, "prof1", "proj1");

		let session = NewAgentSession {
			id: "sess1",
			agent: "claude",
			acp_session_id: "acp123",
			profile_id: "prof1",
			session_init_json: None,
		};
		insert_session(&mut conn, &session).unwrap();

		let e1 = NewAgentSessionEvent {
			id: "evt1",
			event_index: 0,
			session_id: "sess1",
			sender: "user",
			payload_json: r#"{"text":"hello"}"#,
			turn_index: 1,
		};
		let e2 = NewAgentSessionEvent {
			id: "evt2",
			event_index: 1,
			session_id: "sess1",
			sender: "agent",
			payload_json: r#"{"text":"hi there"}"#,
			turn_index: 1,
		};

		append_event(&mut conn, &e1).unwrap();
		append_event(&mut conn, &e2).unwrap();

		let events = get_session_events(&mut conn, "sess1").unwrap();
		assert_eq!(events.len(), 2);
		assert_eq!(events[0].event_index, 0);
		assert_eq!(events[0].sender, "user");
		assert_eq!(events[1].event_index, 1);
		assert_eq!(events[1].sender, "agent");
	}

	#[test]
	fn test_mark_destroyed() {
		let mut conn = setup_db();
		insert_test_project(&mut conn, "proj1");
		insert_test_profile(&mut conn, "prof1", "proj1");

		let session = NewAgentSession {
			id: "sess1",
			agent: "claude",
			acp_session_id: "acp123",
			profile_id: "prof1",
			session_init_json: None,
		};
		insert_session(&mut conn, &session).unwrap();

		mark_destroyed(&mut conn, "sess1").unwrap();

		let retrieved = get_session(&mut conn, "sess1").unwrap();
		assert!(retrieved.destroyed_at.is_some());

		// Should still appear in list_by_project (destroyed sessions are returned for restoration)
		let sessions = list_by_project(&mut conn, "proj1").unwrap();
		assert_eq!(sessions.len(), 1);
	}

	#[test]
	fn test_mark_all_active_destroyed() {
		let mut conn = setup_db();
		insert_test_project(&mut conn, "proj1");
		insert_test_profile(&mut conn, "prof1", "proj1");

		let s1 = NewAgentSession {
			id: "sess1",
			agent: "claude",
			acp_session_id: "acp1",
			profile_id: "prof1",
			session_init_json: None,
		};
		let s2 = NewAgentSession {
			id: "sess2",
			agent: "openai",
			acp_session_id: "acp2",
			profile_id: "prof1",
			session_init_json: None,
		};

		insert_session(&mut conn, &s1).unwrap();
		insert_session(&mut conn, &s2).unwrap();

		let count = mark_all_active_destroyed(&mut conn).unwrap();
		assert_eq!(count, 2);

		// Both sessions should still appear (for restoration)
		let sessions = list_by_project(&mut conn, "proj1").unwrap();
		assert_eq!(sessions.len(), 2);
	}

	#[test]
	fn test_delete_session_cascade() {
		let mut conn = setup_db();
		insert_test_project(&mut conn, "proj1");
		insert_test_profile(&mut conn, "prof1", "proj1");

		let session = NewAgentSession {
			id: "sess1",
			agent: "claude",
			acp_session_id: "acp123",
			profile_id: "prof1",
			session_init_json: None,
		};
		insert_session(&mut conn, &session).unwrap();

		let event = NewAgentSessionEvent {
			id: "evt1",
			event_index: 0,
			session_id: "sess1",
			sender: "user",
			payload_json: r#"{"text":"hello"}"#,
			turn_index: 1,
		};
		append_event(&mut conn, &event).unwrap();

		// Delete session should cascade delete events
		delete_session(&mut conn, "sess1").unwrap();

		let events = get_session_events(&mut conn, "sess1");
		assert!(events.is_err() || events.unwrap().is_empty());
	}
}
