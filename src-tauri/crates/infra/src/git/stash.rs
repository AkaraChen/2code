//! Phase 4: stash list / push / pop / apply / drop.
//!
//! Uses `git stash list --format=...` for listing, then plain
//! `git stash push|pop|apply|drop` for mutations.

use std::process::Command;

use model::error::AppError;
use model::project::StashEntry;

const FIELD_SEP: &str = "\x1e";
const RECORD_SEP: &str = "\x1f";

pub fn stash_list(folder: &str) -> Result<Vec<StashEntry>, AppError> {
	let format = format!(
		concat!("%gd", "{f}", "%H", "{f}", "%s", "{f}", "%cI", "{r}"),
		f = FIELD_SEP,
		r = RECORD_SEP,
	);
	let output = Command::new("git")
		.args(["stash", "list", &format!("--format={format}")])
		.current_dir(folder)
		.output()?;
	if !output.status.success() {
		return Err(AppError::GitError(
			String::from_utf8_lossy(&output.stderr).trim().to_string(),
		));
	}

	let stdout = String::from_utf8_lossy(&output.stdout);
	let mut out = Vec::new();
	for record in stdout.split(RECORD_SEP) {
		let record = record.trim_start_matches('\n');
		if record.is_empty() {
			continue;
		}
		let mut fields = record.split(FIELD_SEP);
		let ref_name = fields.next().unwrap_or("").to_string();
		let hash = fields.next().unwrap_or("").to_string();
		let message = fields.next().unwrap_or("").to_string();
		let date = fields.next().unwrap_or("").to_string();
		if ref_name.is_empty() {
			continue;
		}
		out.push(StashEntry {
			ref_name,
			hash,
			message,
			date,
		});
	}
	Ok(out)
}

/// `git stash push [-u] [-m <message>]`. Returns Ok(true) when something
/// was stashed; Ok(false) when there were no changes (git's "No local
/// changes to save").
pub fn stash_push(
	folder: &str,
	message: Option<&str>,
	include_untracked: bool,
) -> Result<bool, AppError> {
	let mut args: Vec<String> = vec!["stash".into(), "push".into()];
	if include_untracked {
		args.push("-u".into());
	}
	if let Some(m) = message.map(str::trim).filter(|s| !s.is_empty()) {
		args.push("-m".into());
		args.push(m.to_string());
	}

	let output = Command::new("git")
		.args(&args)
		.current_dir(folder)
		.output()?;
	if !output.status.success() {
		let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
		// "No local changes to save" surfaces as a non-zero exit on some
		// git versions, success on others. Either way, treat as Ok(false).
		if stderr.contains("No local changes to save") {
			return Ok(false);
		}
		return Err(AppError::GitError(stderr));
	}

	let stdout = String::from_utf8_lossy(&output.stdout);
	if stdout.contains("No local changes to save") {
		return Ok(false);
	}
	Ok(true)
}

pub fn stash_pop(folder: &str, ref_name: &str) -> Result<(), AppError> {
	stash_op(folder, "pop", ref_name)
}

pub fn stash_apply(folder: &str, ref_name: &str) -> Result<(), AppError> {
	stash_op(folder, "apply", ref_name)
}

pub fn stash_drop(folder: &str, ref_name: &str) -> Result<(), AppError> {
	stash_op(folder, "drop", ref_name)
}

fn stash_op(
	folder: &str,
	subcmd: &str,
	ref_name: &str,
) -> Result<(), AppError> {
	validate_stash_ref(ref_name)?;
	let output = Command::new("git")
		.args(["stash", subcmd, ref_name])
		.current_dir(folder)
		.output()?;
	if !output.status.success() {
		return Err(AppError::GitError(
			String::from_utf8_lossy(&output.stderr).trim().to_string(),
		));
	}
	Ok(())
}

/// Stash refs are always of the form `stash@{N}`. Validate strictly so the
/// caller can't smuggle in arbitrary args.
fn validate_stash_ref(s: &str) -> Result<(), AppError> {
	let trimmed = s.trim();
	if trimmed.is_empty() {
		return Err(AppError::GitError("stash ref cannot be empty".into()));
	}
	if !trimmed.starts_with("stash@{") || !trimmed.ends_with('}') {
		return Err(AppError::GitError(
			"stash ref must look like stash@{N}".into(),
		));
	}
	let inner = &trimmed["stash@{".len()..trimmed.len() - 1];
	if inner.is_empty() || !inner.chars().all(|c| c.is_ascii_digit()) {
		return Err(AppError::GitError(
			"stash ref index must be a number".into(),
		));
	}
	Ok(())
}

#[cfg(test)]
mod tests {
	use super::*;
	use std::process::Command as Cmd;
	use tempfile::TempDir;

	fn init_repo() -> TempDir {
		let dir = TempDir::new().unwrap();
		Cmd::new("git").arg("init").current_dir(dir.path()).output().unwrap();
		Cmd::new("git")
			.args(["config", "user.email", "t@t.com"])
			.current_dir(dir.path())
			.output()
			.unwrap();
		Cmd::new("git")
			.args(["config", "user.name", "T"])
			.current_dir(dir.path())
			.output()
			.unwrap();
		std::fs::write(dir.path().join("a.txt"), "alpha\n").unwrap();
		Cmd::new("git").args(["add", "a.txt"]).current_dir(dir.path()).output().unwrap();
		Cmd::new("git").args(["commit", "-m", "init"]).current_dir(dir.path()).output().unwrap();
		dir
	}

	#[test]
	fn validate_rejects_garbage_refs() {
		assert!(validate_stash_ref("--rf").is_err());
		assert!(validate_stash_ref("").is_err());
		assert!(validate_stash_ref("stash@{abc}").is_err());
		assert!(validate_stash_ref("stash@{}").is_err());
		assert!(validate_stash_ref("stash@{0}").is_ok());
		assert!(validate_stash_ref("stash@{12}").is_ok());
	}

	#[test]
	fn list_returns_empty_when_no_stashes() {
		let dir = init_repo();
		let stashes = stash_list(&dir.path().to_string_lossy()).unwrap();
		assert!(stashes.is_empty());
	}

	#[test]
	fn push_then_list_then_pop() {
		let dir = init_repo();
		let folder = dir.path().to_string_lossy().to_string();

		// Make a change so push has something to stash.
		std::fs::write(dir.path().join("a.txt"), "alpha modified\n").unwrap();
		let did_push = stash_push(&folder, Some("WIP test"), false).unwrap();
		assert!(did_push);

		let stashes = stash_list(&folder).unwrap();
		assert_eq!(stashes.len(), 1);
		assert_eq!(stashes[0].ref_name, "stash@{0}");
		assert!(stashes[0].message.contains("WIP test"));

		// Pop restores and removes the stash.
		stash_pop(&folder, "stash@{0}").unwrap();
		let after = stash_list(&folder).unwrap();
		assert!(after.is_empty());
		assert_eq!(
			std::fs::read_to_string(dir.path().join("a.txt")).unwrap(),
			"alpha modified\n",
		);
	}

	#[test]
	fn push_returns_false_when_no_changes() {
		let dir = init_repo();
		let folder = dir.path().to_string_lossy().to_string();
		let did = stash_push(&folder, Some("nothing"), false).unwrap();
		assert!(!did);
	}

	#[test]
	fn drop_removes_stash_without_applying() {
		let dir = init_repo();
		let folder = dir.path().to_string_lossy().to_string();
		std::fs::write(dir.path().join("a.txt"), "modified\n").unwrap();
		stash_push(&folder, None, false).unwrap();

		// Worktree should be clean again after stash push.
		assert_eq!(
			std::fs::read_to_string(dir.path().join("a.txt")).unwrap(),
			"alpha\n",
		);

		stash_drop(&folder, "stash@{0}").unwrap();
		let after = stash_list(&folder).unwrap();
		assert!(after.is_empty());
		// Drop should NOT restore the changes.
		assert_eq!(
			std::fs::read_to_string(dir.path().join("a.txt")).unwrap(),
			"alpha\n",
		);
	}

	#[test]
	fn apply_restores_without_dropping() {
		let dir = init_repo();
		let folder = dir.path().to_string_lossy().to_string();
		std::fs::write(dir.path().join("a.txt"), "modified\n").unwrap();
		stash_push(&folder, None, false).unwrap();
		stash_apply(&folder, "stash@{0}").unwrap();

		// File restored, stash kept.
		assert_eq!(
			std::fs::read_to_string(dir.path().join("a.txt")).unwrap(),
			"modified\n",
		);
		let after = stash_list(&folder).unwrap();
		assert_eq!(after.len(), 1);
	}

	#[test]
	fn push_with_untracked_picks_up_untracked_files() {
		let dir = init_repo();
		let folder = dir.path().to_string_lossy().to_string();
		std::fs::write(dir.path().join("new.txt"), "untracked\n").unwrap();

		// Without -u, untracked file isn't stashed → no changes to save.
		let did = stash_push(&folder, None, false).unwrap();
		assert!(!did);

		// With -u, it stashes the untracked file.
		let did = stash_push(&folder, None, true).unwrap();
		assert!(did);
		assert!(!dir.path().join("new.txt").exists());
		let after = stash_list(&folder).unwrap();
		assert_eq!(after.len(), 1);
	}
}
