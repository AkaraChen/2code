use std::collections::hash_map::DefaultHasher;
use std::collections::HashSet;
use std::hash::{Hash, Hasher};
use std::io::Write;
use std::path::{Component, Path};
use std::process::Command;

use model::error::AppError;
use model::filesystem::FileTreeGitStatusEntry;
use model::project::{GitAuthor, GitCommit, GitDiffStats};

const MAX_BINARY_PREVIEW_BYTES: usize = 20 * 1024 * 1024;

pub fn init(dir: &Path) -> Result<(), AppError> {
	let output = Command::new("git").arg("init").current_dir(dir).output()?;

	if !output.status.success() {
		let stderr = String::from_utf8_lossy(&output.stderr);
		return Err(AppError::PtyError(format!("git init failed: {stderr}")));
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
}
