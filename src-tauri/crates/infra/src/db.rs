use diesel::prelude::*;
use diesel::sqlite::SqliteConnection;
use diesel_migrations::{
	embed_migrations, EmbeddedMigrations, MigrationHarness,
};
use std::sync::{Arc, Mutex};

pub const MIGRATIONS: EmbeddedMigrations =
	embed_migrations!("../../migrations");

pub type DbPool = Arc<Mutex<SqliteConnection>>;

pub fn init_db(app_data_dir: &std::path::Path) -> Result<DbPool, String> {
	std::fs::create_dir_all(app_data_dir)
		.map_err(|e| format!("Failed to create app data dir: {e}"))?;

	let db_path = app_data_dir.join("app.db");
	let db_url = db_path.to_string_lossy().to_string();

	let mut conn = SqliteConnection::establish(&db_url)
		.map_err(|e| format!("Failed to connect to database: {e}"))?;

	if let Err(e) =
		diesel::sql_query("PRAGMA journal_mode=WAL;").execute(&mut conn)
	{
		tracing::warn!("Failed to set journal_mode=WAL: {e}");
	}
	if let Err(e) =
		diesel::sql_query("PRAGMA foreign_keys=ON;").execute(&mut conn)
	{
		tracing::warn!("Failed to set foreign_keys=ON: {e}");
	}

	conn.run_pending_migrations(MIGRATIONS)
		.map_err(|e| format!("Failed to run migrations: {e}"))?;

	Ok(Arc::new(Mutex::new(conn)))
}

#[cfg(test)]
mod tests {
	use std::fs;
	use std::path::{Path, PathBuf};

	use diesel::connection::SimpleConnection;
	use diesel::prelude::*;
	use diesel::sqlite::SqliteConnection;
	use tempfile::tempdir;

	use super::init_db;

	const DROP_PROFILES_MIGRATION: &str =
		"2026-09-16-000000_drop_profiles_and_runtime_mappings";

	#[derive(QueryableByName)]
	struct IntegerRow {
		#[diesel(sql_type = diesel::sql_types::Integer)]
		foreign_keys: i32,
	}

	#[derive(QueryableByName)]
	struct CountRow {
		#[diesel(sql_type = diesel::sql_types::BigInt)]
		count: i64,
	}

	#[test]
	fn init_db_creates_the_database_file_and_runs_migrations() {
		let dir = tempdir().expect("tempdir");
		let pool = init_db(dir.path()).expect("init db");
		let db_path = dir.path().join("app.db");

		assert!(db_path.exists());

		let mut conn = pool.lock().expect("lock db");
		let row: CountRow = diesel::sql_query(
			"SELECT COUNT(*) AS count \
			 FROM sqlite_master \
			 WHERE type = 'table' AND name IN ('projects', 'checkout_notes', 'pty_sessions')",
		)
		.get_result(&mut *conn)
		.expect("read sqlite_master");

		assert_eq!(row.count, 3);
	}

	#[test]
	fn init_db_enables_foreign_keys() {
		let dir = tempdir().expect("tempdir");
		let pool = init_db(dir.path()).expect("init db");
		let mut conn = pool.lock().expect("lock db");

		let row: IntegerRow = diesel::sql_query("PRAGMA foreign_keys;")
			.get_result(&mut *conn)
			.expect("read foreign_keys pragma");

		assert_eq!(row.foreign_keys, 1);
	}

	#[derive(QueryableByName)]
	struct NameRow {
		#[diesel(sql_type = diesel::sql_types::Text)]
		name: String,
	}

	#[derive(QueryableByName)]
	struct CatalogRow {
		#[diesel(sql_type = diesel::sql_types::Text)]
		id: String,
		#[diesel(sql_type = diesel::sql_types::Text)]
		notes: String,
		#[diesel(sql_type = diesel::sql_types::Integer)]
		sort_order: i32,
		#[diesel(sql_type = diesel::sql_types::Text)]
		folder: String,
	}

	fn column_names(conn: &mut SqliteConnection, table: &str) -> Vec<String> {
		let rows: Vec<NameRow> = diesel::sql_query(format!(
			"SELECT name FROM pragma_table_info('{table}') ORDER BY cid"
		))
		.load(conn)
		.expect("pragma_table_info");
		rows.into_iter().map(|row| row.name).collect()
	}

	fn migrations_dir() -> PathBuf {
		PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../migrations")
	}

	fn apply_up_sql(conn: &mut SqliteConnection, dir: &Path) {
		let sql = fs::read_to_string(dir.join("up.sql")).expect("up.sql");
		conn.batch_execute(&sql).expect("apply up.sql");
	}

	fn apply_migrations_except(conn: &mut SqliteConnection, skip: &str) {
		let mut dirs: Vec<PathBuf> = fs::read_dir(migrations_dir())
			.expect("migrations")
			.filter_map(|entry| {
				let path = entry.ok()?.path();
				(path.is_dir() && path.join("up.sql").exists()).then_some(path)
			})
			.collect();
		dirs.sort();
		for dir in dirs {
			if dir.file_name().and_then(|n| n.to_str()) == Some(skip) {
				continue;
			}
			apply_up_sql(conn, &dir);
		}
	}

	#[test]
	fn drop_profiles_migration_removes_mapping_tables() {
		let dir = tempdir().expect("tempdir");
		let pool = init_db(dir.path()).expect("init db");
		let mut conn = pool.lock().expect("lock db");

		let tables: Vec<NameRow> = diesel::sql_query(
			"SELECT name FROM sqlite_master \
			 WHERE type = 'table' \
			 AND name IN ('profiles', 'herdr_namespaces', \
			              'profile_runtime_mappings', 'session_runtime_mappings') \
			 ORDER BY name",
		)
		.load(&mut *conn)
		.expect("list dropped tables");
		assert!(tables.is_empty());

		assert_eq!(
			column_names(&mut conn, "projects"),
			[
				"id",
				"name",
				"folder",
				"created_at",
				"group_id",
				"sort_order",
				"pinned_at",
				"pinned_order"
			]
		);
		assert_eq!(
			column_names(&mut conn, "checkout_notes"),
			["project_id", "checkout_path", "notes", "created_at"]
		);
		assert_eq!(
			column_names(&mut conn, "pty_sessions"),
			[
				"id",
				"project_id",
				"profile_id",
				"title",
				"shell",
				"cwd",
				"created_at",
				"closed_at",
				"cols",
				"rows"
			]
		);
	}

	#[test]
	fn drop_profiles_migration_copies_notes_and_keeps_projects() {
		let mut conn = SqliteConnection::establish(":memory:").expect("memory");
		diesel::sql_query("PRAGMA foreign_keys=ON;")
			.execute(&mut conn)
			.ok();
		apply_migrations_except(&mut conn, DROP_PROFILES_MIGRATION);

		conn.batch_execute(
			"INSERT INTO projects (id, name, folder, created_at, sort_order) \
			 VALUES ('proj-keep', 'Keep', '/repo', datetime('now'), 42);\
			 INSERT INTO profiles (id, project_id, branch_name, worktree_path, created_at, is_default, notes) \
			 VALUES ('prof-keep', 'proj-keep', 'main', '/repo/cache', datetime('now'), 1, 'keep-notes');\
			 INSERT INTO pty_sessions (id, profile_id, title, shell, cwd, created_at, cols, rows) \
			 VALUES ('sess-keep', 'prof-keep', 'Shell', '/bin/sh', '/repo', datetime('now'), 80, 24);",
		)
		.expect("seed catalog");

		let drop_dir = migrations_dir().join(DROP_PROFILES_MIGRATION);
		apply_up_sql(&mut conn, &drop_dir);

		let after: CatalogRow = diesel::sql_query(
			"SELECT projects.id AS id, checkout_notes.notes AS notes, \
			        projects.sort_order AS sort_order, projects.folder AS folder \
			 FROM projects \
			 JOIN checkout_notes ON checkout_notes.project_id = projects.id \
			 WHERE projects.id = 'proj-keep'",
		)
		.get_result(&mut conn)
		.expect("catalog after");
		assert_eq!(after.id, "proj-keep");
		assert_eq!(after.notes, "keep-notes");
		assert_eq!(after.sort_order, 42);
		assert_eq!(after.folder, "/repo");

		let session: NameRow = diesel::sql_query(
			"SELECT id AS name FROM pty_sessions WHERE id = 'sess-keep'",
		)
		.get_result(&mut conn)
		.expect("session survived");
		assert_eq!(session.name, "sess-keep");
		let session_project: NameRow = diesel::sql_query(
			"SELECT project_id AS name FROM pty_sessions WHERE id = 'sess-keep'",
		)
		.get_result(&mut conn)
		.expect("session project");
		assert_eq!(session_project.name, "proj-keep");

		let dropped: CountRow = diesel::sql_query(
			"SELECT COUNT(*) AS count FROM sqlite_master \
			 WHERE type = 'table' AND name IN \
			 ('profiles', 'herdr_namespaces', \
			  'profile_runtime_mappings', 'session_runtime_mappings')",
		)
		.get_result(&mut conn)
		.expect("dropped tables");
		assert_eq!(dropped.count, 0);
	}
}
