use diesel::prelude::*;
use diesel::sqlite::SqliteConnection;
use diesel_migrations::{
	embed_migrations, EmbeddedMigrations, MigrationHarness,
};
use std::sync::{Arc, Mutex};

pub const MIGRATIONS: EmbeddedMigrations = embed_migrations!("migrations");

pub type DbPool = Arc<Mutex<SqliteConnection>>;

pub fn init_db(app_data_dir: &std::path::Path) -> Result<DbPool, String> {
	std::fs::create_dir_all(app_data_dir)
		.map_err(|e| format!("Failed to create app data dir: {e}"))?;

	let db_path = app_data_dir.join("app.db");
	let db_url = db_path.to_string_lossy().to_string();

	let mut conn = SqliteConnection::establish(&db_url)
		.map_err(|e| format!("Failed to connect to database: {e}"))?;

	if let Err(e) = diesel::sql_query("PRAGMA journal_mode=WAL;").execute(&mut conn) {
		log::warn!("Failed to set journal_mode=WAL: {e}");
	}
	if let Err(e) = diesel::sql_query("PRAGMA foreign_keys=ON;").execute(&mut conn) {
		log::warn!("Failed to set foreign_keys=ON: {e}");
	}

	conn.run_pending_migrations(MIGRATIONS)
		.map_err(|e| format!("Failed to run migrations: {e}"))?;

	Ok(Arc::new(Mutex::new(conn)))
}
