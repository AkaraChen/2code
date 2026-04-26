//! Phase 4: detect in-progress merge / rebase / cherry-pick state, list
//! conflicted files, and continue / abort the operation.
//!
//! Detection is filesystem-based (look for `.git/MERGE_HEAD` etc.) — way
//! cheaper than running git status, and matches what git itself uses to
//! decide what `--continue` and `--abort` apply to.

use std::path::Path;
use std::process::Command;

use model::error::AppError;
use serde::{Deserialize, Serialize};

#[derive(
	Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize,
)]
#[serde(rename_all = "snake_case")]
pub enum InProgressKind {
	Merge,
	Rebase,
	CherryPick,
	Revert,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InProgressOp {
	pub kind: InProgressKind,
	/// Conflicted file paths (repo-relative). Empty when the op paused
	/// for a non-conflict reason (e.g., interactive rebase `edit` step).
	pub conflicts: Vec<String>,
}

pub fn get_in_progress_op(folder: &str) -> Option<InProgressOp> {
	let git_dir = git_dir(folder)?;

	let kind = if git_dir.join("MERGE_HEAD").exists() {
		InProgressKind::Merge
	} else if git_dir.join("rebase-merge").exists()
		|| git_dir.join("rebase-apply").exists()
	{
		InProgressKind::Rebase
	} else if git_dir.join("CHERRY_PICK_HEAD").exists() {
		InProgressKind::CherryPick
	} else if git_dir.join("REVERT_HEAD").exists() {
		InProgressKind::Revert
	} else {
		return None;
	};

	let conflicts = list_conflicts(folder).unwrap_or_default();
	Some(InProgressOp { kind, conflicts })
}

/// Run `git ls-files -u` to enumerate paths in unmerged stages. Returns a
/// deduplicated sorted list of repo-relative paths.
fn list_conflicts(folder: &str) -> Result<Vec<String>, AppError> {
	let output = Command::new("git")
		.args(["ls-files", "-u", "-z"])
		.current_dir(folder)
		.output()?;
	if !output.status.success() {
		return Err(AppError::GitError(
			String::from_utf8_lossy(&output.stderr).trim().to_string(),
		));
	}
	// Format per record: "<mode> <hash> <stage>\t<path>\0"
	let mut paths: std::collections::BTreeSet<String> =
		std::collections::BTreeSet::new();
	for record in output.stdout.split(|&b| b == 0) {
		if record.is_empty() {
			continue;
		}
		let s = String::from_utf8_lossy(record);
		if let Some(tab) = s.find('\t') {
			paths.insert(s[tab + 1..].to_string());
		}
	}
	Ok(paths.into_iter().collect())
}

/// `git <op> --continue`. Op derived from the in-progress kind.
pub fn continue_op(
	folder: &str,
	kind: InProgressKind,
) -> Result<(), AppError> {
	let subcmd = match kind {
		InProgressKind::Merge => "merge",
		InProgressKind::Rebase => "rebase",
		InProgressKind::CherryPick => "cherry-pick",
		InProgressKind::Revert => "revert",
	};
	let output = Command::new("git")
		.args([subcmd, "--continue"])
		.current_dir(folder)
		.env("GIT_EDITOR", "true") // suppress the message editor
		.output()?;
	if !output.status.success() {
		return Err(AppError::GitError(
			String::from_utf8_lossy(&output.stderr).trim().to_string(),
		));
	}
	Ok(())
}

/// Three sides of a conflicted file for the 3-way merge resolver.
/// Each side may be `None` when the file didn't exist at that stage
/// (e.g., add/add conflicts have no `base`).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConflictState {
	/// Stage 1 — common ancestor.
	pub base: Option<String>,
	/// Stage 2 — our side ("HEAD" / current branch).
	pub ours: Option<String>,
	/// Stage 3 — their side (the merging-in branch / cherry-pick / rebase).
	pub theirs: Option<String>,
	/// Working-tree contents (with conflict markers, or the user's edits).
	pub current: Option<String>,
}

pub fn get_conflict_state(
	folder: &str,
	path: &str,
) -> Result<ConflictState, AppError> {
	if path.is_empty()
		|| path.starts_with('-')
		|| path.contains('\0')
		|| path.contains('\n')
	{
		return Err(AppError::GitError("invalid path".into()));
	}

	let base = read_stage_blob(folder, 1, path);
	let ours = read_stage_blob(folder, 2, path);
	let theirs = read_stage_blob(folder, 3, path);
	let current = std::fs::read_to_string(Path::new(folder).join(path)).ok();

	Ok(ConflictState {
		base,
		ours,
		theirs,
		current,
	})
}

fn read_stage_blob(folder: &str, stage: u8, path: &str) -> Option<String> {
	// `git show :<stage>:<path>` reads the index blob at that stage.
	// Stages: 1 = base, 2 = ours, 3 = theirs.
	let spec = format!(":{stage}:{path}");
	let output = Command::new("git")
		.args(["show", &spec])
		.current_dir(folder)
		.output()
		.ok()?;
	if !output.status.success() {
		return None;
	}
	if output.stdout.contains(&0) {
		return None; // binary
	}
	Some(String::from_utf8_lossy(&output.stdout).to_string())
}

/// Mark a conflict resolved: write the resolved contents to the worktree
/// file, then `git add` so it moves to stage 0 and out of the conflict
/// list. Caller is expected to have read the user's edited result from the
/// merge resolver UI.
pub fn mark_conflict_resolved(
	folder: &str,
	path: &str,
	resolved_contents: &str,
) -> Result<(), AppError> {
	if path.is_empty()
		|| path.starts_with('-')
		|| path.contains('\0')
		|| path.contains('\n')
	{
		return Err(AppError::GitError("invalid path".into()));
	}
	let abs = Path::new(folder).join(path);
	if let Some(parent) = abs.parent() {
		std::fs::create_dir_all(parent)?;
	}
	std::fs::write(&abs, resolved_contents)?;
	let output = Command::new("git")
		.args(["add", "--", path])
		.current_dir(folder)
		.output()?;
	if !output.status.success() {
		return Err(AppError::GitError(
			String::from_utf8_lossy(&output.stderr).trim().to_string(),
		));
	}
	Ok(())
}

pub fn abort_op(folder: &str, kind: InProgressKind) -> Result<(), AppError> {
	let subcmd = match kind {
		InProgressKind::Merge => "merge",
		InProgressKind::Rebase => "rebase",
		InProgressKind::CherryPick => "cherry-pick",
		InProgressKind::Revert => "revert",
	};
	let output = Command::new("git")
		.args([subcmd, "--abort"])
		.current_dir(folder)
		.output()?;
	if !output.status.success() {
		return Err(AppError::GitError(
			String::from_utf8_lossy(&output.stderr).trim().to_string(),
		));
	}
	Ok(())
}

fn git_dir(folder: &str) -> Option<std::path::PathBuf> {
	// Resolve the gitdir robustly — works for normal repos and worktrees
	// (where .git is a file pointing at a sibling gitdir).
	let direct = Path::new(folder).join(".git");
	if direct.is_dir() {
		return Some(direct);
	}
	if direct.is_file() {
		let contents = std::fs::read_to_string(&direct).ok()?;
		for line in contents.lines() {
			if let Some(path) = line.strip_prefix("gitdir:") {
				let resolved = std::path::PathBuf::from(path.trim());
				if resolved.is_absolute() {
					return Some(resolved);
				}
				return Some(Path::new(folder).join(resolved));
			}
		}
	}
	None
}

#[cfg(test)]
mod tests {
	use super::*;
	use std::process::Command as Cmd;
	use tempfile::TempDir;

	fn init_repo() -> TempDir {
		let dir = TempDir::new().unwrap();
		Cmd::new("git").arg("init").current_dir(dir.path()).output().unwrap();
		Cmd::new("git").args(["config", "user.email", "t@t.com"]).current_dir(dir.path()).output().unwrap();
		Cmd::new("git").args(["config", "user.name", "T"]).current_dir(dir.path()).output().unwrap();
		std::fs::write(dir.path().join("a.txt"), "alpha\n").unwrap();
		Cmd::new("git").args(["add", "a.txt"]).current_dir(dir.path()).output().unwrap();
		Cmd::new("git").args(["commit", "-m", "init"]).current_dir(dir.path()).output().unwrap();
		dir
	}

	#[test]
	fn returns_none_when_clean() {
		let dir = init_repo();
		assert!(get_in_progress_op(&dir.path().to_string_lossy()).is_none());
	}

	#[test]
	fn detects_merge_with_conflicts() {
		let dir = init_repo();
		// Branch + diverging change to set up a conflict.
		Cmd::new("git").args(["checkout", "-b", "feature"]).current_dir(dir.path()).output().unwrap();
		std::fs::write(dir.path().join("a.txt"), "alpha feat\n").unwrap();
		Cmd::new("git").args(["commit", "-am", "feat change"]).current_dir(dir.path()).output().unwrap();
		Cmd::new("git").args(["checkout", "-"]).current_dir(dir.path()).output().unwrap();
		std::fs::write(dir.path().join("a.txt"), "alpha main\n").unwrap();
		Cmd::new("git").args(["commit", "-am", "main change"]).current_dir(dir.path()).output().unwrap();

		// Trigger the merge — expected to fail with a conflict.
		let _ = Cmd::new("git")
			.args(["merge", "feature", "--no-ff", "-m", "merge"])
			.current_dir(dir.path())
			.output();

		let op = get_in_progress_op(&dir.path().to_string_lossy()).unwrap();
		assert_eq!(op.kind, InProgressKind::Merge);
		assert_eq!(op.conflicts, vec!["a.txt".to_string()]);
	}

	fn setup_conflict() -> TempDir {
		let dir = init_repo();
		Cmd::new("git").args(["checkout", "-b", "feature"]).current_dir(dir.path()).output().unwrap();
		std::fs::write(dir.path().join("a.txt"), "alpha feat\n").unwrap();
		Cmd::new("git").args(["commit", "-am", "feat"]).current_dir(dir.path()).output().unwrap();
		Cmd::new("git").args(["checkout", "-"]).current_dir(dir.path()).output().unwrap();
		std::fs::write(dir.path().join("a.txt"), "alpha main\n").unwrap();
		Cmd::new("git").args(["commit", "-am", "main"]).current_dir(dir.path()).output().unwrap();
		let _ = Cmd::new("git").args(["merge", "feature", "--no-ff", "-m", "m"]).current_dir(dir.path()).output();
		dir
	}

	#[test]
	fn conflict_state_has_three_sides() {
		let dir = setup_conflict();
		let state = get_conflict_state(
			&dir.path().to_string_lossy(),
			"a.txt",
		)
		.unwrap();
		assert_eq!(state.base.as_deref(), Some("alpha\n"));
		assert_eq!(state.ours.as_deref(), Some("alpha main\n"));
		assert_eq!(state.theirs.as_deref(), Some("alpha feat\n"));
		// Working tree should have conflict markers.
		assert!(
			state.current.unwrap().contains("<<<<<<<"),
			"expected conflict markers in worktree contents",
		);
	}

	#[test]
	fn mark_resolved_writes_and_stages() {
		let dir = setup_conflict();
		mark_conflict_resolved(
			&dir.path().to_string_lossy(),
			"a.txt",
			"alpha resolved\n",
		)
		.unwrap();
		// File on disk should match the resolution.
		assert_eq!(
			std::fs::read_to_string(dir.path().join("a.txt")).unwrap(),
			"alpha resolved\n",
		);
		// Conflict should be gone.
		let op = get_in_progress_op(&dir.path().to_string_lossy()).unwrap();
		assert!(op.conflicts.is_empty());
	}

	#[test]
	fn mark_resolved_rejects_dash_paths() {
		let dir = setup_conflict();
		assert!(
			mark_conflict_resolved(
				&dir.path().to_string_lossy(),
				"-rf",
				"x"
			)
			.is_err()
		);
	}

	#[test]
	fn abort_clears_merge_state() {
		let dir = init_repo();
		Cmd::new("git").args(["checkout", "-b", "feature"]).current_dir(dir.path()).output().unwrap();
		std::fs::write(dir.path().join("a.txt"), "alpha feat\n").unwrap();
		Cmd::new("git").args(["commit", "-am", "feat"]).current_dir(dir.path()).output().unwrap();
		Cmd::new("git").args(["checkout", "-"]).current_dir(dir.path()).output().unwrap();
		std::fs::write(dir.path().join("a.txt"), "alpha main\n").unwrap();
		Cmd::new("git").args(["commit", "-am", "main"]).current_dir(dir.path()).output().unwrap();
		let _ = Cmd::new("git").args(["merge", "feature", "--no-ff", "-m", "m"]).current_dir(dir.path()).output();

		assert!(get_in_progress_op(&dir.path().to_string_lossy()).is_some());
		abort_op(
			&dir.path().to_string_lossy(),
			InProgressKind::Merge,
		)
		.unwrap();
		assert!(get_in_progress_op(&dir.path().to_string_lossy()).is_none());
	}
}
