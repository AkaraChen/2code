use std::io::Read;
use std::sync::{mpsc, Arc};

use diesel::SqliteConnection;

use infra::db::DbPool;
use infra::pty::{self as session, PtySessionMap};
use model::error::AppError;
use model::pty::{
	NewPtySessionRecord, PtyConfig, PtySessionMeta, PtySessionRecord,
};

use crate::pty::{
	persist::persist_pty_output, sanitize::sanitize_history, PersistMsg,
	PtyContext, PtyFlushSenders,
};
use crate::PtyEventEmitter;

pub fn create_session(
	ctx: &PtyContext,
	meta: &PtySessionMeta,
	config: &PtyConfig,
) -> Result<String, AppError> {
	create_session_inner(ctx, meta, config, None)
}

fn create_session_inner(
	ctx: &PtyContext,
	meta: &PtySessionMeta,
	config: &PtyConfig,
	initial_output: Option<&[u8]>,
) -> Result<String, AppError> {
	let session_id = uuid::Uuid::new_v4().to_string();
	create_session_with_id(ctx, &session_id, meta, config, initial_output, false)?;
	Ok(session_id)
}

/// Core PTY session creation. When `reuse_existing` is true the DB record
/// already exists and will be updated in-place (used during restore).
fn create_session_with_id(
	ctx: &PtyContext,
	session_id: &str,
	meta: &PtySessionMeta,
	config: &PtyConfig,
	initial_output: Option<&[u8]>,
	reuse_existing: bool,
) -> Result<(), AppError> {
	// 1. Resolve project folder and load init_script from 2code.json
	let project_init_scripts = {
		let conn = &mut *ctx.db.lock().map_err(|_| AppError::LockError)?;
		let profile = repo::profile::find_by_id(conn, &meta.profile_id)?;
		let folder =
			repo::profile::get_project_folder(conn, &profile.project_id)?;
		infra::config::load_project_config(&folder)
			.map(|c| c.init_script)
			.unwrap_or_default()
	};

	// 2. Prepare shell init directory (graceful degradation on failure)
	let init_dir =
		infra::shell_init::prepare_init_dir(session_id, &project_init_scripts);
	if let Err(ref e) = init_dir {
		tracing::warn!(target: "pty", "Failed to prepare init dir: {e}");
	}

	// 3. Create PTY session
	let reader = session::create_session(
		&ctx.sessions,
		session_id,
		&config.shell,
		&config.cwd,
		config.rows,
		config.cols,
		init_dir.as_deref().ok(),
		ctx.helper_url.as_deref(),
		ctx.helper_bin.as_deref(),
	)?;

	// 4. Persist to database
	{
		let conn = &mut *ctx.db.lock().map_err(|_| AppError::LockError)?;
		if reuse_existing {
			// Restore path: update record in-place, replace output blob
			repo::pty::reopen_session(
				conn,
				session_id,
				initial_output.unwrap_or(&[]),
			)?;
		} else {
			// New session path: insert fresh record
			let new_record = NewPtySessionRecord {
				id: session_id,
				profile_id: &meta.profile_id,
				title: &meta.title,
				shell: &config.shell,
				cwd: &config.cwd,
				cols: config.cols as i32,
				rows: config.rows as i32,
			};
			repo::pty::insert_session(conn, &new_record)?;

			// Pre-write initial output BEFORE spawning the read thread
			if let Some(output) = initial_output {
				if !output.is_empty() {
					repo::pty::append_output(conn, session_id, output)?;
				}
			}
		}
	}

	tracing::info!(target: "pty", %session_id, profile_id = %meta.profile_id, reuse_existing, "session created");

	// Spawn a background thread to read PTY output and emit events
	let id = session_id.to_string();
	let emitter = ctx.emitter.clone();
	let db = ctx.db.clone();
	let flush_senders = ctx.flush_senders.clone();
	let handle = std::thread::spawn(move || {
		read_pty_output(emitter, id, reader, db, flush_senders);
	});

	// Track the thread handle so it can be joined on app exit
	if let Ok(mut guard) = ctx.read_threads.lock() {
		guard.push(handle);
	}

	Ok(())
}

pub fn close_session(
	db: &DbPool,
	sessions: &PtySessionMap,
	session_id: &str,
) -> Result<(), AppError> {
	session::close_session(sessions, session_id)?;

	// Mark session as closed in DB
	if let Ok(mut conn) = db.lock() {
		repo::pty::mark_closed(&mut conn, session_id);
	}

	Ok(())
}

pub fn list_project_sessions(
	conn: &mut SqliteConnection,
	project_id: &str,
) -> Result<Vec<PtySessionRecord>, AppError> {
	repo::pty::list_by_project(conn, project_id)
}

pub fn get_history(
	conn: &mut SqliteConnection,
	session_id: &str,
) -> Result<Vec<u8>, AppError> {
	repo::pty::get_session_history(conn, session_id)
}

pub fn delete_session(
	conn: &mut SqliteConnection,
	session_id: &str,
) -> Result<(), AppError> {
	// Capture stats before hard delete
	let _ = crate::stats::capture_terminal_stats(conn, session_id);
	repo::pty::delete_session(conn, session_id)
}

/// Mark all open sessions (NULL closed_at) as closed. Called on startup for orphans
/// and on exit for any still-running sessions.
pub fn mark_all_closed(db: &DbPool) {
	let Ok(mut conn) = db.lock() else { return };
	repo::pty::mark_all_open_closed(&mut conn);
}

/// Restore all closed PTY sessions at startup.
/// For each: read history → sanitize → spawn new PTY reusing the SAME session ID.
/// The DB record is updated in-place so frontend-persisted IDs stay valid.
pub fn restore_all_sessions(ctx: &PtyContext) -> usize {
	let sessions = {
		let Ok(mut conn) = ctx.db.lock() else { return 0 };
		repo::pty::list_all(&mut conn).unwrap_or_default()
	};

	if sessions.is_empty() {
		return 0;
	}

	tracing::info!(target: "pty", count = sessions.len(), "restore_all: found sessions to restore");
	let mut restored = 0;

	for old in &sessions {
		if let Err(e) = restore_single_session(ctx, old) {
			tracing::warn!(target: "pty", session_id = %old.id, error = %e, "restore_all: failed, deleting stale record");
			// Clean up the stale record so it doesn't block future startups
			if let Ok(mut conn) = ctx.db.lock() {
				let _ = repo::pty::delete_session(&mut conn, &old.id);
			}
		} else {
			restored += 1;
		}
	}

	restored
}

fn restore_single_session(
	ctx: &PtyContext,
	old: &PtySessionRecord,
) -> Result<(), AppError> {
	// 1. Read raw history
	let raw_history = {
		let conn = &mut *ctx.db.lock().map_err(|_| AppError::LockError)?;
		repo::pty::get_session_history(conn, &old.id)?
	};

	// 2. Sanitize through vt100
	let history = sanitize_history(&raw_history, old.rows as u16, old.cols as u16);
	tracing::info!(
		target: "pty", session_id = %old.id,
		raw_bytes = raw_history.len(), clean_bytes = history.len(),
		"restore: sanitized history"
	);

	// 3. Spawn new PTY process reusing the SAME session ID, update DB in-place
	let meta = PtySessionMeta {
		profile_id: old.profile_id.clone(),
		title: old.title.clone(),
	};
	let config = PtyConfig {
		shell: old.shell.clone(),
		cwd: old.cwd.clone(),
		rows: old.rows as u16,
		cols: old.cols as u16,
	};
	let history_ref = if history.is_empty() {
		None
	} else {
		Some(history.as_slice())
	};
	create_session_with_id(ctx, &old.id, &meta, &config, history_ref, true)?;
	tracing::info!(target: "pty", session_id = %old.id, "restore: session restored in-place");

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
	emitter: Arc<dyn PtyEventEmitter>,
	session_id: String,
	mut reader: Box<dyn Read + Send>,
	db: DbPool,
	flush_senders: PtyFlushSenders,
) {
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
				if let Some(pos) = find_last_pattern(raw, CLEAR_SCROLLBACK_SEQ)
				{
					let after = pos + CLEAR_SCROLLBACK_SEQ.len();
					let _ = tx.send(PersistMsg::Clear);
					if after < n {
						let _ =
							tx.send(PersistMsg::Data(raw[after..].to_vec()));
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
					if !emitter.emit_output(&session_id, text.as_ref()) {
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
		repo::pty::mark_closed(&mut conn, &session_id);
	}
	tracing::info!(target: "pty", %session_id, "session exited");
	emitter.emit_exit(&session_id);
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
