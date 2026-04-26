//! Phase 4: branch / remote / tag listing.
//!
//! Uses `git for-each-ref` exclusively for branches and tags so we can
//! resolve everything (current head, upstream tracking, ahead/behind, last
//! commit metadata) in one call per refspec. Saves spawning git per branch
//! on a multi-branch repo.
//!
//! Format strings are NUL/RECORD-separator delimited so the parser doesn't
//! choke on subjects with spaces or quotes.

use std::process::Command;

use model::error::AppError;
use model::project::{BranchInfo, RemoteInfo, TagInfo};

const FIELD_SEP: &str = "\x1e";
const RECORD_SEP: &str = "\x1f";

/// `git checkout <branch>`. Surfaces a friendlier error when the worktree
/// has changes that would be overwritten — git's stderr is a bit cryptic.
pub fn checkout_branch(folder: &str, branch: &str) -> Result<(), AppError> {
	validate_branch_name(branch)?;
	let output = Command::new("git")
		.args(["checkout", branch])
		.current_dir(folder)
		.output()?;
	if !output.status.success() {
		let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
		return Err(AppError::GitError(stderr));
	}
	Ok(())
}

/// `git branch <name> [<start_point>]`. start_point=None creates from HEAD.
pub fn create_branch(
	folder: &str,
	name: &str,
	start_point: Option<&str>,
) -> Result<(), AppError> {
	validate_branch_name(name)?;
	let mut args: Vec<&str> = vec!["branch", name];
	if let Some(sp) = start_point {
		validate_start_point(sp)?;
		args.push(sp);
	}
	let output = Command::new("git")
		.args(&args)
		.current_dir(folder)
		.output()?;
	if !output.status.success() {
		let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
		return Err(AppError::GitError(stderr));
	}
	Ok(())
}

/// `git branch -d <name>` (or -D when force=true). Refuses to delete the
/// currently checked-out branch — git would too, but we want a clearer
/// error message.
pub fn delete_branch(
	folder: &str,
	name: &str,
	force: bool,
) -> Result<(), AppError> {
	validate_branch_name(name)?;
	let flag = if force { "-D" } else { "-d" };
	let output = Command::new("git")
		.args(["branch", flag, name])
		.current_dir(folder)
		.output()?;
	if !output.status.success() {
		let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
		return Err(AppError::GitError(stderr));
	}
	Ok(())
}

/// `git branch -m <old> <new>`.
pub fn rename_branch(
	folder: &str,
	old_name: &str,
	new_name: &str,
) -> Result<(), AppError> {
	validate_branch_name(old_name)?;
	validate_branch_name(new_name)?;
	let output = Command::new("git")
		.args(["branch", "-m", old_name, new_name])
		.current_dir(folder)
		.output()?;
	if !output.status.success() {
		let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
		return Err(AppError::GitError(stderr));
	}
	Ok(())
}

/// Reject branch names that look like git options (defends against argv
/// injection like `--upload-pack=evil`) plus a few sanity checks. We're
/// intentionally lenient with valid characters since git has its own
/// stricter check (`git check-ref-format`).
fn validate_branch_name(name: &str) -> Result<(), AppError> {
	let trimmed = name.trim();
	if trimmed.is_empty() {
		return Err(AppError::GitError("branch name cannot be empty".into()));
	}
	if trimmed.starts_with('-') {
		return Err(AppError::GitError(
			"branch name cannot start with '-'".into(),
		));
	}
	if trimmed.contains('\0') || trimmed.contains('\n') {
		return Err(AppError::GitError(
			"branch name contains invalid characters".into(),
		));
	}
	Ok(())
}

fn validate_start_point(sp: &str) -> Result<(), AppError> {
	let trimmed = sp.trim();
	if trimmed.is_empty() {
		return Err(AppError::GitError("start point cannot be empty".into()));
	}
	if trimmed.starts_with('-') {
		return Err(AppError::GitError(
			"start point cannot start with '-'".into(),
		));
	}
	if trimmed.contains('\0') || trimmed.contains('\n') {
		return Err(AppError::GitError(
			"start point contains invalid characters".into(),
		));
	}
	Ok(())
}

pub fn list_branches(folder: &str) -> Result<Vec<BranchInfo>, AppError> {
	// %(HEAD) prefixes the current branch with "*" (otherwise " ").
	// %(upstream:short) is the upstream short name or empty.
	// %(upstream:trackshort) is "<>", ">", "<", "=", or "" — but
	// we want concrete numbers, so use upstream:track which gives e.g.
	// "[ahead 3, behind 1]" or "[ahead 2]" or "[behind 5]" or "[gone]".
	let format = format!(
		concat!(
			"%(HEAD)", "{f}",
			"%(refname)", "{f}",
			"%(refname:short)", "{f}",
			"%(upstream:short)", "{f}",
			"%(upstream:track)", "{f}",
			"%(objectname)", "{f}",
			"%(contents:subject)", "{f}",
			"%(committerdate:iso8601-strict)",
			"{r}",
		),
		f = FIELD_SEP,
		r = RECORD_SEP,
	);

	let output = Command::new("git")
		.args([
			"for-each-ref",
			&format!("--format={format}"),
			"refs/heads",
		])
		.current_dir(folder)
		.output()?;
	if !output.status.success() {
		let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
		return Err(AppError::GitError(stderr));
	}

	let stdout = String::from_utf8_lossy(&output.stdout);
	let mut branches = Vec::new();
	for record in stdout.split(RECORD_SEP) {
		let record = record.trim_start_matches('\n');
		if record.is_empty() {
			continue;
		}
		let mut fields = record.split(FIELD_SEP);
		let head_marker = fields.next().unwrap_or("");
		let full_ref = fields.next().unwrap_or("").to_string();
		let name = fields.next().unwrap_or("").to_string();
		let upstream_short = fields.next().unwrap_or("").to_string();
		let upstream_track = fields.next().unwrap_or("");
		let last_commit_hash = fields.next().unwrap_or("").to_string();
		let last_commit_subject = fields.next().unwrap_or("").to_string();
		let last_commit_date = fields.next().unwrap_or("").to_string();

		if name.is_empty() {
			continue;
		}

		let (ahead, behind) = parse_track(upstream_track);
		let upstream = if upstream_short.is_empty() {
			None
		} else {
			Some(upstream_short)
		};

		branches.push(BranchInfo {
			name,
			full_ref,
			is_current: head_marker.trim() == "*",
			upstream,
			ahead,
			behind,
			last_commit_hash,
			last_commit_subject,
			last_commit_date,
		});
	}

	Ok(branches)
}

/// Parse `git for-each-ref --format=%(upstream:track)`. Examples:
///   "[ahead 3]"
///   "[behind 5]"
///   "[ahead 3, behind 1]"
///   "[gone]"        — upstream deleted; treat as 0/0
///   ""              — no upstream
fn parse_track(s: &str) -> (u32, u32) {
	let trimmed = s.trim().trim_start_matches('[').trim_end_matches(']');
	if trimmed.is_empty() || trimmed == "gone" {
		return (0, 0);
	}
	let mut ahead = 0u32;
	let mut behind = 0u32;
	for part in trimmed.split(',') {
		let part = part.trim();
		if let Some(rest) = part.strip_prefix("ahead ") {
			ahead = rest.parse().unwrap_or(0);
		} else if let Some(rest) = part.strip_prefix("behind ") {
			behind = rest.parse().unwrap_or(0);
		}
	}
	(ahead, behind)
}

pub fn list_remotes(folder: &str) -> Result<Vec<RemoteInfo>, AppError> {
	// `git remote -v` emits two lines per remote (fetch + push). Use
	// `git remote get-url` for each name to avoid duplicates.
	let names_out = Command::new("git")
		.arg("remote")
		.current_dir(folder)
		.output()?;
	if !names_out.status.success() {
		return Err(AppError::GitError(
			String::from_utf8_lossy(&names_out.stderr).trim().to_string(),
		));
	}

	let mut remotes = Vec::new();
	for name in String::from_utf8_lossy(&names_out.stdout).lines() {
		let name = name.trim();
		if name.is_empty() {
			continue;
		}
		let url_out = Command::new("git")
			.args(["remote", "get-url", name])
			.current_dir(folder)
			.output()?;
		let url = if url_out.status.success() {
			String::from_utf8_lossy(&url_out.stdout).trim().to_string()
		} else {
			String::new()
		};
		remotes.push(RemoteInfo {
			name: name.to_string(),
			url,
		});
	}
	Ok(remotes)
}

pub fn list_tags(folder: &str) -> Result<Vec<TagInfo>, AppError> {
	// %(*objectname) is the dereferenced commit hash for annotated tags;
	// for lightweight tags it's empty so %(objectname) (the commit itself)
	// is correct. We pick whichever is non-empty.
	let format = format!(
		concat!(
			"%(refname:short)", "{f}",
			"%(objecttype)", "{f}",
			"%(objectname)", "{f}",
			"%(*objectname)", "{f}",
			"%(contents:subject)",
			"{r}",
		),
		f = FIELD_SEP,
		r = RECORD_SEP,
	);

	let output = Command::new("git")
		.args([
			"for-each-ref",
			&format!("--format={format}"),
			"refs/tags",
		])
		.current_dir(folder)
		.output()?;
	if !output.status.success() {
		return Err(AppError::GitError(
			String::from_utf8_lossy(&output.stderr).trim().to_string(),
		));
	}

	let stdout = String::from_utf8_lossy(&output.stdout);
	let mut tags = Vec::new();
	for record in stdout.split(RECORD_SEP) {
		let record = record.trim_start_matches('\n');
		if record.is_empty() {
			continue;
		}
		let mut fields = record.split(FIELD_SEP);
		let name = fields.next().unwrap_or("").to_string();
		let object_type = fields.next().unwrap_or("");
		let direct_hash = fields.next().unwrap_or("");
		let deref_hash = fields.next().unwrap_or("");
		let subject = fields.next().unwrap_or("").trim().to_string();

		if name.is_empty() {
			continue;
		}
		let is_annotated = object_type == "tag";
		let target_hash = if !deref_hash.is_empty() {
			deref_hash.to_string()
		} else {
			direct_hash.to_string()
		};
		tags.push(TagInfo {
			name,
			target_hash,
			message: if is_annotated && !subject.is_empty() {
				Some(subject)
			} else {
				None
			},
			is_annotated,
		});
	}
	Ok(tags)
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
		std::fs::write(dir.path().join("a.txt"), "a").unwrap();
		Cmd::new("git").args(["add", "a.txt"]).current_dir(dir.path()).output().unwrap();
		Cmd::new("git").args(["commit", "-m", "init"]).current_dir(dir.path()).output().unwrap();
		dir
	}

	#[test]
	fn parse_track_handles_all_shapes() {
		assert_eq!(parse_track(""), (0, 0));
		assert_eq!(parse_track("[gone]"), (0, 0));
		assert_eq!(parse_track("[ahead 3]"), (3, 0));
		assert_eq!(parse_track("[behind 5]"), (0, 5));
		assert_eq!(parse_track("[ahead 3, behind 1]"), (3, 1));
		assert_eq!(parse_track("[behind 1, ahead 3]"), (3, 1));
	}

	#[test]
	fn list_branches_returns_local_branches_with_current_marker() {
		let dir = init_repo();
		Cmd::new("git").args(["branch", "feat/login"]).current_dir(dir.path()).output().unwrap();
		Cmd::new("git").args(["branch", "fix/typo"]).current_dir(dir.path()).output().unwrap();

		let branches = list_branches(&dir.path().to_string_lossy()).unwrap();
		// 3 branches: default (main or master) + 2 we created.
		assert_eq!(branches.len(), 3);
		let current = branches.iter().filter(|b| b.is_current).count();
		assert_eq!(current, 1, "exactly one current branch");
		let names: Vec<_> = branches.iter().map(|b| b.name.as_str()).collect();
		assert!(names.contains(&"feat/login"));
		assert!(names.contains(&"fix/typo"));
	}

	#[test]
	fn list_branches_carries_last_commit_metadata() {
		let dir = init_repo();
		let branches = list_branches(&dir.path().to_string_lossy()).unwrap();
		let cur = branches.iter().find(|b| b.is_current).unwrap();
		assert!(!cur.last_commit_hash.is_empty());
		assert_eq!(cur.last_commit_subject, "init");
		assert!(!cur.last_commit_date.is_empty());
	}

	#[test]
	fn list_remotes_returns_named_remotes() {
		let dir = init_repo();
		Cmd::new("git")
			.args(["remote", "add", "origin", "https://example.com/r.git"])
			.current_dir(dir.path())
			.output()
			.unwrap();
		Cmd::new("git")
			.args(["remote", "add", "upstream", "git@example.com:r.git"])
			.current_dir(dir.path())
			.output()
			.unwrap();

		let remotes = list_remotes(&dir.path().to_string_lossy()).unwrap();
		assert_eq!(remotes.len(), 2);
		let by_name: std::collections::HashMap<_, _> =
			remotes.iter().map(|r| (r.name.as_str(), r.url.as_str())).collect();
		assert_eq!(by_name.get("origin"), Some(&"https://example.com/r.git"));
		assert_eq!(by_name.get("upstream"), Some(&"git@example.com:r.git"));
	}

	#[test]
	fn list_remotes_returns_empty_when_no_remotes() {
		let dir = init_repo();
		let remotes = list_remotes(&dir.path().to_string_lossy()).unwrap();
		assert!(remotes.is_empty());
	}

	#[test]
	fn create_then_checkout_then_delete_branch() {
		let dir = init_repo();
		let folder = dir.path().to_string_lossy().to_string();

		create_branch(&folder, "feature/x", None).unwrap();
		// Branch exists.
		let listing = list_branches(&folder).unwrap();
		assert!(listing.iter().any(|b| b.name == "feature/x"));

		checkout_branch(&folder, "feature/x").unwrap();
		let listing = list_branches(&folder).unwrap();
		assert!(
			listing
				.iter()
				.any(|b| b.name == "feature/x" && b.is_current),
			"feature/x should be current",
		);

		// Switch away then delete.
		Cmd::new("git")
			.args(["checkout", "-"])
			.current_dir(dir.path())
			.output()
			.unwrap();
		delete_branch(&folder, "feature/x", false).unwrap();
		let listing = list_branches(&folder).unwrap();
		assert!(listing.iter().all(|b| b.name != "feature/x"));
	}

	#[test]
	fn delete_branch_with_unmerged_commits_requires_force() {
		let dir = init_repo();
		let folder = dir.path().to_string_lossy().to_string();
		Cmd::new("git")
			.args(["checkout", "-b", "feat"])
			.current_dir(dir.path())
			.output()
			.unwrap();
		std::fs::write(dir.path().join("b.txt"), "b").unwrap();
		Cmd::new("git").args(["add", "b.txt"]).current_dir(dir.path()).output().unwrap();
		Cmd::new("git").args(["commit", "-m", "feat work"]).current_dir(dir.path()).output().unwrap();
		Cmd::new("git").args(["checkout", "-"]).current_dir(dir.path()).output().unwrap();

		// Plain delete should fail (unmerged).
		assert!(delete_branch(&folder, "feat", false).is_err());
		// Force should succeed.
		delete_branch(&folder, "feat", true).unwrap();
	}

	#[test]
	fn rename_branch_changes_name() {
		let dir = init_repo();
		let folder = dir.path().to_string_lossy().to_string();
		create_branch(&folder, "old-name", None).unwrap();
		rename_branch(&folder, "old-name", "new-name").unwrap();
		let names: Vec<_> = list_branches(&folder)
			.unwrap()
			.into_iter()
			.map(|b| b.name)
			.collect();
		assert!(names.contains(&"new-name".to_string()));
		assert!(!names.contains(&"old-name".to_string()));
	}

	#[test]
	fn validate_rejects_dash_prefixed_names() {
		assert!(validate_branch_name("-rf").is_err());
		assert!(validate_branch_name("--upload-pack=evil").is_err());
		assert!(validate_branch_name("").is_err());
		assert!(validate_branch_name("ok-name").is_ok());
		assert!(validate_branch_name("feat/auth/login").is_ok());
	}

	#[test]
	fn list_tags_returns_lightweight_and_annotated() {
		let dir = init_repo();
		Cmd::new("git").args(["tag", "v1"]).current_dir(dir.path()).output().unwrap();
		Cmd::new("git")
			.args(["tag", "-a", "v2", "-m", "release two"])
			.current_dir(dir.path())
			.output()
			.unwrap();

		let tags = list_tags(&dir.path().to_string_lossy()).unwrap();
		assert_eq!(tags.len(), 2);
		let by_name: std::collections::HashMap<_, _> =
			tags.iter().map(|t| (t.name.as_str(), t)).collect();
		let v1 = by_name.get("v1").unwrap();
		let v2 = by_name.get("v2").unwrap();
		assert!(!v1.is_annotated);
		assert!(v2.is_annotated);
		assert_eq!(v2.message.as_deref(), Some("release two"));
		assert!(!v1.target_hash.is_empty());
		assert!(!v2.target_hash.is_empty());
		// Annotated tag's target_hash should be the underlying COMMIT, not
		// the tag-object hash.
		assert_eq!(v1.target_hash, v2.target_hash);
	}
}
