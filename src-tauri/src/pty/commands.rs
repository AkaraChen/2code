use std::io::Read;
use std::sync::mpsc;

use diesel::prelude::*;
use tauri::{AppHandle, Emitter, Manager, State};

use super::models::{NewPtyOutputChunk, NewPtySessionRecord, PtySessionRecord};
use super::session::{self, PtySessionMap};
use crate::db::DbPool;
use crate::error::{AppError, AppResult};
use crate::schema::{pty_output_chunks, pty_sessions};

const FLUSH_THRESHOLD: usize = 32 * 1024; // 32KB
const MAX_OUTPUT_PER_SESSION: usize = 1024 * 1024; // 1MB

#[tauri::command]
pub fn create_pty_session(
	app: AppHandle,
	sessions: State<'_, PtySessionMap>,
	project_id: String,
	title: String,
	shell: String,
	cwd: String,
	rows: u16,
	cols: u16,
) -> AppResult<String> {
	let (session_id, reader) =
		session::create_session(&sessions, &shell, &cwd, rows, cols)?;

	// Insert session record into database
	let db = app.state::<DbPool>().inner().clone();
	{
		let conn = &mut *db.lock().map_err(|_| AppError::LockError)?;
		let new_record = NewPtySessionRecord {
			id: &session_id,
			project_id: &project_id,
			title: &title,
			shell: &shell,
			cwd: &cwd,
		};
		diesel::insert_into(pty_sessions::table)
			.values(&new_record)
			.execute(conn)
			.map_err(|e| AppError::DbError(e.to_string()))?;
	}

	// Spawn a background thread to read PTY output and emit events
	let id = session_id.clone();
	let app_handle = app.clone();
	std::thread::spawn(move || {
		read_pty_output(app_handle, id, reader, db);
	});

	Ok(session_id)
}

/// Find the byte position up to which the data forms complete UTF-8 sequences.
/// Any trailing incomplete multi-byte sequence is excluded from the boundary.
fn find_utf8_boundary(bytes: &[u8]) -> usize {
	let len = bytes.len();
	if len == 0 {
		return 0;
	}

	// Look at the last 1-3 bytes to find a potential incomplete sequence.
	for i in 1..=std::cmp::min(3, len) {
		let b = bytes[len - i];
		// Skip continuation bytes (10xxxxxx)
		if b & 0xC0 == 0x80 {
			continue;
		}
		// Found a leading byte — determine expected sequence length
		let seq_len = if b & 0x80 == 0 {
			1
		} else if b & 0xE0 == 0xC0 {
			2
		} else if b & 0xF0 == 0xE0 {
			3
		} else if b & 0xF8 == 0xF0 {
			4
		} else {
			1 // Invalid leading byte, treat as single
		};
		return if i < seq_len { len - i } else { len };
	}
	len
}

/// Persistence thread: receives raw bytes from channel, buffers, and flushes to DB.
fn persist_pty_output(
	rx: mpsc::Receiver<Vec<u8>>,
	db: DbPool,
	session_id: &str,
) {
	let mut buffer: Vec<u8> = Vec::new();
	let mut total_written: usize = 0;

	while let Ok(data) = rx.recv() {
		buffer.extend_from_slice(&data);
		if buffer.len() >= FLUSH_THRESHOLD {
			flush_output_buffer(
				&db,
				session_id,
				&mut buffer,
				&mut total_written,
			);
		}
	}

	if !buffer.is_empty() {
		flush_output_buffer(&db, session_id, &mut buffer, &mut total_written);
	}
}

fn read_pty_output(
	app: AppHandle,
	session_id: String,
	mut reader: Box<dyn Read + Send>,
	db: DbPool,
) {
	let event_name = format!("pty-output-{}", session_id);
	let exit_event = format!("pty-exit-{}", session_id);
	let mut buf = [0u8; 4096];
	let mut utf8_remainder: Vec<u8> = Vec::new();

	// Decouple persistence into a separate thread via channel
	let (tx, rx) = mpsc::channel::<Vec<u8>>();
	let persist_db = db.clone();
	let persist_id = session_id.clone();
	let persist_thread = std::thread::spawn(move || {
		persist_pty_output(rx, persist_db, &persist_id);
	});

	loop {
		match reader.read(&mut buf) {
			Ok(0) => break,
			Ok(n) => {
				let raw = &buf[..n];

				// Send raw bytes to persistence thread (non-blocking)
				let _ = tx.send(raw.to_vec());

				// Prepend any leftover bytes from incomplete UTF-8 sequence
				let combined;
				let to_decode: &[u8] = if utf8_remainder.is_empty() {
					raw
				} else {
					utf8_remainder.extend_from_slice(raw);
					combined = std::mem::take(&mut utf8_remainder);
					&combined
				};

				// Split at valid UTF-8 boundary
				let boundary = find_utf8_boundary(to_decode);
				if boundary > 0 {
					let text = String::from_utf8_lossy(&to_decode[..boundary]);
					if app.emit(&event_name, text.as_ref()).is_err() {
						break;
					}
				}

				// Save trailing incomplete bytes for next iteration
				if boundary < to_decode.len() {
					utf8_remainder.extend_from_slice(&to_decode[boundary..]);
				}
			}
			Err(_) => break,
		}
	}

	// Signal persistence thread to finish and wait
	drop(tx);
	let _ = persist_thread.join();

	mark_session_closed(&db, &session_id);
	let _ = app.emit(&exit_event, ());
}

fn flush_output_buffer(
	db: &DbPool,
	session_id: &str,
	buffer: &mut Vec<u8>,
	total_written: &mut usize,
) {
	let Ok(mut conn) = db.lock() else { return };

	let chunk = NewPtyOutputChunk {
		session_id,
		data: buffer,
	};
	if diesel::insert_into(pty_output_chunks::table)
		.values(&chunk)
		.execute(&mut *conn)
		.is_ok()
	{
		*total_written += buffer.len();
	}
	buffer.clear();

	// Prune oldest chunks if total exceeds cap
	if *total_written > MAX_OUTPUT_PER_SESSION {
		prune_oldest_chunks(&mut conn, session_id, total_written);
	}
}

fn prune_oldest_chunks(
	conn: &mut SqliteConnection,
	session_id: &str,
	total_written: &mut usize,
) {
	// Get all chunk ids and sizes for this session, ordered oldest first
	let chunks: Vec<(Option<i32>, Vec<u8>)> = pty_output_chunks::table
		.filter(pty_output_chunks::session_id.eq(session_id))
		.select((pty_output_chunks::id, pty_output_chunks::data))
		.order(pty_output_chunks::id.asc())
		.load(conn)
		.unwrap_or_default();

	let mut running_total: usize =
		chunks.iter().map(|(_, data)| data.len()).sum();
	for (chunk_id, data) in &chunks {
		if running_total <= MAX_OUTPUT_PER_SESSION {
			break;
		}
		if let Some(cid) = chunk_id {
			let _ = diesel::delete(
				pty_output_chunks::table.filter(pty_output_chunks::id.eq(cid)),
			)
			.execute(conn);
			running_total -= data.len();
		}
	}

	*total_written = running_total;
}

fn mark_session_closed(db: &DbPool, session_id: &str) {
	let Ok(mut conn) = db.lock() else { return };
	let _ = diesel::update(
		pty_sessions::table.filter(pty_sessions::id.eq(session_id)),
	)
	.set(pty_sessions::closed_at.eq(diesel::dsl::now))
	.execute(&mut *conn);
}

#[tauri::command]
pub fn write_to_pty(
	sessions: State<'_, PtySessionMap>,
	session_id: String,
	data: String,
) -> AppResult<()> {
	session::write_to_pty(&sessions, &session_id, data.as_bytes())
}

#[tauri::command]
pub fn resize_pty(
	sessions: State<'_, PtySessionMap>,
	session_id: String,
	rows: u16,
	cols: u16,
) -> AppResult<()> {
	session::resize_pty(&sessions, &session_id, rows, cols)
}

#[tauri::command]
pub fn close_pty_session(
	app: AppHandle,
	sessions: State<'_, PtySessionMap>,
	session_id: String,
) -> AppResult<()> {
	session::close_session(&sessions, &session_id)?;

	// Mark session as closed in DB
	let db = app.state::<DbPool>().inner().clone();
	mark_session_closed(&db, &session_id);

	Ok(())
}

#[tauri::command]
pub fn list_active_sessions(
	project_id: String,
	state: State<'_, DbPool>,
) -> AppResult<Vec<PtySessionRecord>> {
	let conn = &mut *state.lock().map_err(|_| AppError::LockError)?;
	pty_sessions::table
		.filter(pty_sessions::project_id.eq(&project_id))
		.select(PtySessionRecord::as_select())
		.order(pty_sessions::created_at.asc())
		.load(conn)
		.map_err(|e| AppError::DbError(e.to_string()))
}

#[tauri::command]
pub fn get_pty_session_history(
	session_id: String,
	state: State<'_, DbPool>,
) -> AppResult<Vec<u8>> {
	let conn = &mut *state.lock().map_err(|_| AppError::LockError)?;
	let chunks: Vec<Vec<u8>> = pty_output_chunks::table
		.filter(pty_output_chunks::session_id.eq(&session_id))
		.select(pty_output_chunks::data)
		.order(pty_output_chunks::id.asc())
		.load(conn)
		.map_err(|e| AppError::DbError(e.to_string()))?;

	Ok(chunks.into_iter().flatten().collect())
}

#[tauri::command]
pub fn delete_pty_session_record(
	session_id: String,
	state: State<'_, DbPool>,
) -> AppResult<()> {
	let conn = &mut *state.lock().map_err(|_| AppError::LockError)?;
	diesel::delete(
		pty_sessions::table.filter(pty_sessions::id.eq(&session_id)),
	)
	.execute(conn)
	.map_err(|e| AppError::DbError(e.to_string()))?;
	Ok(())
}

/// Mark all open sessions (NULL closed_at) as closed. Called on startup for orphans
/// and on exit for any still-running sessions.
pub fn mark_all_open_sessions_closed(db: &DbPool) {
	let Ok(mut conn) = db.lock() else { return };
	let _ = diesel::update(
		pty_sessions::table.filter(pty_sessions::closed_at.is_null()),
	)
	.set(pty_sessions::closed_at.eq(diesel::dsl::now))
	.execute(&mut *conn);
}

#[cfg(test)]
mod tests {
	use super::*;

	// --- Empty / pure-ASCII ---

	#[test]
	fn boundary_empty() {
		assert_eq!(find_utf8_boundary(&[]), 0);
	}

	#[test]
	fn boundary_single_ascii() {
		assert_eq!(find_utf8_boundary(b"A"), 1);
	}

	#[test]
	fn boundary_all_ascii() {
		assert_eq!(find_utf8_boundary(b"Hello, world!"), 13);
	}

	// --- Complete multi-byte sequences ---

	#[test]
	fn boundary_complete_2byte() {
		// "é" = 0xC3 0xA9
		let bytes = "é".as_bytes();
		assert_eq!(find_utf8_boundary(bytes), bytes.len());
	}

	#[test]
	fn boundary_complete_3byte() {
		// "中" = 0xE4 0xB8 0xAD
		let bytes = "中".as_bytes();
		assert_eq!(find_utf8_boundary(bytes), bytes.len());
	}

	#[test]
	fn boundary_complete_4byte() {
		// "😀" = 0xF0 0x9F 0x98 0x80
		let bytes = "😀".as_bytes();
		assert_eq!(find_utf8_boundary(bytes), bytes.len());
	}

	// --- Incomplete sequences (leader only) ---

	#[test]
	fn boundary_incomplete_2byte_leader_only() {
		// 0xC3 is a 2-byte leader, missing continuation
		assert_eq!(find_utf8_boundary(&[0xC3]), 0);
	}

	#[test]
	fn boundary_incomplete_3byte_leader_only() {
		// 0xE4 is a 3-byte leader, missing 2 continuations
		assert_eq!(find_utf8_boundary(&[0xE4]), 0);
	}

	#[test]
	fn boundary_incomplete_4byte_leader_only() {
		// 0xF0 is a 4-byte leader, missing 3 continuations
		assert_eq!(find_utf8_boundary(&[0xF0]), 0);
	}

	// --- Incomplete sequences (leader + partial continuations) ---

	#[test]
	fn boundary_incomplete_3byte_one_continuation() {
		// 0xE4 0xB8 — 3-byte leader + 1 continuation, missing 1 more
		assert_eq!(find_utf8_boundary(&[0xE4, 0xB8]), 0);
	}

	#[test]
	fn boundary_incomplete_4byte_one_continuation() {
		// 0xF0 0x9F — 4-byte leader + 1 continuation, missing 2 more
		assert_eq!(find_utf8_boundary(&[0xF0, 0x9F]), 0);
	}

	#[test]
	fn boundary_incomplete_4byte_two_continuations() {
		// 0xF0 0x9F 0x98 — 4-byte leader + 2 continuations, missing 1 more
		assert_eq!(find_utf8_boundary(&[0xF0, 0x9F, 0x98]), 0);
	}

	// --- Mixed ASCII + incomplete trailing sequence ---

	#[test]
	fn boundary_ascii_then_incomplete_2byte() {
		// "Hi" + incomplete 2-byte leader
		let bytes = &[b'H', b'i', 0xC3];
		assert_eq!(find_utf8_boundary(bytes), 2);
	}

	#[test]
	fn boundary_ascii_then_incomplete_3byte() {
		// "AB" + incomplete 3-byte (leader + 1 continuation)
		let bytes = &[b'A', b'B', 0xE4, 0xB8];
		assert_eq!(find_utf8_boundary(bytes), 2);
	}

	#[test]
	fn boundary_ascii_then_incomplete_4byte() {
		// "X" + incomplete 4-byte (leader + 2 continuations)
		let bytes = &[b'X', 0xF0, 0x9F, 0x98];
		assert_eq!(find_utf8_boundary(bytes), 1);
	}

	#[test]
	fn boundary_multibyte_then_incomplete() {
		// "中" (complete 3-byte) + incomplete 2-byte leader
		let mut bytes = "中".as_bytes().to_vec();
		bytes.push(0xC3);
		assert_eq!(find_utf8_boundary(&bytes), 3);
	}

	// --- Edge cases ---

	#[test]
	fn boundary_only_continuation_bytes() {
		// 3 continuation bytes with no leader — the scan finds no leading byte
		// within the last 3 bytes, so returns len
		assert_eq!(find_utf8_boundary(&[0x80, 0x80, 0x80]), 3);
	}

	#[test]
	fn boundary_invalid_leading_byte_0xff() {
		// 0xFF is invalid in UTF-8, treated as single-byte by the function
		assert_eq!(find_utf8_boundary(&[0xFF]), 1);
	}

	#[test]
	fn boundary_single_2byte_leader() {
		// Single byte that's a 2-byte leader — sequence needs 2 bytes, only 1 present
		assert_eq!(find_utf8_boundary(&[0xC0]), 0);
	}
}
