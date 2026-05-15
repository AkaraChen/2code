use tauri::State;

use infra::db::DbPool;
use model::error::AppError;
use model::project::{
	GitBinaryPreview, GitCommit, GitDiffStats, GitPullRequestStatus, Project,
	ProjectConfig, ProjectWithProfiles,
};
use model::project_group::ProjectGroup;

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

#[tauri::command]
pub async fn create_project_from_folder(
	name: String,
	folder: String,
	state: State<'_, DbPool>,
) -> Result<Project, AppError> {
	let db = state.inner().clone();
	super::run_blocking(move || {
		let conn = &mut *db.lock().map_err(|_| AppError::LockError)?;
		service::project::create_from_folder(conn, &name, &folder)
	})
	.await
}

#[tauri::command]
pub async fn list_projects(
	state: State<'_, DbPool>,
) -> Result<Vec<ProjectWithProfiles>, AppError> {
	let db = state.inner().clone();
	super::run_blocking(move || {
		let conn = &mut *db.lock().map_err(|_| AppError::LockError)?;
		service::project::list(conn)
	})
	.await
}

#[tauri::command]
pub async fn update_project(
	id: String,
	name: Option<String>,
	folder: Option<String>,
	state: State<'_, DbPool>,
) -> Result<Project, AppError> {
	let db = state.inner().clone();
	super::run_blocking(move || {
		let conn = &mut *db.lock().map_err(|_| AppError::LockError)?;
		service::project::update(conn, &id, name, folder)
	})
	.await
}

#[tauri::command]
pub async fn get_git_branch(folder: String) -> Result<String, AppError> {
	super::run_blocking(move || service::project::get_branch(&folder)).await
}

#[tauri::command]
pub async fn get_git_diff(
	profile_id: String,
	state: State<'_, DbPool>,
) -> Result<String, AppError> {
	let db = state.inner().clone();
	super::run_blocking(move || {
		let worktree_path = profile_worktree_path(&db, &profile_id)?;
		infra::git::diff(&worktree_path)
	})
	.await
}

#[tauri::command]
pub async fn get_git_diff_stats(
	profile_id: String,
	state: State<'_, DbPool>,
) -> Result<GitDiffStats, AppError> {
	let db = state.inner().clone();
	super::run_blocking(move || {
		let worktree_path = profile_worktree_path(&db, &profile_id)?;
		infra::git::diff_stats(&worktree_path)
	})
	.await
}

#[tauri::command]
pub async fn get_git_log(
	profile_id: String,
	limit: Option<u32>,
	state: State<'_, DbPool>,
) -> Result<Vec<GitCommit>, AppError> {
	let db = state.inner().clone();
	super::run_blocking(move || {
		let worktree_path = profile_worktree_path(&db, &profile_id)?;
		infra::git::log(&worktree_path, limit.unwrap_or(50))
	})
	.await
}

#[tauri::command]
pub async fn get_commit_diff(
	profile_id: String,
	commit_hash: String,
	state: State<'_, DbPool>,
) -> Result<String, AppError> {
	let db = state.inner().clone();
	super::run_blocking(move || {
		let worktree_path = profile_worktree_path(&db, &profile_id)?;
		infra::git::show(&worktree_path, &commit_hash)
	})
	.await
}

#[tauri::command]
pub async fn get_git_binary_preview(
	profile_id: String,
	path: String,
	source: String,
	commit_hash: Option<String>,
	state: State<'_, DbPool>,
) -> Result<Option<GitBinaryPreview>, AppError> {
	let db = state.inner().clone();
	super::run_blocking(move || {
		let worktree_path = profile_worktree_path(&db, &profile_id)?;
		let file_path = match source.as_str() {
			"working_tree" => {
				infra::git::read_worktree_file(&worktree_path, &path)?
			}
			"head" => infra::git::read_head_file(&worktree_path, &path)?,
			"commit" => {
				let commit_hash = commit_hash.as_deref().ok_or_else(|| {
					AppError::GitError(
						"commit_hash is required for commit previews".into(),
					)
				})?;
				infra::git::read_commit_file(
					&worktree_path,
					commit_hash,
					&path,
				)?
			}
			"parent_commit" => {
				let commit_hash = commit_hash.as_deref().ok_or_else(|| {
					AppError::GitError(
						"commit_hash is required for parent commit previews"
							.into(),
					)
				})?;
				infra::git::read_parent_commit_file(
					&worktree_path,
					commit_hash,
					&path,
				)?
			}
			other => {
				return Err(AppError::GitError(format!(
					"Unsupported preview source: {other}"
				)));
			}
		};

		Ok(file_path.map(|file_path| GitBinaryPreview { file_path }))
	})
	.await
}

#[tauri::command]
pub async fn commit_git_changes(
	profile_id: String,
	files: Vec<String>,
	message: String,
	body: Option<String>,
	state: State<'_, DbPool>,
) -> Result<String, AppError> {
	let db = state.inner().clone();
	super::run_blocking(move || {
		let worktree_path = profile_worktree_path(&db, &profile_id)?;
		infra::git::commit(&worktree_path, &files, &message, body.as_deref())
	})
	.await
}

#[tauri::command]
pub async fn discard_git_file_changes(
	profile_id: String,
	paths: Vec<String>,
	state: State<'_, DbPool>,
) -> Result<(), AppError> {
	let db = state.inner().clone();
	super::run_blocking(move || {
		let worktree_path = profile_worktree_path(&db, &profile_id)?;
		infra::git::discard_changes(&worktree_path, &paths)
	})
	.await
}

#[tauri::command]
pub async fn get_git_ahead_count(
	profile_id: String,
	state: State<'_, DbPool>,
) -> Result<u32, AppError> {
	let db = state.inner().clone();
	super::run_blocking(move || {
		let worktree_path = profile_worktree_path(&db, &profile_id)?;
		Ok(infra::git::ahead_count(&worktree_path))
	})
	.await
}

#[tauri::command]
pub async fn git_push(
	profile_id: String,
	state: State<'_, DbPool>,
) -> Result<(), AppError> {
	let db = state.inner().clone();
	super::run_blocking(move || {
		let worktree_path = profile_worktree_path(&db, &profile_id)?;
		infra::git::push(&worktree_path)
	})
	.await
}

#[tauri::command]
pub async fn get_git_pull_request_status(
	profile_id: String,
	state: State<'_, DbPool>,
) -> Result<Option<GitPullRequestStatus>, AppError> {
	let db = state.inner().clone();
	super::run_blocking(move || {
		let worktree_path = profile_worktree_path(&db, &profile_id)?;
		service::project::get_pull_request_status_for_folder(&worktree_path)
	})
	.await
}

#[tauri::command]
pub async fn delete_project(
	id: String,
	state: State<'_, DbPool>,
) -> Result<(), AppError> {
	let db = state.inner().clone();
	super::run_blocking(move || {
		let conn = &mut *db.lock().map_err(|_| AppError::LockError)?;
		service::project::delete(conn, &id)
	})
	.await
}

#[tauri::command]
pub async fn create_project_group(
	name: String,
	state: State<'_, DbPool>,
) -> Result<ProjectGroup, AppError> {
	let db = state.inner().clone();
	super::run_blocking(move || {
		let conn = &mut *db.lock().map_err(|_| AppError::LockError)?;
		service::project::create_group(conn, &name)
	})
	.await
}

#[tauri::command]
pub async fn list_project_groups(
	state: State<'_, DbPool>,
) -> Result<Vec<ProjectGroup>, AppError> {
	let db = state.inner().clone();
	super::run_blocking(move || {
		let conn = &mut *db.lock().map_err(|_| AppError::LockError)?;
		service::project::list_groups(conn)
	})
	.await
}

#[tauri::command]
pub async fn assign_project_to_group(
	project_id: String,
	group_id: Option<String>,
	state: State<'_, DbPool>,
) -> Result<Project, AppError> {
	let db = state.inner().clone();
	super::run_blocking(move || {
		let conn = &mut *db.lock().map_err(|_| AppError::LockError)?;
		service::project::assign_to_group(conn, &project_id, group_id)
	})
	.await
}

#[tauri::command]
pub async fn get_project_config(
	project_id: String,
	state: State<'_, DbPool>,
) -> Result<ProjectConfig, AppError> {
	let db = state.inner().clone();
	super::run_blocking(move || {
		let folder = project_folder(&db, &project_id)?;
		infra::config::load_project_config(&folder)
	})
	.await
}

#[tauri::command]
pub async fn save_project_config(
	project_id: String,
	config: ProjectConfig,
	state: State<'_, DbPool>,
) -> Result<(), AppError> {
	let db = state.inner().clone();
	super::run_blocking(move || {
		let folder = project_folder(&db, &project_id)?;
		infra::config::write_project_config(&folder, &config)
	})
	.await
}

#[tauri::command]
pub async fn get_project_github_avatar(
	project_id: String,
	state: State<'_, DbPool>,
) -> Result<Option<String>, AppError> {
	let db = state.inner().clone();
	super::run_blocking(move || {
		let folder = project_folder(&db, &project_id)?;
		Ok(infra::git::github_avatar_url(&folder))
	})
	.await
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
