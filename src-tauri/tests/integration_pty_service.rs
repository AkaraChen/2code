mod common;

use std::sync::{Arc, Mutex};

use common::{add_commit, cleanup, create_temp_git_repo, setup_db_pool};
use model::pty::{PtyConfig, PtySessionMeta};
use service::PtyEventEmitter;

// ============================================================
// Test Emitter (captures output/exit events without Tauri)
// ============================================================

struct TestEmitter {
	outputs: Arc<Mutex<Vec<(String, String)>>>,
	exits: Arc<Mutex<Vec<String>>>,
}

impl TestEmitter {
	fn new() -> Self {
		Self {
			outputs: Arc::new(Mutex::new(Vec::new())),
			exits: Arc::new(Mutex::new(Vec::new())),
		}
	}
}

impl PtyEventEmitter for TestEmitter {
	fn emit_output(&self, session_id: &str, text: &str) -> bool {
		self.outputs
			.lock()
			.unwrap()
			.push((session_id.to_string(), text.to_string()));
		true
	}

	fn emit_exit(&self, session_id: &str) {
		self.exits.lock().unwrap().push(session_id.to_string());
	}
}

/// Build a PtyContext backed by an in-memory DB + test emitter.
fn build_test_ctx(
	db: infra::db::DbPool,
) -> (service::pty::PtyContext, Arc<TestEmitter>) {
	let emitter = Arc::new(TestEmitter::new());
	let ctx = service::pty::PtyContext {
		db,
		sessions: infra::pty::create_session_map(),
		flush_senders: service::pty::create_flush_senders(),
		read_threads: infra::pty::create_thread_tracker(),
		emitter: emitter.clone(),
		helper_url: None,
		helper_bin: None,
	};
	(ctx, emitter)
}

/// Insert a project + default profile directly into the DB pool.
/// Returns the profile_id.
fn setup_project_in_pool(db: &infra::db::DbPool, folder: &str) -> String {
	let mut conn = db.lock().unwrap();
	common::insert_bare_project_and_profile(&mut conn, "p1", "pr1", folder);
	"pr1".to_string()
}

fn default_meta(profile_id: &str) -> PtySessionMeta {
	PtySessionMeta {
		profile_id: profile_id.to_string(),
		title: "test".to_string(),
	}
}

fn default_config(cwd: &str) -> PtyConfig {
	PtyConfig {
		shell: "/bin/sh".to_string(),
		cwd: cwd.to_string(),
		rows: 24,
		cols: 80,
	}
}

// ============================================================
// Tests
// ============================================================

#[test]
fn create_session_inserts_db_record() {
	let db = setup_db_pool();
	let dir = create_temp_git_repo();
	add_commit(&dir, "README.md", "# Test", "init");
	let folder = dir.to_string_lossy().to_string();
	let profile_id = setup_project_in_pool(&db, &folder);
	let (ctx, _emitter) = build_test_ctx(db.clone());

	let session_id = service::pty::create_session(
		&ctx,
		&default_meta(&profile_id),
		&default_config(&folder),
	)
	.unwrap();

	// Verify DB record exists
	let mut conn = db.lock().unwrap();
	let sessions =
		service::pty::list_project_sessions(&mut conn, "p1").unwrap();
	assert_eq!(sessions.len(), 1);
	assert_eq!(sessions[0].id, session_id);
	assert_eq!(sessions[0].profile_id, profile_id);
	assert_eq!(sessions[0].title, "test");
	assert_eq!(sessions[0].shell, "/bin/sh");
	assert!(sessions[0].closed_at.is_none());
	drop(conn);

	// Cleanup: close the PTY
	service::pty::close_session(&db, &ctx.sessions, &session_id).unwrap();
	cleanup(&dir);
}

#[test]
fn create_session_starts_emitting() {
	let db = setup_db_pool();
	let dir = create_temp_git_repo();
	add_commit(&dir, "README.md", "# Test", "init");
	let folder = dir.to_string_lossy().to_string();
	let profile_id = setup_project_in_pool(&db, &folder);
	let (ctx, emitter) = build_test_ctx(db.clone());

	let session_id = service::pty::create_session(
		&ctx,
		&default_meta(&profile_id),
		&default_config(&folder),
	)
	.unwrap();

	// Write some data to the PTY
	infra::pty::write_to_pty(&ctx.sessions, &session_id, b"echo hello\n")
		.unwrap();

	// Wait a bit for the read thread to process output
	std::thread::sleep(std::time::Duration::from_millis(500));

	let outputs = emitter.outputs.lock().unwrap();
	assert!(
		!outputs.is_empty(),
		"emitter should have received at least one output event"
	);
	// All output events should reference our session
	assert!(outputs.iter().all(|(id, _)| id == &session_id));

	drop(outputs);
	service::pty::close_session(&db, &ctx.sessions, &session_id).unwrap();
	cleanup(&dir);
}

#[test]
fn close_session_marks_db_closed() {
	let db = setup_db_pool();
	let dir = create_temp_git_repo();
	add_commit(&dir, "README.md", "# Test", "init");
	let folder = dir.to_string_lossy().to_string();
	let profile_id = setup_project_in_pool(&db, &folder);
	let (ctx, _emitter) = build_test_ctx(db.clone());

	let session_id = service::pty::create_session(
		&ctx,
		&default_meta(&profile_id),
		&default_config(&folder),
	)
	.unwrap();

	service::pty::close_session(&db, &ctx.sessions, &session_id).unwrap();

	let mut conn = db.lock().unwrap();
	let sessions =
		service::pty::list_project_sessions(&mut conn, "p1").unwrap();
	let s = sessions.iter().find(|s| s.id == session_id).unwrap();
	assert!(
		s.closed_at.is_some(),
		"closed_at should be set after close_session"
	);

	cleanup(&dir);
}

#[test]
fn create_session_nonexistent_profile_fails() {
	let db = setup_db_pool();
	let (ctx, _emitter) = build_test_ctx(db);

	let meta = PtySessionMeta {
		profile_id: "nonexistent-profile".to_string(),
		title: "test".to_string(),
	};
	let config = PtyConfig {
		shell: "/bin/sh".to_string(),
		cwd: "/tmp".to_string(),
		rows: 24,
		cols: 80,
	};

	let result = service::pty::create_session(&ctx, &meta, &config);
	assert!(result.is_err(), "should fail for nonexistent profile_id");
}

#[test]
fn restore_all_sessions_reuses_existing() {
	let db = setup_db_pool();
	let dir = create_temp_git_repo();
	add_commit(&dir, "README.md", "# Test", "init");
	let folder = dir.to_string_lossy().to_string();
	let profile_id = setup_project_in_pool(&db, &folder);
	let (ctx, _emitter) = build_test_ctx(db.clone());

	// Create original session
	let session_id = service::pty::create_session(
		&ctx,
		&default_meta(&profile_id),
		&default_config(&folder),
	)
	.unwrap();

	// Write some data so there's history
	infra::pty::write_to_pty(&ctx.sessions, &session_id, b"echo restore\n")
		.unwrap();
	std::thread::sleep(std::time::Duration::from_millis(500));

	// Close session (simulates app shutdown)
	service::pty::close_session(&db, &ctx.sessions, &session_id).unwrap();

	// Wait for background read thread to flush
	std::thread::sleep(std::time::Duration::from_millis(500));

	// Mark all closed (as startup would do)
	service::pty::mark_all_closed(&db);

	// Restore all sessions
	let count = service::pty::restore_all_sessions(&ctx);
	assert!(count > 0, "should restore at least one session");

	let mut conn = db.lock().unwrap();
	let sessions =
		service::pty::list_project_sessions(&mut conn, "p1").unwrap();

	// Should have exactly one session, and it should be the original ID
	assert_eq!(sessions.len(), 1, "should have exactly one session after restore");
	let restored_session = &sessions[0];
	assert_eq!(restored_session.id, session_id, "restored session ID should be the same as the original");
	assert!(restored_session.closed_at.is_none(), "restored session should be open (closed_at is None)");
	drop(conn);

	// Cleanup
	service::pty::close_session(&db, &ctx.sessions, &session_id).unwrap();
	cleanup(&dir);
}

#[test]
fn mark_all_closed_via_service() {
	let db = setup_db_pool();
	let dir = create_temp_git_repo();
	add_commit(&dir, "README.md", "# Test", "init");
	let folder = dir.to_string_lossy().to_string();
	let profile_id = setup_project_in_pool(&db, &folder);
	let (ctx, _emitter) = build_test_ctx(db.clone());

	// Create multiple sessions
	let id1 = service::pty::create_session(
		&ctx,
		&default_meta(&profile_id),
		&default_config(&folder),
	)
	.unwrap();
	let id2 = service::pty::create_session(
		&ctx,
		&default_meta(&profile_id),
		&default_config(&folder),
	)
	.unwrap();

	// mark_all_closed should close all open sessions
	service::pty::mark_all_closed(&db);

	let mut conn = db.lock().unwrap();
	let sessions =
		service::pty::list_project_sessions(&mut conn, "p1").unwrap();
	for s in &sessions {
		assert!(
			s.closed_at.is_some(),
			"session {} should have closed_at set",
			s.id
		);
	}
	drop(conn);

	// Cleanup PTY processes
	let _ = service::pty::close_session(&db, &ctx.sessions, &id1);
	let _ = service::pty::close_session(&db, &ctx.sessions, &id2);
	cleanup(&dir);
}

#[test]
fn create_session_loads_init_script() {
	let db = setup_db_pool();
	let dir = create_temp_git_repo();
	add_commit(&dir, "README.md", "# Test", "init");

	// Write a 2code.json with init_script
	let config_content =
		r#"{"init_script": ["export MY_VAR=hello", "alias ll='ls -la'"]}"#;
	std::fs::write(dir.join("2code.json"), config_content).unwrap();

	let folder = dir.to_string_lossy().to_string();
	let profile_id = setup_project_in_pool(&db, &folder);
	let (ctx, _emitter) = build_test_ctx(db.clone());

	// create_session should succeed — it loads init_script from 2code.json
	// and prepares a ZDOTDIR init directory. We verify by checking no error.
	let session_id = service::pty::create_session(
		&ctx,
		&default_meta(&profile_id),
		&default_config(&folder),
	)
	.unwrap();

	assert!(!session_id.is_empty());

	service::pty::close_session(&db, &ctx.sessions, &session_id).unwrap();
	cleanup(&dir);
}
