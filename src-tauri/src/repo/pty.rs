use diesel::prelude::*;

use crate::error::AppError;
use crate::model::pty::{
	NewPtySessionOutput, NewPtySessionRecord, PtySessionRecord,
};
use crate::schema::{profiles, pty_session_output, pty_sessions};

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
		session_ids = ?sessions.iter().map(|s| &s.id).collect::<Vec<_>>(),
		"repo: list_by_project"
	);
	Ok(sessions)
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
