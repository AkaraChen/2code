use diesel::prelude::*;

use model::error::AppError;
use model::pty::{NewPtySessionRecord, PtySessionRecord};
use model::schema::{profiles, pty_sessions};

pub fn insert_session(
	conn: &mut SqliteConnection,
	record: &NewPtySessionRecord,
) -> Result<(), AppError> {
	diesel::insert_into(pty_sessions::table)
		.values(record)
		.execute(conn)
		.map_err(|e| AppError::DbError(e.to_string()))?;

	Ok(())
}

/// All known session ids. Used on startup to garbage-collect orphaned log files.
pub fn all_session_ids(
	conn: &mut SqliteConnection,
) -> Result<Vec<String>, AppError> {
	pty_sessions::table
		.select(pty_sessions::id)
		.load(conn)
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

pub fn list_ids_by_profile(
	conn: &mut SqliteConnection,
	profile_id: &str,
) -> Result<Vec<String>, AppError> {
	pty_sessions::table
		.filter(pty_sessions::profile_id.eq(profile_id))
		.select(pty_sessions::id)
		.load(conn)
		.map_err(|e| AppError::DbError(e.to_string()))
}

pub fn update_dimensions(
	conn: &mut SqliteConnection,
	session_id: &str,
	cols: u16,
	rows: u16,
) {
	match diesel::update(
		pty_sessions::table.filter(pty_sessions::id.eq(session_id)),
	)
	.set((
		pty_sessions::cols.eq(cols as i32),
		pty_sessions::rows.eq(rows as i32),
	))
	.execute(conn)
	{
		Ok(_) => {}
		Err(e) => {
			tracing::warn!(
				target: "pty",
				%session_id,
				error = %e,
				"repo: failed to update dimensions"
			);
		}
	}
}

pub fn mark_closed(conn: &mut SqliteConnection, session_id: &str) {
	match diesel::update(
		pty_sessions::table.filter(pty_sessions::id.eq(session_id)),
	)
	.set(pty_sessions::closed_at.eq(diesel::dsl::now))
	.execute(conn)
	{
		Ok(_) => {}
		Err(e) => {
			tracing::warn!(
				target: "pty",
				%session_id,
				error = %e,
				"repo: failed to mark session closed"
			);
		}
	}
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

#[cfg(test)]
mod tests {
	use super::*;
	use crate::profile;
	use crate::project;
	use crate::test_utils::setup_db;

	fn setup_profile(conn: &mut SqliteConnection) -> String {
		project::insert(conn, "proj-1", "Project", "/tmp/project")
			.expect("insert project");
		profile::insert_default(
			conn,
			"profile-1",
			"proj-1",
			"main",
			"/tmp/project",
		)
		.expect("insert default profile");
		"profile-1".to_string()
	}

	fn session_record<'a>(
		id: &'a str,
		profile_id: &'a str,
	) -> NewPtySessionRecord<'a> {
		NewPtySessionRecord {
			id,
			profile_id,
			title: "Shell",
			shell: "/bin/zsh",
			cwd: "/tmp/project",
			cols: 80,
			rows: 24,
		}
	}

	#[test]
	fn insert_session_lists_by_project() {
		let mut conn = setup_db();
		let profile_id = setup_profile(&mut conn);

		insert_session(&mut conn, &session_record("session-1", &profile_id))
			.expect("insert session");

		let sessions =
			list_by_project(&mut conn, "proj-1").expect("list sessions");
		assert_eq!(sessions.len(), 1);
		assert_eq!(sessions[0].id, "session-1");
	}

	#[test]
	fn all_session_ids_returns_every_session() {
		let mut conn = setup_db();
		let profile_id = setup_profile(&mut conn);
		insert_session(&mut conn, &session_record("session-1", &profile_id))
			.expect("insert session 1");
		insert_session(&mut conn, &session_record("session-2", &profile_id))
			.expect("insert session 2");

		let mut ids = all_session_ids(&mut conn).expect("all ids");
		ids.sort();
		assert_eq!(ids, vec!["session-1", "session-2"]);
	}

	#[test]
	fn list_ids_by_profile_returns_only_matching_profile_sessions() {
		let mut conn = setup_db();
		let profile_id = setup_profile(&mut conn);
		project::insert(&mut conn, "proj-2", "Project 2", "/tmp/project-2")
			.expect("insert second project");
		profile::insert_default(
			&mut conn,
			"profile-2",
			"proj-2",
			"main",
			"/tmp/project-2",
		)
		.expect("insert second profile");

		insert_session(&mut conn, &session_record("session-1", &profile_id))
			.expect("insert session 1");
		insert_session(&mut conn, &session_record("session-2", &profile_id))
			.expect("insert session 2");
		insert_session(&mut conn, &session_record("session-3", "profile-2"))
			.expect("insert other profile session");

		let mut ids =
			list_ids_by_profile(&mut conn, &profile_id).expect("list ids");
		ids.sort();
		assert_eq!(ids, vec!["session-1", "session-2"]);
	}

	#[test]
	fn delete_session_removes_the_session() {
		let mut conn = setup_db();
		let profile_id = setup_profile(&mut conn);
		insert_session(&mut conn, &session_record("session-1", &profile_id))
			.expect("insert session");

		delete_session(&mut conn, "session-1").expect("delete session");

		assert!(list_by_project(&mut conn, "proj-1").unwrap().is_empty());
	}
}
