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
	use diesel::prelude::*;
	use tempfile::tempdir;

	use super::init_db;

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
}
