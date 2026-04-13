#[cfg(test)]
pub(crate) fn setup_db() -> diesel::SqliteConnection {
	use diesel::prelude::*;
	use diesel_migrations::MigrationHarness;
	use infra::db::MIGRATIONS;

	let mut conn =
		diesel::SqliteConnection::establish(":memory:").expect("in-memory db");
	diesel::sql_query("PRAGMA foreign_keys=ON;")
		.execute(&mut conn)
		.ok();
	conn.run_pending_migrations(MIGRATIONS)
		.expect("run migrations");
	conn
}
