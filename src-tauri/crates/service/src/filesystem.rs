use diesel::SqliteConnection;

use model::error::AppError;
use model::filesystem::FileSearchResult;

pub fn search_file(
	conn: &mut SqliteConnection,
	profile_id: &str,
	query: &str,
) -> Result<Vec<FileSearchResult>, AppError> {
	let profile = repo::profile::find_by_id(conn, profile_id)?;
	let root = std::path::Path::new(&profile.worktree_path);
	infra::filesystem::search_files(root, query)
}

#[cfg(test)]
mod tests {
	use diesel::prelude::*;
	use diesel_migrations::MigrationHarness;
	use model::error::AppError;
	use tempfile::tempdir;

	use super::search_file;

	fn setup_db() -> SqliteConnection {
		let mut conn =
			SqliteConnection::establish(":memory:").expect("in-memory db");
		conn.run_pending_migrations(infra::db::MIGRATIONS)
			.expect("run migrations");
		conn
	}

	fn insert_profile(
		conn: &mut SqliteConnection,
		worktree_path: &str,
	) -> String {
		repo::project::insert(conn, "proj-1", "Project", worktree_path)
			.expect("insert project");
		repo::profile::insert_default(
			conn,
			"profile-1",
			"proj-1",
			"main",
			worktree_path,
		)
		.expect("insert profile");
		"profile-1".to_string()
	}

	#[test]
	fn search_file_uses_the_profiles_worktree() {
		let dir = tempdir().expect("tempdir");
		std::fs::create_dir_all(dir.path().join("src")).expect("mkdir src");
		std::fs::write(dir.path().join("src/main.rs"), "fn main() {}")
			.expect("write main");
		std::fs::write(dir.path().join("README.md"), "# readme")
			.expect("write readme");

		let mut conn = setup_db();
		let profile_id =
			insert_profile(&mut conn, &dir.path().to_string_lossy());

		let results =
			search_file(&mut conn, &profile_id, "main").expect("search files");

		assert_eq!(results.len(), 1);
		assert_eq!(results[0].name, "main.rs");
		assert_eq!(results[0].relative_path, "src/main.rs");
	}

	#[test]
	fn search_file_returns_a_not_found_error_for_unknown_profiles() {
		let mut conn = setup_db();

		let result = search_file(&mut conn, "missing-profile", "main");

		assert!(matches!(result, Err(AppError::NotFound(_))));
	}
}
