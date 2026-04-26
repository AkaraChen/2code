use std::collections::hash_map::DefaultHasher;
use std::collections::HashSet;
use std::hash::{Hash, Hasher};
use std::io::Write;
use std::path::{Component, Path};
use std::process::Command;

use model::error::AppError;
use model::filesystem::FileTreeGitStatusEntry;
use model::project::{
	FileDiffSides, GitAuthor, GitChangeKind, GitCommit, GitDiffStats,
	IndexEntry, IndexStatus,
};

const MAX_BINARY_PREVIEW_BYTES: usize = 20 * 1024 * 1024;

/// Cheap check: is `folder` inside a git working tree? Returns false (not an
/// error) for plain folders, missing folders, or anything git can't make
/// sense of. Used by the frontend to gate the git UI before any other git
/// command runs.
pub fn is_git_repo(folder: &str) -> bool {
	let output = Command::new("git")
		.args(["rev-parse", "--is-inside-work-tree"])
		.current_dir(folder)
		.output();
	match output {
		Ok(o) if o.status.success() => {
			String::from_utf8_lossy(&o.stdout).trim() == "true"
		}
		_ => false,
	}
}

pub fn init(dir: &Path) -> Result<(), AppError> {
	let output = Command::new("git").arg("init").current_dir(dir).output()?;

	if !output.status.success() {
		let stderr = String::from_utf8_lossy(&output.stderr);
		return Err(AppError::PtyError(format!("git init failed: {stderr}")));
	}
	Ok(())
}

/// Add a remote (`git remote add <name> <url>`). Validates the inputs:
/// - name: non-empty, no whitespace, no shell metachars
/// - url: non-empty, no leading dash (defends against argv injection),
///   no NUL bytes
///
/// Doesn't enforce URL scheme — git itself accepts ssh://, https://, git://,
/// scp-style (`user@host:path`), or even local paths.
pub fn remote_add(folder: &str, name: &str, url: &str) -> Result<(), AppError> {
	let name = name.trim();
	let url = url.trim();
	if name.is_empty() {
		return Err(AppError::GitError("remote name cannot be empty".into()));
	}
	if url.is_empty() {
		return Err(AppError::GitError("remote URL cannot be empty".into()));
	}
	if name.starts_with('-') || url.starts_with('-') {
		return Err(AppError::GitError(
			"remote name/URL cannot start with '-'".into(),
		));
	}
	if name.chars().any(|c| c.is_whitespace() || c == '\0') {
		return Err(AppError::GitError(
			"remote name cannot contain whitespace".into(),
		));
	}
	if url.contains('\0') {
		return Err(AppError::GitError("remote URL contains NUL".into()));
	}

	let output = Command::new("git")
		.args(["remote", "add", name, url])
		.current_dir(folder)
		.output()?;

	if !output.status.success() {
		let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
		return Err(AppError::GitError(format!(
			"git remote add failed: {stderr}"
		)));
	}
	Ok(())
}

pub fn branch(folder: &str) -> Result<String, AppError> {
	let output = Command::new("git")
		.args(["rev-parse", "--abbrev-ref", "HEAD"])
		.current_dir(folder)
		.output()?;
	if !output.status.success() {
		// Empty repo (no commits) — try symbolic-ref which works without commits
		let sym_output = Command::new("git")
			.args(["symbolic-ref", "--short", "HEAD"])
			.current_dir(folder)
			.output()?;
		if sym_output.status.success() {
			return Ok(String::from_utf8_lossy(&sym_output.stdout)
				.trim()
				.to_string());
		}
		return Ok("main".to_string());
	}
	Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

pub fn status(folder: &str) -> Result<Vec<FileTreeGitStatusEntry>, AppError> {
	let output = Command::new("git")
		.args([
			"status",
			"--porcelain=v1",
			"-z",
			"--untracked-files=all",
			"--ignored=matching",
		])
		.current_dir(folder)
		.output()?;

	if !output.status.success() {
		let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
		if stderr.contains("not a git repository") {
			return Ok(Vec::new());
		}
		return Err(AppError::GitError(stderr));
	}

	Ok(parse_porcelain_status_z(&output.stdout))
}

/// Structured index status: separate staged/unstaged file lists with rename
/// info. Backs the GitPanel "Changes" tab.
///
/// Uses `git status --porcelain=v2 -z` for the rich format that includes
/// rename detection and clean per-side change codes (XY: X=index, Y=worktree).
pub fn index_status(folder: &str) -> Result<IndexStatus, AppError> {
	let output = Command::new("git")
		.args([
			"status",
			"--porcelain=v2",
			"-z",
			"--untracked-files=all",
		])
		.current_dir(folder)
		.output()?;

	if !output.status.success() {
		let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
		if stderr.contains("not a git repository") {
			return Ok(IndexStatus::default());
		}
		return Err(AppError::GitError(stderr));
	}

	Ok(parse_porcelain_v2_z(&output.stdout))
}

/// Get the full diff (staged + unstaged) without affecting the real index.
/// Uses a temporary index file seeded from the repo's current index so tracked
/// files that are now ignored still remain tracked in the temporary view.
pub fn diff(folder: &str) -> Result<String, AppError> {
	let (_tmp_dir, tmp_index) = create_temp_index_from_repo(folder)?;

	// Stage all changes into the temporary index without mutating the real one.
	let add_output = Command::new("git")
		.args(["add", "-A"])
		.current_dir(folder)
		.env("GIT_INDEX_FILE", &tmp_index)
		.output()?;

	if !add_output.status.success() {
		return Err(AppError::GitError(
			String::from_utf8_lossy(&add_output.stderr)
				.trim()
				.to_string(),
		));
	}

	// Diff the temporary index (everything staged) against HEAD
	let diff_output = Command::new("git")
		.args(["diff", "--cached", "HEAD"])
		.current_dir(folder)
		.env("GIT_INDEX_FILE", &tmp_index)
		.output()?;

	if !diff_output.status.success() {
		let stderr = String::from_utf8_lossy(&diff_output.stderr)
			.trim()
			.to_string();
		let no_head_patterns = [
			"does not have any commits",
			"bad revision 'HEAD'",
			"invalid revision 'HEAD'",
			"unknown revision",
		];
		if no_head_patterns.iter().any(|p| stderr.contains(p)) {
			return Ok(String::new());
		}
		return Err(AppError::GitError(stderr));
	}

	Ok(String::from_utf8_lossy(&diff_output.stdout).to_string())
}

/// Get a single file's patch (worktree vs index, or index vs HEAD).
/// Used by the Phase 2 GitPanel to render one file in MonacoFileDiff.
///
/// `staged=false` → `git diff -- <path>` (worktree vs index)
/// `staged=true` → `git diff --cached -- <path>` (index vs HEAD)
pub fn file_patch(
	folder: &str,
	path: &str,
	staged: bool,
) -> Result<String, AppError> {
	let path = validate_repo_relative_path(path, "Diff path")?;

	// Untracked files: `git diff --` returns empty for them. Synthesize a
	// patch via `git diff --no-index /dev/null <path>` so the user actually
	// sees the file's contents instead of a blank "No diff" pane. Also
	// rewrite the synthetic header so the path shows as repo-relative
	// (matching the tracked-file format the frontend parsers expect).
	if !staged && is_untracked(folder, &path) {
		return untracked_file_as_patch(folder, &path);
	}

	let mut args: Vec<&str> = vec!["diff", "--no-color"];
	if staged {
		args.push("--cached");
	}
	args.push("--");
	args.push(&path);

	let output = Command::new("git")
		.args(&args)
		.current_dir(folder)
		.output()?;
	if !output.status.success() {
		let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
		return Err(AppError::GitError(stderr));
	}
	Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

fn is_untracked(folder: &str, path: &str) -> bool {
	let output = Command::new("git")
		.args(["status", "--porcelain=v1", "-z", "--", path])
		.current_dir(folder)
		.output();
	let Ok(output) = output else {
		return false;
	};
	if !output.status.success() {
		return false;
	}
	// `?? <path>\0` is the porcelain v1 marker for untracked.
	output.stdout.starts_with(b"?? ")
}

fn untracked_file_as_patch(folder: &str, path: &str) -> Result<String, AppError> {
	// `git diff --no-index` exits with status 1 when there's a diff (which
	// is the entire file here). Don't treat that as an error.
	let output = Command::new("git")
		.args([
			"diff",
			"--no-color",
			"--no-index",
			"--",
			"/dev/null",
			path,
		])
		.current_dir(folder)
		.output()?;

	let stdout = String::from_utf8_lossy(&output.stdout).to_string();
	let code = output.status.code().unwrap_or(-1);
	// Status 0 = identical (impossible here), 1 = differ (the normal case).
	// Anything else is a real error.
	if code > 1 {
		let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
		return Err(AppError::GitError(stderr));
	}

	// `--no-index` emits `--- /dev/null` and `+++ b/<path>` headers — that
	// already matches what the frontend parser expects for an added file,
	// so no rewrite is needed.
	Ok(stdout)
}

pub fn diff_stats(folder: &str) -> Result<GitDiffStats, AppError> {
	let (_tmp_dir, tmp_index) = create_temp_index_from_repo(folder)?;

	let add_output = Command::new("git")
		.args(["add", "-A"])
		.current_dir(folder)
		.env("GIT_INDEX_FILE", &tmp_index)
		.output()?;

	if !add_output.status.success() {
		return Err(AppError::GitError(
			String::from_utf8_lossy(&add_output.stderr)
				.trim()
				.to_string(),
		));
	}

	let diff_output = Command::new("git")
		.args(["diff", "--cached", "--shortstat", "HEAD"])
		.current_dir(folder)
		.env("GIT_INDEX_FILE", &tmp_index)
		.output()?;

	if !diff_output.status.success() {
		let stderr = String::from_utf8_lossy(&diff_output.stderr)
			.trim()
			.to_string();
		let no_head_patterns = [
			"does not have any commits",
			"bad revision 'HEAD'",
			"invalid revision 'HEAD'",
			"unknown revision",
		];
		if no_head_patterns.iter().any(|p| stderr.contains(p)) {
			return Ok(GitDiffStats::default());
		}
		return Err(AppError::GitError(stderr));
	}

	let stdout = String::from_utf8_lossy(&diff_output.stdout);
	let (files_changed, insertions, deletions) = stdout
		.lines()
		.find(|line| line.contains("file"))
		.map(parse_shortstat)
		.unwrap_or((0, 0, 0));

	Ok(GitDiffStats {
		files_changed,
		insertions,
		deletions,
	})
}

fn create_temp_index_from_repo(
	folder: &str,
) -> Result<(tempfile::TempDir, std::path::PathBuf), AppError> {
	let tmp_dir = tempfile::tempdir().map_err(|e| {
		AppError::GitError(format!("Failed to create temp dir: {e}"))
	})?;
	let tmp_index = tmp_dir.path().join("index");

	if let Some(repo_index) = resolve_git_index_path(folder)? {
		if repo_index.exists() {
			std::fs::copy(&repo_index, &tmp_index).map_err(|e| {
				AppError::GitError(format!(
					"Failed to copy git index from {}: {e}",
					repo_index.display()
				))
			})?;
		}
	}

	Ok((tmp_dir, tmp_index))
}

fn resolve_git_index_path(
	folder: &str,
) -> Result<Option<std::path::PathBuf>, AppError> {
	let output = Command::new("git")
		.args(["rev-parse", "--git-path", "index"])
		.current_dir(folder)
		.output()?;

	if !output.status.success() {
		return Ok(None);
	}

	let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
	if path.is_empty() {
		return Ok(None);
	}

	let path = Path::new(&path);
	let resolved = if path.is_absolute() {
		path.to_path_buf()
	} else {
		Path::new(folder).join(path)
	};

	Ok(Some(resolved))
}

pub fn log(folder: &str, limit: u32) -> Result<Vec<GitCommit>, AppError> {
	let output = Command::new("git")
		.args([
			"log",
			&format!("-{limit}"),
			"--format=%H\x1f%h\x1f%an\x1f%ae\x1f%aI\x1f%s",
			"--shortstat",
		])
		.current_dir(folder)
		.output()?;

	if !output.status.success() {
		let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
		// Empty repo (no commits) — not an error
		if stderr.contains("does not have any commits") {
			return Ok(Vec::new());
		}
		return Err(AppError::GitError(stderr));
	}

	let stdout = String::from_utf8_lossy(&output.stdout);
	Ok(parse_git_log(&stdout))
}

pub fn show(folder: &str, commit_hash: &str) -> Result<String, AppError> {
	validate_commit_hash(commit_hash)?;

	let output = Command::new("git")
		.args(["show", "--format=", commit_hash])
		.current_dir(folder)
		.output()?;

	if !output.status.success() {
		let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
		return Err(AppError::GitError(stderr));
	}

	Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

pub fn read_worktree_file(
	folder: &str,
	path: &str,
) -> Result<Option<String>, AppError> {
	let path = validate_repo_relative_path(path, "Preview file path")?;
	let file_path = Path::new(folder).join(&path);

	if !file_path.exists() || file_path.is_dir() {
		return Ok(None);
	}

	let metadata = std::fs::metadata(&file_path)?;
	if metadata.len() > MAX_BINARY_PREVIEW_BYTES as u64 {
		return Err(AppError::GitError(format!(
			"Preview file is too large: {path}"
		)));
	}

	Ok(Some(file_path.to_string_lossy().to_string()))
}

const MAX_DIFF_TEXT_BYTES: usize = 5 * 1024 * 1024;

/// Both sides of a per-file diff as plain text (or `None` when the side
/// doesn't exist — e.g., HEAD side for an added file, worktree side for a
/// deleted file). Used by the Monaco DiffEditor for language-aware syntax
/// highlighting.
///
/// `staged=false` → original = HEAD revision, modified = worktree.
/// `staged=true` → original = HEAD revision, modified = INDEX (staged version).
///
/// Skips files larger than 5MB on either side; the diff editor would choke
/// and the patch view in MonacoFileDiff handles those cases acceptably.
pub fn file_diff_sides(
	folder: &str,
	path: &str,
	staged: bool,
) -> Result<FileDiffSides, AppError> {
	let path = validate_repo_relative_path(path, "Diff path")?;

	let original = read_blob_text(folder, &format!("HEAD:{path}"))?;
	let modified = if staged {
		read_blob_text(folder, &format!(":0:{path}"))?
	} else {
		read_worktree_text(folder, &path)?
	};

	let too_large = original
		.as_ref()
		.is_some_and(|s| s.len() > MAX_DIFF_TEXT_BYTES)
		|| modified
			.as_ref()
			.is_some_and(|s| s.len() > MAX_DIFF_TEXT_BYTES);

	Ok(FileDiffSides {
		original,
		modified,
		too_large,
	})
}

/// Both sides of a per-file diff at a specific commit. Used by the commit
/// detail view to render each file the commit touched in syntax-highlighted
/// side-by-side mode.
///
/// Resolution: `original` = file at `<commit>^` (parent), `modified` = file
/// at `<commit>`. For the very first commit (no parent), original = None.
/// Either side may also be None when the commit added (no original) or
/// deleted (no modified) the file.
///
/// `merged_with` lets callers stitch a single tab across multiple commits:
/// when it's `Some(other_commit)`, `original` is taken from `<other_commit>^`
/// (the parent of the OLDEST selected commit) instead of `<commit>^`. This
/// way the diff shows the full delta from before the entire range to the
/// final state, not just the last commit's piece.
pub fn commit_file_diff_sides(
	folder: &str,
	commit_hash: &str,
	path: &str,
	merged_with: Option<&str>,
) -> Result<FileDiffSides, AppError> {
	validate_commit_hash(commit_hash)?;
	let path = validate_repo_relative_path(path, "Diff path")?;

	let original_spec = if let Some(oldest) = merged_with {
		validate_commit_hash(oldest)?;
		format!("{oldest}^:{path}")
	} else {
		format!("{commit_hash}^:{path}")
	};

	let original = read_blob_text(folder, &original_spec)?;
	let modified = read_blob_text(folder, &format!("{commit_hash}:{path}"))?;

	let too_large = original
		.as_ref()
		.is_some_and(|s| s.len() > MAX_DIFF_TEXT_BYTES)
		|| modified
			.as_ref()
			.is_some_and(|s| s.len() > MAX_DIFF_TEXT_BYTES);

	Ok(FileDiffSides {
		original,
		modified,
		too_large,
	})
}

/// Revert one file's changes from a commit by checking out the file from
/// the commit's parent. Restores the file to its pre-commit state in both
/// the worktree and the index, so the user can review and commit the
/// reverted version themselves.
///
/// For an added-by-commit file, the parent doesn't have it — we delete
/// it from the worktree and index instead. For a deleted-by-commit file,
/// the parent has it — checkout brings it back. For modified/renamed,
/// checkout pulls the parent version.
pub fn revert_file_in_commit(
	folder: &str,
	commit_hash: &str,
	path: &str,
) -> Result<(), AppError> {
	validate_commit_hash(commit_hash)?;
	let path = validate_repo_relative_path(path, "Revert path")?;

	// Did the file exist in the parent? If not, this is an added-by-commit
	// file and we should delete it instead of trying to checkout.
	let parent_has = Command::new("git")
		.args(["cat-file", "-e", &format!("{commit_hash}^:{path}")])
		.current_dir(folder)
		.output()?;

	if !parent_has.status.success() {
		// Parent doesn't have the file → commit added it → revert by removing.
		// `git rm --quiet --cached --ignore-unmatch` clears index, then unlink
		// from worktree. Use --ignore-unmatch so a missing index entry doesn't
		// fail the whole op.
		let _ = Command::new("git")
			.args(["rm", "--quiet", "--cached", "--ignore-unmatch", "--", &path])
			.current_dir(folder)
			.output()?;
		let abs = std::path::Path::new(folder).join(&path);
		if abs.exists() {
			std::fs::remove_file(&abs)?;
		}
		return Ok(());
	}

	let output = Command::new("git")
		.args(["checkout", &format!("{commit_hash}^"), "--", &path])
		.current_dir(folder)
		.output()?;

	if !output.status.success() {
		let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
		return Err(AppError::GitError(format!(
			"git checkout failed: {stderr}"
		)));
	}
	Ok(())
}

/// File list (with per-file change kind) for one commit. Used to populate
/// the file explorer in the commit detail tab.
///
/// Uses `git diff-tree --no-commit-id --name-status -r -z` for fast,
/// machine-readable output.
pub fn commit_files(
	folder: &str,
	commit_hash: &str,
) -> Result<Vec<IndexEntry>, AppError> {
	validate_commit_hash(commit_hash)?;

	let output = Command::new("git")
		.args([
			"diff-tree",
			"--no-commit-id",
			"--name-status",
			"-r",
			"-z",
			commit_hash,
		])
		.current_dir(folder)
		.output()?;
	if !output.status.success() {
		let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
		return Err(AppError::GitError(stderr));
	}

	parse_diff_tree_z(&output.stdout)
}

/// Parse `git diff-tree --name-status -r -z` output. Each record is:
///   <status>\0<path>\0
/// Rename/copy records have a similarity score in the status (R100, C75, …)
/// and TWO NUL-separated paths:
///   R100\0<old>\0<new>\0
fn parse_diff_tree_z(output: &[u8]) -> Result<Vec<IndexEntry>, AppError> {
	let mut entries = Vec::new();
	let mut iter = output.split(|&b| b == 0).peekable();
	while let Some(token) = iter.next() {
		if token.is_empty() {
			continue;
		}
		let status = String::from_utf8_lossy(token);
		let kind_char = status.chars().next().unwrap_or('M');

		let path1 = match iter.next() {
			Some(b) => String::from_utf8_lossy(b).to_string(),
			None => break,
		};
		if path1.is_empty() {
			continue;
		}

		match kind_char {
			'R' | 'C' => {
				// Rename/copy carries a second path.
				let new_path = match iter.next() {
					Some(b) => String::from_utf8_lossy(b).to_string(),
					None => continue,
				};
				entries.push(IndexEntry {
					path: new_path,
					original_path: Some(path1),
					kind: if kind_char == 'R' {
						GitChangeKind::Renamed
					} else {
						GitChangeKind::Copied
					},
				});
			}
			_ => {
				let kind = match kind_char {
					'A' => GitChangeKind::Added,
					'M' => GitChangeKind::Modified,
					'D' => GitChangeKind::Deleted,
					'T' => GitChangeKind::TypeChanged,
					'U' => GitChangeKind::Unmerged,
					_ => GitChangeKind::Modified,
				};
				entries.push(IndexEntry {
					path: path1,
					original_path: None,
					kind,
				});
			}
		}
	}
	Ok(entries)
}

/// Read a git blob's text via `cat-file -p`. Returns Ok(None) when the spec
/// doesn't resolve (e.g., HEAD:foo for a file that didn't exist at HEAD).
/// Returns Ok(None) for binary content (NUL-byte detection) so Monaco
/// doesn't try to render it.
fn read_blob_text(folder: &str, spec: &str) -> Result<Option<String>, AppError> {
	let output = Command::new("git")
		.args(["cat-file", "-p", spec])
		.current_dir(folder)
		.output()?;
	if !output.status.success() {
		// Spec doesn't exist (e.g., file didn't exist at HEAD).
		return Ok(None);
	}
	if output.stdout.contains(&0) {
		return Ok(None);
	}
	Ok(Some(String::from_utf8_lossy(&output.stdout).to_string()))
}

/// Read a worktree file as text. Returns Ok(None) for missing/binary files.
fn read_worktree_text(
	folder: &str,
	path: &str,
) -> Result<Option<String>, AppError> {
	let file_path = Path::new(folder).join(path);
	if !file_path.exists() || file_path.is_dir() {
		return Ok(None);
	}
	let bytes = std::fs::read(&file_path)?;
	if bytes.contains(&0) {
		return Ok(None);
	}
	Ok(Some(String::from_utf8_lossy(&bytes).to_string()))
}

pub fn read_head_file(
	folder: &str,
	path: &str,
) -> Result<Option<String>, AppError> {
	let path = validate_repo_relative_path(path, "Preview file path")?;
	let cache_path = preview_cache_path(folder, "head", None, &path);
	read_git_blob_to_cache(folder, &format!("HEAD:{path}"), &cache_path)
}

pub fn read_commit_file(
	folder: &str,
	commit_hash: &str,
	path: &str,
) -> Result<Option<String>, AppError> {
	validate_commit_hash(commit_hash)?;
	let path = validate_repo_relative_path(path, "Preview file path")?;
	let cache_path =
		preview_cache_path(folder, "commit", Some(commit_hash), &path);
	read_git_blob_to_cache(
		folder,
		&format!("{commit_hash}:{path}"),
		&cache_path,
	)
}

pub fn read_parent_commit_file(
	folder: &str,
	commit_hash: &str,
	path: &str,
) -> Result<Option<String>, AppError> {
	validate_commit_hash(commit_hash)?;
	let path = validate_repo_relative_path(path, "Preview file path")?;
	let cache_path =
		preview_cache_path(folder, "parent-commit", Some(commit_hash), &path);
	read_git_blob_to_cache(
		folder,
		&format!("{commit_hash}^:{path}"),
		&cache_path,
	)
}

pub fn commit(
	folder: &str,
	files: &[String],
	message: &str,
	body: Option<&str>,
) -> Result<String, AppError> {
	let files = validate_commit_files(files)?;
	let message = validate_commit_message(message)?;
	let body = body
		.map(str::trim)
		.filter(|content| !content.is_empty())
		.map(ToOwned::to_owned);

	// Stage the selected paths first so untracked files and deletions can be
	// committed, then use `--only` so unrelated staged files stay out.
	let add_output = Command::new("git")
		.arg("add")
		.arg("-A")
		.arg("--")
		.args(&files)
		.current_dir(folder)
		.output()?;

	if !add_output.status.success() {
		return Err(AppError::GitError(command_error(
			"git add failed",
			&add_output,
		)));
	}

	let mut commit_command = Command::new("git");
	commit_command
		.arg("commit")
		.arg("--only")
		.arg("-m")
		.arg(&message);

	if let Some(body) = &body {
		commit_command.arg("-m").arg(body);
	}

	let commit_output = commit_command
		.arg("--")
		.args(&files)
		.current_dir(folder)
		.output()?;

	if !commit_output.status.success() {
		return Err(AppError::GitError(command_error(
			"git commit failed",
			&commit_output,
		)));
	}

	let rev_parse = Command::new("git")
		.args(["rev-parse", "HEAD"])
		.current_dir(folder)
		.output()?;

	if !rev_parse.status.success() {
		return Err(AppError::GitError(command_error(
			"git rev-parse failed",
			&rev_parse,
		)));
	}

	Ok(String::from_utf8_lossy(&rev_parse.stdout)
		.trim()
		.to_string())
}

/// Stage whole files (equivalent of `git add <paths>`). For partial staging,
/// use `stage_hunk` or `stage_lines` instead.
pub fn stage_files(folder: &str, paths: &[String]) -> Result<(), AppError> {
	let paths = validate_repo_relative_paths(
		paths,
		"Stage path",
		"no paths supplied",
	)?;
	let mut args: Vec<&str> = vec!["add", "--"];
	for p in &paths {
		args.push(p);
	}
	let output = Command::new("git")
		.args(&args)
		.current_dir(folder)
		.output()?;
	if !output.status.success() {
		let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
		return Err(AppError::GitError(format!("git add failed: {stderr}")));
	}
	Ok(())
}

/// Unstage whole files (equivalent of `git restore --staged <paths>`).
pub fn unstage_files(folder: &str, paths: &[String]) -> Result<(), AppError> {
	let paths = validate_repo_relative_paths(
		paths,
		"Unstage path",
		"no paths supplied",
	)?;
	let mut args: Vec<&str> = vec!["restore", "--staged", "--"];
	for p in &paths {
		args.push(p);
	}
	let output = Command::new("git")
		.args(&args)
		.current_dir(folder)
		.output()?;
	if !output.status.success() {
		let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
		return Err(AppError::GitError(format!(
			"git restore --staged failed: {stderr}"
		)));
	}
	Ok(())
}

/// Stage one or more hunks by applying a synthesized patch to the index.
///
/// `file_header` is the file-level header (the `diff --git` line through
/// `+++ b/<path>`). `hunks` is one or more `@@ ... @@` blocks (each starting
/// with the hunk header and including all `+`, `-`, and ` ` context lines).
///
/// Implementation: write `<file_header>\n<hunk1>\n<hunk2>...` to a temp file,
/// then `git apply --cached --recount`. `--recount` lets git fix up hunk
/// counts in case the synthesis is slightly off.
pub fn stage_hunk(
	folder: &str,
	file_header: &str,
	hunks: &[String],
) -> Result<(), AppError> {
	apply_hunks(folder, file_header, hunks, false)
}

/// Unstage one or more hunks. Inverse of `stage_hunk`.
pub fn unstage_hunk(
	folder: &str,
	file_header: &str,
	hunks: &[String],
) -> Result<(), AppError> {
	apply_hunks(folder, file_header, hunks, true)
}

/// Stage individual lines within a hunk. `selected_indices` are 0-based
/// indices into the hunk body (lines after the `@@` header).
///
/// Behavior matches `git add --patch -e`:
/// - selected `+` line: kept (added to index)
/// - unselected `+` line: dropped (not added)
/// - selected `-` line: kept (removed from index)
/// - unselected `-` line: converted to context (line stays as-is)
/// - context line: always kept
pub fn stage_lines(
	folder: &str,
	file_header: &str,
	hunk: &str,
	selected_indices: &[usize],
) -> Result<(), AppError> {
	let synthesized = synthesize_partial_hunk(hunk, selected_indices, false)?;
	apply_hunks(folder, file_header, &[synthesized], false)
}

/// Unstage individual lines. Inverse of `stage_lines` — applies a reverse
/// patch built from selected lines in a staged hunk.
pub fn unstage_lines(
	folder: &str,
	file_header: &str,
	hunk: &str,
	selected_indices: &[usize],
) -> Result<(), AppError> {
	// For unstage, we synthesize the same forward patch (selected lines)
	// then apply with --reverse.
	let synthesized = synthesize_partial_hunk(hunk, selected_indices, true)?;
	apply_hunks(folder, file_header, &[synthesized], true)
}

/// Build a smaller hunk from a larger one by selecting specific change-line
/// indices. Returns the new hunk text (including a recomputed `@@` header
/// — but `apply_hunks` passes `--recount` so it's tolerant of small drifts).
///
/// `for_unstage` flips how unselected change lines are treated: when staging
/// from worktree, unselected `+` are dropped and unselected `-` become
/// context. When unstaging from index, the input hunk represents staged
/// changes, and we want the inverse: unselected lines convert symmetrically.
fn synthesize_partial_hunk(
	hunk: &str,
	selected_indices: &[usize],
	_for_unstage: bool,
) -> Result<String, AppError> {
	let mut lines = hunk.lines();
	let header = lines
		.next()
		.ok_or_else(|| AppError::GitError("empty hunk".into()))?;
	if !header.starts_with("@@") {
		return Err(AppError::GitError(
			"hunk must begin with @@ header".into(),
		));
	}

	let body: Vec<&str> = lines.collect();
	if body.is_empty() {
		return Err(AppError::GitError("hunk body is empty".into()));
	}

	let selected: std::collections::HashSet<usize> =
		selected_indices.iter().copied().collect();

	let mut out = String::new();
	for (i, line) in body.iter().enumerate() {
		if line.is_empty() {
			out.push('\n');
			continue;
		}
		let first = line.chars().next().unwrap();
		match first {
			'+' => {
				if selected.contains(&i) {
					out.push_str(line);
					out.push('\n');
				}
				// else: drop the line entirely
			}
			'-' => {
				if selected.contains(&i) {
					out.push_str(line);
					out.push('\n');
				} else {
					// Convert to context: the deletion is unselected, so
					// the line stays. Replace the leading '-' with ' '.
					out.push(' ');
					out.push_str(&line[1..]);
					out.push('\n');
				}
			}
			' ' | '\\' => {
				// Context, or "\ No newline at end of file" — keep verbatim.
				out.push_str(line);
				out.push('\n');
			}
			_ => {
				// Defensive: keep unknown lines verbatim so apply --recount
				// can still try to make sense of them.
				out.push_str(line);
				out.push('\n');
			}
		}
	}

	// Recompute the @@ header. Old lines = context + unselected '-' (now
	// context) + selected '-'. New lines = context + selected '+'.
	// `--recount` will fix any small mistakes here, so we just use the
	// original header as a starting point.
	let mut result = String::with_capacity(out.len() + header.len() + 1);
	result.push_str(header);
	result.push('\n');
	result.push_str(&out);

	// Sanity check: did we produce any actual changes?
	let has_change = result
		.lines()
		.skip(1)
		.any(|l| l.starts_with('+') || l.starts_with('-'));
	if !has_change {
		return Err(AppError::GitError(
			"no lines selected — patch would be empty".into(),
		));
	}

	Ok(result)
}

fn apply_hunks(
	folder: &str,
	file_header: &str,
	hunks: &[String],
	reverse: bool,
) -> Result<(), AppError> {
	if file_header.trim().is_empty() {
		return Err(AppError::GitError("empty file header".into()));
	}
	if hunks.is_empty() {
		return Err(AppError::GitError("no hunks supplied".into()));
	}
	for hunk in hunks {
		if !hunk.trim_start().starts_with("@@") {
			return Err(AppError::GitError(
				"hunk must begin with @@ header".into(),
			));
		}
	}

	// Synthesize the patch.
	let mut patch = String::new();
	patch.push_str(file_header.trim_end());
	patch.push('\n');
	for hunk in hunks {
		patch.push_str(hunk.trim_end());
		patch.push('\n');
	}

	// Write to a temp file so git apply can read it.
	let mut tmp = tempfile::NamedTempFile::new()?;
	tmp.write_all(patch.as_bytes())?;
	tmp.flush()?;

	let mut args = vec!["apply", "--cached", "--recount"];
	if reverse {
		args.push("--reverse");
	}
	let tmp_path = tmp.path().to_string_lossy().to_string();
	args.push(&tmp_path);

	let output = Command::new("git")
		.args(&args)
		.current_dir(folder)
		.output()?;

	if !output.status.success() {
		let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
		return Err(AppError::GitError(format!("git apply failed: {stderr}")));
	}
	Ok(())
}

pub fn discard_changes(folder: &str, paths: &[String]) -> Result<(), AppError> {
	let paths = validate_discard_paths(paths)?;
	let (tracked_paths, untracked_paths) =
		partition_paths_by_tracking(folder, &paths)?;

	if !tracked_paths.is_empty() {
		let restore_output = Command::new("git")
			.args(["restore", "--source=HEAD", "--staged", "--worktree", "--"])
			.args(&tracked_paths)
			.current_dir(folder)
			.output()?;

		if !restore_output.status.success() {
			return Err(AppError::GitError(command_error(
				"git restore failed",
				&restore_output,
			)));
		}
	}

	if !untracked_paths.is_empty() {
		let clean_output = Command::new("git")
			.args(["clean", "-f", "--"])
			.args(&untracked_paths)
			.current_dir(folder)
			.output()?;

		if !clean_output.status.success() {
			return Err(AppError::GitError(command_error(
				"git clean failed",
				&clean_output,
			)));
		}
	}

	Ok(())
}

pub fn ahead_count(folder: &str) -> u32 {
	let output = Command::new("git")
		.args(["rev-list", "--count", "@{u}..HEAD"])
		.current_dir(folder)
		.output();

	match output {
		Ok(o) if o.status.success() => String::from_utf8_lossy(&o.stdout)
			.trim()
			.parse::<u32>()
			.unwrap_or(0),
		_ => 0,
	}
}

pub fn push(folder: &str) -> Result<(), AppError> {
	let output = Command::new("git")
		.args(["push"])
		.current_dir(folder)
		.output()?;

	if !output.status.success() {
		let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
		return Err(AppError::GitError(format!("git push failed: {stderr}")));
	}
	Ok(())
}

/// Cancellable variant of `push`. Killed when the token fires.
pub fn push_cancellable(
	folder: &str,
	token: &super::cancel::CancelToken,
) -> Result<(), AppError> {
	let mut cmd = Command::new("git");
	cmd.args(["push"]).current_dir(folder);
	let output = super::cancel::run_cancellable(cmd, token)?;

	if !output.status.success() {
		let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
		return Err(AppError::GitError(format!("git push failed: {stderr}")));
	}
	Ok(())
}

/// `git push --force-with-lease`. Safer than raw `--force`: refuses if the
/// remote ref has changed since we last fetched it, so we don't clobber
/// commits a teammate pushed.
///
/// `force_raw=true` upgrades to `--force` (no lease check). The frontend
/// gates this behind a branch-name confirmation so it's hard to do by
/// accident.
pub fn push_with_lease(
	folder: &str,
	force_raw: bool,
	token: &super::cancel::CancelToken,
) -> Result<(), AppError> {
	let mut cmd = Command::new("git");
	cmd.current_dir(folder);
	if force_raw {
		cmd.args(["push", "--force"]);
	} else {
		cmd.args(["push", "--force-with-lease"]);
	}
	let output = super::cancel::run_cancellable(cmd, token)?;
	if !output.status.success() {
		let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
		return Err(AppError::GitError(stderr));
	}
	Ok(())
}

/// `git fetch` — fetches the named remote, or all remotes when `remote` is
/// None / empty. Cancellable.
pub fn fetch(
	folder: &str,
	remote: Option<&str>,
	token: &super::cancel::CancelToken,
) -> Result<(), AppError> {
	let mut cmd = Command::new("git");
	cmd.current_dir(folder);
	let remote = remote.unwrap_or("").trim();
	if remote.is_empty() {
		cmd.args(["fetch", "--all", "--prune"]);
	} else {
		// Defend against argv injection on the remote name.
		if remote.starts_with('-')
			|| remote.contains('\0')
			|| remote.contains('\n')
		{
			return Err(AppError::GitError(
				"invalid remote name".into(),
			));
		}
		cmd.args(["fetch", remote, "--prune"]);
	}
	let output = super::cancel::run_cancellable(cmd, token)?;
	if !output.status.success() {
		let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
		return Err(AppError::GitError(stderr));
	}
	Ok(())
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PullMode {
	Merge,
	Rebase,
	FastForwardOnly,
}

/// `git merge <ref>` — merges the named ref (commit, branch, remote-tracking
/// ref, etc.) into the current branch. Conflicts are surfaced as a normal
/// error here; the InProgressBanner picks up the .git/MERGE_HEAD state
/// independently, so the UI flow is identical to a CLI conflict.
pub fn merge_ref(
	folder: &str,
	target: &str,
	token: &super::cancel::CancelToken,
) -> Result<(), AppError> {
	validate_revspec(target)?;
	let mut cmd = Command::new("git");
	cmd.current_dir(folder).args(["merge", "--no-edit", target]);
	let output = super::cancel::run_cancellable(cmd, token)?;
	if !output.status.success() {
		let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
		return Err(AppError::GitError(stderr));
	}
	Ok(())
}

/// `git rebase <ref>` — rebases the current branch onto the named ref.
/// Conflicts surface via .git/rebase-merge — InProgressBanner handles it.
pub fn rebase_onto(
	folder: &str,
	target: &str,
	token: &super::cancel::CancelToken,
) -> Result<(), AppError> {
	validate_revspec(target)?;
	let mut cmd = Command::new("git");
	cmd.current_dir(folder).args(["rebase", target]);
	let output = super::cancel::run_cancellable(cmd, token)?;
	if !output.status.success() {
		let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
		return Err(AppError::GitError(stderr));
	}
	Ok(())
}

/// `git push <remote> --delete <branch>` — deletes a branch on the remote.
/// Network op, cancellable. Caller is responsible for confirming intent.
pub fn delete_remote_branch(
	folder: &str,
	remote: &str,
	branch: &str,
	token: &super::cancel::CancelToken,
) -> Result<(), AppError> {
	validate_remote_token(remote)?;
	validate_remote_token(branch)?;
	let mut cmd = Command::new("git");
	cmd.current_dir(folder)
		.args(["push", remote, "--delete", branch]);
	let output = super::cancel::run_cancellable(cmd, token)?;
	if !output.status.success() {
		let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
		return Err(AppError::GitError(stderr));
	}
	Ok(())
}

/// Rename a branch on the remote. Git has no first-class rename op for remote
/// refs, so we push the new name (`<remote> <old>:<new>`) and then delete the
/// old name. If the second push fails the new ref is left in place — which is
/// the safer state of the two ("both branches exist" is recoverable, "only
/// the new one exists but the second push raced and failed" would lose work
/// if we'd deleted first). Cancellable.
pub fn rename_remote_branch(
	folder: &str,
	remote: &str,
	old_branch: &str,
	new_branch: &str,
	token: &super::cancel::CancelToken,
) -> Result<(), AppError> {
	validate_remote_token(remote)?;
	validate_remote_token(old_branch)?;
	validate_remote_token(new_branch)?;
	if old_branch == new_branch {
		return Err(AppError::GitError(
			"new branch name must differ from the old name".into(),
		));
	}

	// Step 1: push old → new, creating the new remote ref.
	let mut push_new = Command::new("git");
	push_new.current_dir(folder).args([
		"push",
		remote,
		&format!("refs/remotes/{remote}/{old_branch}:refs/heads/{new_branch}"),
	]);
	let output = super::cancel::run_cancellable(push_new, token)?;
	if !output.status.success() {
		let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
		return Err(AppError::GitError(format!(
			"failed to create new remote branch: {stderr}"
		)));
	}

	// Step 2: delete the old name. If this fails, both refs exist and the
	// user can clean up via Delete… on the old one.
	delete_remote_branch(folder, remote, old_branch, token).map_err(|e| {
		AppError::GitError(format!(
			"new branch '{new_branch}' was created on '{remote}', but \
			 deleting the old name '{old_branch}' failed: {e}. Delete it \
			 manually with the Delete… action.",
			e = match e {
				AppError::GitError(s) => s,
				other => other.to_string(),
			},
		))
	})
}

/// Loose validation for arg-position tokens passed to git (remote, branch).
/// Same defenses as branch validation but lives here to avoid pulling in
/// the branches.rs validators (which are private).
fn validate_remote_token(token: &str) -> Result<(), AppError> {
	let t = token.trim();
	if t.is_empty() {
		return Err(AppError::GitError("name cannot be empty".into()));
	}
	if t.starts_with('-') {
		return Err(AppError::GitError("name cannot start with '-'".into()));
	}
	if t.contains('\0') || t.contains('\n') || t.contains(':') {
		return Err(AppError::GitError(
			"name contains invalid characters".into(),
		));
	}
	Ok(())
}

/// Loose validation for a refspec/commit-ish argument (e.g. "origin/main",
/// "abc1234", "refs/heads/foo"). Allows '/' (refs use it) but rejects
/// dash-prefixed names and embedded NUL/newline.
fn validate_revspec(rs: &str) -> Result<(), AppError> {
	let t = rs.trim();
	if t.is_empty() {
		return Err(AppError::GitError("ref cannot be empty".into()));
	}
	if t.starts_with('-') {
		return Err(AppError::GitError("ref cannot start with '-'".into()));
	}
	if t.contains('\0') || t.contains('\n') {
		return Err(AppError::GitError("ref contains invalid characters".into()));
	}
	Ok(())
}

/// `git pull` with the user-chosen merge strategy. Cancellable.
pub fn pull(
	folder: &str,
	mode: PullMode,
	token: &super::cancel::CancelToken,
) -> Result<(), AppError> {
	let mut cmd = Command::new("git");
	cmd.current_dir(folder).arg("pull");
	match mode {
		PullMode::Merge => {}
		PullMode::Rebase => {
			cmd.arg("--rebase");
		}
		PullMode::FastForwardOnly => {
			cmd.arg("--ff-only");
		}
	}
	let output = super::cancel::run_cancellable(cmd, token)?;
	if !output.status.success() {
		let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
		return Err(AppError::GitError(stderr));
	}
	Ok(())
}

/// Try `git worktree add -b <branch> <path>` (new branch).
/// If the branch already exists, return an error.
/// If a ref conflict blocks creation (e.g. `feat` exists, blocking `feat/auth`),
/// delete the conflicting branch and retry once.
pub fn worktree_add(
	project_folder: &str,
	branch_name: &str,
	worktree_path: &str,
) -> Result<(), AppError> {
	let output = Command::new("git")
		.args(["worktree", "add", "-b", branch_name, worktree_path])
		.current_dir(project_folder)
		.output()?;

	if output.status.success() {
		return Ok(());
	}

	let stderr = String::from_utf8_lossy(&output.stderr);

	// Branch already exists — let the user know
	if stderr.contains("already exists") {
		return Err(AppError::GitError(format!(
			"Branch '{branch_name}' already exists"
		)));
	}

	// Ref conflict: e.g. 'refs/heads/feat' blocks 'refs/heads/feat/auth'.
	// Try to delete the conflicting branch and retry once.
	if stderr.contains("cannot lock ref") {
		if let Some(conflicting) = extract_conflicting_ref(&stderr) {
			let _ = Command::new("git")
				.args(["branch", "-D", &conflicting])
				.current_dir(project_folder)
				.output();

			// Retry
			let retry = Command::new("git")
				.args(["worktree", "add", "-b", branch_name, worktree_path])
				.current_dir(project_folder)
				.output()?;
			if retry.status.success() {
				return Ok(());
			}
			let retry_err = String::from_utf8_lossy(&retry.stderr);
			return Err(AppError::GitError(format!(
				"git worktree add failed: {retry_err}"
			)));
		}
	}

	Err(AppError::GitError(format!(
		"git worktree add failed: {stderr}"
	)))
}

pub fn worktree_remove(project_folder: &str, worktree_path: &str) {
	let output = Command::new("git")
		.args(["worktree", "remove", worktree_path, "--force"])
		.current_dir(project_folder)
		.output();

	match output {
		Ok(o) if !o.status.success() => {
			let stderr = String::from_utf8_lossy(&o.stderr);
			tracing::warn!("git worktree remove failed: {stderr}");
		}
		Err(e) => {
			tracing::warn!("git worktree remove error: {e}");
		}
		_ => {}
	}
}

pub fn branch_delete(project_folder: &str, branch_name: &str) {
	let output = Command::new("git")
		.args(["branch", "-D", branch_name])
		.current_dir(project_folder)
		.output();

	match output {
		Ok(o) if !o.status.success() => {
			let stderr = String::from_utf8_lossy(&o.stderr);
			tracing::warn!("git branch delete failed: {stderr}");
		}
		Err(e) => {
			tracing::warn!("git branch delete error: {e}");
		}
		_ => {}
	}
}

// --- Private helpers ---

pub fn validate_commit_hash(hash: &str) -> Result<(), AppError> {
	if hash.len() < 4 || hash.len() > 40 {
		return Err(AppError::GitError(format!(
			"Invalid commit hash length: {}",
			hash.len()
		)));
	}
	if !hash.chars().all(|c| c.is_ascii_hexdigit()) {
		return Err(AppError::GitError(
			"Invalid commit hash: non-hex characters".into(),
		));
	}
	Ok(())
}

pub fn validate_commit_message(message: &str) -> Result<String, AppError> {
	let trimmed = message.trim();
	if trimmed.is_empty() {
		return Err(AppError::GitError(
			"Commit message cannot be empty".into(),
		));
	}
	Ok(trimmed.to_string())
}

pub fn validate_commit_files(
	files: &[String],
) -> Result<Vec<String>, AppError> {
	validate_repo_relative_paths(
		files,
		"Commit file path",
		"Select at least one file to commit",
	)
}

fn validate_discard_paths(paths: &[String]) -> Result<Vec<String>, AppError> {
	validate_repo_relative_paths(
		paths,
		"Discard file path",
		"Select at least one file to discard",
	)
}

fn validate_repo_relative_paths(
	paths: &[String],
	label: &str,
	empty_error: &str,
) -> Result<Vec<String>, AppError> {
	if paths.is_empty() {
		return Err(AppError::GitError(empty_error.into()));
	}

	let mut seen = HashSet::new();
	let mut validated = Vec::with_capacity(paths.len());

	for path in paths {
		let trimmed = validate_repo_relative_path(path, label)?;
		if seen.insert(trimmed.to_string()) {
			validated.push(trimmed);
		}
	}

	Ok(validated)
}

fn validate_repo_relative_path(
	path: &str,
	label: &str,
) -> Result<String, AppError> {
	let trimmed = path.trim();
	if trimmed.is_empty() {
		return Err(AppError::GitError(format!("{label} cannot be empty")));
	}
	if trimmed.contains('\0') {
		return Err(AppError::GitError(format!(
			"{label} contains invalid characters"
		)));
	}

	let parsed = Path::new(trimmed);
	if parsed.is_absolute() {
		return Err(AppError::GitError(format!(
			"{label} must be relative: {trimmed}"
		)));
	}
	if parsed.components().any(|component| {
		matches!(
			component,
			Component::ParentDir | Component::RootDir | Component::Prefix(_)
		)
	}) {
		return Err(AppError::GitError(format!(
			"{label} escapes repository: {trimmed}"
		)));
	}

	Ok(trimmed.to_string())
}

pub fn parse_shortstat(line: &str) -> (u32, u32, u32) {
	let mut files = 0u32;
	let mut insertions = 0u32;
	let mut deletions = 0u32;

	for part in line.split(',') {
		let part = part.trim();
		if let Some(n) = part
			.split_whitespace()
			.next()
			.and_then(|s| s.parse::<u32>().ok())
		{
			if part.contains("file") {
				files = n;
			} else if part.contains("insertion") {
				insertions = n;
			} else if part.contains("deletion") {
				deletions = n;
			}
		}
	}

	(files, insertions, deletions)
}

pub fn parse_git_log(output: &str) -> Vec<GitCommit> {
	if output.trim().is_empty() {
		return Vec::new();
	}

	let mut commits = Vec::new();
	let mut lines = output.lines().peekable();

	while let Some(line) = lines.next() {
		let line = line.trim();
		if line.is_empty() {
			continue;
		}

		// Try to parse as a commit format line (contains \x1f separators)
		let parts: Vec<&str> = line.split('\x1f').collect();
		if parts.len() == 6 {
			let full_hash = parts[0].to_string();
			let hash = parts[1].to_string();
			let author_name = parts[2].to_string();
			let author_email = parts[3].to_string();
			let date = parts[4].to_string();
			let message = parts[5].to_string();

			// Check if the next non-empty line is a shortstat
			let mut files_changed = 0;
			let mut insertions = 0;
			let mut deletions = 0;

			// Skip empty lines and look for shortstat
			while let Some(next) = lines.peek() {
				let next = next.trim();
				if next.is_empty() {
					lines.next();
					continue;
				}
				if next.contains("file") && next.contains("changed") {
					let (f, i, d) = parse_shortstat(next);
					files_changed = f;
					insertions = i;
					deletions = d;
					lines.next();
				}
				break;
			}

			commits.push(GitCommit {
				hash,
				full_hash,
				author: GitAuthor {
					name: author_name,
					email: author_email,
				},
				date,
				message,
				files_changed,
				insertions,
				deletions,
			});
		}
	}

	commits
}

/// Parse `git status --porcelain=v2 -z` output into structured staged/unstaged
/// lists. Each record is NUL-terminated; rename records (type "2") have two
/// NUL-separated paths.
fn parse_porcelain_v2_z(output: &[u8]) -> IndexStatus {
	let mut staged = Vec::new();
	let mut unstaged = Vec::new();

	// Split on NUL but keep enough context to handle rename records (type 2)
	// which include two paths. We process records token-by-token.
	let mut iter = output.split(|&b| b == 0).peekable();
	while let Some(record) = iter.next() {
		if record.is_empty() {
			continue;
		}
		let s = String::from_utf8_lossy(record);
		let mut parts = s.splitn(2, ' ');
		let kind_marker = parts.next().unwrap_or("");
		let rest = parts.next().unwrap_or("");

		match kind_marker {
			"1" => {
				// "1 XY sub modeH modeI modeW hashH hashI path"
				let mut fields = rest.splitn(8, ' ');
				let xy = fields.next().unwrap_or("..");
				// Skip the next 6 fields (sub, 3 modes, 2 hashes).
				for _ in 0..6 {
					if fields.next().is_none() {
						break;
					}
				}
				let path = fields.next().unwrap_or("").to_string();
				if path.is_empty() {
					continue;
				}
				push_xy(&mut staged, &mut unstaged, xy, path, None);
			}
			"2" => {
				// "2 XY sub modeH modeI modeW hashH hashI X<score> path"
				// Then a SECOND record (the original path) follows the NUL.
				let mut fields = rest.splitn(9, ' ');
				let xy = fields.next().unwrap_or("..");
				for _ in 0..6 {
					if fields.next().is_none() {
						break;
					}
				}
				let _score = fields.next().unwrap_or("");
				let path = fields.next().unwrap_or("").to_string();
				let original = iter
					.next()
					.map(|b| String::from_utf8_lossy(b).to_string())
					.unwrap_or_default();
				if path.is_empty() {
					continue;
				}
				push_xy(&mut staged, &mut unstaged, xy, path, Some(original));
			}
			"u" => {
				// "u XY sub modeH modeI modeW modeS hashH hashI hashS path"
				let mut fields = rest.splitn(11, ' ');
				let _xy = fields.next();
				for _ in 0..9 {
					if fields.next().is_none() {
						break;
					}
				}
				let path = fields.next().unwrap_or("").to_string();
				if !path.is_empty() {
					unstaged.push(IndexEntry {
						path,
						original_path: None,
						kind: GitChangeKind::Unmerged,
					});
				}
			}
			"?" => {
				// "? path" — but with `1 ` prefix consumed, rest holds path
				let path = rest.to_string();
				if !path.is_empty() {
					unstaged.push(IndexEntry {
						path,
						original_path: None,
						kind: GitChangeKind::Untracked,
					});
				}
			}
			_ => {
				// "!" ignored, or unknown — skip silently.
			}
		}
	}

	IndexStatus { staged, unstaged }
}

fn push_xy(
	staged: &mut Vec<IndexEntry>,
	unstaged: &mut Vec<IndexEntry>,
	xy: &str,
	path: String,
	original_path: Option<String>,
) {
	let mut chars = xy.chars();
	let x = chars.next().unwrap_or('.');
	let y = chars.next().unwrap_or('.');

	if let Some(kind) = porcelain_v2_kind(x) {
		staged.push(IndexEntry {
			path: path.clone(),
			original_path: original_path.clone(),
			kind,
		});
	}
	if let Some(kind) = porcelain_v2_kind(y) {
		unstaged.push(IndexEntry {
			path,
			original_path,
			kind,
		});
	}
}

fn porcelain_v2_kind(c: char) -> Option<GitChangeKind> {
	match c {
		'A' => Some(GitChangeKind::Added),
		'M' => Some(GitChangeKind::Modified),
		'D' => Some(GitChangeKind::Deleted),
		'R' => Some(GitChangeKind::Renamed),
		'C' => Some(GitChangeKind::Copied),
		'T' => Some(GitChangeKind::TypeChanged),
		'U' => Some(GitChangeKind::Unmerged),
		'.' | ' ' => None,
		_ => None,
	}
}

fn parse_porcelain_status_z(output: &[u8]) -> Vec<FileTreeGitStatusEntry> {
	let records: Vec<&[u8]> = output
		.split(|byte| *byte == 0)
		.filter(|record| !record.is_empty())
		.collect();
	let mut entries = Vec::new();
	let mut index = 0usize;

	while let Some(record) = records.get(index) {
		if record.len() < 4 {
			index += 1;
			continue;
		}

		let status_code = String::from_utf8_lossy(&record[..2]).to_string();
		let path = String::from_utf8_lossy(&record[3..]).to_string();
		let status = map_porcelain_status(&status_code);
		if status_code.contains('R') || status_code.contains('C') {
			index += 1;
		}

		if let Some(status) = status {
			entries.push(FileTreeGitStatusEntry {
				path,
				status: status.to_string(),
			});
		}

		index += 1;
	}

	entries
}

fn map_porcelain_status(status_code: &str) -> Option<&'static str> {
	if status_code.contains('!') {
		return Some("ignored");
	}
	if status_code.contains('?') {
		return Some("untracked");
	}
	if status_code.contains('R') {
		return Some("renamed");
	}
	if status_code.contains('A') {
		return Some("added");
	}
	if status_code.contains('D') {
		return Some("deleted");
	}
	if status_code
		.chars()
		.any(|value| matches!(value, 'M' | 'T' | 'U' | 'C'))
	{
		return Some("modified");
	}
	None
}

/// Parse "'refs/heads/feat' exists" from git error to extract "feat".
fn extract_conflicting_ref(stderr: &str) -> Option<String> {
	// Look for: 'refs/heads/XXX' exists
	let suffix = "' exists";
	let exists_pos = stderr.find(suffix)?;
	let before = &stderr[..exists_pos];
	let marker = "refs/heads/";
	let marker_pos = before.rfind(marker)? + marker.len();
	let name = &before[marker_pos..];
	if name.is_empty() {
		return None;
	}
	Some(name.to_string())
}

fn partition_paths_by_tracking(
	folder: &str,
	paths: &[String],
) -> Result<(Vec<String>, Vec<String>), AppError> {
	let mut tracked_paths = Vec::new();
	let mut untracked_paths = Vec::new();

	for path in paths {
		if is_path_tracked(folder, path)? {
			tracked_paths.push(path.clone());
		} else {
			untracked_paths.push(path.clone());
		}
	}

	Ok((tracked_paths, untracked_paths))
}

fn is_path_tracked(folder: &str, path: &str) -> Result<bool, AppError> {
	let output = Command::new("git")
		.args(["ls-files", "--error-unmatch", "--", path])
		.current_dir(folder)
		.output()?;

	if output.status.success() {
		return Ok(true);
	}

	let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
	if stderr.contains("did not match any file(s) known to git") {
		return Ok(false);
	}

	Err(AppError::GitError(command_error(
		"git ls-files failed",
		&output,
	)))
}

fn command_error(prefix: &str, output: &std::process::Output) -> String {
	let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
	if !stderr.is_empty() {
		return format!("{prefix}: {stderr}");
	}

	let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
	if !stdout.is_empty() {
		return format!("{prefix}: {stdout}");
	}

	prefix.to_string()
}

fn read_git_blob_to_cache(
	folder: &str,
	spec: &str,
	cache_path: &Path,
) -> Result<Option<String>, AppError> {
	let blob_size = get_git_blob_size(folder, spec)?;
	let Some(blob_size) = blob_size else {
		return Ok(None);
	};

	if blob_size > MAX_BINARY_PREVIEW_BYTES as u64 {
		return Err(AppError::GitError(format!(
			"Preview file is too large: {spec}"
		)));
	}

	if let Ok(metadata) = std::fs::metadata(cache_path) {
		if metadata.is_file() && metadata.len() == blob_size {
			return Ok(Some(cache_path.to_string_lossy().to_string()));
		}
	}

	let output = Command::new("git")
		.args(["cat-file", "blob", spec])
		.current_dir(folder)
		.output()?;

	if output.status.success() {
		if output.stdout.len() as u64 != blob_size {
			return Err(AppError::GitError(format!(
				"Preview file size changed while reading: {spec}"
			)));
		}
		write_preview_cache_file(cache_path, &output.stdout)?;
		return Ok(Some(cache_path.to_string_lossy().to_string()));
	}

	let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
	if is_missing_blob_error(&stderr) {
		return Ok(None);
	}

	Err(AppError::GitError(stderr))
}

fn get_git_blob_size(
	folder: &str,
	spec: &str,
) -> Result<Option<u64>, AppError> {
	let output = Command::new("git")
		.args(["cat-file", "-s", spec])
		.current_dir(folder)
		.output()?;

	if output.status.success() {
		let stdout = String::from_utf8_lossy(&output.stdout);
		let size = stdout.trim().parse::<u64>().map_err(|error| {
			AppError::GitError(format!(
				"Failed to parse preview size for {spec}: {error}"
			))
		})?;
		return Ok(Some(size));
	}

	let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
	if is_missing_blob_error(&stderr) {
		return Ok(None);
	}

	Err(AppError::GitError(stderr))
}

fn is_missing_blob_error(stderr: &str) -> bool {
	[
		"does not exist in",
		"exists on disk, but not in",
		"invalid object name",
		"Not a valid object name",
		"invalid object",
	]
	.iter()
	.any(|pattern| stderr.contains(pattern))
}

fn preview_cache_path(
	folder: &str,
	source: &str,
	commit_hash: Option<&str>,
	relative_path: &str,
) -> std::path::PathBuf {
	let mut hasher = DefaultHasher::new();
	folder.hash(&mut hasher);
	let repo_hash = hasher.finish();

	let mut cache_path = std::env::temp_dir()
		.join("2code")
		.join("git-preview-cache")
		.join(format!("{repo_hash:016x}"))
		.join(source);

	if let Some(commit_hash) = commit_hash {
		cache_path = cache_path.join(commit_hash);
	}

	cache_path.join(relative_path)
}

fn write_preview_cache_file(path: &Path, bytes: &[u8]) -> Result<(), AppError> {
	if let Some(parent) = path.parent() {
		std::fs::create_dir_all(parent)?;
		let mut temporary = tempfile::NamedTempFile::new_in(parent)?;
		temporary.write_all(bytes)?;
		temporary.flush()?;
		match temporary.persist(path) {
			Ok(_) => {}
			Err(error)
				if error.error.kind() == std::io::ErrorKind::AlreadyExists => {}
			Err(error) => {
				return Err(AppError::IoError(error.error));
			}
		}
		return Ok(());
	}

	Err(AppError::IoError(std::io::Error::other(
		"Preview cache path has no parent directory",
	)))
}

#[cfg(test)]
mod tests {
	use super::*;
	use std::process::Command;

	// --- validate_commit_hash ---

	#[test]
	fn validate_hash_valid_short() {
		assert!(validate_commit_hash("abcd").is_ok());
	}

	#[test]
	fn validate_hash_valid_full() {
		assert!(validate_commit_hash(
			"abc123def456abc123def456abc123def456abc1"
		)
		.is_ok());
	}

	#[test]
	fn validate_hash_too_short() {
		assert!(validate_commit_hash("abc").is_err());
	}

	#[test]
	fn validate_hash_non_hex() {
		assert!(validate_commit_hash("ghijklmn").is_err());
	}

	#[test]
	fn validate_hash_flag_injection() {
		assert!(validate_commit_hash("--all").is_err());
	}

	#[test]
	fn validate_hash_empty() {
		assert!(validate_commit_hash("").is_err());
	}

	#[test]
	fn validate_commit_message_rejects_blank() {
		assert!(validate_commit_message("   ").is_err());
	}

	#[test]
	fn validate_commit_message_trims_whitespace() {
		assert_eq!(
			validate_commit_message("  test commit  ").unwrap(),
			"test commit"
		);
	}

	#[test]
	fn validate_commit_files_rejects_empty_list() {
		let files: Vec<String> = Vec::new();
		assert!(validate_commit_files(&files).is_err());
	}

	#[test]
	fn validate_commit_files_deduplicates_paths() {
		let files = vec!["a.txt".into(), "a.txt".into(), "b.txt".into()];
		assert_eq!(
			validate_commit_files(&files).unwrap(),
			vec!["a.txt".to_string(), "b.txt".to_string()]
		);
	}

	#[test]
	fn validate_commit_files_rejects_parent_dir_escape() {
		let files = vec!["../secrets.txt".into()];
		assert!(validate_commit_files(&files).is_err());
	}

	#[test]
	fn validate_commit_files_rejects_absolute_paths() {
		let files = vec!["/tmp/a.txt".into()];
		assert!(validate_commit_files(&files).is_err());
	}

	#[test]
	fn validate_discard_paths_rejects_empty_list() {
		let paths: Vec<String> = Vec::new();
		assert!(validate_discard_paths(&paths).is_err());
	}

	#[test]
	fn validate_repo_relative_path_accepts_nested_relative_paths() {
		assert_eq!(
			validate_repo_relative_path(
				"assets/image.png",
				"Preview file path"
			)
			.unwrap(),
			"assets/image.png"
		);
	}

	#[test]
	fn validate_repo_relative_path_rejects_parent_dir_escape() {
		assert!(validate_repo_relative_path(
			"../secret.png",
			"Preview file path"
		)
		.is_err());
	}

	#[test]
	fn parses_porcelain_status_for_file_tree() {
		let output = b" M src/main.rs\0?? scratch.txt\0!! target/\0R  src/new.rs\0src/old.rs\0D  gone.rs\0";

		let entries = parse_porcelain_status_z(output);

		assert_eq!(
			entries,
			vec![
				FileTreeGitStatusEntry {
					path: "src/main.rs".to_string(),
					status: "modified".to_string(),
				},
				FileTreeGitStatusEntry {
					path: "scratch.txt".to_string(),
					status: "untracked".to_string(),
				},
				FileTreeGitStatusEntry {
					path: "target/".to_string(),
					status: "ignored".to_string(),
				},
				FileTreeGitStatusEntry {
					path: "src/new.rs".to_string(),
					status: "renamed".to_string(),
				},
				FileTreeGitStatusEntry {
					path: "gone.rs".to_string(),
					status: "deleted".to_string(),
				},
			]
		);
	}

	// --- parse_shortstat ---

	#[test]
	fn shortstat_all_fields() {
		let (f, i, d) = parse_shortstat(
			" 3 files changed, 10 insertions(+), 5 deletions(-)",
		);
		assert_eq!((f, i, d), (3, 10, 5));
	}

	#[test]
	fn shortstat_insertions_only() {
		let (f, i, d) = parse_shortstat(" 1 file changed, 4 insertions(+)");
		assert_eq!((f, i, d), (1, 4, 0));
	}

	#[test]
	fn shortstat_deletions_only() {
		let (f, i, d) = parse_shortstat(" 2 files changed, 7 deletions(-)");
		assert_eq!((f, i, d), (2, 0, 7));
	}

	#[test]
	fn shortstat_empty() {
		let (f, i, d) = parse_shortstat("");
		assert_eq!((f, i, d), (0, 0, 0));
	}

	#[test]
	fn shortstat_singular_file() {
		let (f, i, d) =
			parse_shortstat(" 1 file changed, 1 insertion(+), 1 deletion(-)");
		assert_eq!((f, i, d), (1, 1, 1));
	}

	// --- parse_git_log ---

	#[test]
	fn parse_log_multiple_commits() {
		let output = "abc123def456abc123def456abc123def456abc1\x1fabc123d\x1fJohn\x1fjohn@example.com\x1f2024-01-01T00:00:00+00:00\x1fFirst commit\n 1 file changed, 3 insertions(+)\n\ndef456abc123def456abc123def456abc123def4\x1fdef456a\x1fJane\x1fjane@example.com\x1f2024-01-02T00:00:00+00:00\x1fSecond commit\n 2 files changed, 5 insertions(+), 2 deletions(-)\n";
		let commits = parse_git_log(output);
		assert_eq!(commits.len(), 2);
		assert_eq!(commits[0].message, "First commit");
		assert_eq!(commits[0].hash, "abc123d");
		assert_eq!(commits[0].author.name, "John");
		assert_eq!(commits[0].author.email, "john@example.com");
		assert_eq!(commits[0].files_changed, 1);
		assert_eq!(commits[0].insertions, 3);
		assert_eq!(commits[0].deletions, 0);
		assert_eq!(commits[1].message, "Second commit");
		assert_eq!(commits[1].files_changed, 2);
		assert_eq!(commits[1].insertions, 5);
		assert_eq!(commits[1].deletions, 2);
	}

	#[test]
	fn parse_log_empty_output() {
		let commits = parse_git_log("");
		assert!(commits.is_empty());
	}

	#[test]
	fn parse_log_commit_without_stat() {
		let output = "abc123def456abc123def456abc123def456abc1\x1fabc123d\x1fJohn\x1fjohn@example.com\x1f2024-01-01T00:00:00+00:00\x1fEmpty commit\n";
		let commits = parse_git_log(output);
		assert_eq!(commits.len(), 1);
		assert_eq!(commits[0].files_changed, 0);
		assert_eq!(commits[0].insertions, 0);
		assert_eq!(commits[0].deletions, 0);
	}

	// --- extract_conflicting_ref ---

	#[test]
	fn extract_ref_from_typical_error() {
		let stderr = "fatal: cannot lock ref 'refs/heads/feat/auth': 'refs/heads/feat' exists; cannot create 'refs/heads/feat/auth'";
		assert_eq!(extract_conflicting_ref(stderr), Some("feat".to_string()));
	}

	#[test]
	fn extract_ref_nested() {
		let stderr = "fatal: cannot lock ref 'refs/heads/a/b/c': 'refs/heads/a/b' exists;";
		assert_eq!(extract_conflicting_ref(stderr), Some("a/b".to_string()));
	}

	#[test]
	fn extract_ref_no_match() {
		assert_eq!(extract_conflicting_ref("some other error"), None);
	}

	#[test]
	fn read_preview_files_from_worktree_and_head() {
		let dir = create_temp_git_repo();
		let initial = vec![0_u8, 1, 2, 3];
		let modified = vec![4_u8, 5, 6, 7];

		std::fs::write(dir.join("image.bin"), &initial).unwrap();
		Command::new("git")
			.args(["add", "image.bin"])
			.current_dir(&dir)
			.output()
			.unwrap();
		Command::new("git")
			.args(["commit", "-m", "add image"])
			.current_dir(&dir)
			.output()
			.unwrap();

		std::fs::write(dir.join("image.bin"), &modified).unwrap();

		let head_preview =
			read_head_file(dir.to_string_lossy().as_ref(), "image.bin")
				.unwrap()
				.unwrap();
		let worktree_preview =
			read_worktree_file(dir.to_string_lossy().as_ref(), "image.bin")
				.unwrap()
				.unwrap();

		assert_ne!(head_preview, dir.join("image.bin").to_string_lossy());
		assert_eq!(std::fs::read(head_preview).unwrap(), initial);
		assert_eq!(worktree_preview, dir.join("image.bin").to_string_lossy());
		assert_eq!(std::fs::read(worktree_preview).unwrap(), modified);

		std::fs::remove_dir_all(dir).unwrap();
	}

	#[test]
	fn read_preview_files_from_commit_and_parent_commit() {
		let dir = create_temp_git_repo();
		let before = vec![1_u8, 2, 3, 4];
		let after = vec![5_u8, 6, 7, 8];

		std::fs::write(dir.join("image.bin"), &before).unwrap();
		Command::new("git")
			.args(["add", "image.bin"])
			.current_dir(&dir)
			.output()
			.unwrap();
		Command::new("git")
			.args(["commit", "-m", "add image"])
			.current_dir(&dir)
			.output()
			.unwrap();

		std::fs::write(dir.join("image.bin"), &after).unwrap();
		Command::new("git")
			.args(["add", "image.bin"])
			.current_dir(&dir)
			.output()
			.unwrap();
		Command::new("git")
			.args(["commit", "-m", "update image"])
			.current_dir(&dir)
			.output()
			.unwrap();

		let head = Command::new("git")
			.args(["rev-parse", "HEAD"])
			.current_dir(&dir)
			.output()
			.unwrap();
		let commit_hash =
			String::from_utf8_lossy(&head.stdout).trim().to_string();

		let commit_preview = read_commit_file(
			dir.to_string_lossy().as_ref(),
			&commit_hash,
			"image.bin",
		)
		.unwrap()
		.unwrap();
		let parent_preview = read_parent_commit_file(
			dir.to_string_lossy().as_ref(),
			&commit_hash,
			"image.bin",
		)
		.unwrap()
		.unwrap();

		assert_eq!(std::fs::read(commit_preview).unwrap(), after);
		assert_eq!(std::fs::read(parent_preview).unwrap(), before);

		std::fs::remove_dir_all(dir).unwrap();
	}

	#[test]
	fn read_preview_files_reject_large_committed_blob() {
		let dir = create_temp_git_repo();
		let oversized = vec![0_u8; MAX_BINARY_PREVIEW_BYTES + 1];

		std::fs::write(dir.join("large.bin"), oversized).unwrap();
		Command::new("git")
			.args(["add", "large.bin"])
			.current_dir(&dir)
			.output()
			.unwrap();
		Command::new("git")
			.args(["commit", "-m", "add large image"])
			.current_dir(&dir)
			.output()
			.unwrap();

		let error = read_head_file(dir.to_string_lossy().as_ref(), "large.bin")
			.unwrap_err();

		assert!(
			matches!(error, AppError::GitError(message) if message.contains("too large"))
		);

		std::fs::remove_dir_all(dir).unwrap();
	}

	// --- Integration tests (temp git repos) ---

	fn create_temp_git_repo() -> std::path::PathBuf {
		let dir = std::env::temp_dir()
			.join(format!("git-infra-test-{}", uuid::Uuid::new_v4()));
		std::fs::create_dir_all(&dir).unwrap();
		Command::new("git")
			.args(["init"])
			.current_dir(&dir)
			.output()
			.unwrap();
		Command::new("git")
			.args(["config", "user.email", "test@test.com"])
			.current_dir(&dir)
			.output()
			.unwrap();
		Command::new("git")
			.args(["config", "user.name", "Test"])
			.current_dir(&dir)
			.output()
			.unwrap();
		dir
	}

	fn add_commit(
		dir: &std::path::Path,
		filename: &str,
		content: &str,
		msg: &str,
	) {
		std::fs::write(dir.join(filename), content).unwrap();
		Command::new("git")
			.args(["add", filename])
			.current_dir(dir)
			.output()
			.unwrap();
		Command::new("git")
			.args(["commit", "-m", msg])
			.current_dir(dir)
			.output()
			.unwrap();
	}

	#[test]
	fn branch_in_git_repo() {
		let dir = create_temp_git_repo();
		add_commit(&dir, "a.txt", "hello", "init");
		let result = branch(&dir.to_string_lossy());
		let _ = std::fs::remove_dir_all(&dir);
		let b = result.unwrap();
		assert!(
			b == "main" || b == "master",
			"expected main or master, got: {b}"
		);
	}

	#[test]
	fn branch_empty_repo() {
		let dir = create_temp_git_repo();
		let result = branch(&dir.to_string_lossy());
		let _ = std::fs::remove_dir_all(&dir);
		let b = result.unwrap();
		assert!(
			b == "main" || b == "master",
			"expected main or master, got: {b}"
		);
	}

	#[test]
	fn branch_non_git_dir() {
		let dir = std::env::temp_dir()
			.join(format!("no-git-infra-{}", uuid::Uuid::new_v4()));
		std::fs::create_dir_all(&dir).unwrap();
		let result = branch(&dir.to_string_lossy());
		let _ = std::fs::remove_dir_all(&dir);
		assert_eq!(result.unwrap(), "main");
	}

	#[test]
	fn log_basic() {
		let dir = create_temp_git_repo();
		add_commit(&dir, "a.txt", "hello", "First");
		add_commit(&dir, "b.txt", "world", "Second");

		let commits = log(&dir.to_string_lossy(), 50).unwrap();
		let _ = std::fs::remove_dir_all(&dir);

		assert_eq!(commits.len(), 2);
		assert_eq!(commits[0].message, "Second");
		assert_eq!(commits[1].message, "First");
	}

	#[test]
	fn log_limit() {
		let dir = create_temp_git_repo();
		add_commit(&dir, "a.txt", "a", "First");
		add_commit(&dir, "b.txt", "b", "Second");
		add_commit(&dir, "c.txt", "c", "Third");

		let commits = log(&dir.to_string_lossy(), 2).unwrap();
		let _ = std::fs::remove_dir_all(&dir);

		assert_eq!(commits.len(), 2);
	}

	#[test]
	fn log_empty_repo() {
		let dir = create_temp_git_repo();
		let commits = log(&dir.to_string_lossy(), 50).unwrap();
		let _ = std::fs::remove_dir_all(&dir);
		assert!(commits.is_empty());
	}

	#[test]
	fn show_returns_patch() {
		let dir = create_temp_git_repo();
		add_commit(&dir, "hello.txt", "hello world", "Add hello");

		let log_output = Command::new("git")
			.args(["log", "-1", "--format=%H"])
			.current_dir(&dir)
			.output()
			.unwrap();
		let hash = String::from_utf8_lossy(&log_output.stdout)
			.trim()
			.to_string();

		let patch = show(&dir.to_string_lossy(), &hash).unwrap();
		let _ = std::fs::remove_dir_all(&dir);

		assert!(patch.contains("hello.txt"));
		assert!(patch.contains("+hello world"));
	}

	#[test]
	fn show_nonexistent_hash() {
		let dir = create_temp_git_repo();
		add_commit(&dir, "a.txt", "a", "Init");

		let result = show(&dir.to_string_lossy(), "deadbeefdeadbeef");
		let _ = std::fs::remove_dir_all(&dir);

		assert!(result.is_err());
	}

	// --- diff tests ---

	#[test]
	fn diff_empty_repo() {
		let dir = create_temp_git_repo();
		let result = diff(&dir.to_string_lossy());
		let _ = std::fs::remove_dir_all(&dir);

		match result {
			Ok(diff) => assert_eq!(diff, ""),
			Err(e) => panic!("diff returned error: {e:?}"),
		}
	}

	#[test]
	fn diff_no_changes() {
		let dir = create_temp_git_repo();
		add_commit(&dir, "a.txt", "hello", "Init");

		let result = diff(&dir.to_string_lossy());
		let _ = std::fs::remove_dir_all(&dir);

		assert!(result.is_ok());
		assert_eq!(result.unwrap(), "");
	}

	#[test]
	fn diff_unstaged_changes() {
		let dir = create_temp_git_repo();
		add_commit(&dir, "a.txt", "hello", "Init");

		std::fs::write(dir.join("a.txt"), "hello world").unwrap();

		let result = diff(&dir.to_string_lossy());
		let _ = std::fs::remove_dir_all(&dir);

		assert!(result.is_ok());
		let diff_output = result.unwrap();
		assert!(diff_output.contains("a.txt"));
		assert!(diff_output.contains("-hello"));
		assert!(diff_output.contains("+hello world"));
	}

	#[test]
	fn diff_staged_changes() {
		let dir = create_temp_git_repo();
		add_commit(&dir, "a.txt", "hello", "Init");

		std::fs::write(dir.join("a.txt"), "hello world").unwrap();
		Command::new("git")
			.args(["add", "a.txt"])
			.current_dir(&dir)
			.output()
			.unwrap();

		let result = diff(&dir.to_string_lossy());
		let _ = std::fs::remove_dir_all(&dir);

		assert!(result.is_ok());
		let diff_output = result.unwrap();
		assert!(diff_output.contains("a.txt"));
		assert!(diff_output.contains("-hello"));
		assert!(diff_output.contains("+hello world"));
	}

	#[test]
	fn diff_staged_and_unstaged() {
		let dir = create_temp_git_repo();
		add_commit(&dir, "a.txt", "hello", "Init");
		add_commit(&dir, "b.txt", "foo", "Add b");

		std::fs::write(dir.join("a.txt"), "hello world").unwrap();
		Command::new("git")
			.args(["add", "a.txt"])
			.current_dir(&dir)
			.output()
			.unwrap();

		std::fs::write(dir.join("b.txt"), "bar").unwrap();

		let result = diff(&dir.to_string_lossy());
		let _ = std::fs::remove_dir_all(&dir);

		assert!(result.is_ok());
		let diff_output = result.unwrap();
		assert!(diff_output.contains("a.txt"));
		assert!(diff_output.contains("b.txt"));
		assert!(diff_output.contains("-hello"));
		assert!(diff_output.contains("+hello world"));
		assert!(diff_output.contains("-foo"));
		assert!(diff_output.contains("+bar"));
	}

	#[test]
	fn diff_new_untracked_file() {
		let dir = create_temp_git_repo();
		add_commit(&dir, "a.txt", "hello", "Init");

		std::fs::write(dir.join("new.txt"), "new content").unwrap();

		let result = diff(&dir.to_string_lossy());
		let _ = std::fs::remove_dir_all(&dir);

		assert!(result.is_ok());
		let diff_output = result.unwrap();
		assert!(diff_output.contains("new.txt"));
		assert!(diff_output.contains("+new content"));
	}

	#[test]
	fn diff_excludes_tracked_files_that_are_now_ignored() {
		let dir = create_temp_git_repo();
		std::fs::create_dir_all(dir.join("build")).unwrap();
		std::fs::write(
			dir.join("build/entitlements.mac.plist"),
			"<plist>tracked</plist>",
		)
		.unwrap();
		Command::new("git")
			.args(["add", "build/entitlements.mac.plist"])
			.current_dir(&dir)
			.output()
			.unwrap();
		Command::new("git")
			.args(["commit", "-m", "Add tracked entitlements"])
			.current_dir(&dir)
			.output()
			.unwrap();

		std::fs::write(dir.join(".gitignore"), "build/\n").unwrap();
		Command::new("git")
			.args(["add", ".gitignore"])
			.current_dir(&dir)
			.output()
			.unwrap();
		Command::new("git")
			.args(["commit", "-m", "Ignore build output"])
			.current_dir(&dir)
			.output()
			.unwrap();

		let diff_output = diff(&dir.to_string_lossy()).unwrap();
		let stats = diff_stats(&dir.to_string_lossy()).unwrap();
		let _ = std::fs::remove_dir_all(&dir);

		assert_eq!(diff_output, "");
		assert_eq!(stats.files_changed, 0);
		assert_eq!(stats.insertions, 0);
		assert_eq!(stats.deletions, 0);
	}

	#[test]
	fn discard_changes_restores_tracked_untracked_and_renamed_paths() {
		let dir = create_temp_git_repo();
		add_commit(&dir, "tracked.txt", "hello", "Init tracked");
		add_commit(&dir, "rename-me.txt", "rename me", "Init rename");

		std::fs::write(dir.join("tracked.txt"), "updated").unwrap();
		std::fs::write(dir.join("new.txt"), "new content").unwrap();
		std::fs::rename(dir.join("rename-me.txt"), dir.join("renamed.txt"))
			.unwrap();

		discard_changes(
			&dir.to_string_lossy(),
			&[
				"tracked.txt".into(),
				"new.txt".into(),
				"renamed.txt".into(),
				"rename-me.txt".into(),
			],
		)
		.unwrap();

		assert_eq!(
			std::fs::read_to_string(dir.join("tracked.txt")).unwrap(),
			"hello"
		);
		assert!(!dir.join("new.txt").exists());
		assert!(!dir.join("renamed.txt").exists());
		assert_eq!(
			std::fs::read_to_string(dir.join("rename-me.txt")).unwrap(),
			"rename me"
		);

		let status = Command::new("git")
			.args(["status", "--short"])
			.current_dir(&dir)
			.output()
			.unwrap();
		assert!(String::from_utf8_lossy(&status.stdout).trim().is_empty());
	}

	// --- index_status / parse_porcelain_v2_z ---

	fn create_index_status_repo() -> tempfile::TempDir {
		let dir = tempfile::tempdir().unwrap();
		Command::new("git").arg("init").current_dir(dir.path()).output().unwrap();
		Command::new("git")
			.args(["config", "user.email", "test@test.com"])
			.current_dir(dir.path())
			.output()
			.unwrap();
		Command::new("git")
			.args(["config", "user.name", "Test"])
			.current_dir(dir.path())
			.output()
			.unwrap();
		std::fs::write(dir.path().join("a.txt"), "alpha\n").unwrap();
		std::fs::write(dir.path().join("b.txt"), "bravo\n").unwrap();
		Command::new("git")
			.args(["add", "."])
			.current_dir(dir.path())
			.output()
			.unwrap();
		Command::new("git")
			.args(["commit", "-m", "init"])
			.current_dir(dir.path())
			.output()
			.unwrap();
		dir
	}

	#[test]
	fn index_status_empty_when_clean() {
		let dir = create_index_status_repo();
		let status =
			index_status(&dir.path().to_string_lossy()).expect("index_status");
		assert!(status.staged.is_empty());
		assert!(status.unstaged.is_empty());
	}

	#[test]
	fn index_status_classifies_unstaged_modifications() {
		let dir = create_index_status_repo();
		std::fs::write(dir.path().join("a.txt"), "alpha modified\n").unwrap();
		let status =
			index_status(&dir.path().to_string_lossy()).expect("index_status");
		assert_eq!(status.staged.len(), 0);
		assert_eq!(status.unstaged.len(), 1);
		assert_eq!(status.unstaged[0].path, "a.txt");
		assert_eq!(status.unstaged[0].kind, GitChangeKind::Modified);
	}

	#[test]
	fn index_status_classifies_staged_modifications() {
		let dir = create_index_status_repo();
		std::fs::write(dir.path().join("a.txt"), "alpha modified\n").unwrap();
		Command::new("git")
			.args(["add", "a.txt"])
			.current_dir(dir.path())
			.output()
			.unwrap();
		let status =
			index_status(&dir.path().to_string_lossy()).expect("index_status");
		assert_eq!(status.staged.len(), 1);
		assert_eq!(status.staged[0].kind, GitChangeKind::Modified);
		assert!(status.unstaged.is_empty());
	}

	#[test]
	fn index_status_classifies_untracked() {
		let dir = create_index_status_repo();
		std::fs::write(dir.path().join("c.txt"), "charlie\n").unwrap();
		let status =
			index_status(&dir.path().to_string_lossy()).expect("index_status");
		assert_eq!(status.unstaged.len(), 1);
		assert_eq!(status.unstaged[0].path, "c.txt");
		assert_eq!(status.unstaged[0].kind, GitChangeKind::Untracked);
	}

	#[test]
	fn index_status_classifies_deleted() {
		let dir = create_index_status_repo();
		std::fs::remove_file(dir.path().join("a.txt")).unwrap();
		let status =
			index_status(&dir.path().to_string_lossy()).expect("index_status");
		assert_eq!(status.unstaged.len(), 1);
		assert_eq!(status.unstaged[0].kind, GitChangeKind::Deleted);
	}

	#[test]
	fn index_status_classifies_added_then_modified() {
		// Same file: staged add + further unstaged modification.
		let dir = create_index_status_repo();
		std::fs::write(dir.path().join("c.txt"), "charlie\n").unwrap();
		Command::new("git")
			.args(["add", "c.txt"])
			.current_dir(dir.path())
			.output()
			.unwrap();
		std::fs::write(dir.path().join("c.txt"), "charlie modified\n").unwrap();
		let status =
			index_status(&dir.path().to_string_lossy()).expect("index_status");
		assert_eq!(status.staged.len(), 1);
		assert_eq!(status.staged[0].kind, GitChangeKind::Added);
		assert_eq!(status.unstaged.len(), 1);
		assert_eq!(status.unstaged[0].kind, GitChangeKind::Modified);
	}

	#[test]
	fn index_status_classifies_renames() {
		let dir = create_index_status_repo();
		std::fs::rename(
			dir.path().join("a.txt"),
			dir.path().join("a-renamed.txt"),
		)
		.unwrap();
		Command::new("git")
			.args(["add", "."])
			.current_dir(dir.path())
			.output()
			.unwrap();
		let status =
			index_status(&dir.path().to_string_lossy()).expect("index_status");
		assert_eq!(status.staged.len(), 1);
		assert_eq!(status.staged[0].kind, GitChangeKind::Renamed);
		assert_eq!(status.staged[0].path, "a-renamed.txt");
		assert_eq!(
			status.staged[0].original_path.as_deref(),
			Some("a.txt")
		);
	}

	#[test]
	fn index_status_handles_non_repo() {
		let dir = tempfile::tempdir().unwrap();
		let status =
			index_status(&dir.path().to_string_lossy()).expect("index_status");
		assert!(status.staged.is_empty() && status.unstaged.is_empty());
	}

	// --- stage_hunk / unstage_hunk ---

	/// Helper: get the worktree-vs-HEAD patch for a single file.
	fn patch_for_file(dir: &std::path::Path, path: &str) -> (String, Vec<String>) {
		let out = Command::new("git")
			.args(["diff", "--no-color", "--", path])
			.current_dir(dir)
			.output()
			.unwrap();
		let s = String::from_utf8_lossy(&out.stdout).to_string();

		// Split into header (everything before first @@) and hunk(s).
		let header_end = s.find("\n@@").map(|i| i + 1).unwrap_or(s.len());
		let header = s[..header_end].trim_end_matches('\n').to_string();

		let mut hunks = Vec::new();
		let mut current = String::new();
		for line in s[header_end..].lines() {
			if line.starts_with("@@") && !current.is_empty() {
				hunks.push(std::mem::take(&mut current));
			}
			current.push_str(line);
			current.push('\n');
		}
		if !current.is_empty() {
			hunks.push(current);
		}
		(header, hunks)
	}

	#[test]
	fn stage_hunk_moves_change_to_index() {
		let dir = create_index_status_repo();
		std::fs::write(
			dir.path().join("a.txt"),
			"alpha\nadded line\n",
		)
		.unwrap();

		let (header, hunks) = patch_for_file(dir.path(), "a.txt");
		assert!(!hunks.is_empty(), "expected at least one hunk");

		stage_hunk(&dir.path().to_string_lossy(), &header, &hunks)
			.expect("stage_hunk");

		let status = index_status(&dir.path().to_string_lossy()).unwrap();
		assert_eq!(status.staged.len(), 1);
		assert_eq!(status.staged[0].path, "a.txt");
		assert_eq!(status.staged[0].kind, GitChangeKind::Modified);
		assert!(
			status.unstaged.is_empty(),
			"after staging, no unstaged changes"
		);
	}

	#[test]
	fn unstage_hunk_moves_change_back_to_worktree() {
		let dir = create_index_status_repo();
		std::fs::write(dir.path().join("a.txt"), "alpha\nadded\n").unwrap();
		Command::new("git")
			.args(["add", "a.txt"])
			.current_dir(dir.path())
			.output()
			.unwrap();

		// Get the staged patch so we can unstage it.
		let out = Command::new("git")
			.args(["diff", "--cached", "--no-color", "--", "a.txt"])
			.current_dir(dir.path())
			.output()
			.unwrap();
		let s = String::from_utf8_lossy(&out.stdout).to_string();
		let header_end = s.find("\n@@").map(|i| i + 1).unwrap_or(s.len());
		let header = s[..header_end].trim_end_matches('\n').to_string();
		let hunk = s[header_end..].to_string();

		unstage_hunk(&dir.path().to_string_lossy(), &header, &[hunk])
			.expect("unstage_hunk");

		let status = index_status(&dir.path().to_string_lossy()).unwrap();
		assert!(status.staged.is_empty(), "after unstage, nothing staged");
		assert_eq!(status.unstaged.len(), 1);
		assert_eq!(status.unstaged[0].kind, GitChangeKind::Modified);
	}

	#[test]
	fn stage_hunk_partial_keeps_other_hunks_unstaged() {
		let dir = create_index_status_repo();
		// Make a file with two distinct hunks (header changes + footer changes)
		std::fs::write(
			dir.path().join("multi.txt"),
			"line1\nline2\nline3\nline4\nline5\nline6\nline7\nline8\nline9\nline10\n",
		)
		.unwrap();
		Command::new("git")
			.args(["add", "multi.txt"])
			.current_dir(dir.path())
			.output()
			.unwrap();
		Command::new("git")
			.args(["commit", "-m", "add multi"])
			.current_dir(dir.path())
			.output()
			.unwrap();

		// Modify both top and bottom — should produce two hunks.
		std::fs::write(
			dir.path().join("multi.txt"),
			"LINE1\nline2\nline3\nline4\nline5\nline6\nline7\nline8\nline9\nLINE10\n",
		)
		.unwrap();

		let (header, hunks) = patch_for_file(dir.path(), "multi.txt");
		assert_eq!(hunks.len(), 2, "expected 2 hunks, got {}", hunks.len());

		// Stage only the first hunk.
		stage_hunk(&dir.path().to_string_lossy(), &header, &[hunks[0].clone()])
			.expect("stage_hunk");

		let status = index_status(&dir.path().to_string_lossy()).unwrap();
		// File should appear in BOTH staged and unstaged: first hunk staged,
		// second still unstaged.
		assert_eq!(status.staged.len(), 1);
		assert_eq!(status.unstaged.len(), 1);
		assert_eq!(status.staged[0].path, "multi.txt");
		assert_eq!(status.unstaged[0].path, "multi.txt");
	}

	#[test]
	fn stage_hunk_rejects_empty_header() {
		let result = stage_hunk("/tmp/anywhere", "   ", &["@@ -1 +1 @@".into()]);
		assert!(result.is_err());
	}

	#[test]
	fn stage_hunk_rejects_empty_hunks() {
		let dir = create_index_status_repo();
		let result = stage_hunk(
			&dir.path().to_string_lossy(),
			"diff --git a/x b/x",
			&[],
		);
		assert!(result.is_err());
	}

	#[test]
	fn stage_hunk_rejects_hunk_missing_header() {
		let dir = create_index_status_repo();
		let result = stage_hunk(
			&dir.path().to_string_lossy(),
			"diff --git a/x b/x",
			&["+just a line\n".into()],
		);
		assert!(result.is_err());
	}

	// --- stage_lines / synthesize_partial_hunk ---

	#[test]
	fn synthesize_drops_unselected_added_lines() {
		// Hunk body indices: 0=context, 1='+a', 2='+b', 3=context
		let hunk = "@@ -1,2 +1,4 @@\n line1\n+added a\n+added b\n line2\n";
		// Select only line index 1 (the first '+')
		let result = synthesize_partial_hunk(hunk, &[1], false).unwrap();
		assert!(result.contains("+added a"));
		assert!(!result.contains("+added b"));
		assert!(result.contains(" line1"));
		assert!(result.contains(" line2"));
	}

	#[test]
	fn synthesize_converts_unselected_deletions_to_context() {
		// Body: 0='-old1', 1='-old2', 2='+new'
		let hunk = "@@ -1,2 +1,1 @@\n-old1\n-old2\n+new\n";
		// Select only the '+new' line at index 2 — both deletions become context
		let result = synthesize_partial_hunk(hunk, &[2], false).unwrap();
		assert!(result.contains("+new"));
		assert!(result.contains(" old1"));
		assert!(result.contains(" old2"));
		// Should not contain '-old1' or '-old2' anymore
		assert!(!result.contains("-old1"));
		assert!(!result.contains("-old2"));
	}

	#[test]
	fn synthesize_rejects_no_selection() {
		let hunk = "@@ -1 +1 @@\n-old\n+new\n";
		let result = synthesize_partial_hunk(hunk, &[], false);
		assert!(result.is_err());
	}

	#[test]
	fn synthesize_rejects_empty_hunk() {
		let result = synthesize_partial_hunk("", &[0], false);
		assert!(result.is_err());
	}

	#[test]
	fn synthesize_rejects_hunk_without_header() {
		let result = synthesize_partial_hunk("+just a line\n", &[0], false);
		assert!(result.is_err());
	}

	// --- stage_files / unstage_files (whole-file) ---

	#[test]
	fn stage_files_stages_modifications() {
		let dir = create_index_status_repo();
		std::fs::write(dir.path().join("a.txt"), "alpha changed\n").unwrap();
		stage_files(&dir.path().to_string_lossy(), &["a.txt".into()])
			.expect("stage_files");
		let s = index_status(&dir.path().to_string_lossy()).unwrap();
		assert_eq!(s.staged.len(), 1);
		assert!(s.unstaged.is_empty());
	}

	#[test]
	fn unstage_files_unstages_modifications() {
		let dir = create_index_status_repo();
		std::fs::write(dir.path().join("a.txt"), "alpha changed\n").unwrap();
		Command::new("git")
			.args(["add", "a.txt"])
			.current_dir(dir.path())
			.output()
			.unwrap();
		unstage_files(&dir.path().to_string_lossy(), &["a.txt".into()])
			.expect("unstage_files");
		let s = index_status(&dir.path().to_string_lossy()).unwrap();
		assert!(s.staged.is_empty());
		assert_eq!(s.unstaged.len(), 1);
	}

	#[test]
	fn stage_files_rejects_empty_path_list() {
		let dir = create_index_status_repo();
		let result = stage_files(&dir.path().to_string_lossy(), &[]);
		assert!(result.is_err());
	}

	#[test]
	fn stage_files_rejects_path_escape() {
		let dir = create_index_status_repo();
		let result =
			stage_files(&dir.path().to_string_lossy(), &["../escape".into()]);
		assert!(result.is_err());
	}

	// --- remote_add ---

	#[test]
	fn remote_add_creates_remote() {
		let dir = create_index_status_repo();
		remote_add(
			&dir.path().to_string_lossy(),
			"origin",
			"https://github.com/foo/bar.git",
		)
		.unwrap();
		let out = Command::new("git")
			.args(["remote", "-v"])
			.current_dir(dir.path())
			.output()
			.unwrap();
		let listing = String::from_utf8_lossy(&out.stdout);
		assert!(listing.contains("origin"));
		assert!(listing.contains("github.com/foo/bar"));
	}

	#[test]
	fn remote_add_rejects_empty_name_or_url() {
		let dir = create_index_status_repo();
		let folder = dir.path().to_string_lossy().to_string();
		assert!(remote_add(&folder, "", "https://x").is_err());
		assert!(remote_add(&folder, "origin", "").is_err());
		assert!(remote_add(&folder, "  ", "https://x").is_err());
	}

	#[test]
	fn remote_add_rejects_argv_injection_attempts() {
		let dir = create_index_status_repo();
		let folder = dir.path().to_string_lossy().to_string();
		assert!(remote_add(&folder, "-flag", "https://x").is_err());
		assert!(remote_add(&folder, "origin", "--upload-pack=evil").is_err());
		assert!(remote_add(&folder, "bad name", "https://x").is_err());
	}

	#[test]
	fn remote_add_rejects_duplicate() {
		let dir = create_index_status_repo();
		let folder = dir.path().to_string_lossy().to_string();
		remote_add(&folder, "origin", "https://github.com/a/b.git").unwrap();
		// git itself errors on duplicate; we surface the stderr.
		let result = remote_add(&folder, "origin", "https://github.com/c/d.git");
		assert!(result.is_err());
	}

	#[test]
	fn stage_lines_stages_only_selected_addition() {
		let dir = create_index_status_repo();
		// Set up a file with two consecutive additions (one hunk, two '+' lines)
		std::fs::write(
			dir.path().join("a.txt"),
			"alpha\nadded one\nadded two\n",
		)
		.unwrap();

		let (header, hunks) = patch_for_file(dir.path(), "a.txt");
		assert_eq!(hunks.len(), 1);

		// Find the index of the first '+' line in the hunk body.
		let body: Vec<&str> = hunks[0].lines().skip(1).collect();
		let first_plus = body
			.iter()
			.position(|l| l.starts_with('+'))
			.expect("should have a + line");

		stage_lines(
			&dir.path().to_string_lossy(),
			&header,
			&hunks[0],
			&[first_plus],
		)
		.expect("stage_lines");

		// Confirm the staged diff contains the first added line but not both.
		let staged = Command::new("git")
			.args(["diff", "--cached", "--no-color", "--", "a.txt"])
			.current_dir(dir.path())
			.output()
			.unwrap();
		let staged_text = String::from_utf8_lossy(&staged.stdout);
		assert!(staged_text.contains("+added one"));
		assert!(!staged_text.contains("+added two"));
	}

	// --- file_patch (per-file diff used by the diff tab) ---

	#[test]
	fn file_patch_returns_diff_for_modified_tracked_file() {
		let dir = create_index_status_repo();
		std::fs::write(dir.path().join("a.txt"), "alpha modified\n").unwrap();
		let patch = file_patch(
			&dir.path().to_string_lossy(),
			"a.txt",
			false,
		)
		.unwrap();
		assert!(patch.contains("a.txt"), "patch should reference path");
		assert!(patch.contains("+alpha modified"));
	}

	#[test]
	fn file_patch_returns_synthetic_diff_for_untracked_file() {
		let dir = create_index_status_repo();
		std::fs::write(
			dir.path().join("brand-new.txt"),
			"line one\nline two\n",
		)
		.unwrap();
		let patch = file_patch(
			&dir.path().to_string_lossy(),
			"brand-new.txt",
			false,
		)
		.unwrap();
		assert!(
			!patch.is_empty(),
			"untracked file should still produce a patch"
		);
		assert!(patch.contains("brand-new.txt"));
		assert!(patch.contains("+line one"));
		assert!(patch.contains("+line two"));
	}

	#[test]
	fn file_patch_staged_returns_index_diff() {
		let dir = create_index_status_repo();
		std::fs::write(dir.path().join("a.txt"), "alpha staged\n").unwrap();
		Command::new("git")
			.args(["add", "a.txt"])
			.current_dir(dir.path())
			.output()
			.unwrap();
		let patch = file_patch(
			&dir.path().to_string_lossy(),
			"a.txt",
			true,
		)
		.unwrap();
		assert!(patch.contains("+alpha staged"));
	}

	#[test]
	fn commit_files_returns_added_modified_deleted() {
		let dir = create_index_status_repo();
		// Existing commit added a.txt + b.txt.
		std::fs::write(dir.path().join("a.txt"), "alpha edited\n").unwrap();
		std::fs::remove_file(dir.path().join("b.txt")).unwrap();
		std::fs::write(dir.path().join("c.txt"), "charlie\n").unwrap();
		Command::new("git")
			.args(["add", "-A"])
			.current_dir(dir.path())
			.output()
			.unwrap();
		Command::new("git")
			.args(["commit", "-m", "mixed"])
			.current_dir(dir.path())
			.output()
			.unwrap();
		let head = Command::new("git")
			.args(["rev-parse", "HEAD"])
			.current_dir(dir.path())
			.output()
			.unwrap();
		let head = String::from_utf8_lossy(&head.stdout).trim().to_string();

		let entries =
			commit_files(&dir.path().to_string_lossy(), &head).unwrap();
		assert_eq!(entries.len(), 3);

		let by_path: std::collections::HashMap<_, _> =
			entries.iter().map(|e| (e.path.as_str(), e.kind)).collect();
		assert_eq!(by_path.get("a.txt"), Some(&GitChangeKind::Modified));
		assert_eq!(by_path.get("b.txt"), Some(&GitChangeKind::Deleted));
		assert_eq!(by_path.get("c.txt"), Some(&GitChangeKind::Added));
	}

	#[test]
	fn commit_files_rejects_invalid_hash() {
		let dir = create_index_status_repo();
		assert!(
			commit_files(&dir.path().to_string_lossy(), "not-hex").is_err()
		);
	}

	#[test]
	fn revert_file_in_commit_restores_modified_file() {
		let dir = create_index_status_repo();
		std::fs::write(dir.path().join("a.txt"), "alpha v2\n").unwrap();
		Command::new("git")
			.args(["commit", "-am", "v2"])
			.current_dir(dir.path())
			.output()
			.unwrap();
		let head = Command::new("git")
			.args(["rev-parse", "HEAD"])
			.current_dir(dir.path())
			.output()
			.unwrap();
		let head = String::from_utf8_lossy(&head.stdout).trim().to_string();

		// Pre-condition: worktree has v2 contents.
		assert_eq!(
			std::fs::read_to_string(dir.path().join("a.txt")).unwrap(),
			"alpha v2\n"
		);

		revert_file_in_commit(
			&dir.path().to_string_lossy(),
			&head,
			"a.txt",
		)
		.unwrap();

		// After revert: worktree has the parent (v1) contents.
		assert_eq!(
			std::fs::read_to_string(dir.path().join("a.txt")).unwrap(),
			"alpha\n"
		);
	}

	#[test]
	fn revert_file_in_commit_removes_added_file() {
		let dir = create_index_status_repo();
		std::fs::write(dir.path().join("c.txt"), "charlie\n").unwrap();
		Command::new("git")
			.args(["add", "c.txt"])
			.current_dir(dir.path())
			.output()
			.unwrap();
		Command::new("git")
			.args(["commit", "-m", "add c"])
			.current_dir(dir.path())
			.output()
			.unwrap();
		let head = Command::new("git")
			.args(["rev-parse", "HEAD"])
			.current_dir(dir.path())
			.output()
			.unwrap();
		let head = String::from_utf8_lossy(&head.stdout).trim().to_string();

		assert!(dir.path().join("c.txt").exists());
		revert_file_in_commit(
			&dir.path().to_string_lossy(),
			&head,
			"c.txt",
		)
		.unwrap();
		assert!(!dir.path().join("c.txt").exists());
	}

	#[test]
	fn revert_file_in_commit_restores_deleted_file() {
		let dir = create_index_status_repo();
		std::fs::remove_file(dir.path().join("a.txt")).unwrap();
		Command::new("git")
			.args(["commit", "-am", "remove a"])
			.current_dir(dir.path())
			.output()
			.unwrap();
		let head = Command::new("git")
			.args(["rev-parse", "HEAD"])
			.current_dir(dir.path())
			.output()
			.unwrap();
		let head = String::from_utf8_lossy(&head.stdout).trim().to_string();

		assert!(!dir.path().join("a.txt").exists());
		revert_file_in_commit(
			&dir.path().to_string_lossy(),
			&head,
			"a.txt",
		)
		.unwrap();
		assert_eq!(
			std::fs::read_to_string(dir.path().join("a.txt")).unwrap(),
			"alpha\n"
		);
	}

	#[test]
	fn revert_file_in_commit_rejects_invalid_hash() {
		let dir = create_index_status_repo();
		assert!(
			revert_file_in_commit(
				&dir.path().to_string_lossy(),
				"not-hex",
				"a.txt"
			)
			.is_err()
		);
	}

	#[test]
	fn commit_file_diff_sides_returns_both_sides() {
		let dir = create_index_status_repo();
		std::fs::write(dir.path().join("a.txt"), "alpha v2\n").unwrap();
		Command::new("git")
			.args(["commit", "-am", "v2"])
			.current_dir(dir.path())
			.output()
			.unwrap();
		let head = Command::new("git")
			.args(["rev-parse", "HEAD"])
			.current_dir(dir.path())
			.output()
			.unwrap();
		let head = String::from_utf8_lossy(&head.stdout).trim().to_string();

		let sides = commit_file_diff_sides(
			&dir.path().to_string_lossy(),
			&head,
			"a.txt",
			None,
		)
		.unwrap();
		assert_eq!(sides.original.as_deref(), Some("alpha\n"));
		assert_eq!(sides.modified.as_deref(), Some("alpha v2\n"));
	}

	#[test]
	fn commit_file_diff_sides_added_file_has_no_original() {
		let dir = create_index_status_repo();
		std::fs::write(dir.path().join("c.txt"), "charlie\n").unwrap();
		Command::new("git")
			.args(["add", "c.txt"])
			.current_dir(dir.path())
			.output()
			.unwrap();
		Command::new("git")
			.args(["commit", "-m", "add c"])
			.current_dir(dir.path())
			.output()
			.unwrap();
		let head = Command::new("git")
			.args(["rev-parse", "HEAD"])
			.current_dir(dir.path())
			.output()
			.unwrap();
		let head = String::from_utf8_lossy(&head.stdout).trim().to_string();

		let sides = commit_file_diff_sides(
			&dir.path().to_string_lossy(),
			&head,
			"c.txt",
			None,
		)
		.unwrap();
		assert!(sides.original.is_none());
		assert_eq!(sides.modified.as_deref(), Some("charlie\n"));
	}

	#[test]
	fn commit_file_diff_sides_merged_with_uses_older_parent() {
		// Three commits modifying the same file. Diff for the newest with
		// merged_with=oldest should span the full history.
		let dir = create_index_status_repo();

		std::fs::write(dir.path().join("a.txt"), "alpha v2\n").unwrap();
		Command::new("git")
			.args(["commit", "-am", "v2"])
			.current_dir(dir.path())
			.output()
			.unwrap();
		let v2 = Command::new("git")
			.args(["rev-parse", "HEAD"])
			.current_dir(dir.path())
			.output()
			.unwrap();
		let v2 = String::from_utf8_lossy(&v2.stdout).trim().to_string();

		std::fs::write(dir.path().join("a.txt"), "alpha v3\n").unwrap();
		Command::new("git")
			.args(["commit", "-am", "v3"])
			.current_dir(dir.path())
			.output()
			.unwrap();
		let v3 = Command::new("git")
			.args(["rev-parse", "HEAD"])
			.current_dir(dir.path())
			.output()
			.unwrap();
		let v3 = String::from_utf8_lossy(&v3.stdout).trim().to_string();

		// Without merged_with: original = v3's parent = v2's content.
		let sides_single = commit_file_diff_sides(
			&dir.path().to_string_lossy(),
			&v3,
			"a.txt",
			None,
		)
		.unwrap();
		assert_eq!(sides_single.original.as_deref(), Some("alpha v2\n"));
		assert_eq!(sides_single.modified.as_deref(), Some("alpha v3\n"));

		// With merged_with=v2 (the older selected commit): original = v2's
		// parent = original "alpha\n".
		let sides_range = commit_file_diff_sides(
			&dir.path().to_string_lossy(),
			&v3,
			"a.txt",
			Some(&v2),
		)
		.unwrap();
		assert_eq!(sides_range.original.as_deref(), Some("alpha\n"));
		assert_eq!(sides_range.modified.as_deref(), Some("alpha v3\n"));
	}

	#[test]
	fn file_patch_empty_for_unchanged_tracked_file() {
		let dir = create_index_status_repo();
		// a.txt was committed unchanged; no diff expected.
		let patch = file_patch(
			&dir.path().to_string_lossy(),
			"a.txt",
			false,
		)
		.unwrap();
		assert!(patch.is_empty(), "no diff for unchanged file");
	}

	// --- merge_ref / rebase_onto / delete_remote_branch / rename_remote_branch ---

	fn current_branch_name(folder: &str) -> String {
		let out = Command::new("git")
			.args(["rev-parse", "--abbrev-ref", "HEAD"])
			.current_dir(folder)
			.output()
			.unwrap();
		String::from_utf8(out.stdout).unwrap().trim().to_string()
	}

	#[test]
	fn merge_ref_fast_forwards_clean_branch() {
		let dir = create_index_status_repo();
		let folder = dir.path().to_string_lossy().to_string();
		let initial = current_branch_name(&folder);
		// Create a feature branch with one extra commit, then return to
		// the initial branch and merge — should fast-forward.
		Command::new("git")
			.args(["checkout", "-b", "feat"])
			.current_dir(dir.path())
			.output()
			.unwrap();
		std::fs::write(dir.path().join("c.txt"), "charlie\n").unwrap();
		Command::new("git").args(["add", "c.txt"]).current_dir(dir.path()).output().unwrap();
		Command::new("git").args(["commit", "-m", "feat"]).current_dir(dir.path()).output().unwrap();
		Command::new("git").args(["checkout", &initial]).current_dir(dir.path()).output().unwrap();

		let token = super::super::cancel::CancelToken::new();
		merge_ref(&folder, "feat", &token).unwrap();
		assert!(dir.path().join("c.txt").exists(), "fast-forwarded file should be present");
	}

	#[test]
	fn rebase_onto_replays_commits() {
		let dir = create_index_status_repo();
		let folder = dir.path().to_string_lossy().to_string();
		let initial = current_branch_name(&folder);
		// Branch off, add one commit on initial branch, switch to feat,
		// add another commit, then rebase feat onto initial.
		Command::new("git")
			.args(["checkout", "-b", "feat"])
			.current_dir(dir.path())
			.output()
			.unwrap();
		Command::new("git").args(["checkout", &initial]).current_dir(dir.path()).output().unwrap();
		std::fs::write(dir.path().join("d.txt"), "delta\n").unwrap();
		Command::new("git").args(["add", "d.txt"]).current_dir(dir.path()).output().unwrap();
		Command::new("git").args(["commit", "-m", "delta"]).current_dir(dir.path()).output().unwrap();
		Command::new("git").args(["checkout", "feat"]).current_dir(dir.path()).output().unwrap();
		std::fs::write(dir.path().join("e.txt"), "echo\n").unwrap();
		Command::new("git").args(["add", "e.txt"]).current_dir(dir.path()).output().unwrap();
		Command::new("git").args(["commit", "-m", "echo"]).current_dir(dir.path()).output().unwrap();

		let token = super::super::cancel::CancelToken::new();
		rebase_onto(&folder, &initial, &token).unwrap();
		// After rebase, both d.txt (from initial) and e.txt (from feat) are present.
		assert!(dir.path().join("d.txt").exists());
		assert!(dir.path().join("e.txt").exists());
	}

	fn make_bare_remote() -> tempfile::TempDir {
		let bare = tempfile::tempdir().unwrap();
		Command::new("git")
			.args(["init", "--bare"])
			.current_dir(bare.path())
			.output()
			.unwrap();
		bare
	}

	fn clone_with_remote_branches(
		bare: &tempfile::TempDir,
		branches: &[&str],
	) -> tempfile::TempDir {
		// Working clone, seed it, push each requested branch.
		let work = tempfile::tempdir().unwrap();
		Command::new("git")
			.args(["clone", &bare.path().to_string_lossy(), "."])
			.current_dir(work.path())
			.output()
			.unwrap();
		Command::new("git")
			.args(["config", "user.email", "test@test.com"])
			.current_dir(work.path())
			.output()
			.unwrap();
		Command::new("git")
			.args(["config", "user.name", "Test"])
			.current_dir(work.path())
			.output()
			.unwrap();
		std::fs::write(work.path().join("a.txt"), "a\n").unwrap();
		Command::new("git").args(["add", "a.txt"]).current_dir(work.path()).output().unwrap();
		Command::new("git").args(["commit", "-m", "init"]).current_dir(work.path()).output().unwrap();
		// Force the initial branch name we'll push as.
		Command::new("git").args(["branch", "-M", branches[0]]).current_dir(work.path()).output().unwrap();
		Command::new("git").args(["push", "-u", "origin", branches[0]]).current_dir(work.path()).output().unwrap();
		for b in &branches[1..] {
			Command::new("git").args(["checkout", "-b", b]).current_dir(work.path()).output().unwrap();
			Command::new("git").args(["push", "-u", "origin", b]).current_dir(work.path()).output().unwrap();
		}
		// Switch back to the first branch so subsequent operations (delete,
		// rename) don't try to mutate the currently-checked-out branch.
		Command::new("git").args(["checkout", branches[0]]).current_dir(work.path()).output().unwrap();
		Command::new("git").args(["fetch", "--prune"]).current_dir(work.path()).output().unwrap();
		work
	}

	#[test]
	fn delete_remote_branch_removes_ref_on_remote() {
		let bare = make_bare_remote();
		let work = clone_with_remote_branches(&bare, &["main", "to-delete"]);
		let folder = work.path().to_string_lossy().to_string();
		let token = super::super::cancel::CancelToken::new();

		delete_remote_branch(&folder, "origin", "to-delete", &token).unwrap();

		// Re-fetch and verify the remote ref no longer exists.
		Command::new("git").args(["fetch", "--prune"]).current_dir(work.path()).output().unwrap();
		let out = Command::new("git")
			.args(["branch", "-r"])
			.current_dir(work.path())
			.output()
			.unwrap();
		let s = String::from_utf8_lossy(&out.stdout);
		assert!(!s.contains("origin/to-delete"), "deleted ref should be gone from `git branch -r`: {s}");
	}

	#[test]
	fn rename_remote_branch_pushes_new_then_drops_old() {
		let bare = make_bare_remote();
		let work = clone_with_remote_branches(&bare, &["main", "old-name"]);
		let folder = work.path().to_string_lossy().to_string();
		let token = super::super::cancel::CancelToken::new();

		rename_remote_branch(&folder, "origin", "old-name", "new-name", &token)
			.unwrap();

		Command::new("git").args(["fetch", "--prune"]).current_dir(work.path()).output().unwrap();
		let out = Command::new("git")
			.args(["branch", "-r"])
			.current_dir(work.path())
			.output()
			.unwrap();
		let s = String::from_utf8_lossy(&out.stdout);
		assert!(s.contains("origin/new-name"), "new ref should exist: {s}");
		assert!(!s.contains("origin/old-name"), "old ref should be gone: {s}");
	}

	#[test]
	fn rename_remote_branch_rejects_same_name() {
		let bare = make_bare_remote();
		let work = clone_with_remote_branches(&bare, &["main"]);
		let folder = work.path().to_string_lossy().to_string();
		let token = super::super::cancel::CancelToken::new();
		assert!(
			rename_remote_branch(&folder, "origin", "main", "main", &token)
				.is_err()
		);
	}

	#[test]
	fn validate_remote_token_rejects_dash_and_colon() {
		assert!(validate_remote_token("-rf").is_err());
		assert!(validate_remote_token("foo:bar").is_err());
		assert!(validate_remote_token("").is_err());
		assert!(validate_remote_token("origin").is_ok());
		assert!(validate_remote_token("feat/auth").is_ok());
	}

	#[test]
	fn validate_revspec_allows_slash_rejects_dash() {
		assert!(validate_revspec("origin/main").is_ok());
		assert!(validate_revspec("abc1234").is_ok());
		assert!(validate_revspec("--all").is_err());
		assert!(validate_revspec("").is_err());
	}
}
