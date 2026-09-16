use tauri::State;

use infra::db::DbPool;
use model::error::AppError;
use model::profile::{Profile, ProfileDeleteCheck};
use service::runtime::RuntimeHandle;

#[tauri::command]
#[tracing::instrument(skip_all)]
pub async fn create_profile(
	project_id: String,
	branch_name: String,
	default_worktree_dir: Option<String>,
	runtime: State<'_, RuntimeHandle>,
	state: State<'_, DbPool>,
) -> Result<Profile, AppError> {
	let runtime = runtime.inner().clone();
	let db = state.inner().clone();
	super::run_blocking(move || {
		service::profile::create_with_runtime(
			&runtime,
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
	runtime: State<'_, RuntimeHandle>,
	state: State<'_, DbPool>,
) -> Result<(), AppError> {
	let runtime = runtime.inner().clone();
	let db = state.inner().clone();
	super::run_blocking(move || {
		service::profile::delete_with_runtime(&runtime, &db, &id)
	})
	.await
}

#[tauri::command]
#[tracing::instrument(skip_all)]
pub async fn get_profile_delete_check(
	id: String,
	runtime: State<'_, RuntimeHandle>,
	state: State<'_, DbPool>,
) -> Result<ProfileDeleteCheck, AppError> {
	let runtime = runtime.inner().clone();
	let db = state.inner().clone();
	super::run_blocking(move || {
		service::profile::delete_check(&runtime, &db, &id)
	})
	.await
}

#[tauri::command]
#[tracing::instrument(skip_all)]
pub async fn update_profile_notes(
	id: String,
	notes: String,
	runtime: State<'_, RuntimeHandle>,
	state: State<'_, DbPool>,
) -> Result<Profile, AppError> {
	let runtime = runtime.inner().clone();
	let db = state.inner().clone();
	super::run_blocking(move || {
		service::profile::update_notes_with_runtime(&runtime, &db, &id, &notes)
	})
	.await
}

#[cfg(test)]
mod tests {
	use model::project::GitDiffStats;

	fn add_diff_stats(
		left: &GitDiffStats,
		right: &GitDiffStats,
	) -> GitDiffStats {
		GitDiffStats {
			files_changed: left.files_changed + right.files_changed,
			insertions: left.insertions + right.insertions,
			deletions: left.deletions + right.deletions,
		}
	}

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
