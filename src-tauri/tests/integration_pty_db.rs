mod common;

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use common::{cleanup, create_project_with_git_repo, setup_db};
use diesel::RunQueryDsl;
use infra::db::DbPool;
use infra::pty_log::{self, SessionLog};
use model::pty::{NewPtySessionRecord, PtyConfig, PtySessionMeta};
use repo::pty;
use service::pty::{create_flush_senders, PtyContext};

/// A unique, empty temp directory to stand in for the per-session log store.
fn tmp_log_dir(tag: &str) -> PathBuf {
	let dir = std::env::temp_dir()
		.join(format!("pty-db-test-{}-{tag}", std::process::id()));
	let _ = std::fs::remove_dir_all(&dir);
	std::fs::create_dir_all(&dir).unwrap();
	dir
}

/// Append raw output to a session's log file (what the persist thread does).
fn write_output(dir: &Path, session_id: &str, data: &[u8]) {
	SessionLog::open(dir, session_id)
		.unwrap()
		.append(data)
		.unwrap();
}

struct TestPtyEmitter;

impl service::PtyEventEmitter for TestPtyEmitter {
	fn emit_output(&self, _session_id: &str, _bytes: &[u8]) -> bool {
		true
	}

	fn emit_exit(&self, _session_id: &str) {}
}

fn test_shell() -> String {
	if cfg!(windows) {
		"powershell.exe -NoLogo -NoProfile -NonInteractive".to_string()
	} else {
		"/bin/sh".to_string()
	}
}

fn startup_commands() -> Vec<String> {
	if cfg!(windows) {
		vec!["Write-Output tmpl-ok".to_string(), "exit".to_string()]
	} else {
		vec!["printf 'tmpl-ok\\n'".to_string(), "exit".to_string()]
	}
}

fn pty_context(
	conn: diesel::SqliteConnection,
	tag: &str,
) -> (
	PtyContext,
	infra::pty::PtySessionMap,
	infra::pty::PtyReadThreads,
	PathBuf,
) {
	let db: DbPool = Arc::new(Mutex::new(conn));
	let sessions = infra::pty::create_session_map();
	let read_threads = infra::pty::create_thread_tracker();
	let flush_senders = create_flush_senders();
	let emitter = Arc::new(TestPtyEmitter);
	let logs = tmp_log_dir(tag);
	let ctx = PtyContext {
		db,
		sessions: sessions.clone(),
		flush_senders,
		read_threads: read_threads.clone(),
		emitter,
		output_dir: logs.clone(),
	};

	(ctx, sessions, read_threads, logs)
}

fn wait_for_flush_sender(ctx: &PtyContext, session_id: &str) {
	for _ in 0..50 {
		if ctx.flush_senders.lock().unwrap().contains_key(session_id) {
			return;
		}
		std::thread::sleep(Duration::from_millis(20));
	}
	panic!("flush sender was not registered for session {session_id}");
}

fn pty_config(cwd: String) -> PtyConfig {
	PtyConfig {
		shell: test_shell(),
		cwd,
		rows: 24,
		cols: 80,
		startup_commands: Vec::new(),
	}
}

fn create_live_session(
	ctx: &PtyContext,
	profile_id: &str,
	cwd: &str,
	title: &str,
) -> String {
	service::pty::create_session(
		ctx,
		&PtySessionMeta {
			profile_id: profile_id.to_string(),
			title: title.to_string(),
		},
		&pty_config(cwd.to_string()),
	)
	.unwrap()
}

/// Helper: insert a session record for a given profile.
fn insert_session(
	conn: &mut diesel::SqliteConnection,
	session_id: &str,
	profile_id: &str,
	title: &str,
) {
	let record = NewPtySessionRecord {
		id: session_id,
		profile_id,
		title,
		shell: "/bin/bash",
		cwd: "/tmp",
		cols: 80,
		rows: 24,
	};
	pty::insert_session(conn, &record).unwrap();
}

// ============================================================
// Session List (via profile JOIN)
// ============================================================

#[test]
fn list_sessions_joins_via_profiles() {
	let mut conn = setup_db();
	let (project, default_profile, dir) =
		create_project_with_git_repo(&mut conn);

	insert_session(&mut conn, "s1", &default_profile.id, "bash");

	// Frontend calls with projectId, backend JOINs through profiles
	let sessions =
		service::pty::list_project_sessions(&mut conn, &project.id).unwrap();
	assert_eq!(sessions.len(), 1);
	assert_eq!(sessions[0].id, "s1");
	assert_eq!(sessions[0].profile_id, default_profile.id);

	cleanup(&dir);
}

#[test]
fn list_sessions_returns_correct_shape() {
	let mut conn = setup_db();
	let (project, default_profile, dir) =
		create_project_with_git_repo(&mut conn);

	insert_session(&mut conn, "s-shape", &default_profile.id, "zsh");

	let sessions =
		service::pty::list_project_sessions(&mut conn, &project.id).unwrap();
	let s = &sessions[0];

	assert_eq!(s.id, "s-shape");
	assert_eq!(s.profile_id, default_profile.id);
	assert_eq!(s.title, "zsh");
	assert_eq!(s.shell, "/bin/bash");
	assert_eq!(s.cwd, "/tmp");
	assert!(!s.created_at.is_empty());
	assert!(s.closed_at.is_none());
	assert_eq!(s.cols, 80);
	assert_eq!(s.rows, 24);

	cleanup(&dir);
}

#[test]
fn list_sessions_across_multiple_profiles() {
	let mut conn = setup_db();
	let (project, default_profile, dir) =
		create_project_with_git_repo(&mut conn);

	let profile2 =
		service::profile::create(&mut conn, &project.id, "second-branch")
			.unwrap();

	insert_session(&mut conn, "s1", &default_profile.id, "bash");
	insert_session(&mut conn, "s2", &profile2.id, "bash");

	let sessions =
		service::pty::list_project_sessions(&mut conn, &project.id).unwrap();
	assert_eq!(sessions.len(), 2);

	service::profile::delete(&mut conn, &profile2.id).unwrap();
	cleanup(&dir);
}

#[test]
fn list_sessions_ordered_by_created_at() {
	let mut conn = setup_db();
	let (project, default_profile, dir) =
		create_project_with_git_repo(&mut conn);

	insert_session(&mut conn, "s-first", &default_profile.id, "first");
	insert_session(&mut conn, "s-second", &default_profile.id, "second");
	insert_session(&mut conn, "s-third", &default_profile.id, "third");

	let sessions =
		service::pty::list_project_sessions(&mut conn, &project.id).unwrap();
	assert_eq!(sessions.len(), 3);
	assert_eq!(sessions[0].id, "s-first");
	assert_eq!(sessions[1].id, "s-second");
	assert_eq!(sessions[2].id, "s-third");

	cleanup(&dir);
}

#[test]
fn list_sessions_empty_project() {
	let mut conn = setup_db();
	let (project, _default, dir) = create_project_with_git_repo(&mut conn);

	let sessions =
		service::pty::list_project_sessions(&mut conn, &project.id).unwrap();
	assert!(sessions.is_empty());

	cleanup(&dir);
}

// ============================================================
// Session List (Edge Cases)
// ============================================================

#[test]
fn list_sessions_nonexistent_project_returns_empty() {
	let mut conn = setup_db();
	// JOIN results in empty set, not an error
	let sessions =
		service::pty::list_project_sessions(&mut conn, "nonexistent-project")
			.unwrap();
	assert!(sessions.is_empty());
}

#[test]
fn list_sessions_excludes_other_projects() {
	let mut conn = setup_db();
	let (project1, profile1, dir1) = create_project_with_git_repo(&mut conn);
	let (project2, profile2, dir2) = create_project_with_git_repo(&mut conn);

	insert_session(&mut conn, "s-p1", &profile1.id, "bash");
	insert_session(&mut conn, "s-p2", &profile2.id, "bash");

	let sessions1 =
		service::pty::list_project_sessions(&mut conn, &project1.id).unwrap();
	assert_eq!(sessions1.len(), 1);
	assert_eq!(sessions1[0].id, "s-p1");

	let sessions2 =
		service::pty::list_project_sessions(&mut conn, &project2.id).unwrap();
	assert_eq!(sessions2.len(), 1);
	assert_eq!(sessions2[0].id, "s-p2");

	cleanup(&dir1);
	cleanup(&dir2);
}

// ============================================================
// Session History
// ============================================================

#[test]
fn history_starts_empty() {
	let logs = tmp_log_dir("history-starts-empty");
	// A session that never produced output reads as empty.
	assert!(service::pty::get_history(&logs, "s-empty").is_empty());
}

#[test]
fn append_and_read_history() {
	let logs = tmp_log_dir("append-and-read");
	write_output(&logs, "s-append", b"hello world");

	let history = service::pty::get_history(&logs, "s-append");
	assert_eq!(history, b"hello world");
}

#[test]
fn clear_output_resets_history() {
	let logs = tmp_log_dir("clear-resets");
	let senders = create_flush_senders();

	write_output(&logs, "s-clear", b"some data");
	// No live persist thread → clear_output falls back to truncating the file.
	service::pty::clear_output(&logs, &senders, "s-clear").unwrap();

	assert!(service::pty::get_history(&logs, "s-clear").is_empty());
}

#[test]
fn large_output_is_not_capped() {
	let logs = tmp_log_dir("no-cap");

	// Write 1.5MB — files have no size cap (scrollback is bounded by vt100
	// sanitize on restore, not by trimming bytes here).
	let chunk = vec![b'X'; 512 * 1024];
	write_output(&logs, "s-big", &chunk);
	write_output(&logs, "s-big", &chunk);
	write_output(&logs, "s-big", &chunk);

	let history = service::pty::get_history(&logs, "s-big");
	assert_eq!(history.len(), 3 * 512 * 1024);
}

// ============================================================
// Session History (Edge Cases)
// ============================================================

#[test]
fn history_nonexistent_session_returns_empty() {
	let logs = tmp_log_dir("history-nonexistent");
	assert!(service::pty::get_history(&logs, "nonexistent-session").is_empty());
}

#[test]
fn append_empty_data() {
	let logs = tmp_log_dir("append-empty");
	write_output(&logs, "s-empty-append", &[]);
	assert!(service::pty::get_history(&logs, "s-empty-append").is_empty());
}

#[test]
fn append_binary_data() {
	let logs = tmp_log_dir("append-binary");
	let data: Vec<u8> = (0..=255).collect();
	write_output(&logs, "s-binary", &data);

	assert_eq!(service::pty::get_history(&logs, "s-binary"), data);
}

#[test]
fn multiple_appends_concatenated_correctly() {
	let logs = tmp_log_dir("multi-append");
	write_output(&logs, "s-multi", b"AAA");
	write_output(&logs, "s-multi", b"BBB");
	write_output(&logs, "s-multi", b"CCC");

	assert_eq!(service::pty::get_history(&logs, "s-multi"), b"AAABBBCCC");
}

// ============================================================
// Session State
// ============================================================

#[test]
fn resize_updates_dimensions_in_db() {
	let mut conn = setup_db();
	let (project, default_profile, dir) =
		create_project_with_git_repo(&mut conn);

	insert_session(&mut conn, "s-resize", &default_profile.id, "bash");
	pty::update_dimensions(&mut conn, "s-resize", 200, 50);

	let sessions =
		service::pty::list_project_sessions(&mut conn, &project.id).unwrap();
	let s = sessions.iter().find(|s| s.id == "s-resize").unwrap();
	assert_eq!(s.cols, 200);
	assert_eq!(s.rows, 50);

	cleanup(&dir);
}

#[test]
fn mark_closed_sets_closed_at() {
	let mut conn = setup_db();
	let (project, default_profile, dir) =
		create_project_with_git_repo(&mut conn);

	insert_session(&mut conn, "s-close", &default_profile.id, "bash");
	pty::mark_closed(&mut conn, "s-close");

	let sessions =
		service::pty::list_project_sessions(&mut conn, &project.id).unwrap();
	let s = sessions.iter().find(|s| s.id == "s-close").unwrap();
	assert!(s.closed_at.is_some());

	cleanup(&dir);
}

#[test]
fn mark_all_open_closed() {
	let mut conn = setup_db();
	let (project, default_profile, dir) =
		create_project_with_git_repo(&mut conn);

	insert_session(&mut conn, "s-open-1", &default_profile.id, "bash");
	insert_session(&mut conn, "s-open-2", &default_profile.id, "bash");

	// Close one manually
	pty::mark_closed(&mut conn, "s-open-1");

	// Batch close all remaining open
	pty::mark_all_open_closed(&mut conn);

	let sessions =
		service::pty::list_project_sessions(&mut conn, &project.id).unwrap();
	for s in &sessions {
		assert!(s.closed_at.is_some(), "session {} should be closed", s.id);
	}

	cleanup(&dir);
}

// ============================================================
// Session Creation (Edge Cases)
// ============================================================

#[test]
fn insert_session_for_nonexistent_profile_returns_error() {
	let mut conn = setup_db();
	let record = NewPtySessionRecord {
		id: "s-orphan",
		profile_id: "nonexistent-profile",
		title: "bash",
		shell: "/bin/bash",
		cwd: "/tmp",
		cols: 80,
		rows: 24,
	};
	let result = pty::insert_session(&mut conn, &record);
	assert!(result.is_err());
}

#[test]
fn insert_duplicate_session_id_returns_error() {
	let mut conn = setup_db();
	let (_project, default_profile, dir) =
		create_project_with_git_repo(&mut conn);

	insert_session(&mut conn, "s-dup", &default_profile.id, "bash");
	let record = NewPtySessionRecord {
		id: "s-dup",
		profile_id: &default_profile.id,
		title: "bash",
		shell: "/bin/bash",
		cwd: "/tmp",
		cols: 80,
		rows: 24,
	};
	let result = pty::insert_session(&mut conn, &record);
	assert!(result.is_err());

	cleanup(&dir);
}

#[test]
fn create_session_executes_startup_commands() {
	let mut conn = setup_db();
	let (_project, default_profile, dir) =
		create_project_with_git_repo(&mut conn);
	let db: DbPool = Arc::new(Mutex::new(conn));

	let sessions = infra::pty::create_session_map();
	let read_threads = infra::pty::create_thread_tracker();
	let flush_senders = create_flush_senders();
	let emitter = Arc::new(TestPtyEmitter);
	let logs = tmp_log_dir("startup-commands");
	let ctx = PtyContext {
		db: db.clone(),
		sessions: sessions.clone(),
		flush_senders: flush_senders.clone(),
		read_threads: read_threads.clone(),
		emitter,
		output_dir: logs.clone(),
	};

	let session_id = service::pty::create_session(
		&ctx,
		&PtySessionMeta {
			profile_id: default_profile.id.clone(),
			title: "Dev Server".to_string(),
		},
		&PtyConfig {
			shell: test_shell(),
			cwd: default_profile.worktree_path.clone(),
			rows: 24,
			cols: 80,
			startup_commands: startup_commands(),
		},
	)
	.unwrap();

	std::thread::sleep(std::time::Duration::from_secs(2));
	infra::pty::close_all_sessions(&sessions);
	infra::pty::join_all_read_threads(&read_threads);

	let history = service::pty::get_history(&logs, &session_id);
	let history_text = String::from_utf8_lossy(&history);
	assert!(
		history_text.contains("tmpl-ok"),
		"history did not contain startup output: {history_text:?}",
	);

	cleanup(&dir);
}

#[test]
fn create_session_cleans_up_live_process_when_db_insert_fails() {
	let mut conn = setup_db();
	let (_project, default_profile, dir) =
		create_project_with_git_repo(&mut conn);
	diesel::sql_query("DROP TABLE pty_sessions")
		.execute(&mut conn)
		.unwrap();

	let (ctx, sessions, read_threads, logs) =
		pty_context(conn, "create-failure-cleanup");

	let result = service::pty::create_session(
		&ctx,
		&PtySessionMeta {
			profile_id: default_profile.id.clone(),
			title: "Broken".to_string(),
		},
		&pty_config(default_profile.worktree_path.clone()),
	);

	assert!(result.is_err());
	assert!(sessions.lock().unwrap().is_empty());

	infra::pty::close_all_sessions(&sessions);
	infra::pty::join_all_read_threads(&read_threads);
	cleanup(&dir);
	cleanup(&logs);
}

// ============================================================
// Session Delete & Frontend Flows
// ============================================================

#[test]
fn delete_removes_session_and_output() {
	let mut conn = setup_db();
	let (project, default_profile, dir) =
		create_project_with_git_repo(&mut conn);
	let logs = tmp_log_dir("delete-removes");

	insert_session(&mut conn, "s-del", &default_profile.id, "bash");
	write_output(&logs, "s-del", b"data");

	service::pty::delete_session(&mut conn, &logs, "s-del").unwrap();

	let sessions =
		service::pty::list_project_sessions(&mut conn, &project.id).unwrap();
	assert!(sessions.is_empty());

	// Output file should also be gone.
	assert!(service::pty::get_history(&logs, "s-del").is_empty());
	assert!(!pty_log::session_path(&logs, "s-del").exists());

	cleanup(&dir);
}

#[test]
fn close_then_delete_flow() {
	let mut conn = setup_db();
	let (_project, default_profile, dir) =
		create_project_with_git_repo(&mut conn);
	let logs = tmp_log_dir("close-then-delete");

	insert_session(&mut conn, "s-flow", &default_profile.id, "bash");
	write_output(&logs, "s-flow", b"output data");

	// Frontend: close_pty_session marks it closed
	pty::mark_closed(&mut conn, "s-flow");

	// Frontend: delete_pty_session_record removes it
	service::pty::delete_session(&mut conn, &logs, "s-flow").unwrap();

	assert!(service::pty::get_history(&logs, "s-flow").is_empty());

	cleanup(&dir);
}

#[test]
fn restoration_flow_db_side() {
	let mut conn = setup_db();
	let (_project, default_profile, dir) =
		create_project_with_git_repo(&mut conn);
	let logs = tmp_log_dir("restoration-flow");

	// 1. Old session with history
	insert_session(&mut conn, "s-old", &default_profile.id, "bash");
	write_output(&logs, "s-old", b"old terminal output");

	// 2. Read history from old session
	let history = service::pty::get_history(&logs, "s-old");
	assert_eq!(history, b"old terminal output");

	// 3. Create new session (simulating PTY restoration)
	insert_session(&mut conn, "s-new", &default_profile.id, "bash");

	// 4. Delete old session (row + log file)
	service::pty::delete_session(&mut conn, &logs, "s-old").unwrap();

	// 5. Old session gone, new session exists and starts fresh
	assert!(service::pty::get_history(&logs, "s-old").is_empty());
	assert!(service::pty::get_history(&logs, "s-new").is_empty());

	cleanup(&dir);
}

#[test]
fn restore_session_creates_new_deletes_old_and_returns_history() {
	let mut conn = setup_db();
	let (project, default_profile, dir) =
		create_project_with_git_repo(&mut conn);
	insert_session(&mut conn, "s-restore-old", &default_profile.id, "bash");

	let (ctx, sessions, read_threads, logs) =
		pty_context(conn, "restore-session");
	write_output(&logs, "s-restore-old", b"hello from history\r\n");

	let result = service::pty::restore_session(
		&ctx,
		"s-restore-old",
		&PtySessionMeta {
			profile_id: default_profile.id.clone(),
			title: "Restored".to_string(),
		},
		&PtyConfig {
			shell: test_shell(),
			cwd: default_profile.worktree_path.clone(),
			rows: 24,
			cols: 80,
			startup_commands: Vec::new(),
		},
	)
	.unwrap();

	infra::pty::close_all_sessions(&sessions);
	infra::pty::join_all_read_threads(&read_threads);

	assert_ne!(result.new_session_id, "s-restore-old");
	let history_text = String::from_utf8_lossy(&result.history);
	assert!(history_text.contains("hello from history"));
	assert!(!pty_log::session_path(&logs, "s-restore-old").exists());

	{
		let mut conn = ctx.db.lock().unwrap();
		let sessions =
			service::pty::list_project_sessions(&mut conn, &project.id)
				.unwrap();
		assert!(!sessions.iter().any(|session| session.id == "s-restore-old"));
		assert!(sessions
			.iter()
			.any(|session| session.id == result.new_session_id));
	}

	cleanup(&dir);
	cleanup(&logs);
}

#[test]
fn restore_session_with_empty_history_still_swaps_records() {
	let mut conn = setup_db();
	let (project, default_profile, dir) =
		create_project_with_git_repo(&mut conn);
	insert_session(&mut conn, "s-restore-empty", &default_profile.id, "bash");

	let (ctx, sessions, read_threads, logs) =
		pty_context(conn, "restore-empty-session");

	let result = service::pty::restore_session(
		&ctx,
		"s-restore-empty",
		&PtySessionMeta {
			profile_id: default_profile.id.clone(),
			title: "Restored empty".to_string(),
		},
		&PtyConfig {
			shell: test_shell(),
			cwd: default_profile.worktree_path.clone(),
			rows: 24,
			cols: 80,
			startup_commands: Vec::new(),
		},
	)
	.unwrap();

	infra::pty::close_all_sessions(&sessions);
	infra::pty::join_all_read_threads(&read_threads);

	assert_ne!(result.new_session_id, "s-restore-empty");
	assert!(result.history.is_empty());
	assert!(!pty_log::session_path(&logs, "s-restore-empty").exists());

	{
		let mut conn = ctx.db.lock().unwrap();
		let sessions =
			service::pty::list_project_sessions(&mut conn, &project.id)
				.unwrap();
		assert!(!sessions
			.iter()
			.any(|session| session.id == "s-restore-empty"));
		assert!(sessions
			.iter()
			.any(|session| session.id == result.new_session_id));
	}

	cleanup(&dir);
	cleanup(&logs);
}

#[test]
fn delete_profile_closes_live_session_and_removes_log() {
	let mut conn = setup_db();
	let (project, _default_profile, dir) =
		create_project_with_git_repo(&mut conn);
	let profile =
		service::profile::create(&mut conn, &project.id, "live-profile")
			.unwrap();
	let profile_id = profile.id.clone();
	let worktree_path = profile.worktree_path.clone();

	let (ctx, sessions, read_threads, logs) =
		pty_context(conn, "delete-profile-live");
	let session_id =
		create_live_session(&ctx, &profile_id, &worktree_path, "Profile live");
	wait_for_flush_sender(&ctx, &session_id);
	write_output(&logs, &session_id, b"profile output");

	service::profile::delete_with_context(&ctx, &profile_id).unwrap();

	assert!(!sessions.lock().unwrap().contains_key(&session_id));
	assert!(!pty_log::session_path(&logs, &session_id).exists());

	infra::pty::join_all_read_threads(&read_threads);
	cleanup(&dir);
	cleanup(&logs);
}

#[test]
fn delete_project_closes_live_session_and_removes_log() {
	let mut conn = setup_db();
	let (project, default_profile, dir) =
		create_project_with_git_repo(&mut conn);
	let project_id = project.id.clone();

	let (ctx, sessions, read_threads, logs) =
		pty_context(conn, "delete-project-live");
	let session_id = create_live_session(
		&ctx,
		&default_profile.id,
		&default_profile.worktree_path,
		"Project live",
	);
	wait_for_flush_sender(&ctx, &session_id);
	write_output(&logs, &session_id, b"project output");

	service::project::delete_with_context(&ctx, &project_id).unwrap();

	assert!(!sessions.lock().unwrap().contains_key(&session_id));
	assert!(!pty_log::session_path(&logs, &session_id).exists());

	infra::pty::join_all_read_threads(&read_threads);
	cleanup(&dir);
	cleanup(&logs);
}

#[test]
fn restore_session_closes_live_old_session() {
	let mut conn = setup_db();
	let (project, default_profile, dir) =
		create_project_with_git_repo(&mut conn);
	let (ctx, sessions, read_threads, logs) =
		pty_context(conn, "restore-live-old");

	let old_session_id = create_live_session(
		&ctx,
		&default_profile.id,
		&default_profile.worktree_path,
		"Old live",
	);
	wait_for_flush_sender(&ctx, &old_session_id);
	write_output(&logs, &old_session_id, b"live old history\r\n");

	let result = service::pty::restore_session(
		&ctx,
		&old_session_id,
		&PtySessionMeta {
			profile_id: default_profile.id.clone(),
			title: "Restored live".to_string(),
		},
		&pty_config(default_profile.worktree_path.clone()),
	)
	.unwrap();

	assert_ne!(result.new_session_id, old_session_id);
	assert!(!sessions.lock().unwrap().contains_key(&old_session_id));
	assert!(!pty_log::session_path(&logs, &old_session_id).exists());
	let history_text = String::from_utf8_lossy(&result.history);
	assert!(history_text.contains("live old history"));

	{
		let mut conn = ctx.db.lock().unwrap();
		let sessions =
			service::pty::list_project_sessions(&mut conn, &project.id)
				.unwrap();
		assert!(!sessions.iter().any(|session| session.id == old_session_id));
		assert!(sessions
			.iter()
			.any(|session| session.id == result.new_session_id));
	}

	infra::pty::close_all_sessions(&sessions);
	infra::pty::join_all_read_threads(&read_threads);
	cleanup(&dir);
	cleanup(&logs);
}

// ============================================================
// Edge Cases
// ============================================================

#[test]
fn delete_nonexistent_session_succeeds() {
	let mut conn = setup_db();
	let logs = tmp_log_dir("delete-nonexistent");
	// Deleting a session that doesn't exist should return Ok (0 rows affected)
	let result = service::pty::delete_session(
		&mut conn,
		&logs,
		"nonexistent-session-id",
	);
	assert!(result.is_ok());
}

#[test]
fn clear_output_nonexistent_session_no_panic() {
	let logs = tmp_log_dir("clear-nonexistent");
	let senders = create_flush_senders();
	// Clearing output for a non-existent session should not panic or error.
	service::pty::clear_output(&logs, &senders, "nonexistent-session-id")
		.unwrap();
}
