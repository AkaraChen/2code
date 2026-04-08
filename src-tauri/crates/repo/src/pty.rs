use diesel::prelude::*;
use diesel::sql_types::{Integer, Text};

use model::error::AppError;
use model::pty::{
	NewPtyOutputChunk, NewPtyOutputState, NewPtySessionRecord, PtyOutputChunk,
	PtySessionRecord,
};
use model::schema::{
	profiles, pty_output_chunks, pty_output_state, pty_sessions,
};

pub const PERSISTED_PTY_OUTPUT_BYTES_CAP: usize = 1024 * 1024;

pub fn insert_session(
	conn: &mut SqliteConnection,
	record: &NewPtySessionRecord,
) -> Result<(), AppError> {
	conn.transaction::<_, diesel::result::Error, _>(|conn| {
		diesel::insert_into(pty_sessions::table)
			.values(record)
			.execute(conn)?;

		let output_state = NewPtyOutputState {
			session_id: record.id,
			total_bytes: 0,
		};
		diesel::insert_into(pty_output_state::table)
			.values(&output_state)
			.execute(conn)?;

		Ok(())
	})
	.map_err(|e| AppError::DbError(e.to_string()))
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

/// Append data as a new output chunk and trim the session history to the configured cap.
pub fn append_output(
	conn: &mut SqliteConnection,
	session_id: &str,
	data: &[u8],
) -> Result<(), AppError> {
	if data.is_empty() {
		return Ok(());
	}

	let output = NewPtyOutputChunk {
		session_id,
		data,
		byte_len: data.len() as i32,
	};
	diesel::insert_into(pty_output_chunks::table)
		.values(&output)
		.execute(conn)
		.map_err(|e| AppError::DbError(e.to_string()))?;

	let total_bytes = increment_output_bytes(conn, session_id, data.len())?;
	if total_bytes > PERSISTED_PTY_OUTPUT_BYTES_CAP {
		prune_output_to_cap(
			conn,
			session_id,
			total_bytes - PERSISTED_PTY_OUTPUT_BYTES_CAP,
		)?;
		set_output_bytes(conn, session_id, PERSISTED_PTY_OUTPUT_BYTES_CAP)?;
	}

	Ok(())
}

/// Clear persisted output for a session.
pub fn clear_output(conn: &mut SqliteConnection, session_id: &str) {
	let _ = conn.transaction::<_, diesel::result::Error, _>(|conn| {
		diesel::delete(
			pty_output_chunks::table
				.filter(pty_output_chunks::session_id.eq(session_id)),
		)
		.execute(conn)?;
		diesel::update(
			pty_output_state::table
				.filter(pty_output_state::session_id.eq(session_id)),
		)
		.set(pty_output_state::total_bytes.eq(0))
		.execute(conn)?;
		Ok(())
	});
}

pub fn get_session_history(
	conn: &mut SqliteConnection,
	session_id: &str,
) -> Result<Vec<u8>, AppError> {
	let total_bytes = pty_output_state::table
		.filter(pty_output_state::session_id.eq(session_id))
		.select(pty_output_state::total_bytes)
		.first::<i32>(conn)
		.map_err(|e| AppError::DbError(e.to_string()))?
		.max(0) as usize;

	let chunks = pty_output_chunks::table
		.filter(pty_output_chunks::session_id.eq(session_id))
		.order(pty_output_chunks::id.asc())
		.select(PtyOutputChunk::as_select())
		.load::<PtyOutputChunk>(conn)
		.map_err(|e| AppError::DbError(e.to_string()))?;

	let mut data = Vec::with_capacity(total_bytes);
	for chunk in chunks {
		data.extend_from_slice(&chunk.data);
	}

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

fn prune_output_to_cap(
	conn: &mut SqliteConnection,
	session_id: &str,
	mut excess: usize,
) -> Result<(), AppError> {
	while excess > 0 {
		let oldest = pty_output_chunks::table
			.filter(pty_output_chunks::session_id.eq(session_id))
			.order(pty_output_chunks::id.asc())
			.select((pty_output_chunks::id, pty_output_chunks::byte_len))
			.first::<(i32, i32)>(conn)
			.optional()
			.map_err(|e| AppError::DbError(e.to_string()))?;

		let Some((id, byte_len)) = oldest else { break };
		let chunk_len = byte_len.max(0) as usize;
		if excess >= chunk_len {
			diesel::delete(
				pty_output_chunks::table.filter(pty_output_chunks::id.eq(id)),
			)
			.execute(conn)
			.map_err(|e| AppError::DbError(e.to_string()))?;
			excess -= chunk_len;
			continue;
		}

		diesel::sql_query(
			"UPDATE pty_output_chunks \
			 SET data = SUBSTR(data, ?), byte_len = byte_len - ? \
			 WHERE id = ?",
		)
		.bind::<Integer, _>((excess + 1) as i32)
		.bind::<Integer, _>(excess as i32)
		.bind::<Integer, _>(id)
		.execute(conn)
		.map_err(|e| AppError::DbError(e.to_string()))?;
		excess = 0;
	}

	Ok(())
}

fn increment_output_bytes(
	conn: &mut SqliteConnection,
	session_id: &str,
	additional_bytes: usize,
) -> Result<usize, AppError> {
	diesel::sql_query(
		"UPDATE pty_output_state SET total_bytes = total_bytes + ? WHERE session_id = ?",
	)
	.bind::<Integer, _>(additional_bytes as i32)
	.bind::<Text, _>(session_id)
	.execute(conn)
	.map_err(|e| AppError::DbError(e.to_string()))?;

	pty_output_state::table
		.filter(pty_output_state::session_id.eq(session_id))
		.select(pty_output_state::total_bytes)
		.first::<i32>(conn)
		.map(|n| n.max(0) as usize)
		.map_err(|e| AppError::DbError(e.to_string()))
}

fn set_output_bytes(
	conn: &mut SqliteConnection,
	session_id: &str,
	total_bytes: usize,
) -> Result<(), AppError> {
	diesel::update(
		pty_output_state::table
			.filter(pty_output_state::session_id.eq(session_id)),
	)
	.set(pty_output_state::total_bytes.eq(total_bytes as i32))
	.execute(conn)
	.map_err(|e| AppError::DbError(e.to_string()))?;
	Ok(())
}
