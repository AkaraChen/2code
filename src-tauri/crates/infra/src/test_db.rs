use diesel::prelude::*;
use diesel::sqlite::SqliteConnection;
use diesel_migrations::MigrationHarness;

use crate::db::MIGRATIONS;

/// Create an in-memory SQLite database for testing.
/// Fast and isolated - perfect for unit tests.
pub fn create_test_db() -> SqliteConnection {
	let mut conn =
		SqliteConnection::establish(":memory:").expect("in-memory db");

	// Enable foreign keys
	diesel::sql_query("PRAGMA foreign_keys=ON;")
		.execute(&mut conn)
		.expect("enable foreign keys");

	// Run migrations
	conn.run_pending_migrations(MIGRATIONS)
		.expect("run migrations");

	conn
}

/// Create a file-based SQLite database for testing.
/// Use this when you need to inspect the database with sqlite3 CLI.
///
/// # Example
/// ```bash
/// # After running the test:
/// sqlite3 ./test_agent.db
/// .schema agent_sessions
/// SELECT * FROM agent_sessions;
/// .quit
/// ```
pub fn create_file_test_db(path: &str) -> SqliteConnection {
	// Delete existing file if present
	let _ = std::fs::remove_file(path);

	let mut conn = SqliteConnection::establish(path)
		.unwrap_or_else(|_| panic!("Failed to create test db at {path}"));

	// Enable foreign keys
	diesel::sql_query("PRAGMA foreign_keys=ON;")
		.execute(&mut conn)
		.expect("enable foreign keys");

	// Run migrations
	conn.run_pending_migrations(MIGRATIONS)
		.expect("run migrations");

	eprintln!("✅ Test database created at: {path}");
	eprintln!("   Inspect with: sqlite3 {path}");

	conn
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn test_create_test_db() {
		let mut conn = create_test_db();
		// Verify we can run a basic query
		let result = diesel::sql_query("SELECT 1 as value").execute(&mut conn);
		assert!(result.is_ok());
	}

	#[test]
	fn test_create_file_test_db() {
		let path = "./test_temp.db";
		let mut conn = create_file_test_db(path);

		// Verify we can run a basic query
		let result = diesel::sql_query("SELECT 1 as value").execute(&mut conn);
		assert!(result.is_ok());

		// Cleanup
		drop(conn);
		let _ = std::fs::remove_file(path);
	}
}
