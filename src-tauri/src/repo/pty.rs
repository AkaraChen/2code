use diesel::prelude::*;

use crate::error::AppError;
use crate::model::pty::{
	NewPtyOutputChunk, NewPtySessionRecord, PtySessionRecord,
};
use crate::schema::{profiles, pty_output_chunks, pty_sessions};

pub fn insert_session(
	conn: &mut SqliteConnection,
	record: &NewPtySessionRecord,
) -> Result<(), AppError> {
	diesel::insert_into(pty_sessions::table)
		.values(record)
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

pub fn insert_output_chunk(
	conn: &mut SqliteConnection,
	session_id: &str,
	data: &[u8],
) -> Result<(), AppError> {
	let chunk = NewPtyOutputChunk { session_id, data };
	diesel::insert_into(pty_output_chunks::table)
		.values(&chunk)
		.execute(conn)
		.map_err(|e| AppError::DbError(e.to_string()))?;
	Ok(())
}

pub fn get_session_history(
	conn: &mut SqliteConnection,
	session_id: &str,
) -> Result<Vec<u8>, AppError> {
	let chunks: Vec<Vec<u8>> = pty_output_chunks::table
		.filter(pty_output_chunks::session_id.eq(session_id))
		.select(pty_output_chunks::data)
		.order(pty_output_chunks::id.asc())
		.load(conn)
		.map_err(|e| AppError::DbError(e.to_string()))?;

	let chunk_count = chunks.len();
	let total_bytes: usize = chunks.iter().map(|c| c.len()).sum();
	tracing::info!(target: "pty", %session_id, chunk_count, total_bytes, "repo: loaded history");

	Ok(chunks.into_iter().flatten().collect())
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

pub fn get_chunk_sizes(
	conn: &mut SqliteConnection,
	session_id: &str,
) -> Vec<(Option<i32>, i32)> {
	pty_output_chunks::table
		.filter(pty_output_chunks::session_id.eq(session_id))
		.select((
			pty_output_chunks::id,
			diesel::dsl::sql::<diesel::sql_types::Integer>("length(data)"),
		))
		.order(pty_output_chunks::id.asc())
		.load(conn)
		.unwrap_or_default()
}

pub fn delete_chunks_by_ids(conn: &mut SqliteConnection, ids: &[i32]) {
	let _ = diesel::delete(
		pty_output_chunks::table.filter(pty_output_chunks::id.eq_any(ids)),
	)
	.execute(conn);
}
