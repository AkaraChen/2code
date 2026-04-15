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
