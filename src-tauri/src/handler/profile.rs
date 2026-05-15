use std::path::PathBuf;

use tauri::State;

use infra::db::DbPool;
use model::error::AppError;
use model::profile::{Profile, ProfileDeleteCheck};
use model::project::GitDiffStats;

fn add_diff_stats(left: &GitDiffStats, right: &GitDiffStats) -> GitDiffStats {
	GitDiffStats {
		files_changed: left.files_changed + right.files_changed,
		insertions: left.insertions + right.insertions,
		deletions: left.deletions + right.deletions,
	}
}

#[tauri::command]
pub async fn create_profile(
	project_id: String,
	branch_name: String,
	state: State<'_, DbPool>,
) -> Result<Profile, AppError> {
	let db = state.inner().clone();
	super::run_blocking(move || {
		let conn = &mut *db.lock().map_err(|_| AppError::LockError)?;
		service::profile::create(conn, &project_id, &branch_name)
	})
	.await
}

#[tauri::command]
pub async fn delete_profile(
	id: String,
	state: State<'_, DbPool>,
) -> Result<(), AppError> {
	let db = state.inner().clone();
	super::run_blocking(move || {
		let (profile, project_folder) = {
			let conn = &mut *db.lock().map_err(|_| AppError::LockError)?;
			repo::profile::delete(conn, &id)?
		};
		let worktree_path = PathBuf::from(&profile.worktree_path);

		if let Ok(cfg) = infra::config::load_project_config(&project_folder) {
			infra::config::execute_scripts(
				&cfg.teardown_script,
				&worktree_path,
			);
		}

		infra::git::worktree_remove(&project_folder, &profile.worktree_path);
		infra::git::branch_delete(&project_folder, &profile.branch_name);

		Ok(())
	})
	.await
}

#[tauri::command]
pub async fn get_profile_delete_check(
	id: String,
	state: State<'_, DbPool>,
) -> Result<ProfileDeleteCheck, AppError> {
	let db = state.inner().clone();
	super::run_blocking(move || {
		let profile = {
			let conn = &mut *db.lock().map_err(|_| AppError::LockError)?;
			repo::profile::find_by_id(conn, &id)?
		};
		let working_tree_diff = infra::git::diff_stats(&profile.worktree_path)?;
		let unpushed_commits = infra::git::branch_unique_commits(
			&profile.worktree_path,
			&profile.branch_name,
		)?;
		let unpushed_commit_diff = infra::git::commit_diff_stats(
			&profile.worktree_path,
			&unpushed_commits,
		)?;

		Ok(ProfileDeleteCheck {
			total_diff: add_diff_stats(
				&working_tree_diff,
				&unpushed_commit_diff,
			),
			working_tree_diff,
			unpushed_commit_count: unpushed_commits.len() as u32,
			unpushed_commit_diff,
		})
	})
	.await
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn add_diff_stats_sums_fields() {
		let left = GitDiffStats {
			files_changed: 2,
			insertions: 3,
			deletions: 5,
		};
		let right = GitDiffStats {
			files_changed: 7,
			insertions: 11,
			deletions: 13,
		};

		let total = add_diff_stats(&left, &right);

		assert_eq!(total.files_changed, 9);
		assert_eq!(total.insertions, 14);
		assert_eq!(total.deletions, 18);
	}

	#[test]
	fn add_diff_stats_keeps_zero_side_neutral() {
		let zero = GitDiffStats {
			files_changed: 0,
			insertions: 0,
			deletions: 0,
		};
		let diff = GitDiffStats {
			files_changed: 4,
			insertions: 8,
			deletions: 15,
		};

		let total = add_diff_stats(&zero, &diff);

		assert_eq!(total.files_changed, diff.files_changed);
		assert_eq!(total.insertions, diff.insertions);
		assert_eq!(total.deletions, diff.deletions);
	}
}
