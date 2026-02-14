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
	// 1. Read raw history (acquire lock → read → release)
	let raw_history = {
		let db = app.state::<DbPool>().inner().clone();
		let conn = &mut *db.lock().map_err(|_| AppError::LockError)?;
		crate::repo::pty::get_session_history(conn, old_session_id)?
	};
	tracing::info!(target: "pty", %old_session_id, raw_bytes = raw_history.len(), "restore: loaded raw history");

	// 2. Sanitize through vt100 virtual terminal emulator
	let history = sanitize_history(&raw_history, config.rows, config.cols);
	tracing::info!(target: "pty", %old_session_id, raw_bytes = raw_history.len(), clean_bytes = history.len(), "restore: sanitized history");

	// 3. Create new PTY (manages its own lock internally)
	let new_session_id = create_session(app, sessions, meta, config)?;
	tracing::info!(target: "pty", %old_session_id, %new_session_id, "restore: new session created");

	// 4. Delete old record (re-acquire lock — only after new session succeeds)
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
				match crate::repo::pty::append_output(&mut conn, session_id, &data)
				{
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
					crate::repo::pty::clear_output(&mut conn, session_id);
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
		assert!(result.windows(4).any(|w| w == b"\x1b[31" || w == b"\x1b[0m"));
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
}
