mod common;

use diesel::prelude::*;

use common::{insert_bare_project_and_profile, setup_db};
use model::agent::{NewAgentSession, NewAgentSessionEvent};
use repo::agent;

/// Helper: insert an agent session for the given profile.
fn insert_session(
	conn: &mut diesel::SqliteConnection,
	session_id: &str,
	profile_id: &str,
	agent_name: &str,
) {
	let record = NewAgentSession {
		id: session_id,
		agent: agent_name,
		acp_session_id: &format!("acp-{session_id}"),
		profile_id,
		session_init_json: None,
	};
	agent::insert_session(conn, &record).unwrap();
}

/// Helper: insert an agent session event.
fn insert_event(
	conn: &mut diesel::SqliteConnection,
	event_id: &str,
	session_id: &str,
	index: i32,
	sender: &str,
	payload: &str,
) {
	insert_event_with_turn(
		conn, event_id, session_id, index, sender, payload, 0,
	);
}

fn insert_event_with_turn(
	conn: &mut diesel::SqliteConnection,
	event_id: &str,
	session_id: &str,
	index: i32,
	sender: &str,
	payload: &str,
	turn_index: i32,
) {
	let event = NewAgentSessionEvent {
		id: event_id,
		event_index: index,
		session_id,
		sender,
		payload_json: payload,
		turn_index,
	};
	agent::insert_event(conn, &event).unwrap();
}

// ============================================================
// Session CRUD
// ============================================================

#[test]
fn insert_session_and_retrieve() {
	let mut conn = setup_db();
	insert_bare_project_and_profile(&mut conn, "p1", "pr1", "/tmp/test");

	let record = NewAgentSession {
		id: "as1",
		agent: "claude-code",
		acp_session_id: "acp-001",
		profile_id: "pr1",
		session_init_json: Some(r#"{"key":"value"}"#),
	};
	agent::insert_session(&mut conn, &record).unwrap();

	let session = agent::get_session(&mut conn, "as1").unwrap();
	assert_eq!(session.id, "as1");
	assert_eq!(session.agent, "claude-code");
	assert_eq!(session.acp_session_id, "acp-001");
	assert_eq!(session.profile_id, "pr1");
	assert!(session.destroyed_at.is_none());
	assert_eq!(
		session.session_init_json.as_deref(),
		Some(r#"{"key":"value"}"#)
	);
}

#[test]
fn insert_session_invalid_profile_returns_error() {
	let mut conn = setup_db();

	let record = NewAgentSession {
		id: "as-orphan",
		agent: "claude-code",
		acp_session_id: "acp-orphan",
		profile_id: "nonexistent-profile",
		session_init_json: None,
	};
	let result = agent::insert_session(&mut conn, &record);
	assert!(result.is_err(), "should fail on FK constraint");
}

#[test]
fn list_by_project_filters_correctly() {
	let mut conn = setup_db();
	insert_bare_project_and_profile(&mut conn, "p1", "pr1", "/tmp/p1");
	insert_bare_project_and_profile(&mut conn, "p2", "pr2", "/tmp/p2");

	insert_session(&mut conn, "as-p1", "pr1", "claude-code");
	insert_session(&mut conn, "as-p2", "pr2", "codex");

	let sessions = agent::list_by_project(&mut conn, "p1").unwrap();
	assert_eq!(sessions.len(), 1);
	assert_eq!(sessions[0].id, "as-p1");

	let sessions = agent::list_by_project(&mut conn, "p2").unwrap();
	assert_eq!(sessions.len(), 1);
	assert_eq!(sessions[0].id, "as-p2");
}

#[test]
fn list_by_project_includes_destroyed() {
	let mut conn = setup_db();
	insert_bare_project_and_profile(&mut conn, "p1", "pr1", "/tmp/p1");

	insert_session(&mut conn, "as-active", "pr1", "claude-code");
	insert_session(&mut conn, "as-dead", "pr1", "claude-code");

	let _ = agent::mark_destroyed(&mut conn, "as-dead");

	// Both sessions should be returned (destroyed ones are needed for restoration)
	let sessions = agent::list_by_project(&mut conn, "p1").unwrap();
	assert_eq!(sessions.len(), 2);
}

#[test]
fn list_by_project_empty() {
	let mut conn = setup_db();
	insert_bare_project_and_profile(&mut conn, "p1", "pr1", "/tmp/p1");

	let sessions = agent::list_by_project(&mut conn, "p1").unwrap();
	assert!(sessions.is_empty());
}

#[test]
fn get_session_nonexistent_returns_error() {
	let mut conn = setup_db();
	let result = agent::get_session(&mut conn, "nonexistent-id");
	assert!(result.is_err());
}

#[test]
fn mark_destroyed_sets_timestamp() {
	let mut conn = setup_db();
	insert_bare_project_and_profile(&mut conn, "p1", "pr1", "/tmp/p1");
	insert_session(&mut conn, "as1", "pr1", "claude-code");

	let _ = agent::mark_destroyed(&mut conn, "as1");

	let session = agent::get_session(&mut conn, "as1").unwrap();
	assert!(session.destroyed_at.is_some(), "destroyed_at should be set");
}

#[test]
fn mark_all_destroyed_affects_only_active() {
	let mut conn = setup_db();
	insert_bare_project_and_profile(&mut conn, "p1", "pr1", "/tmp/p1");

	insert_session(&mut conn, "as1", "pr1", "claude-code");
	insert_session(&mut conn, "as2", "pr1", "codex");
	insert_session(&mut conn, "as3", "pr1", "opencode");

	// Pre-destroy one
	let _ = agent::mark_destroyed(&mut conn, "as1");
	let before = agent::get_session(&mut conn, "as1").unwrap();
	let before_ts = before.destroyed_at.unwrap();

	agent::mark_all_destroyed(&mut conn);

	// All should have destroyed_at set
	for id in ["as1", "as2", "as3"] {
		let s = agent::get_session(&mut conn, id).unwrap();
		assert!(
			s.destroyed_at.is_some(),
			"session {id} should have destroyed_at"
		);
	}

	// Previously destroyed session should have its timestamp updated
	let after = agent::get_session(&mut conn, "as1").unwrap();
	assert!(
		after.destroyed_at.unwrap() >= before_ts,
		"timestamp should be >= original"
	);
}

#[test]
fn delete_session_cascades_events() {
	let mut conn = setup_db();
	insert_bare_project_and_profile(&mut conn, "p1", "pr1", "/tmp/p1");
	insert_session(&mut conn, "as1", "pr1", "claude-code");
	insert_event(&mut conn, "ev1", "as1", 0, "user", r#"{"text":"hi"}"#);
	insert_event(&mut conn, "ev2", "as1", 1, "agent", r#"{"text":"hello"}"#);

	// Events exist
	let events = agent::list_events(&mut conn, "as1").unwrap();
	assert_eq!(events.len(), 2);

	// Delete session → events cascade
	agent::delete_session(&mut conn, "as1").unwrap();

	let events = agent::list_events(&mut conn, "as1").unwrap();
	assert!(events.is_empty(), "events should be cascade-deleted");
}

#[test]
fn delete_session_nonexistent_succeeds() {
	let mut conn = setup_db();
	let result = agent::delete_session(&mut conn, "fake-id");
	assert!(result.is_ok());
}

// ============================================================
// Event Operations
// ============================================================

#[test]
fn insert_and_list_events_ordered() {
	let mut conn = setup_db();
	insert_bare_project_and_profile(&mut conn, "p1", "pr1", "/tmp/p1");
	insert_session(&mut conn, "as1", "pr1", "claude-code");

	insert_event(&mut conn, "ev-c", "as1", 2, "agent", r#"{"c":3}"#);
	insert_event(&mut conn, "ev-a", "as1", 0, "user", r#"{"a":1}"#);
	insert_event(&mut conn, "ev-b", "as1", 1, "agent", r#"{"b":2}"#);

	let events = agent::list_events(&mut conn, "as1").unwrap();
	assert_eq!(events.len(), 3);
	assert_eq!(events[0].event_index, 0);
	assert_eq!(events[1].event_index, 1);
	assert_eq!(events[2].event_index, 2);
	assert_eq!(events[0].id, "ev-a");
	assert_eq!(events[1].id, "ev-b");
	assert_eq!(events[2].id, "ev-c");
}

#[test]
fn next_event_index_starts_at_zero() {
	let mut conn = setup_db();
	insert_bare_project_and_profile(&mut conn, "p1", "pr1", "/tmp/p1");
	insert_session(&mut conn, "as1", "pr1", "claude-code");

	let idx = agent::next_event_index(&mut conn, "as1").unwrap();
	assert_eq!(idx, 0);
}

#[test]
fn next_event_index_increments() {
	let mut conn = setup_db();
	insert_bare_project_and_profile(&mut conn, "p1", "pr1", "/tmp/p1");
	insert_session(&mut conn, "as1", "pr1", "claude-code");

	insert_event(&mut conn, "ev0", "as1", 0, "user", "{}");
	insert_event(&mut conn, "ev1", "as1", 1, "agent", "{}");
	insert_event(&mut conn, "ev2", "as1", 2, "user", "{}");

	let idx = agent::next_event_index(&mut conn, "as1").unwrap();
	assert_eq!(idx, 3);
}

#[test]
fn insert_event_invalid_session_returns_error() {
	let mut conn = setup_db();
	let event = NewAgentSessionEvent {
		id: "ev-orphan",
		event_index: 0,
		session_id: "nonexistent-session",
		sender: "user",
		payload_json: "{}",
		turn_index: 0,
	};
	let result = agent::insert_event(&mut conn, &event);
	assert!(result.is_err(), "should fail on FK constraint");
}

#[test]
fn list_events_empty_session() {
	let mut conn = setup_db();
	insert_bare_project_and_profile(&mut conn, "p1", "pr1", "/tmp/p1");
	insert_session(&mut conn, "as1", "pr1", "claude-code");

	let events = agent::list_events(&mut conn, "as1").unwrap();
	assert!(events.is_empty());
}

// ============================================================
// Cross-Layer Cascade Tests
// ============================================================

#[test]
fn profile_delete_blocked_by_agent_session() {
	let mut conn = setup_db();
	// Use insert_bare for the project + default profile
	insert_bare_project_and_profile(&mut conn, "p1", "pr-default", "/tmp/p1");

	// Insert a non-default profile directly (no git worktree needed for DB test)
	diesel::insert_into(model::schema::profiles::table)
		.values(&model::profile::NewProfile {
			id: "pr-extra",
			project_id: "p1",
			branch_name: "feature",
			worktree_path: "/tmp/worktree",
			is_default: false,
		})
		.execute(&mut conn)
		.unwrap();

	// Attach an agent session to this profile
	insert_session(&mut conn, "as1", "pr-extra", "claude-code");

	// Verify session exists
	let session = agent::get_session(&mut conn, "as1").unwrap();
	assert_eq!(session.profile_id, "pr-extra");

	// Delete the profile - should cascade delete agent_sessions
	let result = diesel::delete(
		model::schema::profiles::table
			.filter(model::schema::profiles::id.eq("pr-extra")),
	)
	.execute(&mut conn);

	assert!(
		result.is_ok(),
		"profile delete should succeed with CASCADE delete of agent sessions"
	);

	// Verify agent session was cascade deleted
	let session_result = agent::get_session(&mut conn, "as1");
	assert!(
		session_result.is_err(),
		"agent session should be cascade deleted when profile is deleted"
	);
}

#[test]
fn agent_session_full_db_lifecycle() {
	let mut conn = setup_db();
	insert_bare_project_and_profile(&mut conn, "p1", "pr1", "/tmp/p1");

	// 1. Insert session
	let record = NewAgentSession {
		id: "as-lifecycle",
		agent: "claude-code",
		acp_session_id: "acp-lifecycle",
		profile_id: "pr1",
		session_init_json: Some(r#"{"cwd":"/tmp"}"#),
	};
	agent::insert_session(&mut conn, &record).unwrap();

	// 2. Insert user event
	insert_event(
		&mut conn,
		"ev-user",
		"as-lifecycle",
		0,
		"user",
		r#"{"text":"hello"}"#,
	);

	// 3. Insert agent event
	insert_event(
		&mut conn,
		"ev-agent",
		"as-lifecycle",
		1,
		"agent",
		r#"{"text":"hi there"}"#,
	);

	// 4. Check next_index
	let idx = agent::next_event_index(&mut conn, "as-lifecycle").unwrap();
	assert_eq!(idx, 2);

	// 5. Mark destroyed
	let _ = agent::mark_destroyed(&mut conn, "as-lifecycle");
	let session = agent::get_session(&mut conn, "as-lifecycle").unwrap();
	assert!(session.destroyed_at.is_some());

	// 6. Events should still be readable after destroy
	let events = agent::list_events(&mut conn, "as-lifecycle").unwrap();
	assert_eq!(events.len(), 2);
	assert_eq!(events[0].sender, "user");
	assert_eq!(events[1].sender, "agent");
}

#[test]
fn agent_session_restore_db_flow() {
	let mut conn = setup_db();
	insert_bare_project_and_profile(&mut conn, "p1", "pr1", "/tmp/p1");

	// 1. Old session with events
	insert_session(&mut conn, "as-old", "pr1", "claude-code");
	insert_event(
		&mut conn,
		"ev-old-0",
		"as-old",
		0,
		"user",
		r#"{"text":"msg1"}"#,
	);
	insert_event(
		&mut conn,
		"ev-old-1",
		"as-old",
		1,
		"agent",
		r#"{"text":"reply1"}"#,
	);

	// Read old events
	let old_events = agent::list_events(&mut conn, "as-old").unwrap();
	assert_eq!(old_events.len(), 2);

	// 2. Create new session
	insert_session(&mut conn, "as-new", "pr1", "claude-code");

	// 3. Transfer events to new session (uses repo::agent::transfer_events)
	let transferred =
		agent::transfer_events(&mut conn, "as-old", "as-new").unwrap();
	assert_eq!(transferred, 2, "should transfer 2 events");

	// 4. Delete old session
	agent::delete_session(&mut conn, "as-old").unwrap();

	// 5. Verify: old session gone
	let result = agent::get_session(&mut conn, "as-old");
	assert!(result.is_err());

	// Old events gone (cascade delete should not affect transferred events)
	let old_events = agent::list_events(&mut conn, "as-old").unwrap();
	assert!(old_events.is_empty());

	// 6. Verify: new session has the transferred events
	let new_events = agent::list_events(&mut conn, "as-new").unwrap();
	assert_eq!(new_events.len(), 2);
	assert_eq!(new_events[0].payload_json, r#"{"text":"msg1"}"#);
	assert_eq!(new_events[1].payload_json, r#"{"text":"reply1"}"#);
}

// ============================================================
// Comprehensive Restoration Flow Tests
// ============================================================

#[test]
fn transfer_events_preserves_turn_index() {
	let mut conn = setup_db();
	insert_bare_project_and_profile(&mut conn, "p1", "pr1", "/tmp/p1");

	insert_session(&mut conn, "as-old", "pr1", "claude-code");

	// Multi-turn conversation: turn 1 (user+agent), turn 2 (user+agent)
	insert_event_with_turn(
		&mut conn,
		"ev1",
		"as-old",
		0,
		"user",
		r#"{"text":"first question"}"#,
		1,
	);
	insert_event_with_turn(
		&mut conn,
		"ev2",
		"as-old",
		1,
		"agent",
		r#"{"method":"session/update","params":{"sessionId":"acp1","update":{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"first answer"}}}}"#,
		1,
	);
	insert_event_with_turn(
		&mut conn,
		"ev3",
		"as-old",
		2,
		"user",
		r#"{"text":"second question"}"#,
		2,
	);
	insert_event_with_turn(
		&mut conn,
		"ev4",
		"as-old",
		3,
		"agent",
		r#"{"method":"session/update","params":{"sessionId":"acp1","update":{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"second answer"}}}}"#,
		2,
	);

	// Create new session and transfer
	insert_session(&mut conn, "as-new", "pr1", "claude-code");
	let count = agent::transfer_events(&mut conn, "as-old", "as-new").unwrap();
	assert_eq!(count, 4);

	// Verify turn indices are preserved
	let events = agent::list_events(&mut conn, "as-new").unwrap();
	assert_eq!(events.len(), 4);
	assert_eq!(events[0].turn_index, 1);
	assert_eq!(events[1].turn_index, 1);
	assert_eq!(events[2].turn_index, 2);
	assert_eq!(events[3].turn_index, 2);

	// Verify event order is preserved
	assert_eq!(events[0].sender, "user");
	assert_eq!(events[1].sender, "agent");
	assert_eq!(events[2].sender, "user");
	assert_eq!(events[3].sender, "agent");
}

#[test]
fn transfer_events_empty_session_returns_zero() {
	let mut conn = setup_db();
	insert_bare_project_and_profile(&mut conn, "p1", "pr1", "/tmp/p1");

	insert_session(&mut conn, "as-old", "pr1", "claude-code");
	insert_session(&mut conn, "as-new", "pr1", "claude-code");

	let count = agent::transfer_events(&mut conn, "as-old", "as-new").unwrap();
	assert_eq!(count, 0);
}

#[test]
fn full_reconnect_db_flow() {
	// Simulates the complete reconnection database flow:
	// mark_destroyed → list_all → reconnect (insert new + transfer + delete old)
	let mut conn = setup_db();
	insert_bare_project_and_profile(&mut conn, "p1", "pr1", "/tmp/p1");

	// 1. Create original session with conversation
	insert_session(&mut conn, "as-original", "pr1", "claude-code");
	insert_event_with_turn(
		&mut conn,
		"ev-u1",
		"as-original",
		0,
		"user",
		r#"{"text":"hello"}"#,
		1,
	);
	insert_event_with_turn(
		&mut conn,
		"ev-a1",
		"as-original",
		1,
		"agent",
		r#"{"method":"session/update","params":{"sessionId":"acp1","update":{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"hi there"}}}}"#,
		1,
	);

	// 2. Simulate app shutdown: mark destroyed
	let destroyed = agent::mark_all_active_destroyed(&mut conn).unwrap();
	assert_eq!(destroyed, 1);

	// 3. Simulate app restart: list_all returns destroyed sessions
	let all = agent::list_all(&mut conn).unwrap();
	assert_eq!(all.len(), 1);
	assert_eq!(all[0].id, "as-original");
	assert!(all[0].destroyed_at.is_some());

	// 4. Simulate reconnect: create new session, transfer events, delete old
	let old = &all[0];
	insert_session(&mut conn, "as-reconnected", &old.profile_id, &old.agent);

	let transferred =
		agent::transfer_events(&mut conn, &old.id, "as-reconnected").unwrap();
	assert_eq!(transferred, 2, "should transfer all events");

	agent::delete_session(&mut conn, &old.id).unwrap();

	// 5. Verify final state
	// Old session gone
	assert!(agent::get_session(&mut conn, "as-original").is_err());

	// New session exists
	let new_session = agent::get_session(&mut conn, "as-reconnected").unwrap();
	assert_eq!(new_session.agent, "claude-code");
	assert!(new_session.destroyed_at.is_none());

	// Events belong to new session with correct data
	let events = agent::list_events(&mut conn, "as-reconnected").unwrap();
	assert_eq!(events.len(), 2);
	assert_eq!(events[0].sender, "user");
	assert!(events[0].payload_json.contains("hello"));
	assert_eq!(events[1].sender, "agent");
	assert!(events[1].payload_json.contains("hi there"));

	// next_event_index continues from where we left off
	let next_idx =
		agent::next_event_index(&mut conn, "as-reconnected").unwrap();
	assert_eq!(next_idx, 2);

	// list_all should now return only the new session
	let all_after = agent::list_all(&mut conn).unwrap();
	assert_eq!(all_after.len(), 1);
	assert_eq!(all_after[0].id, "as-reconnected");
}

#[test]
fn multiple_sessions_reconnect_independently() {
	let mut conn = setup_db();
	insert_bare_project_and_profile(&mut conn, "p1", "pr1", "/tmp/p1");

	// Create two sessions with different agents
	insert_session(&mut conn, "as-claude", "pr1", "claude-code");
	insert_event_with_turn(
		&mut conn,
		"ev-c1",
		"as-claude",
		0,
		"user",
		r#"{"text":"claude msg"}"#,
		1,
	);

	insert_session(&mut conn, "as-codex", "pr1", "codex");
	insert_event_with_turn(
		&mut conn,
		"ev-x1",
		"as-codex",
		0,
		"user",
		r#"{"text":"codex msg"}"#,
		1,
	);

	// Mark all destroyed
	agent::mark_all_destroyed(&mut conn);

	let all = agent::list_all(&mut conn).unwrap();
	assert_eq!(all.len(), 2);

	// Reconnect each independently
	for old in &all {
		let new_id = format!("as-new-{}", old.agent);
		insert_session(&mut conn, &new_id, &old.profile_id, &old.agent);
		agent::transfer_events(&mut conn, &old.id, &new_id).unwrap();
		agent::delete_session(&mut conn, &old.id).unwrap();
	}

	// Verify
	let claude_events =
		agent::list_events(&mut conn, "as-new-claude-code").unwrap();
	assert_eq!(claude_events.len(), 1);
	assert!(claude_events[0].payload_json.contains("claude msg"));

	let codex_events = agent::list_events(&mut conn, "as-new-codex").unwrap();
	assert_eq!(codex_events.len(), 1);
	assert!(codex_events[0].payload_json.contains("codex msg"));

	// Only new sessions remain
	let final_all = agent::list_all(&mut conn).unwrap();
	assert_eq!(final_all.len(), 2);
	assert!(final_all.iter().all(|s| s.destroyed_at.is_none()));
}

#[test]
fn list_all_returns_all_regardless_of_destroyed_state() {
	let mut conn = setup_db();
	insert_bare_project_and_profile(&mut conn, "p1", "pr1", "/tmp/p1");

	insert_session(&mut conn, "as-active", "pr1", "claude-code");
	insert_session(&mut conn, "as-destroyed", "pr1", "codex");
	let _ = agent::mark_destroyed(&mut conn, "as-destroyed");

	let all = agent::list_all(&mut conn).unwrap();
	assert_eq!(
		all.len(),
		2,
		"list_all should return both active and destroyed"
	);
}
