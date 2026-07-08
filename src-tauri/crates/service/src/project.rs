use std::path::Path;

use diesel::{Connection, SqliteConnection};
use infra::db::DbPool;
use uuid::Uuid;

use model::error::AppError;
use model::project::{
	GitBinaryPreview, GitBranchInfo, GitCommit, GitDiffSnapshot, GitDiffStats,
	GitPullRequestStatus, Project, ProjectConfig, ProjectSidebarLayoutUpdate,
	ProjectWithProfiles,
};
use model::project_group::ProjectGroup;

use crate::pty::PtyContext;

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
	let project = repo::project::find_by_id(conn, id)?;
	repo::project::delete(conn, id)?;
	cleanup_empty_group(conn, project.group_id)?;
	Ok(())
}

pub fn delete_with_context(ctx: &PtyContext, id: &str) -> Result<(), AppError> {
	let (project, session_ids) = {
		let conn = &mut *ctx.db.lock().map_err(|_| AppError::LockError)?;
		let project = repo::project::find_by_id(conn, id)?;
		let session_ids = repo::pty::list_by_project(conn, id)?
			.into_iter()
			.map(|session| session.id)
			.collect::<Vec<_>>();
		(project, session_ids)
	};

	for session_id in &session_ids {
		crate::pty::close_session_full(
			&ctx.sessions,
			&ctx.flush_senders,
			&ctx.output_dir,
			session_id,
		)?;
	}

	let conn = &mut *ctx.db.lock().map_err(|_| AppError::LockError)?;
	for session_id in &session_ids {
		repo::pty::mark_closed(conn, session_id);
	}
	repo::project::delete(conn, id)?;
	cleanup_empty_group(conn, project.group_id)?;
	Ok(())
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

pub fn cleanup_empty_groups(
	conn: &mut SqliteConnection,
) -> Result<usize, AppError> {
	repo::project_group::delete_empty(conn)
}

pub fn assign_to_group(
	conn: &mut SqliteConnection,
	project_id: &str,
	group_id: Option<String>,
) -> Result<Project, AppError> {
	let project = repo::project::find_by_id(conn, project_id)?;
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

	let updated =
		repo::project::set_group(conn, project_id, group_id.as_deref())?;
	if project.group_id != updated.group_id {
		cleanup_empty_group(conn, project.group_id)?;
	}

	Ok(updated)
}

pub fn update_sidebar_layout(
	conn: &mut SqliteConnection,
	updates: Vec<ProjectSidebarLayoutUpdate>,
) -> Result<(), AppError> {
	conn.transaction(|conn| {
		let mut previous_group_ids = Vec::new();

		for update in &updates {
			match update.kind.as_str() {
				"group" => {
					let sort_order = update.sort_order.ok_or_else(|| {
						AppError::DbError("Group sort_order is required".into())
					})?;
					repo::project_group::set_sort_order(
						conn, &update.id, sort_order,
					)?;
				}
				"project" => {
					if update.group_id.is_some()
						&& update.pinned_order.is_some()
					{
						return Err(AppError::DbError(
							"Grouped projects cannot be pinned".into(),
						));
					}
					if let Some(group_id) = update.group_id.as_deref() {
						repo::project_group::find_by_id(conn, group_id)?;
					}
					let project = repo::project::find_by_id(conn, &update.id)?;
					if project.group_id != update.group_id {
						previous_group_ids.push(project.group_id);
					}
					repo::project::update_sidebar_layout(
						conn,
						std::slice::from_ref(update),
					)?;
				}
				other => {
					return Err(AppError::DbError(format!(
						"Unsupported sidebar layout update kind: {other}"
					)));
				}
			}
		}

		for group_id in previous_group_ids {
			cleanup_empty_group(conn, group_id)?;
		}

		Ok(())
	})
}

fn cleanup_empty_group(
	conn: &mut SqliteConnection,
	group_id: Option<String>,
) -> Result<(), AppError> {
	if let Some(group_id) = group_id {
		repo::project_group::delete_if_empty(conn, &group_id)?;
	}

	Ok(())
}

pub fn get_branch(folder: &str) -> Result<String, AppError> {
	infra::git::branch(folder)
}

fn profile_worktree_path(
	db: &DbPool,
	profile_id: &str,
) -> Result<String, AppError> {
	let conn = &mut *db.lock().map_err(|_| AppError::LockError)?;
	Ok(repo::profile::find_by_id(conn, profile_id)?.worktree_path)
}

fn project_folder(db: &DbPool, project_id: &str) -> Result<String, AppError> {
	let conn = &mut *db.lock().map_err(|_| AppError::LockError)?;
	Ok(repo::project::find_by_id(conn, project_id)?.folder)
}

pub fn get_diff(db: &DbPool, profile_id: &str) -> Result<String, AppError> {
	let worktree_path = profile_worktree_path(db, profile_id)?;
	infra::git::diff(&worktree_path)
}

pub fn get_diff_snapshot(
	db: &DbPool,
	profile_id: &str,
) -> Result<GitDiffSnapshot, AppError> {
	let worktree_path = profile_worktree_path(db, profile_id)?;
	infra::git::diff_snapshot(&worktree_path)
}

pub fn get_diff_stats(
	db: &DbPool,
	profile_id: &str,
) -> Result<GitDiffStats, AppError> {
	let worktree_path = profile_worktree_path(db, profile_id)?;
	infra::git::diff_stats(&worktree_path)
}

pub fn get_log(
	db: &DbPool,
	profile_id: &str,
	limit: u32,
) -> Result<Vec<GitCommit>, AppError> {
	let worktree_path = profile_worktree_path(db, profile_id)?;
	infra::git::log(&worktree_path, limit)
}

pub fn get_commit_diff(
	db: &DbPool,
	profile_id: &str,
	commit_hash: &str,
) -> Result<String, AppError> {
	let worktree_path = profile_worktree_path(db, profile_id)?;
	infra::git::show(&worktree_path, commit_hash)
}

pub fn get_binary_preview(
	db: &DbPool,
	profile_id: &str,
	cache_root: &Path,
	path: &str,
	source: &str,
	commit_hash: Option<&str>,
) -> Result<Option<GitBinaryPreview>, AppError> {
	let worktree_path = profile_worktree_path(db, profile_id)?;
	let file_path = match source {
		"working_tree" => {
			infra::git::read_worktree_file(&worktree_path, cache_root, path)?
		}
		"head" => infra::git::read_head_file(&worktree_path, cache_root, path)?,
		"commit" => {
			let commit_hash = commit_hash.ok_or_else(|| {
				AppError::GitError(
					"commit_hash is required for commit previews".into(),
				)
			})?;
			infra::git::read_commit_file(
				&worktree_path,
				cache_root,
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
				&worktree_path,
				cache_root,
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
	db: &DbPool,
	profile_id: &str,
	files: &[String],
	message: &str,
	body: Option<&str>,
) -> Result<String, AppError> {
	let worktree_path = profile_worktree_path(db, profile_id)?;
	infra::git::commit(&worktree_path, files, message, body)
}

pub fn discard_file_changes(
	db: &DbPool,
	profile_id: &str,
	paths: &[String],
) -> Result<(), AppError> {
	let worktree_path = profile_worktree_path(db, profile_id)?;
	infra::git::discard_changes(&worktree_path, paths)
}

pub fn get_ahead_count(db: &DbPool, profile_id: &str) -> Result<u32, AppError> {
	let worktree_path = profile_worktree_path(db, profile_id)?;
	Ok(infra::git::ahead_count(&worktree_path))
}

pub fn list_branches(
	db: &DbPool,
	profile_id: &str,
) -> Result<Vec<GitBranchInfo>, AppError> {
	let worktree_path = profile_worktree_path(db, profile_id)?;
	infra::git::list_branches(&worktree_path)
}

pub fn checkout_branch(
	db: &DbPool,
	profile_id: &str,
	branch: &str,
) -> Result<(), AppError> {
	let worktree_path = profile_worktree_path(db, profile_id)?;
	infra::git::checkout_branch(&worktree_path, branch)
}

pub fn push(db: &DbPool, profile_id: &str) -> Result<(), AppError> {
	let worktree_path = profile_worktree_path(db, profile_id)?;
	infra::git::push(&worktree_path)
}

fn get_pull_request_status_for_folder(
	folder: &str,
	branch_name: Option<&str>,
) -> Result<Option<GitPullRequestStatus>, AppError> {
	match branch_name
		.map(str::trim)
		.filter(|branch| !branch.is_empty())
	{
		Some(branch_name) => {
			infra::git::pull_request_status_for_branch(folder, branch_name)
		}
		None => infra::git::pull_request_status(folder),
	}
}

pub fn get_pull_request_status(
	db: &DbPool,
	profile_id: &str,
	branch_name: Option<&str>,
) -> Result<Option<GitPullRequestStatus>, AppError> {
	let worktree_path = profile_worktree_path(db, profile_id)?;
	get_pull_request_status_for_folder(&worktree_path, branch_name)
}

pub fn get_config(
	db: &DbPool,
	project_id: &str,
) -> Result<ProjectConfig, AppError> {
	let folder = project_folder(db, project_id)?;
	infra::config::load_project_config(&folder)
}

pub fn save_config(
	db: &DbPool,
	project_id: &str,
	config: &ProjectConfig,
) -> Result<(), AppError> {
	let folder = project_folder(db, project_id)?;
	infra::config::write_project_config(&folder, config)
}

pub fn get_github_avatar(
	db: &DbPool,
	project_id: &str,
) -> Result<Option<String>, AppError> {
	let folder = project_folder(db, project_id)?;
	Ok(infra::git::github_avatar_url(&folder))
}

#[cfg(test)]
mod tests {
	use std::sync::{Arc, Mutex};

	use diesel::prelude::*;
	use diesel_migrations::MigrationHarness;
	use model::profile::NewProfile;
	use model::project::NewProject;

	use super::*;

	fn setup_db() -> DbPool {
		let mut conn =
			SqliteConnection::establish(":memory:").expect("in-memory db");
		conn.run_pending_migrations(infra::db::MIGRATIONS)
			.expect("run migrations");

		diesel::insert_into(model::schema::projects::table)
			.values(&NewProject {
				id: "proj-1",
				name: "Project",
				folder: "/repo",
				group_id: None,
				sort_order: 1000,
			})
			.execute(&mut conn)
			.expect("insert project");

		diesel::insert_into(model::schema::profiles::table)
			.values(&NewProfile {
				id: "profile-1",
				project_id: "proj-1",
				branch_name: "main",
				worktree_path: "/repo/worktree",
				is_default: true,
			})
			.execute(&mut conn)
			.expect("insert profile");

		Arc::new(Mutex::new(conn))
	}

	#[test]
	fn profile_worktree_path_reads_only_the_needed_field() {
		let db = setup_db();

		let worktree = profile_worktree_path(&db, "profile-1").unwrap();

		assert_eq!(worktree, "/repo/worktree");
	}

	#[test]
	fn project_folder_reads_only_the_needed_field() {
		let db = setup_db();

		let folder = project_folder(&db, "proj-1").unwrap();

		assert_eq!(folder, "/repo");
	}

	#[test]
	fn profile_worktree_path_returns_not_found_for_missing_profile() {
		let db = setup_db();

		let result = profile_worktree_path(&db, "missing-profile");

		assert!(matches!(result, Err(AppError::NotFound(_))));
	}

	#[test]
	fn project_folder_returns_not_found_for_missing_project() {
		let db = setup_db();

		let result = project_folder(&db, "missing-project");

		assert!(matches!(result, Err(AppError::NotFound(_))));
	}
}
