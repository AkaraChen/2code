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

	const MAPPING_MIGRATION: &str =
		"2026-09-15-000000_add_herdr_runtime_mappings";

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
			 WHERE type = 'table' AND name IN ('projects', 'profiles', 'pty_sessions')",
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
		worktree_path: String,
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
	fn mapping_migration_stores_2code_namespace_and_empty_associations() {
		let dir = tempdir().expect("tempdir");
		let pool = init_db(dir.path()).expect("init db");
		let mut conn = pool.lock().expect("lock db");

		let tables: Vec<NameRow> = diesel::sql_query(
			"SELECT name FROM sqlite_master \
			 WHERE type = 'table' \
			 AND name IN ('herdr_namespaces', 'profile_runtime_mappings', 'session_runtime_mappings') \
			 ORDER BY name",
		)
		.load(&mut *conn)
		.expect("list mapping tables");
		assert_eq!(
			tables
				.iter()
				.map(|row| row.name.as_str())
				.collect::<Vec<_>>(),
			[
				"herdr_namespaces",
				"profile_runtime_mappings",
				"session_runtime_mappings"
			]
		);

		let namespaces: Vec<NameRow> = diesel::sql_query(
			"SELECT name FROM herdr_namespaces ORDER BY name",
		)
		.load(&mut *conn)
		.expect("list namespaces");
		assert_eq!(
			namespaces
				.iter()
				.map(|row| row.name.as_str())
				.collect::<Vec<_>>(),
			["2code"]
		);
		assert_ne!(namespaces[0].name, "default");

		let mappings: CountRow = diesel::sql_query(
			"SELECT COUNT(*) AS count FROM profile_runtime_mappings",
		)
		.get_result(&mut *conn)
		.expect("count profile mappings");
		assert_eq!(mappings.count, 0);

		let sessions: CountRow = diesel::sql_query(
			"SELECT COUNT(*) AS count FROM session_runtime_mappings",
		)
		.get_result(&mut *conn)
		.expect("count session mappings");
		assert_eq!(sessions.count, 0);

		assert_eq!(
			column_names(&mut conn, "profiles"),
			[
				"id",
				"project_id",
				"branch_name",
				"worktree_path",
				"created_at",
				"is_default",
				"notes"
			]
		);
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
			column_names(&mut conn, "pty_sessions"),
			[
				"id",
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
		assert_eq!(
			column_names(&mut conn, "profile_runtime_mappings"),
			["profile_id", "namespace", "workspace_id"]
		);
		assert_eq!(
			column_names(&mut conn, "session_runtime_mappings"),
			["session_id", "namespace", "pane_id"]
		);
		assert!(!column_names(&mut conn, "profile_runtime_mappings")
			.contains(&"terminal_id".into()));
		assert!(!column_names(&mut conn, "session_runtime_mappings")
			.contains(&"terminal_id".into()));
		assert!(!column_names(&mut conn, "profile_runtime_mappings")
			.iter()
			.any(|name| name.contains("label")));
	}

	#[test]
	fn mapping_migration_does_not_rewrite_existing_catalog_rows() {
		let mut conn = SqliteConnection::establish(":memory:").expect("memory");
		diesel::sql_query("PRAGMA foreign_keys=ON;")
			.execute(&mut conn)
			.ok();
		apply_migrations_except(&mut conn, MAPPING_MIGRATION);

		conn.batch_execute(
			"INSERT INTO projects (id, name, folder, created_at, sort_order) \
			 VALUES ('proj-keep', 'Keep', '/repo', datetime('now'), 42);\
			 INSERT INTO profiles (id, project_id, branch_name, worktree_path, created_at, is_default, notes) \
			 VALUES ('prof-keep', 'proj-keep', 'main', '/repo/cache', datetime('now'), 1, 'keep-notes');\
			 INSERT INTO pty_sessions (id, profile_id, title, shell, cwd, created_at, cols, rows) \
			 VALUES ('sess-keep', 'prof-keep', 'Shell', '/bin/sh', '/repo', datetime('now'), 80, 24);",
		)
		.expect("seed catalog");

		let before: CatalogRow = diesel::sql_query(
			"SELECT projects.id AS id, profiles.notes AS notes, \
			        projects.sort_order AS sort_order, profiles.worktree_path AS worktree_path \
			 FROM projects JOIN profiles ON profiles.project_id = projects.id \
			 WHERE projects.id = 'proj-keep'",
		)
		.get_result(&mut conn)
		.expect("catalog before");

		let mapping_dir = migrations_dir().join(MAPPING_MIGRATION);
		apply_up_sql(&mut conn, &mapping_dir);

		let after: CatalogRow = diesel::sql_query(
			"SELECT projects.id AS id, profiles.notes AS notes, \
			        projects.sort_order AS sort_order, profiles.worktree_path AS worktree_path \
			 FROM projects JOIN profiles ON profiles.project_id = projects.id \
			 WHERE projects.id = 'proj-keep'",
		)
		.get_result(&mut conn)
		.expect("catalog after");
		assert_eq!(after.id, before.id);
		assert_eq!(after.notes, "keep-notes");
		assert_eq!(after.sort_order, 42);
		assert_eq!(after.worktree_path, "/repo/cache");

		let session_id: NameRow = diesel::sql_query(
			"SELECT id AS name FROM pty_sessions WHERE id = 'sess-keep'",
		)
		.get_result(&mut conn)
		.expect("session survived");
		assert_eq!(session_id.name, "sess-keep");

		let profile_mappings: CountRow = diesel::sql_query(
			"SELECT COUNT(*) AS count FROM profile_runtime_mappings",
		)
		.get_result(&mut conn)
		.expect("profile mapping count");
		assert_eq!(profile_mappings.count, 0);
		let session_mappings: CountRow = diesel::sql_query(
			"SELECT COUNT(*) AS count FROM session_runtime_mappings",
		)
		.get_result(&mut conn)
		.expect("session mapping count");
		assert_eq!(session_mappings.count, 0);
	}
}
