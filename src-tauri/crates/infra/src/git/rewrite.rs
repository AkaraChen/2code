//! Phase 2.5 history rewrite engine.
//!
//! Drives `git rebase -i <base>` programmatically by injecting a custom
//! todo file via GIT_SEQUENCE_EDITOR. For Reword/SetIdentity rows the
//! rebase pauses on `edit`; we run `git commit --amend` with the right
//! message + author env, then `git rebase --continue`.
//!
//! Powers all four user-facing rewrite operations:
//!   - Edit message       → one Reword
//!   - Squash N commits   → N-1 Squash + 1 Reword on the target
//!   - Bulk rewrite ident → N SetIdentity rows
//!   - Drop a commit      → one Drop
//!
//! Identity overrides use git's standard env vars (GIT_AUTHOR_*,
//! GIT_COMMITTER_*) on `git commit --amend`. For Reword on plain history
//! (no identity change) we fall back to `--no-edit -m <msg>`.

use std::path::Path;
use std::process::Command;

use model::error::AppError;
use model::rewrite::{CommitAction, RewritePlan, RewriteOutcome};

/// Top-level entry point. Validates the plan, optionally creates a backup
/// branch, then runs the rebase.
pub fn rewrite_commits(
	folder: &str,
	plan: &RewritePlan,
) -> Result<RewriteOutcome, AppError> {
	if plan.actions.is_empty() {
		return Err(AppError::GitError("rewrite plan is empty".into()));
	}

	// Backup branch first — cheap insurance.
	let backup_branch = if plan.create_backup_branch {
		Some(create_backup_branch(folder)?)
	} else {
		None
	};

	let force_push_required = compute_force_push_required(folder, plan).ok().unwrap_or(false);

	// Build the todo as plain text. GIT_SEQUENCE_EDITOR will overwrite the
	// rebase's auto-generated todo with this content.
	let todo_text = build_todo_text(plan);

	// Stage the todo file and edit-helper script in a temp dir so we can
	// inject them via env vars.
	let temp = tempfile::tempdir().map_err(|e| AppError::GitError(format!(
		"rewrite: tempdir: {e}"
	)))?;
	let todo_path = temp.path().join("rebase-todo");
	std::fs::write(&todo_path, &todo_text)?;

	let editor_script = build_sequence_editor_script(&todo_path)?;
	let editor_path = temp.path().join("seq-editor.sh");
	std::fs::write(&editor_path, editor_script)?;
	make_executable(&editor_path)?;

	// Kick off the rebase. We pass --no-verify to skip pre-commit hooks for
	// in-flight amends; the user already approved the rewrite via the dialog.
	let mut cmd = Command::new("git");
	cmd.args([
		"rebase",
		"-i",
		"--committer-date-is-author-date",
		&plan.base,
	])
	.current_dir(folder)
	.env("GIT_SEQUENCE_EDITOR", &editor_path)
	// Block git's interactive editor for any reword-prompt that slips
	// through (we handle reword via --amend ourselves below).
	.env("GIT_EDITOR", "true");

	let initial = cmd.output()?;
	// Rebase may exit non-zero when it pauses for our `edit` markers.
	// Walk the loop: while there's a paused commit (HEAD detached), run our
	// per-commit handler and continue.
	if !initial.status.success() && !is_paused(folder) {
		// Hard failure (e.g., conflict). Restore from backup if any and bail.
		let stderr = String::from_utf8_lossy(&initial.stderr).to_string();
		abort_rebase(folder);
		if let Some(b) = &backup_branch {
			let _ = restore_from_backup(folder, b);
		}
		return Err(AppError::GitError(format!(
			"rebase failed: {}",
			stderr.trim()
		)));
	}

	// Walk the rebase, handling each pause.
	loop {
		if !is_paused(folder) {
			break;
		}
		let stopped_at = current_stopped_commit(folder)?;
		let action = lookup_action(&plan.actions, &stopped_at);
		apply_pause_action(folder, action)?;
		let cont = Command::new("git")
			.args(["rebase", "--continue"])
			.current_dir(folder)
			.env("GIT_EDITOR", "true")
			.output()?;
		if !cont.status.success() && !is_paused(folder) {
			let stderr = String::from_utf8_lossy(&cont.stderr).to_string();
			abort_rebase(folder);
			if let Some(b) = &backup_branch {
				let _ = restore_from_backup(folder, b);
			}
			return Err(AppError::GitError(format!(
				"rebase continue failed: {}",
				stderr.trim()
			)));
		}
	}

	// Get the new HEAD.
	let head = Command::new("git")
		.args(["rev-parse", "HEAD"])
		.current_dir(folder)
		.output()?;
	let new_head = String::from_utf8_lossy(&head.stdout).trim().to_string();

	Ok(RewriteOutcome {
		new_head,
		backup_branch,
		force_push_required,
	})
}

/// Heuristic pre-flight: is the oldest affected commit at or behind the
/// upstream tracking branch? If so the rewrite will need a force push.
/// Returns `Ok(false)` for branches without an upstream — the user can
/// always force push manually.
pub fn compute_force_push_required(
	folder: &str,
	plan: &RewritePlan,
) -> Result<bool, AppError> {
	let oldest = plan
		.actions
		.iter()
		.find(|(_, a)| !matches!(a, CommitAction::Keep))
		.map(|(h, _)| h.clone())
		.unwrap_or_default();
	if oldest.is_empty() {
		return Ok(false);
	}

	// `git merge-base --is-ancestor <oldest> @{u}` — if oldest is an
	// ancestor of upstream, the rewrite would need to force push. If there
	// is no upstream (exit code 128), no force push needed (we won't push).
	let output = Command::new("git")
		.args([
			"merge-base",
			"--is-ancestor",
			&oldest,
			"@{u}",
		])
		.current_dir(folder)
		.output()?;
	if !output.status.success() && output.status.code() == Some(128) {
		return Ok(false);
	}
	Ok(output.status.success())
}

fn is_paused(folder: &str) -> bool {
	// Rebase leaves .git/rebase-merge or .git/rebase-apply behind while paused.
	let out = Command::new("git")
		.args(["rev-parse", "--git-dir"])
		.current_dir(folder)
		.output();
	let Ok(out) = out else { return false };
	if !out.status.success() {
		return false;
	}
	let git_dir = String::from_utf8_lossy(&out.stdout).trim().to_string();
	let base = Path::new(folder).join(&git_dir);
	base.join("rebase-merge").exists() || base.join("rebase-apply").exists()
}

fn current_stopped_commit(folder: &str) -> Result<String, AppError> {
	let out = Command::new("git")
		.args(["rev-parse", "HEAD"])
		.current_dir(folder)
		.output()?;
	if !out.status.success() {
		return Err(AppError::GitError(
			"rewrite: cannot read HEAD during rebase pause".into(),
		));
	}
	Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

fn lookup_action<'a>(
	actions: &'a [(String, CommitAction)],
	full_hash: &str,
) -> &'a CommitAction {
	// We pause AFTER the cherry-pick, so HEAD is the new commit. We can't
	// directly match by hash. Instead we match by position in the plan that
	// has Reword/SetIdentity and hasn't been handled yet — but that requires
	// state. A simpler approximation: scan the original plan in order for
	// the first Reword/SetIdentity that hasn't been seen via a marker file.
	// Since this is a marker-based search, we use a side channel: record
	// applied actions in .git/rewrite-applied.
	//
	// For now, fall back to linear scan: find the first non-Keep, non-Squash,
	// non-Fixup, non-Drop action and treat that as the next pending one. The
	// caller (apply_pause_action) marks via incrementing a counter file.
	let _ = full_hash;
	let counter_path = std::env::temp_dir().join("2code-rewrite-counter");
	let cur: usize = std::fs::read_to_string(&counter_path)
		.ok()
		.and_then(|s| s.trim().parse().ok())
		.unwrap_or(0);

	let mut i = 0usize;
	for (_, action) in actions {
		if matches!(
			action,
			CommitAction::Reword { .. } | CommitAction::SetIdentity { .. }
		) {
			if i == cur {
				let _ = std::fs::write(&counter_path, (cur + 1).to_string());
				return action;
			}
			i += 1;
		}
	}
	&CommitAction::Keep
}

fn apply_pause_action(
	folder: &str,
	action: &CommitAction,
) -> Result<(), AppError> {
	match action {
		CommitAction::Reword { message } => {
			let out = Command::new("git")
				.args(["commit", "--amend", "-m", message])
				.current_dir(folder)
				.output()?;
			if !out.status.success() {
				return Err(AppError::GitError(format!(
					"reword amend failed: {}",
					String::from_utf8_lossy(&out.stderr).trim()
				)));
			}
			Ok(())
		}
		CommitAction::SetIdentity { author, committer } => {
			let mut cmd = Command::new("git");
			cmd.args(["commit", "--amend", "--no-edit"])
				.current_dir(folder);
			if let Some(a) = author {
				// `--author` is the only way to actually rewrite the author
				// field; the env vars alone don't override on --amend unless
				// you also pass --reset-author (which then uses the
				// committer env). Pass --author for explicitness.
				let author_str = format!("{} <{}>", a.name, a.email);
				cmd.arg(format!("--author={author_str}"));
				cmd.env("GIT_AUTHOR_NAME", &a.name)
					.env("GIT_AUTHOR_EMAIL", &a.email);
			}
			if let Some(c) = committer {
				cmd.env("GIT_COMMITTER_NAME", &c.name)
					.env("GIT_COMMITTER_EMAIL", &c.email);
			}
			let out = cmd.output()?;
			if !out.status.success() {
				return Err(AppError::GitError(format!(
					"identity amend failed: {}",
					String::from_utf8_lossy(&out.stderr).trim()
				)));
			}
			Ok(())
		}
		_ => Ok(()),
	}
}

fn build_todo_text(plan: &RewritePlan) -> String {
	let mut out = String::new();
	for (hash, action) in &plan.actions {
		let keyword = match action {
			CommitAction::Keep => "pick",
			CommitAction::Reword { .. } => "edit",
			CommitAction::Squash => "squash",
			CommitAction::Fixup => "fixup",
			CommitAction::SetIdentity { .. } => "edit",
			CommitAction::Drop => "drop",
		};
		out.push_str(&format!("{keyword} {hash}\n"));
	}
	out
}

fn build_sequence_editor_script(todo_path: &Path) -> Result<String, AppError> {
	// The editor script is invoked by git as `<editor> <path-to-rebase-todo>`.
	// We just overwrite the destination with our pre-built todo.
	let todo_str = todo_path.to_string_lossy();
	Ok(format!("#!/bin/sh\ncp \"{todo_str}\" \"$1\"\n"))
}

#[cfg(unix)]
fn make_executable(path: &Path) -> Result<(), AppError> {
	use std::os::unix::fs::PermissionsExt;
	let mut perms = std::fs::metadata(path)?.permissions();
	perms.set_mode(0o755);
	std::fs::set_permissions(path, perms)?;
	Ok(())
}

#[cfg(not(unix))]
fn make_executable(_path: &Path) -> Result<(), AppError> {
	Ok(())
}

fn create_backup_branch(folder: &str) -> Result<String, AppError> {
	use std::time::{SystemTime, UNIX_EPOCH};
	let ts = SystemTime::now()
		.duration_since(UNIX_EPOCH)
		.map(|d| d.as_secs())
		.unwrap_or(0);
	// Get current branch name; if detached, fall back to "HEAD".
	let cur = Command::new("git")
		.args(["rev-parse", "--abbrev-ref", "HEAD"])
		.current_dir(folder)
		.output()?;
	let branch = String::from_utf8_lossy(&cur.stdout).trim().to_string();
	let branch = if branch.is_empty() || branch == "HEAD" {
		"HEAD".to_string()
	} else {
		branch
	};
	let backup = format!("{branch}-backup-{ts}");
	let out = Command::new("git")
		.args(["branch", &backup])
		.current_dir(folder)
		.output()?;
	if !out.status.success() {
		return Err(AppError::GitError(format!(
			"backup branch create failed: {}",
			String::from_utf8_lossy(&out.stderr).trim()
		)));
	}
	Ok(backup)
}

fn restore_from_backup(folder: &str, backup: &str) -> Result<(), AppError> {
	let out = Command::new("git")
		.args(["reset", "--hard", backup])
		.current_dir(folder)
		.output()?;
	if !out.status.success() {
		return Err(AppError::GitError(
			"backup restore failed".into(),
		));
	}
	Ok(())
}

fn abort_rebase(folder: &str) {
	let _ = Command::new("git")
		.args(["rebase", "--abort"])
		.current_dir(folder)
		.output();
	// Reset the counter file so the next rewrite starts fresh.
	let counter_path = std::env::temp_dir().join("2code-rewrite-counter");
	let _ = std::fs::remove_file(counter_path);
}

/// Helper for the simple HEAD-amend path used by `EditMessageDialog` — way
/// faster than rebase since there are no descendants to rewrite. Use this
/// when the target commit IS the current HEAD.
pub fn amend_head_message(folder: &str, message: &str) -> Result<String, AppError> {
	let out = Command::new("git")
		.args(["commit", "--amend", "-m", message])
		.current_dir(folder)
		.env("GIT_EDITOR", "true")
		.output()?;
	if !out.status.success() {
		return Err(AppError::GitError(format!(
			"amend failed: {}",
			String::from_utf8_lossy(&out.stderr).trim()
		)));
	}
	let head = Command::new("git")
		.args(["rev-parse", "HEAD"])
		.current_dir(folder)
		.output()?;
	Ok(String::from_utf8_lossy(&head.stdout).trim().to_string())
}

/// Reset the per-process counter that lookup_action uses to find the next
/// pending Reword/SetIdentity action. Call before each rewrite so multiple
/// rewrites in the same run don't see stale state.
fn reset_counter() {
	let path = std::env::temp_dir().join("2code-rewrite-counter");
	let _ = std::fs::remove_file(path);
}

/// Top-level wrapper that always resets the counter first.
pub fn rewrite_commits_safe(
	folder: &str,
	plan: &RewritePlan,
) -> Result<RewriteOutcome, AppError> {
	reset_counter();
	let result = rewrite_commits(folder, plan);
	reset_counter();
	result
}

#[cfg(test)]
mod tests {
	use super::*;
	use model::rewrite::Identity;
	use std::process::Command as Cmd;
	use tempfile::TempDir;

	fn init_repo() -> TempDir {
		let dir = TempDir::new().expect("tempdir");
		Cmd::new("git").arg("init").current_dir(dir.path()).output().unwrap();
		Cmd::new("git")
			.args(["config", "user.email", "test@test.com"])
			.current_dir(dir.path())
			.output()
			.unwrap();
		Cmd::new("git")
			.args(["config", "user.name", "Test"])
			.current_dir(dir.path())
			.output()
			.unwrap();
		dir
	}

	fn add_commit(dir: &Path, file: &str, msg: &str) -> String {
		std::fs::write(dir.join(file), file).unwrap();
		Cmd::new("git")
			.args(["add", file])
			.current_dir(dir)
			.output()
			.unwrap();
		Cmd::new("git")
			.args(["commit", "-m", msg])
			.current_dir(dir)
			.output()
			.unwrap();
		let out = Cmd::new("git")
			.args(["rev-parse", "HEAD"])
			.current_dir(dir)
			.output()
			.unwrap();
		String::from_utf8_lossy(&out.stdout).trim().to_string()
	}

	fn last_message(dir: &Path) -> String {
		let out = Cmd::new("git")
			.args(["log", "-1", "--pretty=%s"])
			.current_dir(dir)
			.output()
			.unwrap();
		String::from_utf8_lossy(&out.stdout).trim().to_string()
	}

	#[test]
	fn amend_head_message_replaces_subject() {
		let dir = init_repo();
		add_commit(dir.path(), "a.txt", "old subject");
		let folder = dir.path().to_string_lossy().to_string();
		amend_head_message(&folder, "new subject").unwrap();
		assert_eq!(last_message(dir.path()), "new subject");
	}

	#[test]
	fn build_todo_text_maps_actions_to_keywords() {
		let plan = RewritePlan {
			base: "abc".into(),
			actions: vec![
				("h1".into(), CommitAction::Keep),
				("h2".into(), CommitAction::Reword { message: "x".into() }),
				("h3".into(), CommitAction::Squash),
				("h4".into(), CommitAction::Fixup),
				("h5".into(), CommitAction::Drop),
				(
					"h6".into(),
					CommitAction::SetIdentity {
						author: Some(Identity {
							name: "A".into(),
							email: "a@a".into(),
						}),
						committer: None,
					},
				),
			],
			create_backup_branch: false,
		};
		let todo = build_todo_text(&plan);
		assert!(todo.contains("pick h1"));
		assert!(todo.contains("edit h2"));
		assert!(todo.contains("squash h3"));
		assert!(todo.contains("fixup h4"));
		assert!(todo.contains("drop h5"));
		assert!(todo.contains("edit h6"));
	}

	#[test]
	fn rewrite_reword_single_commit_in_history() {
		let dir = init_repo();
		let h1 = add_commit(dir.path(), "a.txt", "first");
		let h2 = add_commit(dir.path(), "b.txt", "old subject");
		let h3 = add_commit(dir.path(), "c.txt", "third");

		let plan = RewritePlan {
			base: h1.clone(),
			actions: vec![
				(
					h2.clone(),
					CommitAction::Reword {
						message: "new subject".into(),
					},
				),
				(h3.clone(), CommitAction::Keep),
			],
			create_backup_branch: false,
		};
		let folder = dir.path().to_string_lossy().to_string();
		let out = rewrite_commits_safe(&folder, &plan).expect("rewrite");
		assert!(!out.new_head.is_empty());

		// Walk the log and confirm the reworded commit shows up with new msg.
		let log = Cmd::new("git")
			.args(["log", "--pretty=%s"])
			.current_dir(dir.path())
			.output()
			.unwrap();
		let log = String::from_utf8_lossy(&log.stdout);
		assert!(log.contains("new subject"));
		assert!(!log.contains("old subject"));
		// HEAD subject should still be "third" (the descendant unchanged).
		assert_eq!(last_message(dir.path()), "third");
	}

	#[test]
	fn rewrite_set_identity_updates_author() {
		let dir = init_repo();
		let h1 = add_commit(dir.path(), "a.txt", "first");
		let _h2 = add_commit(dir.path(), "b.txt", "second");

		let plan = RewritePlan {
			base: h1.clone(),
			actions: vec![(
				_h2.clone(),
				CommitAction::SetIdentity {
					author: Some(Identity {
						name: "New Author".into(),
						email: "new@author.com".into(),
					}),
					committer: None,
				},
			)],
			create_backup_branch: false,
		};
		let folder = dir.path().to_string_lossy().to_string();
		rewrite_commits_safe(&folder, &plan).expect("rewrite");

		let out = Cmd::new("git")
			.args(["log", "-1", "--pretty=%an <%ae>"])
			.current_dir(dir.path())
			.output()
			.unwrap();
		let line = String::from_utf8_lossy(&out.stdout);
		assert!(
			line.contains("New Author") && line.contains("new@author.com"),
			"author was not updated: {line}"
		);
	}

	#[test]
	fn rewrite_with_backup_creates_branch() {
		let dir = init_repo();
		let h1 = add_commit(dir.path(), "a.txt", "first");
		let h2 = add_commit(dir.path(), "b.txt", "old");

		let plan = RewritePlan {
			base: h1.clone(),
			actions: vec![(
				h2.clone(),
				CommitAction::Reword {
					message: "new".into(),
				},
			)],
			create_backup_branch: true,
		};
		let folder = dir.path().to_string_lossy().to_string();
		let out = rewrite_commits_safe(&folder, &plan).expect("rewrite");
		assert!(out.backup_branch.is_some(), "expected backup branch");
		let branches = Cmd::new("git")
			.args(["branch", "--list"])
			.current_dir(dir.path())
			.output()
			.unwrap();
		let listing = String::from_utf8_lossy(&branches.stdout);
		assert!(
			listing.contains("backup-"),
			"backup branch not in list: {listing}"
		);
	}

	#[test]
	fn rewrite_empty_plan_errors() {
		let dir = init_repo();
		let folder = dir.path().to_string_lossy().to_string();
		let plan = RewritePlan {
			base: "HEAD".into(),
			actions: vec![],
			create_backup_branch: false,
		};
		let result = rewrite_commits_safe(&folder, &plan);
		assert!(result.is_err());
	}

	#[test]
	fn rewrite_drop_removes_commit() {
		let dir = init_repo();
		let h1 = add_commit(dir.path(), "a.txt", "first");
		let h2 = add_commit(dir.path(), "b.txt", "drop me");
		let _h3 = add_commit(dir.path(), "c.txt", "third");

		let plan = RewritePlan {
			base: h1.clone(),
			actions: vec![
				(h2.clone(), CommitAction::Drop),
				(_h3.clone(), CommitAction::Keep),
			],
			create_backup_branch: false,
		};
		let folder = dir.path().to_string_lossy().to_string();
		rewrite_commits_safe(&folder, &plan).expect("rewrite");

		let log = Cmd::new("git")
			.args(["log", "--pretty=%s"])
			.current_dir(dir.path())
			.output()
			.unwrap();
		let log = String::from_utf8_lossy(&log.stdout);
		assert!(!log.contains("drop me"), "dropped commit still present");
		assert!(log.contains("third"));
		assert!(log.contains("first"));
	}

	#[test]
	fn rewrite_squash_combines_into_previous() {
		let dir = init_repo();
		let h1 = add_commit(dir.path(), "a.txt", "base");
		let h2 = add_commit(dir.path(), "b.txt", "feat: target");
		let h3 = add_commit(dir.path(), "c.txt", "wip 1");
		let h4 = add_commit(dir.path(), "d.txt", "wip 2");

		// Squash h3 + h4 into h2, with a final reword on h2's combined commit.
		let plan = RewritePlan {
			base: h1.clone(),
			actions: vec![
				(
					h2.clone(),
					CommitAction::Reword {
						message: "feat: target (squashed)".into(),
					},
				),
				(h3.clone(), CommitAction::Fixup),
				(h4.clone(), CommitAction::Fixup),
			],
			create_backup_branch: false,
		};
		let folder = dir.path().to_string_lossy().to_string();
		rewrite_commits_safe(&folder, &plan).expect("rewrite");

		let log = Cmd::new("git")
			.args(["log", "--pretty=%s"])
			.current_dir(dir.path())
			.output()
			.unwrap();
		let log = String::from_utf8_lossy(&log.stdout);
		// We should now have base + the squashed commit, no wip commits.
		assert!(log.contains("feat: target (squashed)"));
		assert!(!log.contains("wip 1"));
		assert!(!log.contains("wip 2"));
		assert!(log.contains("base"));
	}
}
