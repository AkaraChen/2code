use std::path::Path;

use diesel::SqliteConnection;
use uuid::Uuid;

use model::error::AppError;
use model::project::{
	GitBinaryPreview, GitCommit, GitDiffStats, GitPullRequestStatus, Project,
	ProjectWithProfiles,
};
use model::project_group::ProjectGroup;

pub fn create_from_folder(
	conn: &mut SqliteConnection,
	name: &str,
	folder: &str,
) -> Result<Project, AppError> {
	if !Path::new(folder).exists() {
		return Err(AppError::NotFound(format!("Folder: {folder}")));
	}

	let id = Uuid::new_v4().to_string();
	let project = repo::project::insert(conn, &id, name, folder)?;

	let branch_name = infra::git::branch(folder).unwrap_or_default();

	let default_profile_id = format!("default-{id}");
	repo::profile::insert_default(
		conn,
		&default_profile_id,
		&id,
		&branch_name,
		folder,
	)?;

	Ok(project)
}

pub fn list(
	conn: &mut SqliteConnection,
) -> Result<Vec<ProjectWithProfiles>, AppError> {
	repo::project::list_all_with_profiles(conn)
}

pub fn update(
	conn: &mut SqliteConnection,
	id: &str,
	name: Option<String>,
	folder: Option<String>,
) -> Result<Project, AppError> {
	repo::project::update(conn, id, name, folder)
}

pub fn delete(conn: &mut SqliteConnection, id: &str) -> Result<(), AppError> {
	repo::project::delete(conn, id)
}

pub fn create_group(
	conn: &mut SqliteConnection,
	name: &str,
) -> Result<ProjectGroup, AppError> {
	let name = name.trim();
	if name.is_empty() {
		return Err(AppError::DbError(
			"Project group name cannot be empty".into(),
		));
	}

	let id = Uuid::new_v4().to_string();
	repo::project_group::insert(conn, &id, name)
}

pub fn list_groups(
	conn: &mut SqliteConnection,
) -> Result<Vec<ProjectGroup>, AppError> {
	repo::project_group::list_all(conn)
}

pub fn assign_to_group(
	conn: &mut SqliteConnection,
	project_id: &str,
	group_id: Option<String>,
) -> Result<Project, AppError> {
	let group_id = group_id.and_then(|id| {
		let trimmed = id.trim().to_string();
		if trimmed.is_empty() {
			None
		} else {
			Some(trimmed)
		}
	});

	if let Some(group_id) = group_id.as_deref() {
		repo::project_group::find_by_id(conn, group_id)?;
	}

	repo::project::set_group(conn, project_id, group_id.as_deref())
}

pub fn get_branch(folder: &str) -> Result<String, AppError> {
	infra::git::branch(folder)
}

pub fn get_diff(
	conn: &mut SqliteConnection,
	profile_id: &str,
) -> Result<String, AppError> {
	let profile = repo::profile::find_by_id(conn, profile_id)?;
	infra::git::diff(&profile.worktree_path)
}

pub fn get_diff_stats(
	conn: &mut SqliteConnection,
	profile_id: &str,
) -> Result<GitDiffStats, AppError> {
	let profile = repo::profile::find_by_id(conn, profile_id)?;
	infra::git::diff_stats(&profile.worktree_path)
}

pub fn get_log(
	conn: &mut SqliteConnection,
	profile_id: &str,
	limit: u32,
) -> Result<Vec<GitCommit>, AppError> {
	let profile = repo::profile::find_by_id(conn, profile_id)?;
	infra::git::log(&profile.worktree_path, limit)
}

pub fn get_commit_diff(
	conn: &mut SqliteConnection,
	profile_id: &str,
	commit_hash: &str,
) -> Result<String, AppError> {
	let profile = repo::profile::find_by_id(conn, profile_id)?;
	infra::git::show(&profile.worktree_path, commit_hash)
}

pub fn get_binary_preview(
	conn: &mut SqliteConnection,
	profile_id: &str,
	path: &str,
	source: &str,
	commit_hash: Option<&str>,
) -> Result<Option<GitBinaryPreview>, AppError> {
	let profile = repo::profile::find_by_id(conn, profile_id)?;
	let file_path = match source {
		"working_tree" => {
			infra::git::read_worktree_file(&profile.worktree_path, path)?
		}
		"head" => infra::git::read_head_file(&profile.worktree_path, path)?,
		"commit" => {
			let commit_hash = commit_hash.ok_or_else(|| {
				AppError::GitError(
					"commit_hash is required for commit previews".into(),
				)
			})?;
			infra::git::read_commit_file(
				&profile.worktree_path,
				commit_hash,
				path,
			)?
		}
		"parent_commit" => {
			let commit_hash = commit_hash.ok_or_else(|| {
				AppError::GitError(
					"commit_hash is required for parent commit previews".into(),
				)
			})?;
			infra::git::read_parent_commit_file(
				&profile.worktree_path,
				commit_hash,
				path,
			)?
		}
		other => {
			return Err(AppError::GitError(format!(
				"Unsupported preview source: {other}"
			)));
		}
	};

	Ok(file_path.map(|file_path| GitBinaryPreview { file_path }))
}

pub fn commit_changes(
	conn: &mut SqliteConnection,
	profile_id: &str,
	files: &[String],
	message: &str,
	body: Option<&str>,
) -> Result<String, AppError> {
	let profile = repo::profile::find_by_id(conn, profile_id)?;
	infra::git::commit(&profile.worktree_path, files, message, body)
}

pub fn discard_file_changes(
	conn: &mut SqliteConnection,
	profile_id: &str,
	paths: &[String],
) -> Result<(), AppError> {
	let profile = repo::profile::find_by_id(conn, profile_id)?;
	infra::git::discard_changes(&profile.worktree_path, paths)
}

pub fn get_ahead_count(
	conn: &mut SqliteConnection,
	profile_id: &str,
) -> Result<u32, AppError> {
	let profile = repo::profile::find_by_id(conn, profile_id)?;
	Ok(infra::git::ahead_count(&profile.worktree_path))
}

pub fn push(
	conn: &mut SqliteConnection,
	profile_id: &str,
) -> Result<(), AppError> {
	let profile = repo::profile::find_by_id(conn, profile_id)?;
	infra::git::push(&profile.worktree_path)
}

pub fn get_pull_request_status_for_folder(
	folder: &str,
) -> Result<Option<GitPullRequestStatus>, AppError> {
	infra::git::pull_request_status(folder)
}

pub fn get_github_avatar(
	conn: &mut SqliteConnection,
	project_id: &str,
) -> Result<Option<String>, AppError> {
	let project = repo::project::find_by_id(conn, project_id)?;
	Ok(infra::git::github_avatar_url(&project.folder))
}
