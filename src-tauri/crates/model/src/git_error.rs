//! Structured git error classification.
//!
//! `AppError::GitError` carries a `String` for backward compatibility with
//! existing handlers and the frontend. New code in Phase 2+ that needs to
//! react to specific failure modes (e.g., distinguish auth failure from
//! non-fast-forward push) returns `Result<T, GitError>` directly so the
//! frontend can render the right toast and call-to-action.
//!
//! `classify_stderr` heuristically maps git CLI stderr text to a
//! `GitErrorKind`. It's a best-effort classifier — git's stderr is not a
//! stable interface, so the matcher is intentionally forgiving and falls
//! back to `Other` when nothing matches.

use serde::{Deserialize, Serialize};

#[derive(
	Debug, Clone, PartialEq, Eq, Serialize, Deserialize,
)]
#[serde(rename_all = "snake_case", tag = "kind", content = "details")]
pub enum GitErrorKind {
	/// Push rejected because the remote has commits the local doesn't.
	/// Frontend can suggest "pull first" or "force push with lease".
	NonFastForward,

	/// Authentication failed — wrong creds, missing key, etc.
	AuthFailed,

	/// Operation hit a merge conflict. `paths` lists the conflicted files.
	MergeConflict { paths: Vec<String> },

	/// Working tree has uncommitted changes that block the operation.
	DirtyWorktree,

	/// HEAD is detached when the operation requires a branch.
	DetachedHead,

	/// Branch already exists (create), or doesn't exist (checkout/delete).
	BranchExists { branch: String },
	BranchNotFound { branch: String },

	/// Remote not configured.
	RemoteNotFound { remote: String },

	/// Folder is not a git repository.
	NotARepo,

	/// Anything we couldn't classify. Carries the raw stderr.
	Other(String),
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct GitError {
	pub kind: GitErrorKind,
	/// Human-readable message. For `Other` this matches the stderr.
	pub message: String,
}

impl GitError {
	pub fn new(kind: GitErrorKind, message: impl Into<String>) -> Self {
		Self {
			kind,
			message: message.into(),
		}
	}

	pub fn from_stderr(stderr: impl AsRef<str>) -> Self {
		let raw = stderr.as_ref().trim();
		Self {
			kind: classify_stderr(raw),
			message: raw.to_string(),
		}
	}
}

impl std::fmt::Display for GitError {
	fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
		f.write_str(&self.message)
	}
}

impl std::error::Error for GitError {}

/// Heuristically classify a git stderr message. Falls back to `Other` when
/// no pattern matches. Patterns are intentionally lowercase substring checks
/// so they survive minor wording changes across git versions.
pub fn classify_stderr(stderr: &str) -> GitErrorKind {
	let s = stderr.to_lowercase();

	if s.contains("not a git repository") {
		return GitErrorKind::NotARepo;
	}

	if s.contains("authentication failed")
		|| s.contains("could not read username")
		|| s.contains("permission denied (publickey)")
		|| s.contains("invalid username or password")
	{
		return GitErrorKind::AuthFailed;
	}

	if s.contains("non-fast-forward")
		|| s.contains("rejected")
			&& (s.contains("fetch first") || s.contains("non-ff"))
	{
		return GitErrorKind::NonFastForward;
	}

	if s.contains("conflict") && s.contains("merge") {
		// Best-effort: extract conflicted paths if present. Git lists them as
		// "CONFLICT (...): Merge conflict in <path>" lines.
		let paths: Vec<String> = stderr
			.lines()
			.filter_map(|line| {
				line.find("Merge conflict in ")
					.map(|i| line[i + "Merge conflict in ".len()..].trim().to_string())
			})
			.collect();
		return GitErrorKind::MergeConflict { paths };
	}

	if s.contains("uncommitted changes")
		|| s.contains("your local changes")
		|| s.contains("would be overwritten")
	{
		return GitErrorKind::DirtyWorktree;
	}

	if s.contains("detached head") || s.contains("not currently on a branch") {
		return GitErrorKind::DetachedHead;
	}

	// Branch exists: "fatal: A branch named 'foo' already exists."
	if let Some(branch) = parse_quoted_branch_after(&s, "a branch named")
		.or_else(|| parse_quoted_branch_after(&s, "branch named"))
	{
		if s.contains("already exists") {
			return GitErrorKind::BranchExists { branch };
		}
	}

	// Branch not found: "error: branch 'foo' not found." or
	// "fatal: invalid reference: foo"
	if s.contains("not found") || s.contains("invalid reference") {
		if let Some(branch) = parse_quoted_branch_after(&s, "branch")
			.or_else(|| parse_quoted_branch_after(&s, "reference:"))
		{
			return GitErrorKind::BranchNotFound { branch };
		}
	}

	// Remote not found: "fatal: 'origin' does not appear to be a git repository"
	if s.contains("does not appear to be a git repository") {
		if let Some(remote) = parse_quoted_branch_after(&s, "fatal:") {
			return GitErrorKind::RemoteNotFound { remote };
		}
	}

	GitErrorKind::Other(stderr.to_string())
}

/// Try to extract a name in single quotes that appears after `marker` in `s`.
/// Returns None if not found.
fn parse_quoted_branch_after(s: &str, marker: &str) -> Option<String> {
	let after_marker = s.find(marker)? + marker.len();
	let tail = &s[after_marker..];
	let q1 = tail.find('\'')?;
	let q2 = tail[q1 + 1..].find('\'')?;
	Some(tail[q1 + 1..q1 + 1 + q2].to_string())
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn classify_non_fast_forward() {
		let stderr = " ! [rejected]        main -> main (non-fast-forward)\nerror: failed to push some refs to 'origin'\nhint: Updates were rejected because the tip of your current branch is behind\nhint: its remote counterpart. Integrate the remote changes (e.g.\nhint: 'git pull ...') before pushing again.";
		assert_eq!(classify_stderr(stderr), GitErrorKind::NonFastForward);
	}

	#[test]
	fn classify_auth_failed_https() {
		let stderr = "fatal: Authentication failed for 'https://github.com/foo/bar.git/'";
		assert_eq!(classify_stderr(stderr), GitErrorKind::AuthFailed);
	}

	#[test]
	fn classify_auth_failed_ssh() {
		let stderr = "git@github.com: Permission denied (publickey).\nfatal: Could not read from remote repository.";
		assert_eq!(classify_stderr(stderr), GitErrorKind::AuthFailed);
	}

	#[test]
	fn classify_merge_conflict_with_paths() {
		let stderr = "Auto-merging src/foo.rs\nCONFLICT (content): Merge conflict in src/foo.rs\nCONFLICT (content): Merge conflict in src/bar.rs\nAutomatic merge failed; fix conflicts and then commit the result.";
		assert_eq!(
			classify_stderr(stderr),
			GitErrorKind::MergeConflict {
				paths: vec!["src/foo.rs".into(), "src/bar.rs".into()]
			}
		);
	}

	#[test]
	fn classify_dirty_worktree() {
		let stderr = "error: Your local changes to the following files would be overwritten by checkout:\n\tREADME.md\nPlease commit your changes or stash them before you switch branches.";
		assert_eq!(classify_stderr(stderr), GitErrorKind::DirtyWorktree);
	}

	#[test]
	fn classify_detached_head() {
		let stderr = "fatal: You are not currently on a branch.";
		assert_eq!(classify_stderr(stderr), GitErrorKind::DetachedHead);
	}

	#[test]
	fn classify_not_a_repo() {
		let stderr = "fatal: not a git repository (or any of the parent directories): .git";
		assert_eq!(classify_stderr(stderr), GitErrorKind::NotARepo);
	}

	#[test]
	fn classify_branch_exists() {
		let stderr = "fatal: A branch named 'feat/x' already exists.";
		assert_eq!(
			classify_stderr(stderr),
			GitErrorKind::BranchExists {
				branch: "feat/x".into()
			}
		);
	}

	#[test]
	fn classify_other_when_unrecognized() {
		let stderr = "fatal: unable to do something weird";
		match classify_stderr(stderr) {
			GitErrorKind::Other(s) => {
				assert_eq!(s, "fatal: unable to do something weird")
			}
			other => panic!("expected Other, got {:?}", other),
		}
	}

	#[test]
	fn from_stderr_round_trip() {
		let err =
			GitError::from_stderr(" ! [rejected]        main -> main (non-fast-forward)");
		assert_eq!(err.kind, GitErrorKind::NonFastForward);
	}

	#[test]
	fn serializes_with_kind_tag() {
		let err = GitError::new(
			GitErrorKind::BranchExists {
				branch: "x".into(),
			},
			"branch x already exists",
		);
		let json = serde_json::to_value(&err).unwrap();
		assert_eq!(json["message"], "branch x already exists");
		assert_eq!(json["kind"]["kind"], "branch_exists");
		assert_eq!(json["kind"]["details"]["branch"], "x");
	}

	#[test]
	fn serializes_unit_variant_without_details() {
		let err = GitError::new(GitErrorKind::AuthFailed, "auth failed");
		let json = serde_json::to_value(&err).unwrap();
		assert_eq!(json["kind"]["kind"], "auth_failed");
		assert_eq!(json["message"], "auth failed");
	}
}
