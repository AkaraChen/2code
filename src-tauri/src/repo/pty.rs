use diesel::prelude::*;

use crate::error::{AppError, AppResult};
use crate::model::pty::{
	NewPtyOutputChunk, NewPtySessionRecord, PtySessionRecord,
};
use crate::schema::{pty_output_chunks, pty_sessions};

pub fn insert_session(
	conn: &mut SqliteConnection,
	record: &NewPtySessionRecord,
) -> AppResult<()> {
	diesel::insert_into(pty_sessions::table)
		.values(record)
		.execute(conn)
		.map_err(|e| AppError::DbError(e.to_string()))?;
	Ok(())
}

pub fn list_by_project(
	conn: &mut SqliteConnection,
	project_id: &str,
) -> AppResult<Vec<PtySessionRecord>> {
	pty_sessions::table
		.filter(pty_sessions::project_id.eq(project_id))
		.select(PtySessionRecord::as_select())
		.order(pty_sessions::created_at.asc())
		.load(conn)
		.map_err(|e| AppError::DbError(e.to_string()))
}

pub fn mark_closed(conn: &mut SqliteConnection, session_id: &str) {
	let _ = diesel::update(
		pty_sessions::table.filter(pty_sessions::id.eq(session_id)),
	)
	.set(pty_sessions::closed_at.eq(diesel::dsl::now))
	.execute(conn);
}

pub fn mark_all_open_closed(conn: &mut SqliteConnection) {
	let _ = diesel::update(
		pty_sessions::table.filter(pty_sessions::closed_at.is_null()),
	)
	.set(pty_sessions::closed_at.eq(diesel::dsl::now))
	.execute(conn);
}

pub fn insert_output_chunk(
	conn: &mut SqliteConnection,
	session_id: &str,
	data: &[u8],
) -> AppResult<()> {
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
) -> AppResult<Vec<u8>> {
	let chunks: Vec<Vec<u8>> = pty_output_chunks::table
		.filter(pty_output_chunks::session_id.eq(session_id))
		.select(pty_output_chunks::data)
		.order(pty_output_chunks::id.asc())
		.load(conn)
		.map_err(|e| AppError::DbError(e.to_string()))?;

	Ok(chunks.into_iter().flatten().collect())
}

pub fn delete_session(
	conn: &mut SqliteConnection,
	session_id: &str,
) -> AppResult<()> {
	diesel::delete(pty_sessions::table.filter(pty_sessions::id.eq(session_id)))
		.execute(conn)
		.map_err(|e| AppError::DbError(e.to_string()))?;
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
