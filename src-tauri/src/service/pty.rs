use std::io::Read;
use std::sync::mpsc;

use diesel::prelude::*;
use tauri::{AppHandle, Emitter, Manager};

use tauri_plugin_store::StoreExt;

use crate::error::AppError;
use crate::infra::db::DbPool;
use crate::infra::pty::{self as session, PtySessionMap};
use crate::model::pty::{
	NewPtySessionRecord, PtyConfig, PtySessionMeta, PtySessionRecord,
};

const FLUSH_THRESHOLD: usize = 32 * 1024; // 32KB
const MAX_OUTPUT_PER_SESSION: usize = 1024 * 1024; // 1MB

pub fn create_session(
	app: &AppHandle,
	sessions: &PtySessionMap,
	meta: &PtySessionMeta,
	config: &PtyConfig,
) -> Result<String, AppError> {
	// 1. Resolve project folder and load init_script from 2code.json
	let project_init_scripts = {
		let db = app.state::<DbPool>().inner().clone();
		let conn = &mut *db.lock().map_err(|_| AppError::LockError)?;
		let profile =
			crate::repo::profile::find_by_id(conn, &meta.profile_id)?;
		let folder = crate::repo::profile::get_project_folder(
			conn,
			&profile.project_id,
		)?;
		crate::infra::config::load_project_config(&folder)
			.map(|c| c.init_script)
			.unwrap_or_default()
	};

	// 2. Generate session ID (needed for init dir name)
	let session_id = uuid::Uuid::new_v4().to_string();

	// 3. Prepare shell init directory (graceful degradation on failure)
	let init_dir = crate::infra::shell_init::prepare_init_dir(
		&session_id,
		&project_init_scripts,
	);
	if let Err(ref e) = init_dir {
		tracing::warn!(target: "pty", "Failed to prepare init dir: {e}");
	}

	// 4. Read notification sound from shared settings store
	let notify_sound: Option<String> = app
		.store("settings.json")
		.ok()
		.and_then(|store| {
			let val = store.get("notification-settings")?;
			let enabled = val.get("state")?.get("enabled")?.as_bool()?;
			if !enabled {
				return None;
			}
			val.get("state")?.get("sound")?.as_str().map(String::from)
		});

	// 5. Create PTY session
	let reader = session::create_session(
		sessions,
		&session_id,
		&config.shell,
		&config.cwd,
		config.rows,
		config.cols,
		init_dir.as_deref().ok(),
		notify_sound.as_deref(),
	)?;

	// Insert session record into database
	let db = app.state::<DbPool>().inner().clone();
	{
		let conn = &mut *db.lock().map_err(|_| AppError::LockError)?;
		let new_record = NewPtySessionRecord {
			id: &session_id,
			profile_id: &meta.profile_id,
			title: &meta.title,
			shell: &config.shell,
			cwd: &config.cwd,
		};
		crate::repo::pty::insert_session(conn, &new_record)?;
	}

	tracing::info!(target: "pty", %session_id, profile_id = %meta.profile_id, "session created");

	// Spawn a background thread to read PTY output and emit events
	let id = session_id.clone();
	let app_handle = app.clone();
	std::thread::spawn(move || {
		read_pty_output(app_handle, id, reader, db);
	});

	Ok(session_id)
}

pub fn close_session(
	app: &AppHandle,
	sessions: &PtySessionMap,
	session_id: &str,
) -> Result<(), AppError> {
	session::close_session(sessions, session_id)?;

	// Mark session as closed in DB
	let db = app.state::<DbPool>().inner().clone();
	if let Ok(mut conn) = db.lock() {
		crate::repo::pty::mark_closed(&mut conn, session_id);
	}

	Ok(())
}

pub fn list_project_sessions(
	conn: &mut SqliteConnection,
	project_id: &str,
) -> Result<Vec<PtySessionRecord>, AppError> {
	crate::repo::pty::list_by_project(conn, project_id)
}

pub fn get_history(
	conn: &mut SqliteConnection,
	session_id: &str,
) -> Result<Vec<u8>, AppError> {
	crate::repo::pty::get_session_history(conn, session_id)
}

pub fn delete_session(
	conn: &mut SqliteConnection,
	session_id: &str,
) -> Result<(), AppError> {
	crate::repo::pty::delete_session(conn, session_id)
}

/// Mark all open sessions (NULL closed_at) as closed. Called on startup for orphans
/// and on exit for any still-running sessions.
pub fn mark_all_closed(db: &DbPool) {
	let Ok(mut conn) = db.lock() else { return };
	crate::repo::pty::mark_all_open_closed(&mut conn);
}

/// Find the byte position up to which the data forms complete UTF-8 sequences.
/// Any trailing incomplete multi-byte sequence is excluded from the boundary.
pub fn find_utf8_boundary(bytes: &[u8]) -> usize {
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

	// Mark session closed in DB
	if let Ok(mut conn) = db.lock() {
		crate::repo::pty::mark_closed(&mut conn, &session_id);
	}
	tracing::info!(target: "pty", %session_id, "session exited");
	let _ = app.emit(&exit_event, ());
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

fn flush_output_buffer(
	db: &DbPool,
	session_id: &str,
	buffer: &mut Vec<u8>,
	total_written: &mut usize,
) {
	let Ok(mut conn) = db.lock() else { return };

	if crate::repo::pty::insert_output_chunk(&mut conn, session_id, buffer)
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
	let chunks = crate::repo::pty::get_chunk_sizes(conn, session_id);

	let mut running_total: usize =
		chunks.iter().map(|(_, len)| *len as usize).sum();

	let mut ids_to_delete: Vec<i32> = Vec::new();
	for (chunk_id, len) in &chunks {
		if running_total <= MAX_OUTPUT_PER_SESSION {
			break;
		}
		if let Some(cid) = chunk_id {
			running_total -= *len as usize;
			ids_to_delete.push(*cid);
		}
	}

	if !ids_to_delete.is_empty() {
		crate::repo::pty::delete_chunks_by_ids(conn, &ids_to_delete);
	}

	*total_written = running_total;
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
		let bytes = "é".as_bytes();
		assert_eq!(find_utf8_boundary(bytes), bytes.len());
	}

	#[test]
	fn boundary_complete_3byte() {
		let bytes = "中".as_bytes();
		assert_eq!(find_utf8_boundary(bytes), bytes.len());
	}

	#[test]
	fn boundary_complete_4byte() {
		let bytes = "😀".as_bytes();
		assert_eq!(find_utf8_boundary(bytes), bytes.len());
	}

	// --- Incomplete sequences (leader only) ---

	#[test]
	fn boundary_incomplete_2byte_leader_only() {
		assert_eq!(find_utf8_boundary(&[0xC3]), 0);
	}

	#[test]
	fn boundary_incomplete_3byte_leader_only() {
		assert_eq!(find_utf8_boundary(&[0xE4]), 0);
	}

	#[test]
	fn boundary_incomplete_4byte_leader_only() {
		assert_eq!(find_utf8_boundary(&[0xF0]), 0);
	}

	// --- Incomplete sequences (leader + partial continuations) ---

	#[test]
	fn boundary_incomplete_3byte_one_continuation() {
		assert_eq!(find_utf8_boundary(&[0xE4, 0xB8]), 0);
	}

	#[test]
	fn boundary_incomplete_4byte_one_continuation() {
		assert_eq!(find_utf8_boundary(&[0xF0, 0x9F]), 0);
	}

	#[test]
	fn boundary_incomplete_4byte_two_continuations() {
		assert_eq!(find_utf8_boundary(&[0xF0, 0x9F, 0x98]), 0);
	}

	// --- Mixed ASCII + incomplete trailing sequence ---

	#[test]
	fn boundary_ascii_then_incomplete_2byte() {
		let bytes = &[b'H', b'i', 0xC3];
		assert_eq!(find_utf8_boundary(bytes), 2);
	}

	#[test]
	fn boundary_ascii_then_incomplete_3byte() {
		let bytes = &[b'A', b'B', 0xE4, 0xB8];
		assert_eq!(find_utf8_boundary(bytes), 2);
	}

	#[test]
	fn boundary_ascii_then_incomplete_4byte() {
		let bytes = &[b'X', 0xF0, 0x9F, 0x98];
		assert_eq!(find_utf8_boundary(bytes), 1);
	}

	#[test]
	fn boundary_multibyte_then_incomplete() {
		let mut bytes = "中".as_bytes().to_vec();
		bytes.push(0xC3);
		assert_eq!(find_utf8_boundary(&bytes), 3);
	}

	// --- Edge cases ---

	#[test]
	fn boundary_only_continuation_bytes() {
		assert_eq!(find_utf8_boundary(&[0x80, 0x80, 0x80]), 3);
	}

	#[test]
	fn boundary_invalid_leading_byte_0xff() {
		assert_eq!(find_utf8_boundary(&[0xFF]), 1);
	}

	#[test]
	fn boundary_single_2byte_leader() {
		assert_eq!(find_utf8_boundary(&[0xC0]), 0);
	}
}
