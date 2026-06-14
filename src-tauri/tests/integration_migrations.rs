use diesel::connection::SimpleConnection;
use diesel::prelude::*;
use diesel::sql_types::{Binary, Text};
use diesel_migrations::MigrationHarness;
use infra::db::MIGRATIONS;

#[derive(QueryableByName)]
struct OutputRow {
	#[diesel(sql_type = Text)]
	session_id: String,
	#[diesel(sql_type = Binary)]
	data: Vec<u8>,
}

#[derive(QueryableByName)]
struct IndexRow {
	#[diesel(sql_type = Text)]
	name: String,
}

fn setup_pre_single_blob_migration_db() -> SqliteConnection {
	let mut conn =
		SqliteConnection::establish(":memory:").expect("in-memory db");
	conn.batch_execute(
		r#"
		PRAGMA foreign_keys=ON;

		CREATE TABLE projects (
			id TEXT PRIMARY KEY NOT NULL,
			name TEXT NOT NULL,
			folder TEXT NOT NULL,
			created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
		);

		CREATE TABLE profiles (
			id TEXT PRIMARY KEY NOT NULL,
			project_id TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
			branch_name TEXT NOT NULL,
			worktree_path TEXT NOT NULL,
			created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
		);

		CREATE TABLE pty_sessions (
			id TEXT PRIMARY KEY NOT NULL,
			project_id TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
			title TEXT NOT NULL DEFAULT '',
			shell TEXT NOT NULL,
			cwd TEXT NOT NULL,
			created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
			closed_at TIMESTAMP
		);

		CREATE TABLE pty_output_chunks (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			session_id TEXT NOT NULL REFERENCES pty_sessions (id) ON DELETE CASCADE,
			data BLOB NOT NULL
		);
		CREATE INDEX idx_pty_output_session ON pty_output_chunks (session_id);

		INSERT INTO projects (id, name, folder)
		VALUES ('project-1', 'Project 1', '/repo');

		INSERT INTO pty_sessions (id, project_id, title, shell, cwd)
		VALUES
			('session-with-output', 'project-1', 'with output', '/bin/sh', '/repo'),
			('session-empty', 'project-1', 'empty', '/bin/sh', '/repo');

		INSERT INTO pty_output_chunks (session_id, data)
		VALUES
			('session-with-output', X'68656C6C6F'),
			('session-with-output', X'20'),
			('session-with-output', X'776F726C6400FF');
		"#,
	)
	.expect("create old schema fixture");
	conn
}

fn setup_db_with_migrations() -> SqliteConnection {
	let mut conn =
		SqliteConnection::establish(":memory:").expect("in-memory db");
	diesel::sql_query("PRAGMA foreign_keys=ON;")
		.execute(&mut conn)
		.ok();
	conn.run_pending_migrations(MIGRATIONS)
		.expect("run migrations");
	conn
}

fn run_pty_output_migration_sequence(conn: &mut SqliteConnection) {
	conn.batch_execute(include_str!(
		"../migrations/2026-02-13-000000_profile_first_refactor/up.sql"
	))
	.expect("run profile-first migration");
	conn.batch_execute(include_str!(
		"../migrations/2026-02-13-100000_add_pty_dimensions/up.sql"
	))
	.expect("run dimensions migration");
	conn.batch_execute(include_str!(
		"../migrations/2026-02-14-000000_single_blob_output/up.sql"
	))
	.expect("run single-blob migration");
}

#[test]
fn migration_preserves_pty_output_chunks() {
	let mut conn = setup_pre_single_blob_migration_db();

	run_pty_output_migration_sequence(&mut conn);

	let rows: Vec<OutputRow> = diesel::sql_query(
		"SELECT session_id, data FROM pty_session_output ORDER BY session_id",
	)
	.load(&mut conn)
	.expect("load migrated output rows");

	assert_eq!(rows.len(), 2);
	assert_eq!(rows[0].session_id, "session-empty");
	assert_eq!(rows[0].data, Vec::<u8>::new());
	assert_eq!(rows[1].session_id, "session-with-output");
	assert_eq!(rows[1].data, b"hello world\0\xff".to_vec());
}

#[test]
fn migrations_create_profile_and_session_lookup_indexes() {
	let mut conn = setup_db_with_migrations();

	let rows: Vec<IndexRow> = diesel::sql_query(
		"SELECT name FROM sqlite_master \
		 WHERE type = 'index' \
		 AND name IN ('idx_profiles_project_id', 'idx_pty_sessions_profile_id') \
		 ORDER BY name",
	)
	.load(&mut conn)
	.expect("load index names");
	let names: Vec<String> = rows.into_iter().map(|row| row.name).collect();

	assert_eq!(
		names,
		vec![
			"idx_profiles_project_id".to_string(),
			"idx_pty_sessions_profile_id".to_string(),
		],
	);
}
