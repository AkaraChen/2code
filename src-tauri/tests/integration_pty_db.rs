mod common;

use common::{cleanup, create_project_with_git_repo, setup_db};
use model::pty::NewPtySessionRecord;
use repo::pty;

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
	let mut conn = setup_db();
	let (_project, default_profile, dir) =
		create_project_with_git_repo(&mut conn);

	insert_session(&mut conn, "s-empty", &default_profile.id, "bash");

	let history = service::pty::get_history(&mut conn, "s-empty").unwrap();
	assert!(history.is_empty());

	cleanup(&dir);
}

#[test]
fn append_and_read_history() {
	let mut conn = setup_db();
	let (_project, default_profile, dir) =
		create_project_with_git_repo(&mut conn);

	insert_session(&mut conn, "s-append", &default_profile.id, "bash");

	pty::append_output(&mut conn, "s-append", b"hello world").unwrap();

	let history = service::pty::get_history(&mut conn, "s-append").unwrap();
	assert_eq!(history, b"hello world");

	cleanup(&dir);
}

#[test]
fn clear_output_resets_history() {
	let mut conn = setup_db();
	let (_project, default_profile, dir) =
		create_project_with_git_repo(&mut conn);

	insert_session(&mut conn, "s-clear", &default_profile.id, "bash");
	pty::append_output(&mut conn, "s-clear", b"some data").unwrap();
	pty::clear_output(&mut conn, "s-clear");

	let history = service::pty::get_history(&mut conn, "s-clear").unwrap();
	assert!(history.is_empty());

	cleanup(&dir);
}

#[test]
fn output_capped_at_1mb() {
	let mut conn = setup_db();
	let (_project, default_profile, dir) =
		create_project_with_git_repo(&mut conn);

	insert_session(&mut conn, "s-cap", &default_profile.id, "bash");

	// Write 1.5MB of data
	let chunk = vec![b'X'; 512 * 1024]; // 512KB
	pty::append_output(&mut conn, "s-cap", &chunk).unwrap();
	pty::append_output(&mut conn, "s-cap", &chunk).unwrap();
	pty::append_output(&mut conn, "s-cap", &chunk).unwrap();

	let history = service::pty::get_history(&mut conn, "s-cap").unwrap();
	assert!(
		history.len() <= 1048576,
		"expected <= 1MB, got {} bytes",
		history.len()
	);

	cleanup(&dir);
}

#[test]
fn output_cap_keeps_latest_bytes_exactly() {
	let mut conn = setup_db();
	let (_project, default_profile, dir) =
		create_project_with_git_repo(&mut conn);

	insert_session(&mut conn, "s-cap-tail", &default_profile.id, "bash");

	let prefix = vec![b'A'; pty::PERSISTED_PTY_OUTPUT_BYTES_CAP - 2];
	pty::append_output(&mut conn, "s-cap-tail", &prefix).unwrap();
	pty::append_output(&mut conn, "s-cap-tail", b"BC").unwrap();
	pty::append_output(&mut conn, "s-cap-tail", b"DEF").unwrap();

	let history = service::pty::get_history(&mut conn, "s-cap-tail").unwrap();
	assert_eq!(history.len(), pty::PERSISTED_PTY_OUTPUT_BYTES_CAP);
	assert_eq!(
		&history[pty::PERSISTED_PTY_OUTPUT_BYTES_CAP - 5..],
		b"BCDEF"
	);
	assert!(history[..pty::PERSISTED_PTY_OUTPUT_BYTES_CAP - 5]
		.iter()
		.all(|b| *b == b'A'));

	cleanup(&dir);
}

// ============================================================
// Session History (Edge Cases)
// ============================================================

#[test]
fn history_nonexistent_session_returns_error() {
	let mut conn = setup_db();
	let result = service::pty::get_history(&mut conn, "nonexistent-session");
	assert!(result.is_err());
}

#[test]
fn append_empty_data() {
	let mut conn = setup_db();
	let (_project, default_profile, dir) =
		create_project_with_git_repo(&mut conn);

	insert_session(&mut conn, "s-empty-append", &default_profile.id, "bash");
	let result = pty::append_output(&mut conn, "s-empty-append", &[]);
	assert!(result.is_ok());

	let history =
		service::pty::get_history(&mut conn, "s-empty-append").unwrap();
	assert!(history.is_empty());

	cleanup(&dir);
}

#[test]
fn append_binary_data() {
	let mut conn = setup_db();
	let (_project, default_profile, dir) =
		create_project_with_git_repo(&mut conn);

	insert_session(&mut conn, "s-binary", &default_profile.id, "bash");

	let data: Vec<u8> = (0..=255).collect();
	pty::append_output(&mut conn, "s-binary", &data).unwrap();

	let history = service::pty::get_history(&mut conn, "s-binary").unwrap();
	assert_eq!(history, data);

	cleanup(&dir);
}

#[test]
fn multiple_appends_concatenated_correctly() {
	let mut conn = setup_db();
	let (_project, default_profile, dir) =
		create_project_with_git_repo(&mut conn);

	insert_session(&mut conn, "s-multi", &default_profile.id, "bash");

	pty::append_output(&mut conn, "s-multi", b"AAA").unwrap();
	pty::append_output(&mut conn, "s-multi", b"BBB").unwrap();
	pty::append_output(&mut conn, "s-multi", b"CCC").unwrap();

	let history = service::pty::get_history(&mut conn, "s-multi").unwrap();
	assert_eq!(history, b"AAABBBCCC");

	cleanup(&dir);
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

// ============================================================
// Session Delete & Frontend Flows
// ============================================================

#[test]
fn delete_removes_session_and_output() {
	let mut conn = setup_db();
	let (project, default_profile, dir) =
		create_project_with_git_repo(&mut conn);

	insert_session(&mut conn, "s-del", &default_profile.id, "bash");
	pty::append_output(&mut conn, "s-del", b"data").unwrap();

	service::pty::delete_session(&mut conn, "s-del").unwrap();

	let sessions =
		service::pty::list_project_sessions(&mut conn, &project.id).unwrap();
	assert!(sessions.is_empty());

	// History should also be gone
	let result = service::pty::get_history(&mut conn, "s-del");
	assert!(result.is_err());

	cleanup(&dir);
}

#[test]
fn close_then_delete_flow() {
	let mut conn = setup_db();
	let (_project, default_profile, dir) =
		create_project_with_git_repo(&mut conn);

	insert_session(&mut conn, "s-flow", &default_profile.id, "bash");
	pty::append_output(&mut conn, "s-flow", b"output data").unwrap();

	// Frontend: close_pty_session marks it closed
	pty::mark_closed(&mut conn, "s-flow");

	// Frontend: delete_pty_session_record removes it
	service::pty::delete_session(&mut conn, "s-flow").unwrap();

	let result = service::pty::get_history(&mut conn, "s-flow");
	assert!(result.is_err());

	cleanup(&dir);
}

#[test]
fn restoration_flow_db_side() {
	let mut conn = setup_db();
	let (_project, default_profile, dir) =
		create_project_with_git_repo(&mut conn);

	// 1. Old session with history
	insert_session(&mut conn, "s-old", &default_profile.id, "bash");
	pty::append_output(&mut conn, "s-old", b"old terminal output").unwrap();

	// 2. Read history from old session
	let history = service::pty::get_history(&mut conn, "s-old").unwrap();
	assert_eq!(history, b"old terminal output");

	// 3. Create new session (simulating PTY restoration)
	insert_session(&mut conn, "s-new", &default_profile.id, "bash");

	// 4. Delete old session
	service::pty::delete_session(&mut conn, "s-old").unwrap();

	// 5. Old session gone, new session exists
	let old_result = service::pty::get_history(&mut conn, "s-old");
	assert!(old_result.is_err());

	let new_history = service::pty::get_history(&mut conn, "s-new").unwrap();
	assert!(new_history.is_empty()); // new session starts fresh

	cleanup(&dir);
}

// ============================================================
// Repo Edge Cases
// ============================================================

#[test]
fn delete_nonexistent_session_succeeds() {
	let mut conn = setup_db();
	// Deleting a session that doesn't exist should return Ok (0 rows affected)
	let result =
		service::pty::delete_session(&mut conn, "nonexistent-session-id");
	assert!(result.is_ok());
}

#[test]
fn clear_output_nonexistent_session_no_panic() {
	let mut conn = setup_db();
	// Clearing output for a non-existent session should not panic
	pty::clear_output(&mut conn, "nonexistent-session-id");
}

#[test]
#[ignore = "benchmark"]
fn benchmark_append_output_near_cap() {
	let mut conn = setup_db();
	let (_project, default_profile, dir) =
		create_project_with_git_repo(&mut conn);

	insert_session(&mut conn, "s-bench-cap", &default_profile.id, "bash");

	let chunk = vec![b'X'; 4096];
	let total_target = 2 * pty::PERSISTED_PTY_OUTPUT_BYTES_CAP;
	let checkpoints = [
		64 * 1024,
		256 * 1024,
		512 * 1024,
		pty::PERSISTED_PTY_OUTPUT_BYTES_CAP,
		pty::PERSISTED_PTY_OUTPUT_BYTES_CAP + 256 * 1024,
		total_target,
	];

	let mut recent = std::collections::VecDeque::with_capacity(32);
	let mut checkpoint_index = 0usize;
	let mut total_written = 0usize;

	while total_written < total_target {
		let started = std::time::Instant::now();
		pty::append_output(&mut conn, "s-bench-cap", &chunk).unwrap();
		let elapsed = started.elapsed();

		if recent.len() == 32 {
			recent.pop_front();
		}
		recent.push_back(elapsed);
		total_written += chunk.len();

		while checkpoint_index < checkpoints.len()
			&& total_written >= checkpoints[checkpoint_index]
		{
			let avg_recent_ms = recent
				.iter()
				.map(|sample| sample.as_secs_f64() * 1000.0)
				.sum::<f64>()
				/ recent.len() as f64;
			eprintln!(
				"[bench][append_output] written_bytes={} recent_avg_ms={:.3} last_ms={:.3}",
				total_written,
				avg_recent_ms,
				elapsed.as_secs_f64() * 1000.0
			);
			checkpoint_index += 1;
		}
	}

	let history = service::pty::get_history(&mut conn, "s-bench-cap").unwrap();
	eprintln!(
		"[bench][append_output] final_history_bytes={} cap_bytes={}",
		history.len(),
		pty::PERSISTED_PTY_OUTPUT_BYTES_CAP
	);
	assert!(history.len() <= pty::PERSISTED_PTY_OUTPUT_BYTES_CAP);

	cleanup(&dir);
}
