use std::collections::HashMap;
use std::io::Read;
use std::sync::mpsc;
use std::sync::{Arc, Mutex};

use diesel::SqliteConnection;

use infra::db::DbPool;
use infra::pty::{self as session, PtyReadThreads, PtySessionMap};
use model::error::AppError;
use model::pty::{
	NewPtySessionRecord, PtyConfig, PtySessionMeta, PtySessionRecord,
};

use crate::PtyEventEmitter;

pub enum PersistMsg {
	Data(Vec<u8>),
	Flush,
	Clear,
}

pub type PtyFlushSenders =
	Arc<Mutex<HashMap<String, mpsc::Sender<PersistMsg>>>>;

pub fn create_flush_senders() -> PtyFlushSenders {
	Arc::new(Mutex::new(HashMap::new()))
}

/// All dependencies needed to create a PTY session, fully decoupled from Tauri.
pub struct PtyContext {
	pub db: DbPool,
	pub sessions: PtySessionMap,
	pub flush_senders: PtyFlushSenders,
	pub read_threads: PtyReadThreads,
	pub emitter: Arc<dyn PtyEventEmitter>,
	pub helper_url: Option<String>,
	pub helper_bin: Option<String>,
}

const VT100_SCROLLBACK: usize = 10000;

/// Process raw terminal history through a virtual terminal emulator
/// to produce clean output (text + colors, no cursor positioning).
fn sanitize_history(raw: &[u8], rows: u16, cols: u16) -> Vec<u8> {
	if raw.is_empty() {
		return Vec::new();
	}
	let mut parser = vt100::Parser::new(rows, cols, VT100_SCROLLBACK);
	parser.process(raw);
	serialize_screen(&mut parser)
}

/// Extract all visible content (scrollback + current screen) from a vt100 parser
/// as formatted bytes with SGR sequences but no cursor positioning.
fn serialize_screen(parser: &mut vt100::Parser) -> Vec<u8> {
	let (rows, cols) = parser.screen().size();
	let screen_rows = rows as usize;

	// Find max scrollback depth
	parser.screen_mut().set_scrollback(usize::MAX);
	let max_scrollback = parser.screen().scrollback();

	let mut all_lines: Vec<Vec<u8>> = Vec::new();

	// Extract scrollback content in full pages (oldest first)
	let mut offset = max_scrollback;
	while offset >= screen_rows {
		parser.screen_mut().set_scrollback(offset);
		for line in parser.screen().rows_formatted(0, cols) {
			all_lines.push(line);
		}
		offset -= screen_rows;
	}

	// Partial page remaining (if max_scrollback is not a multiple of screen_rows)
	if offset > 0 {
		parser.screen_mut().set_scrollback(offset);
		for line in parser.screen().rows_formatted(0, cols).take(offset) {
			all_lines.push(line);
		}
	}

	// Current screen content
	parser.screen_mut().set_scrollback(0);
	for line in parser.screen().rows_formatted(0, cols) {
		all_lines.push(line);
	}

	// Trim trailing visually-empty lines
	while let Some(last) = all_lines.last() {
		if is_visually_empty(last) {
			all_lines.pop();
		} else {
			break;
		}
	}

	if all_lines.is_empty() {
		return Vec::new();
	}

	// Join lines with \r\n and add SGR reset at the end
	let mut output = Vec::new();
	for (i, line) in all_lines.iter().enumerate() {
		if i > 0 {
			output.extend_from_slice(b"\r\n");
		}
		output.extend_from_slice(line);
	}
	output.extend_from_slice(b"\x1b[0m");

	output
}

/// Check if a formatted line is visually empty (contains only SGR sequences and/or spaces).
fn is_visually_empty(line: &[u8]) -> bool {
	let mut i = 0;
	while i < line.len() {
		if line[i] == 0x1b {
			// Skip ESC [ ... m (SGR sequence)
			i += 1;
			if i < line.len() && line[i] == b'[' {
				i += 1;
				while i < line.len() && line[i] != b'm' {
					i += 1;
				}
				if i < line.len() {
					i += 1; // skip 'm'
				}
			}
		} else if line[i] == b' ' {
			i += 1;
		} else {
			return false;
		}
	}
	true
}

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

	// 2. Generate session ID (needed for init dir name)
	let session_id = uuid::Uuid::new_v4().to_string();

	// 3. Prepare shell init directory (graceful degradation on failure)
	let init_dir =
		infra::shell_init::prepare_init_dir(&session_id, &project_init_scripts);
	if let Err(ref e) = init_dir {
		tracing::warn!(target: "pty", "Failed to prepare init dir: {e}");
	}

	// 4. Create PTY session
	let reader = session::create_session(
		&ctx.sessions,
		&session_id,
		&config.shell,
		&config.cwd,
		config.rows,
		config.cols,
		init_dir.as_deref().ok(),
		ctx.helper_url.as_deref(),
		ctx.helper_bin.as_deref(),
	)?;

	// Insert session record into database
	{
		let conn = &mut *ctx.db.lock().map_err(|_| AppError::LockError)?;
		let new_record = NewPtySessionRecord {
			id: &session_id,
			profile_id: &meta.profile_id,
			title: &meta.title,
			shell: &config.shell,
			cwd: &config.cwd,
			cols: config.cols as i32,
			rows: config.rows as i32,
		};
		repo::pty::insert_session(conn, &new_record)?;

		// Pre-write initial output (e.g. sanitized history from restored session)
		// BEFORE spawning the read thread so it precedes any new PTY output.
		if let Some(output) = initial_output {
			if !output.is_empty() {
				repo::pty::append_output(conn, &session_id, output)?;
			}
		}
	}

	tracing::info!(target: "pty", %session_id, profile_id = %meta.profile_id, "session created");

	// Spawn a background thread to read PTY output and emit events
	let id = session_id.clone();
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

	Ok(session_id)
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
	repo::pty::delete_session(conn, session_id)
}

/// Mark all open sessions (NULL closed_at) as closed. Called on startup for orphans
/// and on exit for any still-running sessions.
pub fn mark_all_closed(db: &DbPool) {
	let Ok(mut conn) = db.lock() else { return };
	repo::pty::mark_all_open_closed(&mut conn);
}

/// Restore all closed PTY sessions at startup.
/// For each: read history → sanitize → create new PTY with history pre-written → delete old record.
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

	// 3. Create new PTY with history pre-written to blob
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
	let new_id = create_session_inner(ctx, &meta, &config, history_ref)?;
	tracing::info!(target: "pty", old_id = %old.id, %new_id, "restore: new session created");

	// 4. Delete old record
	{
		let conn = &mut *ctx.db.lock().map_err(|_| AppError::LockError)?;
		repo::pty::delete_session(conn, &old.id)?;
	}

	Ok(())
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

/// Persistence thread: receives raw bytes from channel and writes to DB immediately.
fn persist_pty_output(
	rx: mpsc::Receiver<PersistMsg>,
	db: DbPool,
	session_id: &str,
) {
	while let Ok(msg) = rx.recv() {
		match msg {
			PersistMsg::Data(data) => {
				let Ok(mut conn) = db.lock() else { continue };
				let n = data.len();
				match repo::pty::append_output(&mut conn, session_id, &data) {
					Ok(()) => {
						tracing::info!(target: "pty", %session_id, n, "persist: appended");
					}
					Err(e) => {
						tracing::warn!(target: "pty", %session_id, error = %e, "persist: failed to append");
					}
				}
			}
			PersistMsg::Flush => {} // no-op: data is already persisted
			PersistMsg::Clear => {
				tracing::info!(target: "pty", %session_id, "persist: clear scrollback");
				if let Ok(mut conn) = db.lock() {
					repo::pty::clear_output(&mut conn, session_id);
				}
			}
		}
	}
	tracing::info!(target: "pty", %session_id, "persist: thread exiting");
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

	// --- is_visually_empty ---

	#[test]
	fn visually_empty_empty_line() {
		assert!(is_visually_empty(b""));
	}

	#[test]
	fn visually_empty_spaces_only() {
		assert!(is_visually_empty(b"     "));
	}

	#[test]
	fn visually_empty_sgr_only() {
		assert!(is_visually_empty(b"\x1b[0m\x1b[32m"));
	}

	#[test]
	fn visually_empty_sgr_and_spaces() {
		assert!(is_visually_empty(b"\x1b[0m   \x1b[32m  "));
	}

	#[test]
	fn visually_nonempty_text() {
		assert!(!is_visually_empty(b"hello"));
	}

	#[test]
	fn visually_nonempty_text_with_sgr() {
		assert!(!is_visually_empty(b"\x1b[32mhello\x1b[0m"));
	}

	// --- sanitize_history ---

	/// Helper to extract plain text from sanitized output (strip ANSI sequences).
	fn strip_ansi(bytes: &[u8]) -> String {
		let s = String::from_utf8_lossy(bytes);
		let mut result = String::new();
		let mut chars = s.chars().peekable();
		while let Some(c) = chars.next() {
			if c == '\x1b' {
				// Skip ESC [ ... (letter)
				if chars.peek() == Some(&'[') {
					chars.next();
					while let Some(&nc) = chars.peek() {
						chars.next();
						if nc.is_ascii_alphabetic() {
							break;
						}
					}
				}
			} else {
				result.push(c);
			}
		}
		result
	}

	#[test]
	fn sanitize_empty_input() {
		assert_eq!(sanitize_history(b"", 24, 80), Vec::<u8>::new());
	}

	#[test]
	fn sanitize_plain_text() {
		let result = sanitize_history(b"hello world", 24, 80);
		let text = strip_ansi(&result);
		assert!(text.contains("hello world"));
	}

	#[test]
	fn sanitize_multiline_text() {
		let input = b"line1\r\nline2\r\nline3";
		let result = sanitize_history(input, 24, 80);
		let text = strip_ansi(&result);
		assert!(text.contains("line1"));
		assert!(text.contains("line2"));
		assert!(text.contains("line3"));
	}

	#[test]
	fn sanitize_preserves_sgr_colors() {
		// Red text: ESC[31m hello ESC[0m
		let input = b"\x1b[31mred text\x1b[0m";
		let result = sanitize_history(input, 24, 80);
		// Output should contain SGR sequences (not be plain text)
		assert!(result
			.windows(4)
			.any(|w| w == b"\x1b[31" || w == b"\x1b[0m"));
		let text = strip_ansi(&result);
		assert!(text.contains("red text"));
	}

	#[test]
	fn sanitize_removes_cursor_movement() {
		// Write "AAAA", move cursor to home, overwrite with "BB"
		// Final visible: "BBAA"
		let input = b"AAAA\x1b[HBB";
		let result = sanitize_history(input, 24, 80);
		let text = strip_ansi(&result);
		assert!(
			text.contains("BBAA"),
			"Expected 'BBAA' in output, got: {:?}",
			text
		);
	}

	#[test]
	fn sanitize_inline_tui_overwrite() {
		// Simulate progress: write "Loading...", then \r to go to start, overwrite with "Done!     "
		let input = b"Loading...\rDone!     ";
		let result = sanitize_history(input, 24, 80);
		let text = strip_ansi(&result);
		assert!(
			text.contains("Done!"),
			"Expected 'Done!' in output, got: {:?}",
			text
		);
		assert!(
			!text.contains("Loading"),
			"Should not contain 'Loading', got: {:?}",
			text
		);
	}

	#[test]
	fn sanitize_erase_line() {
		// Write text, then \r + erase to end of line + new text
		let input = b"old text\r\x1b[Knew text";
		let result = sanitize_history(input, 24, 80);
		let text = strip_ansi(&result);
		assert!(
			text.contains("new text"),
			"Expected 'new text', got: {:?}",
			text
		);
		assert!(
			!text.contains("old text"),
			"Should not contain 'old text', got: {:?}",
			text
		);
	}

	#[test]
	fn sanitize_cjk_wide_chars() {
		let input = "你好世界\r\n测试中文".as_bytes();
		let result = sanitize_history(input, 24, 80);
		let text = strip_ansi(&result);
		assert!(text.contains("你好世界"));
		assert!(text.contains("测试中文"));
	}

	#[test]
	fn sanitize_alt_screen_exited() {
		// Enter alt screen, write content, exit alt screen, write normal content
		let mut input = Vec::new();
		input.extend_from_slice(b"normal before\r\n");
		input.extend_from_slice(b"\x1b[?1049h"); // enter alt screen
		input.extend_from_slice(b"alt screen content");
		input.extend_from_slice(b"\x1b[?1049l"); // exit alt screen
		input.extend_from_slice(b"normal after");

		let result = sanitize_history(&input, 24, 80);
		let text = strip_ansi(&result);
		assert!(
			text.contains("normal before"),
			"Expected 'normal before', got: {:?}",
			text
		);
		assert!(
			text.contains("normal after"),
			"Expected 'normal after', got: {:?}",
			text
		);
		// Alt screen content should not appear in normal buffer
		assert!(
			!text.contains("alt screen content"),
			"Should not contain alt screen content, got: {:?}",
			text
		);
	}

	#[test]
	fn sanitize_scrollback_content() {
		// Generate enough lines to push content into scrollback
		let mut input = Vec::new();
		for i in 0..30 {
			input.extend_from_slice(format!("line {i}\r\n").as_bytes());
		}
		// Use a small terminal (5 rows) so lines go into scrollback
		let result = sanitize_history(&input, 5, 80);
		let text = strip_ansi(&result);
		// Should contain both early and late lines
		assert!(
			text.contains("line 0"),
			"Expected 'line 0' in scrollback, got: {:?}",
			text
		);
		assert!(
			text.contains("line 29"),
			"Expected 'line 29', got: {:?}",
			text
		);
	}

	#[test]
	fn sanitize_trims_trailing_empty_lines() {
		// Single line of text on a 24-row terminal should not produce 24 lines
		let result = sanitize_history(b"hello", 24, 80);
		let text = strip_ansi(&result);
		let lines: Vec<&str> = text.split("\r\n").collect();
		assert!(
			lines.len() < 24,
			"Should trim trailing empty lines, got {} lines",
			lines.len()
		);
	}

	// --- persist_pty_output ---

	fn setup_test_db() -> infra::db::DbPool {
		use diesel::prelude::*;
		use diesel_migrations::MigrationHarness;

		let mut conn =
			SqliteConnection::establish(":memory:").expect("in-memory db");
		diesel::sql_query("PRAGMA foreign_keys=ON;")
			.execute(&mut conn)
			.ok();
		conn.run_pending_migrations(infra::db::MIGRATIONS)
			.expect("run migrations");

		Arc::new(Mutex::new(conn))
	}

	fn insert_test_project_and_session(
		db: &infra::db::DbPool,
		session_id: &str,
	) {
		use diesel::RunQueryDsl;
		use model::pty::NewPtySessionRecord;
		let mut conn = db.lock().unwrap();
		// Insert a minimal project + profile + session
		diesel::sql_query(
			"INSERT INTO projects (id, name, folder, created_at) VALUES ('p1', 'Test', '/tmp', datetime('now'))",
		)
		.execute(&mut *conn)
		.unwrap();
		diesel::sql_query(
			"INSERT INTO profiles (id, project_id, branch_name, worktree_path, created_at, is_default) VALUES ('pr1', 'p1', 'main', '/tmp', datetime('now'), 1)",
		)
		.execute(&mut *conn)
		.unwrap();
		let record = NewPtySessionRecord {
			id: session_id,
			profile_id: "pr1",
			title: "test",
			shell: "/bin/sh",
			cwd: "/tmp",
			cols: 80,
			rows: 24,
		};
		repo::pty::insert_session(&mut conn, &record).unwrap();
	}

	#[test]
	fn persist_pty_output_writes_data_to_db() {
		let db = setup_test_db();
		insert_test_project_and_session(&db, "s-persist-data");

		let (tx, rx) = mpsc::channel();
		let persist_db = db.clone();
		let handle = std::thread::spawn(move || {
			persist_pty_output(rx, persist_db, "s-persist-data");
		});

		tx.send(PersistMsg::Data(b"hello persist".to_vec()))
			.unwrap();
		drop(tx);
		handle.join().unwrap();

		let mut conn = db.lock().unwrap();
		let history =
			repo::pty::get_session_history(&mut conn, "s-persist-data")
				.unwrap();
		assert_eq!(history, b"hello persist");
	}

	#[test]
	fn persist_pty_output_clear_resets_output() {
		let db = setup_test_db();
		insert_test_project_and_session(&db, "s-persist-clear");

		let (tx, rx) = mpsc::channel();
		let persist_db = db.clone();
		let handle = std::thread::spawn(move || {
			persist_pty_output(rx, persist_db, "s-persist-clear");
		});

		tx.send(PersistMsg::Data(b"some data".to_vec())).unwrap();
		tx.send(PersistMsg::Clear).unwrap();
		drop(tx);
		handle.join().unwrap();

		let mut conn = db.lock().unwrap();
		let history =
			repo::pty::get_session_history(&mut conn, "s-persist-clear")
				.unwrap();
		assert!(history.is_empty());
	}

	#[test]
	fn persist_pty_output_flush_is_noop() {
		let db = setup_test_db();
		insert_test_project_and_session(&db, "s-persist-flush");

		let (tx, rx) = mpsc::channel();
		let persist_db = db.clone();
		let handle = std::thread::spawn(move || {
			persist_pty_output(rx, persist_db, "s-persist-flush");
		});

		tx.send(PersistMsg::Data(b"data before flush".to_vec()))
			.unwrap();
		tx.send(PersistMsg::Flush).unwrap();
		drop(tx);
		handle.join().unwrap();

		let mut conn = db.lock().unwrap();
		let history =
			repo::pty::get_session_history(&mut conn, "s-persist-flush")
				.unwrap();
		assert_eq!(history, b"data before flush");
	}
}
