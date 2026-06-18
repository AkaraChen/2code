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
#[tracing::instrument(skip_all)]
pub async fn create_profile(
	project_id: String,
	branch_name: String,
	default_worktree_dir: Option<String>,
	state: State<'_, DbPool>,
) -> Result<Profile, AppError> {
	let db = state.inner().clone();
	super::run_blocking(move || {
		service::profile::create_with_db(
			&db,
			&project_id,
			&branch_name,
			default_worktree_dir.as_deref(),
		)
	})
	.await
}

#[tauri::command]
#[tracing::instrument(skip_all)]
pub async fn delete_profile(
	id: String,
	state: State<'_, DbPool>,
) -> Result<(), AppError> {
	let db = state.inner().clone();
	super::run_blocking(move || service::profile::delete_with_db(&db, &id))
		.await
}

#[tauri::command]
#[tracing::instrument(skip_all)]
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

#[tauri::command]
#[tracing::instrument(skip_all)]
pub async fn update_profile_notes(
	id: String,
	notes: String,
	state: State<'_, DbPool>,
) -> Result<Profile, AppError> {
	let db = state.inner().clone();
	super::run_blocking(move || {
		let conn = &mut *db.lock().map_err(|_| AppError::LockError)?;
		repo::profile::update_notes(conn, &id, &notes)
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
