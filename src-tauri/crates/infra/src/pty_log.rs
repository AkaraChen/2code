//! Per-session PTY output storage backed by plain files.
//!
//! Each session's raw terminal output (ANSI bytes) lives in its own
//! `{app_data_dir}/pty_logs/{session_id}.log` file. This replaces the old
//! single-BLOB-per-session SQLite storage: appending to a file never touches
//! the global DB mutex, so a chatty terminal can no longer stall other
//! sessions, and there is no per-flush blob rewrite.
//!
//! There is deliberately **no on-disk byte cap**: a log file lives only for the
//! duration of one session (it is removed on restore/close/delete). Restore and
//! history replay read a bounded tail because terminal scrollback is bounded.

use std::collections::HashSet;
use std::fs::{self, File, OpenOptions};
use std::io::{self, Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};

/// Directory holding all per-session log files.
pub fn logs_dir(app_data_dir: &Path) -> PathBuf {
	app_data_dir.join("pty_logs")
}

/// Path of a single session's log file within `dir`.
pub fn session_path(dir: &Path, session_id: &str) -> PathBuf {
	dir.join(format!("{session_id}.log"))
}

/// An open, append-only handle to one session's log file.
///
/// Owned by the session's persistence thread for the session's lifetime.
pub struct SessionLog {
	file: File,
}

impl SessionLog {
	/// Open (creating if absent) the log file for `session_id` in append mode.
	pub fn open(dir: &Path, session_id: &str) -> io::Result<Self> {
		fs::create_dir_all(dir)?;
		let file = OpenOptions::new()
			.create(true)
			.append(true)
			.open(session_path(dir, session_id))?;
		Ok(Self { file })
	}

	/// Append raw bytes to the end of the log.
	pub fn append(&mut self, data: &[u8]) -> io::Result<()> {
		self.file.write_all(data)
	}

	/// Truncate the log to empty (handles the `ESC[3J` clear-scrollback signal).
	/// In append mode subsequent writes still go to the (new) end of file.
	pub fn clear(&mut self) -> io::Result<()> {
		self.file.set_len(0)
	}
}

/// Read a session's full history. Missing file → empty (a session that never
/// produced output is indistinguishable from an absent one, by design).
pub fn read_all(dir: &Path, session_id: &str) -> Vec<u8> {
	fs::read(session_path(dir, session_id)).unwrap_or_default()
}

/// Read at most the last `max_bytes` of a session's history. Missing file →
/// empty, matching [`read_all`].
pub fn read_tail(dir: &Path, session_id: &str, max_bytes: u64) -> Vec<u8> {
	let read = || -> io::Result<Vec<u8>> {
		let mut file = File::open(session_path(dir, session_id))?;
		let len = file.metadata()?.len();
		if len > max_bytes {
			file.seek(SeekFrom::Start(len - max_bytes))?;
		}
		let mut buf = Vec::with_capacity(len.min(max_bytes) as usize);
		file.read_to_end(&mut buf)?;
		Ok(buf)
	};
	read().unwrap_or_default()
}

/// Truncate a session's log without holding an open [`SessionLog`]. Used by the
/// `clear_output` fallback when no live persistence thread owns the session.
pub fn clear(dir: &Path, session_id: &str) -> io::Result<()> {
	let path = session_path(dir, session_id);
	if path.exists() {
		OpenOptions::new().write(true).open(&path)?.set_len(0)?;
	}
	Ok(())
}

/// Best-effort delete of a session's log file.
pub fn remove(dir: &Path, session_id: &str) {
	let _ = fs::remove_file(session_path(dir, session_id));
}

/// Delete any `*.log` file whose session id is not in `live_ids`.
///
/// Run on startup to reap logs left behind by (a) an unclean shutdown and
/// (b) sessions whose DB rows were cascade-deleted with a profile/project.
pub fn gc_orphans(dir: &Path, live_ids: &HashSet<String>) {
	let Ok(entries) = fs::read_dir(dir) else {
		return;
	};
	for entry in entries.flatten() {
		let path = entry.path();
		if path.extension().and_then(|e| e.to_str()) != Some("log") {
			continue;
		}
		let Some(stem) = path.file_stem().and_then(|s| s.to_str()) else {
			continue;
		};
		if !live_ids.contains(stem) {
			let _ = fs::remove_file(&path);
		}
	}
}

#[cfg(test)]
mod tests {
	use super::*;
	use std::collections::HashSet;

	fn tmp() -> PathBuf {
		let base = std::env::temp_dir().join(format!(
			"pty-log-test-{}-{:?}",
			std::process::id(),
			std::thread::current().id()
		));
		let _ = fs::remove_dir_all(&base);
		base
	}

	#[test]
	fn append_then_read_roundtrips() {
		let dir = tmp();
		let mut log = SessionLog::open(&dir, "s1").unwrap();
		log.append(b"hello ").unwrap();
		log.append(b"world").unwrap();
		assert_eq!(read_all(&dir, "s1"), b"hello world");
		let _ = fs::remove_dir_all(&dir);
	}

	#[test]
	fn missing_session_reads_empty() {
		let dir = tmp();
		fs::create_dir_all(&dir).unwrap();
		assert!(read_all(&dir, "nope").is_empty());
		let _ = fs::remove_dir_all(&dir);
	}

	#[test]
	fn read_tail_returns_whole_file_when_smaller_than_cap() {
		let dir = tmp();
		SessionLog::open(&dir, "s1")
			.unwrap()
			.append(b"hello world")
			.unwrap();
		assert_eq!(read_tail(&dir, "s1", 1024), b"hello world");
		let _ = fs::remove_dir_all(&dir);
	}

	#[test]
	fn read_tail_returns_last_max_bytes_when_larger() {
		let dir = tmp();
		SessionLog::open(&dir, "s1")
			.unwrap()
			.append(b"0123456789")
			.unwrap();
		assert_eq!(read_tail(&dir, "s1", 4), b"6789");
		let _ = fs::remove_dir_all(&dir);
	}

	#[test]
	fn read_tail_exact_size_boundary() {
		let dir = tmp();
		SessionLog::open(&dir, "s1")
			.unwrap()
			.append(b"12345")
			.unwrap();
		assert_eq!(read_tail(&dir, "s1", 5), b"12345");
		let _ = fs::remove_dir_all(&dir);
	}

	#[test]
	fn read_tail_missing_session_reads_empty() {
		let dir = tmp();
		fs::create_dir_all(&dir).unwrap();
		assert!(read_tail(&dir, "nope", 5).is_empty());
		let _ = fs::remove_dir_all(&dir);
	}

	#[test]
	fn read_tail_zero_cap_reads_empty() {
		let dir = tmp();
		SessionLog::open(&dir, "s1")
			.unwrap()
			.append(b"12345")
			.unwrap();
		assert!(read_tail(&dir, "s1", 0).is_empty());
		let _ = fs::remove_dir_all(&dir);
	}

	#[test]
	fn clear_truncates_and_appends_continue_at_zero() {
		let dir = tmp();
		let mut log = SessionLog::open(&dir, "s1").unwrap();
		log.append(b"discard me").unwrap();
		log.clear().unwrap();
		assert!(read_all(&dir, "s1").is_empty());
		log.append(b"fresh").unwrap();
		assert_eq!(read_all(&dir, "s1"), b"fresh");
		let _ = fs::remove_dir_all(&dir);
	}

	#[test]
	fn standalone_clear_truncates() {
		let dir = tmp();
		SessionLog::open(&dir, "s1")
			.unwrap()
			.append(b"data")
			.unwrap();
		clear(&dir, "s1").unwrap();
		assert!(read_all(&dir, "s1").is_empty());
		// Clearing an absent session is a no-op, not an error.
		clear(&dir, "absent").unwrap();
		let _ = fs::remove_dir_all(&dir);
	}

	#[test]
	fn binary_data_preserved() {
		let dir = tmp();
		let data: Vec<u8> = (0..=255).collect();
		SessionLog::open(&dir, "s1").unwrap().append(&data).unwrap();
		assert_eq!(read_all(&dir, "s1"), data);
		let _ = fs::remove_dir_all(&dir);
	}

	#[test]
	fn remove_deletes_file() {
		let dir = tmp();
		SessionLog::open(&dir, "s1").unwrap().append(b"x").unwrap();
		remove(&dir, "s1");
		assert!(!session_path(&dir, "s1").exists());
		let _ = fs::remove_dir_all(&dir);
	}

	#[test]
	fn gc_removes_only_orphans() {
		let dir = tmp();
		SessionLog::open(&dir, "keep")
			.unwrap()
			.append(b"a")
			.unwrap();
		SessionLog::open(&dir, "drop")
			.unwrap()
			.append(b"b")
			.unwrap();
		let live: HashSet<String> = ["keep".to_string()].into_iter().collect();
		gc_orphans(&dir, &live);
		assert!(session_path(&dir, "keep").exists());
		assert!(!session_path(&dir, "drop").exists());
		let _ = fs::remove_dir_all(&dir);
	}
}
