use std::path::PathBuf;

use diesel::SqliteConnection;
use uuid::Uuid;

use crate::error::{AppError, AppResult};
use crate::model::profile::Profile;

/// Sanitize user input into a valid git branch name.
/// Splits on `/` to preserve namespace separators (e.g. "feature/auth"),
/// slugifies each segment (handling CJK via pinyin), then rejoins.
fn sanitize_branch_name(input: &str) -> String {
	input
		.split('/')
		.map(crate::infra::slug::slugify_cjk)
		.filter(|s| !s.is_empty())
		.collect::<Vec<_>>()
		.join("/")
}

fn resolve_worktree_base() -> AppResult<PathBuf> {
	let home = dirs::home_dir().ok_or_else(|| {
		AppError::IoError(std::io::Error::new(
			std::io::ErrorKind::NotFound,
			"Could not resolve home directory",
		))
	})?;
	Ok(home.join(".2code").join("workspace"))
}

pub fn create(
	conn: &mut SqliteConnection,
	project_id: &str,
	branch_name: &str,
) -> AppResult<Profile> {
	let project_folder =
		crate::repo::profile::get_project_folder(conn, project_id)?;

	let branch_name = sanitize_branch_name(branch_name);
	if branch_name.is_empty() {
		return Err(AppError::GitError("Invalid branch name".to_string()));
	}

	let id = Uuid::new_v4().to_string();
	let worktree_base = resolve_worktree_base()?;
	std::fs::create_dir_all(&worktree_base)?;
	let worktree_path = worktree_base.join(&id);
	let worktree_str = worktree_path.to_string_lossy().to_string();

	crate::infra::git::worktree_add(
		&project_folder,
		&branch_name,
		&worktree_str,
	)?;

	let profile = crate::repo::profile::insert(
		conn,
		&id,
		project_id,
		&branch_name,
		&worktree_str,
	)?;

	if let Ok(cfg) = crate::infra::config::load_project_config(&project_folder)
	{
		crate::infra::config::execute_scripts(
			&cfg.setup_script,
			&worktree_path,
		);
	}

	Ok(profile)
}

pub fn list(
	conn: &mut SqliteConnection,
	project_id: &str,
) -> AppResult<Vec<Profile>> {
	crate::repo::profile::list_by_project(conn, project_id)
}

pub fn get(conn: &mut SqliteConnection, id: &str) -> AppResult<Profile> {
	crate::repo::profile::find_by_id(conn, id)
}

pub fn update(
	conn: &mut SqliteConnection,
	id: &str,
	branch_name: Option<String>,
) -> AppResult<Profile> {
	crate::repo::profile::update(conn, id, branch_name)
}

pub fn delete(conn: &mut SqliteConnection, id: &str) -> AppResult<()> {
	let (profile, project_folder) = crate::repo::profile::delete(conn, id)?;
	let worktree_path = PathBuf::from(&profile.worktree_path);

	if let Ok(cfg) = crate::infra::config::load_project_config(&project_folder)
	{
		crate::infra::config::execute_scripts(
			&cfg.teardown_script,
			&worktree_path,
		);
	}

	crate::infra::git::worktree_remove(&project_folder, &profile.worktree_path);
	crate::infra::git::branch_delete(&project_folder, &profile.branch_name);

	Ok(())
}

#[cfg(test)]
mod tests {
	use super::*;

	// --- worktree base resolution ---

	#[test]
	fn resolve_worktree_base_returns_valid_path() {
		let base = resolve_worktree_base().unwrap();
		assert!(base.ends_with(".2code/workspace"));
	}

	// --- branch name sanitization ---

	#[test]
	fn sanitize_simple_english() {
		assert_eq!(sanitize_branch_name("feature/auth"), "feature/auth");
	}

	#[test]
	fn sanitize_with_spaces() {
		assert_eq!(sanitize_branch_name("my feature"), "my-feature");
	}

	#[test]
	fn sanitize_chinese() {
		assert_eq!(
			sanitize_branch_name("新功能/登录"),
			"xin-gong-neng/deng-lu"
		);
	}

	#[test]
	fn sanitize_mixed() {
		assert_eq!(
			sanitize_branch_name("feat/用户认证"),
			"feat/yong-hu-ren-zheng"
		);
	}

	#[test]
	fn sanitize_special_chars() {
		assert_eq!(sanitize_branch_name("fix: bug #123"), "fix-bug-123");
	}

	#[test]
	fn sanitize_empty_segments() {
		assert_eq!(sanitize_branch_name("feature//auth"), "feature/auth");
	}

	#[test]
	fn sanitize_empty_input() {
		assert_eq!(sanitize_branch_name(""), "");
	}
}
