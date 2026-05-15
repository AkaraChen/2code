use diesel::prelude::*;
use std::fmt;

use model::error::AppError;
use model::pty::{NewPtySessionOutput, NewPtySessionRecord, PtySessionRecord};
use model::schema::{profiles, pty_session_output, pty_sessions};

pub fn insert_session(
	conn: &mut SqliteConnection,
	record: &NewPtySessionRecord,
) -> Result<(), AppError> {
	diesel::insert_into(pty_sessions::table)
		.values(record)
		.execute(conn)
		.map_err(|e| AppError::DbError(e.to_string()))?;

	// Create companion output row with empty BLOB
	let output = NewPtySessionOutput {
		session_id: record.id,
		data: &[],
	};
	diesel::insert_into(pty_session_output::table)
		.values(&output)
		.execute(conn)
		.map_err(|e| AppError::DbError(e.to_string()))?;

	Ok(())
}

pub fn list_by_project(
	conn: &mut SqliteConnection,
	project_id: &str,
) -> Result<Vec<PtySessionRecord>, AppError> {
	let sessions = pty_sessions::table
		.inner_join(
			profiles::table.on(profiles::id.eq(pty_sessions::profile_id)),
		)
		.filter(profiles::project_id.eq(project_id))
		.select(PtySessionRecord::as_select())
		.order(pty_sessions::created_at.asc())
		.load(conn)
		.map_err(|e| AppError::DbError(e.to_string()))?;

	tracing::info!(
		target: "pty",
		%project_id,
		count = sessions.len(),
		session_ids = ?SessionIds(&sessions),
		"repo: list_by_project"
	);
	Ok(sessions)
}

struct SessionIds<'a>(&'a [PtySessionRecord]);

impl fmt::Debug for SessionIds<'_> {
	fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
		let mut list = f.debug_list();
		for session in self.0 {
			list.entry(&session.id);
		}
		list.finish()
	}
}

pub fn update_dimensions(
	conn: &mut SqliteConnection,
	session_id: &str,
	cols: u16,
	rows: u16,
) {
	let _ = diesel::update(
		pty_sessions::table.filter(pty_sessions::id.eq(session_id)),
	)
	.set((
		pty_sessions::cols.eq(cols as i32),
		pty_sessions::rows.eq(rows as i32),
	))
	.execute(conn);
}

pub fn mark_closed(conn: &mut SqliteConnection, session_id: &str) {
	let _ = diesel::update(
		pty_sessions::table.filter(pty_sessions::id.eq(session_id)),
	)
	.set(pty_sessions::closed_at.eq(diesel::dsl::now))
	.execute(conn);
}

pub fn mark_all_open_closed(conn: &mut SqliteConnection) {
	match diesel::update(
		pty_sessions::table.filter(pty_sessions::closed_at.is_null()),
	)
	.set(pty_sessions::closed_at.eq(diesel::dsl::now))
	.execute(conn)
	{
		Ok(n) => {
			tracing::info!(target: "pty", count = n, "repo: marked open sessions closed")
		}
		Err(e) => {
			tracing::warn!(target: "pty", error = %e, "repo: failed to mark sessions closed")
		}
	}
}

/// Append data to the session's output BLOB and trim to 1MB cap.
pub fn append_output(
	conn: &mut SqliteConnection,
	session_id: &str,
	data: &[u8],
) -> Result<(), AppError> {
	diesel::sql_query(
		"UPDATE pty_session_output SET data = data || ? WHERE session_id = ?",
	)
	.bind::<diesel::sql_types::Binary, _>(data)
	.bind::<diesel::sql_types::Text, _>(session_id)
	.execute(conn)
	.map_err(|e| AppError::DbError(e.to_string()))?;

	// Trim to last 1MB if needed (SUBSTR with negative offset = last N bytes)
	diesel::sql_query(
		"UPDATE pty_session_output \
		 SET data = SUBSTR(data, -1048576) \
		 WHERE session_id = ? AND LENGTH(data) > 1048576",
	)
	.bind::<diesel::sql_types::Text, _>(session_id)
	.execute(conn)
	.map_err(|e| AppError::DbError(e.to_string()))?;

	Ok(())
}

/// Clear persisted output for a session (reset BLOB to empty).
pub fn clear_output(conn: &mut SqliteConnection, session_id: &str) {
	let _ = diesel::sql_query(
		"UPDATE pty_session_output SET data = X'' WHERE session_id = ?",
	)
	.bind::<diesel::sql_types::Text, _>(session_id)
	.execute(conn);
}

pub fn get_session_history(
	conn: &mut SqliteConnection,
	session_id: &str,
) -> Result<Vec<u8>, AppError> {
	let data: Vec<u8> = pty_session_output::table
		.filter(pty_session_output::session_id.eq(session_id))
		.select(pty_session_output::data)
		.first(conn)
		.map_err(|e| AppError::DbError(e.to_string()))?;

	tracing::info!(target: "pty", %session_id, total_bytes = data.len(), "repo: loaded history");
	Ok(data)
}

pub fn delete_session(
	conn: &mut SqliteConnection,
	session_id: &str,
) -> Result<(), AppError> {
	let rows = diesel::delete(
		pty_sessions::table.filter(pty_sessions::id.eq(session_id)),
	)
	.execute(conn)
	.map_err(|e| AppError::DbError(e.to_string()))?;
	tracing::info!(target: "pty", %session_id, rows_deleted = rows, "repo: delete_session");
	Ok(())
}

#[cfg(test)]
mod tests {
	use super::*;
	use crate::profile;
	use crate::project;
	use crate::test_utils::setup_db;
	use std::time::Instant;

	fn setup_profile(conn: &mut SqliteConnection) -> String {
		project::insert(conn, "proj-1", "Project", "/tmp/project")
			.expect("insert project");
		profile::insert_default(
			conn,
			"profile-1",
			"proj-1",
			"main",
			"/tmp/project",
		)
		.expect("insert default profile");
		"profile-1".to_string()
	}

	fn session_record<'a>(
		id: &'a str,
		profile_id: &'a str,
	) -> NewPtySessionRecord<'a> {
		NewPtySessionRecord {
			id,
			profile_id,
			title: "Shell",
			shell: "/bin/zsh",
			cwd: "/tmp/project",
			cols: 80,
			rows: 24,
		}
	}

	fn pty_session_record(id: String) -> PtySessionRecord {
		PtySessionRecord {
			id,
			profile_id: "profile-1".to_string(),
			title: "Shell".to_string(),
			shell: "/bin/zsh".to_string(),
			cwd: "/tmp/project".to_string(),
			created_at: "now".to_string(),
			closed_at: None,
			cols: 80,
			rows: 24,
		}
	}

	#[test]
	#[ignore]
	fn bench_format_session_ids_without_vec() {
		let sessions: Vec<_> = (0..2_000)
			.map(|index| pty_session_record(format!("session-{index}")))
			.collect();
		let iterations = 1_000;

		let started = Instant::now();
		let mut vec_debug_len = 0;
		for _ in 0..iterations {
			vec_debug_len += format!(
				"{:?}",
				std::hint::black_box(&sessions)
					.iter()
					.map(|session| &session.id)
					.collect::<Vec<_>>()
			)
			.len();
		}
		let vec_debug = started.elapsed();

		let started = Instant::now();
		let mut wrapper_debug_len = 0;
		for _ in 0..iterations {
			wrapper_debug_len +=
				format!("{:?}", SessionIds(std::hint::black_box(&sessions))).len();
		}
		let wrapper_debug = started.elapsed();

		assert_eq!(vec_debug_len, wrapper_debug_len);
		println!(
			"vec_debug={vec_debug:?} wrapper_debug={wrapper_debug:?} speedup={:.2}x",
			vec_debug.as_secs_f64() / wrapper_debug.as_secs_f64()
		);
	}

	#[test]
	fn insert_session_creates_a_history_row_and_lists_by_project() {
		let mut conn = setup_db();
		let profile_id = setup_profile(&mut conn);

		insert_session(&mut conn, &session_record("session-1", &profile_id))
			.expect("insert session");

		let sessions =
			list_by_project(&mut conn, "proj-1").expect("list sessions");
		assert_eq!(sessions.len(), 1);
		assert_eq!(sessions[0].id, "session-1");
		assert_eq!(
			get_session_history(&mut conn, "session-1").expect("history"),
			Vec::<u8>::new(),
		);
	}

	#[test]
	fn append_output_trims_history_to_the_last_megabyte_and_can_be_cleared() {
		let mut conn = setup_db();
		let profile_id = setup_profile(&mut conn);
		insert_session(&mut conn, &session_record("session-1", &profile_id))
			.expect("insert session");

		append_output(&mut conn, "session-1", &vec![b'a'; 1_048_576])
			.expect("append first chunk");
		append_output(&mut conn, "session-1", b"tail").expect("append tail");

		let history =
			get_session_history(&mut conn, "session-1").expect("history");
		assert_eq!(history.len(), 1_048_576);
		assert!(history.ends_with(b"tail"));
		assert_eq!(history[0], b'a');

		clear_output(&mut conn, "session-1");
		assert!(get_session_history(&mut conn, "session-1")
			.expect("cleared history")
			.is_empty(),);
	}

	#[test]
	fn delete_session_removes_the_session_and_its_history() {
		let mut conn = setup_db();
		let profile_id = setup_profile(&mut conn);
		insert_session(&mut conn, &session_record("session-1", &profile_id))
			.expect("insert session");
		append_output(&mut conn, "session-1", b"hello")
			.expect("append history");

		delete_session(&mut conn, "session-1").expect("delete session");

		assert!(list_by_project(&mut conn, "proj-1").unwrap().is_empty());
		assert!(get_session_history(&mut conn, "session-1").is_err());
	}
}
