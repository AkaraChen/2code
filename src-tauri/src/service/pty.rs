use std::collections::HashMap;
use std::io::Read;
use std::sync::mpsc;
use std::sync::{Arc, Mutex};

use diesel::SqliteConnection;
use tauri::{AppHandle, Emitter, Manager};

use crate::error::AppError;
use crate::infra::db::DbPool;
use crate::infra::pty::{self as session, PtySessionMap};
use crate::model::pty::{
	NewPtySessionRecord, PtyConfig, PtySessionMeta, PtySessionRecord,
};

pub(crate) enum PersistMsg {
	Data(Vec<u8>),
	Flush,
	Clear,
}

pub type PtyFlushSenders =
	Arc<Mutex<HashMap<String, mpsc::Sender<PersistMsg>>>>;

pub fn create_flush_senders() -> PtyFlushSenders {
	Arc::new(Mutex::new(HashMap::new()))
}

const FLUSH_THRESHOLD: usize = 32 * 1024; // 32KB

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
		let profile = crate::repo::profile::find_by_id(conn, &meta.profile_id)?;
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

	// 4. Read helper URL and binary path from managed state
	let (helper_url, helper_bin) = app
		.try_state::<crate::infra::helper::HelperState>()
		.map(|s| {
			(
				format!("http://127.0.0.1:{}", s.port),
				s.sidecar_path.to_string_lossy().to_string(),
			)
		})
		.unzip();

	// 5. Create PTY session
	let reader = session::create_session(
		sessions,
		&session_id,
		&config.shell,
		&config.cwd,
		config.rows,
		config.cols,
		init_dir.as_deref().ok(),
		helper_url.as_deref(),
		helper_bin.as_deref(),
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
			cols: config.cols as i32,
			rows: config.rows as i32,
		};
		crate::repo::pty::insert_session(conn, &new_record)?;
	}

	tracing::info!(target: "pty", %session_id, profile_id = %meta.profile_id, "session created");

	// Spawn a background thread to read PTY output and emit events
	let id = session_id.clone();
	let app_handle = app.clone();
	let flush_senders = app.state::<PtyFlushSenders>().inner().clone();
	let handle = std::thread::spawn(move || {
		read_pty_output(app_handle, id, reader, db, flush_senders);
	});

	// Track the thread handle so it can be joined on app exit,
	// ensuring the persistence sub-thread flushes its buffer.
	if let Some(threads) = app.try_state::<crate::infra::pty::PtyReadThreads>()
	{
		if let Ok(mut guard) = threads.lock() {
			guard.push(handle);
		}
	}

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

/// Atomically restore a PTY session: read history → create new PTY → delete old record.
/// DB lock is acquired/released carefully to avoid deadlock with `create_session`.
pub fn restore_session(
	app: &AppHandle,
	sessions: &PtySessionMap,
	old_session_id: &str,
	meta: &PtySessionMeta,
	config: &PtyConfig,
) -> Result<crate::model::pty::RestoreResult, AppError> {
	// 1. Read history (acquire lock → read → release)
	let history = {
		let db = app.state::<DbPool>().inner().clone();
		let conn = &mut *db.lock().map_err(|_| AppError::LockError)?;
		crate::repo::pty::get_session_history(conn, old_session_id)?
	};
	tracing::info!(target: "pty", %old_session_id, bytes = history.len(), "restore: loaded history");

	// 2. Create new PTY (manages its own lock internally)
	let new_session_id = create_session(app, sessions, meta, config)?;
	tracing::info!(target: "pty", %old_session_id, %new_session_id, "restore: new session created");

	// 3. Delete old record (re-acquire lock — only after new session succeeds)
	{
		let db = app.state::<DbPool>().inner().clone();
		let conn = &mut *db.lock().map_err(|_| AppError::LockError)?;
		crate::repo::pty::delete_session(conn, old_session_id)?;
	}

	Ok(crate::model::pty::RestoreResult {
		new_session_id,
		history,
	})
}

/// Send a flush signal to the persistence thread for the given session.
/// Best-effort: silently ignores errors (session already closed, lock poisoned, etc.).
pub fn flush_output(
	senders: &PtyFlushSenders,
	session_id: &str,
) -> Result<(), AppError> {
	let map = senders.lock().map_err(|_| AppError::LockError)?;
	if let Some(tx) = map.get(session_id) {
		let _ = tx.send(PersistMsg::Flush);
	}
	Ok(())
}

/// Find the last occurrence of `needle` in `haystack`.
/// Returns the byte offset of the match start, or `None` if not found.
fn find_last_pattern(haystack: &[u8], needle: &[u8]) -> Option<usize> {
	if needle.is_empty() || haystack.len() < needle.len() {
		return None;
	}
	(0..=haystack.len() - needle.len())
		.rev()
		.find(|&i| haystack[i..i + needle.len()] == *needle)
}

const CLEAR_SCROLLBACK_SEQ: &[u8] = b"\x1b[3J";

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
	flush_senders: PtyFlushSenders,
) {
	let event_name = format!("pty-output-{}", session_id);
	let exit_event = format!("pty-exit-{}", session_id);
	let mut buf = [0u8; 4096];
	let mut utf8_remainder: Vec<u8> = Vec::new();

	// Decouple persistence into a separate thread via channel
	let (tx, rx) = mpsc::channel::<PersistMsg>();
	let persist_db = db.clone();
	let persist_id = session_id.clone();
	let persist_thread = std::thread::spawn(move || {
		persist_pty_output(rx, persist_db, &persist_id);
	});

	// Store a clone of the sender so the frontend can trigger flushes
	if let Ok(mut map) = flush_senders.lock() {
		map.insert(session_id.clone(), tx.clone());
	}

	loop {
		match reader.read(&mut buf) {
			Ok(0) => break,
			Ok(n) => {
				tracing::info!(target: "pty", %session_id, n, "read: bytes from PTY");
				let raw = &buf[..n];

				// Detect clear-scrollback sequence and notify persistence thread
				if let Some(pos) = find_last_pattern(raw, CLEAR_SCROLLBACK_SEQ) {
					let after = pos + CLEAR_SCROLLBACK_SEQ.len();
					let _ = tx.send(PersistMsg::Clear);
					if after < n {
						let _ = tx.send(PersistMsg::Data(raw[after..].to_vec()));
					}
				} else {
					let _ = tx.send(PersistMsg::Data(raw.to_vec()));
				}

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

	// Remove from flush senders map, then drop our sender
	if let Ok(mut map) = flush_senders.lock() {
		map.remove(&session_id);
	}

	// Signal persistence thread to finish and wait
	tracing::info!(target: "pty", %session_id, "read: EOF, waiting for persist thread");
	drop(tx);
	let _ = persist_thread.join();
	tracing::info!(target: "pty", %session_id, "read: persist thread joined");

	// Mark session closed in DB
	if let Ok(mut conn) = db.lock() {
		crate::repo::pty::mark_closed(&mut conn, &session_id);
	}
	tracing::info!(target: "pty", %session_id, "session exited");
	let _ = app.emit(&exit_event, ());
}

/// Persistence thread: receives raw bytes from channel, buffers, and flushes to DB.
fn persist_pty_output(
	rx: mpsc::Receiver<PersistMsg>,
	db: DbPool,
	session_id: &str,
) {
	let mut buffer: Vec<u8> = Vec::new();

	while let Ok(msg) = rx.recv() {
		match msg {
			PersistMsg::Data(data) => {
				tracing::info!(target: "pty", %session_id, n = data.len(), buf_len = buffer.len() + data.len(), "persist: received chunk");
				buffer.extend_from_slice(&data);
				if buffer.len() >= FLUSH_THRESHOLD {
					tracing::info!(target: "pty", %session_id, buf_len = buffer.len(), "persist: buffer reached threshold, flushing");
					flush_output_buffer(&db, session_id, &mut buffer);
				}
			}
			PersistMsg::Flush => {
				if !buffer.is_empty() {
					tracing::info!(target: "pty", %session_id, buf_len = buffer.len(), "persist: flush signal received, flushing");
					flush_output_buffer(&db, session_id, &mut buffer);
				}
			}
			PersistMsg::Clear => {
				tracing::info!(target: "pty", %session_id, "persist: clear scrollback");
				buffer.clear();
				if let Ok(mut conn) = db.lock() {
					crate::repo::pty::clear_output(&mut conn, session_id);
				}
			}
		}
	}

	if !buffer.is_empty() {
		tracing::info!(target: "pty", %session_id, buf_len = buffer.len(), "persist: EOF, flushing remaining");
		flush_output_buffer(&db, session_id, &mut buffer);
	}
	tracing::info!(target: "pty", %session_id, "persist: thread exiting");
}

fn flush_output_buffer(db: &DbPool, session_id: &str, buffer: &mut Vec<u8>) {
	let Ok(mut conn) = db.lock() else { return };

	let chunk_len = buffer.len();
	match crate::repo::pty::append_output(&mut conn, session_id, buffer) {
		Ok(()) => {
			tracing::info!(target: "pty", %session_id, chunk_len, "flush: appended to blob");
		}
		Err(e) => {
			tracing::warn!(target: "pty", %session_id, error = %e, "flush: failed to append");
		}
	}
	buffer.clear();
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

	// --- find_last_pattern ---

	#[test]
	fn pattern_not_found() {
		assert_eq!(find_last_pattern(b"hello", b"\x1b[3J"), None);
	}

	#[test]
	fn pattern_empty_needle() {
		assert_eq!(find_last_pattern(b"hello", b""), None);
	}

	#[test]
	fn pattern_needle_longer_than_haystack() {
		assert_eq!(find_last_pattern(b"ab", b"abcde"), None);
	}

	#[test]
	fn pattern_single_occurrence() {
		let data = b"before\x1b[3Jafter";
		assert_eq!(find_last_pattern(data, CLEAR_SCROLLBACK_SEQ), Some(6));
	}

	#[test]
	fn pattern_multiple_occurrences_returns_last() {
		let data = b"\x1b[3Jfoo\x1b[3Jbar";
		assert_eq!(find_last_pattern(data, CLEAR_SCROLLBACK_SEQ), Some(7));
	}

	#[test]
	fn pattern_at_start() {
		let data = b"\x1b[3Jrest";
		assert_eq!(find_last_pattern(data, CLEAR_SCROLLBACK_SEQ), Some(0));
	}

	#[test]
	fn pattern_at_end() {
		let data = b"stuff\x1b[3J";
		assert_eq!(
			find_last_pattern(data, CLEAR_SCROLLBACK_SEQ),
			Some(data.len() - CLEAR_SCROLLBACK_SEQ.len())
		);
	}

	#[test]
	fn pattern_exact_match() {
		assert_eq!(
			find_last_pattern(CLEAR_SCROLLBACK_SEQ, CLEAR_SCROLLBACK_SEQ),
			Some(0)
		);
	}
}
