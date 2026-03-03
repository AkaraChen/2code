use std::collections::HashMap;
use std::sync::{mpsc, Arc, Mutex};

use infra::db::DbPool;
use model::error::AppError;

use crate::pty::{PersistMsg, PtyFlushSenders};

pub fn create_flush_senders() -> PtyFlushSenders {
	Arc::new(Mutex::new(HashMap::new()))
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

/// Persistence thread: receives raw bytes from channel and writes to DB immediately.
pub(crate) fn persist_pty_output(
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
	use diesel::prelude::*;
	use diesel_migrations::MigrationHarness;

	fn setup_test_db() -> infra::db::DbPool {
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
