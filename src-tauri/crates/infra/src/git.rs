use std::collections::hash_map::DefaultHasher;
use std::collections::{HashMap, HashSet};
use std::hash::{Hash, Hasher};
use std::io::Write;
use std::path::{Component, Path};
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

use crate::no_window::command_without_windows_console;

use model::error::AppError;
use model::filesystem::FileTreeGitStatusEntry;
use model::project::{
	GitAuthor, GitBranchInfo, GitCommit, GitDiffSnapshot, GitDiffStats,
	GitPullRequestStatus,
};

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct GhPullRequest {
	number: u32,
	title: String,
	state: String,
	url: String,
	is_draft: bool,
	head_ref_name: String,
	head_repository_owner: Option<GhPullRequestOwner>,
}

#[derive(serde::Deserialize)]
struct GhPullRequestOwner {
	login: String,
}

const MAX_BINARY_PREVIEW_BYTES: usize = 20 * 1024 * 1024;
const GH_COMMAND_TIMEOUT: Duration = Duration::from_secs(10);

#[derive(Clone)]
struct CachedDiff {
	fingerprint: u64,
	stats: GitDiffStats,
	snapshot: Option<GitDiffSnapshot>,
}

#[derive(Clone)]
struct CachedLog {
	head_oid: String,
	commits: Vec<GitCommit>,
}

static DIFF_CACHE: OnceLock<Mutex<HashMap<String, CachedDiff>>> =
	OnceLock::new();
static LOG_CACHE: OnceLock<Mutex<HashMap<(String, u32), CachedLog>>> =
	OnceLock::new();

fn diff_cache() -> &'static Mutex<HashMap<String, CachedDiff>> {
	DIFF_CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

fn log_cache() -> &'static Mutex<HashMap<(String, u32), CachedLog>> {
	LOG_CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

pub fn github_avatar_url(folder: &str) -> Option<String> {
	let remote_url = remote_url(folder).ok().flatten()?;
	let (owner, _) = parse_github_owner_and_repo(&remote_url)?;
	Some(format!("https://avatars.githubusercontent.com/{owner}?v=4"))
}

pub fn remote_url(folder: &str) -> Result<Option<String>, AppError> {
	let output = command_without_windows_console("git")
		.args(["remote", "get-url", "origin"])
		.current_dir(folder)
		.output()?;

	if !output.status.success() {
		let stderr = String::from_utf8_lossy(&output.stderr).to_lowercase();
		let nonfatal_patterns = [
			"no such remote",
			"not a git repository",
			"not in a git directory",
			"failed to run",
		];
		if nonfatal_patterns
			.iter()
			.any(|pattern| stderr.contains(pattern))
		{
			return Ok(None);
		}
		return Err(AppError::GitError(
			String::from_utf8_lossy(&output.stderr).trim().to_string(),
		));
	}

	let remote = String::from_utf8_lossy(&output.stdout).trim().to_string();
	if remote.is_empty() {
		return Ok(None);
	}

	Ok(Some(remote))
}

pub fn init(dir: &Path) -> Result<(), AppError> {
	let output = command_without_windows_console("git")
		.arg("init")
		.current_dir(dir)
		.output()?;

	if !output.status.success() {
		let stderr = String::from_utf8_lossy(&output.stderr);
		return Err(AppError::PtyError(format!("git init failed: {stderr}")));
	}
	Ok(())
}

pub fn branch(folder: &str) -> Result<String, AppError> {
	let sym_output = command_without_windows_console("git")
		.args(["symbolic-ref", "--short", "HEAD"])
		.current_dir(folder)
		.output()?;
	if sym_output.status.success() {
		return Ok(String::from_utf8_lossy(&sym_output.stdout)
			.trim()
			.to_string());
	}

	let output = command_without_windows_console("git")
		.args(["rev-parse", "--abbrev-ref", "HEAD"])
		.current_dir(folder)
		.output()?;
	if !output.status.success() {
		return Ok("main".to_string());
	}
	Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

pub fn status(folder: &str) -> Result<Vec<FileTreeGitStatusEntry>, AppError> {
	let output = command_without_windows_console("git")
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

	let mut entries = parse_porcelain_status_z(&output.stdout);
	normalize_file_tree_git_status_paths(Path::new(folder), &mut entries);
	Ok(entries)
}

/// Get the full diff (staged + unstaged) without affecting the real index.
/// Uses a temporary index file seeded from the repo's current index so tracked
/// files that are now ignored still remain tracked in the temporary view.
pub fn diff(folder: &str) -> Result<String, AppError> {
	Ok(diff_snapshot(folder)?.diff)
}

pub fn diff_stats(folder: &str) -> Result<GitDiffStats, AppError> {
	let status_z = status_porcelain_z_uall(folder)?;
	if status_z.is_empty() {
		return Ok(GitDiffStats::default());
	}

	let fingerprint = snapshot_fingerprint(folder, &status_z);
	if let Some(hit) = diff_cache().lock().unwrap().get(folder) {
		if hit.fingerprint == fingerprint {
			return Ok(hit.stats.clone());
		}
	}

	let stats = compute_diff_stats_uncached(folder)?;
	diff_cache().lock().unwrap().insert(
		folder.to_string(),
		CachedDiff {
			fingerprint,
			stats: stats.clone(),
			snapshot: None,
		},
	);
	Ok(stats)
}

pub fn diff_snapshot(folder: &str) -> Result<GitDiffSnapshot, AppError> {
	let status_z = status_porcelain_z_uall(folder)?;
	if status_z.is_empty() {
		return Ok(GitDiffSnapshot::default());
	}

	let fingerprint = snapshot_fingerprint(folder, &status_z);
	if let Some(hit) = diff_cache().lock().unwrap().get(folder) {
		if hit.fingerprint == fingerprint {
			if let Some(snapshot) = &hit.snapshot {
				return Ok(snapshot.clone());
			}
		}
	}

	let snapshot = compute_diff_snapshot_uncached(folder)?;
	diff_cache().lock().unwrap().insert(
		folder.to_string(),
		CachedDiff {
			fingerprint,
			stats: snapshot.stats.clone(),
			snapshot: Some(snapshot.clone()),
		},
	);
	Ok(snapshot)
}

fn status_porcelain_z_uall(folder: &str) -> Result<Vec<u8>, AppError> {
	let output = command_without_windows_console("git")
		.args(["status", "--porcelain", "-z", "--untracked-files=all"])
		.current_dir(folder)
		.output()?;

	if !output.status.success() {
		return Err(AppError::GitError(
			String::from_utf8_lossy(&output.stderr).trim().to_string(),
		));
	}

	Ok(output.stdout)
}

fn head_commit(folder: &str) -> Option<String> {
	let output = command_without_windows_console("git")
		.args(["rev-parse", "HEAD"])
		.current_dir(folder)
		.output()
		.ok()?;

	output
		.status
		.success()
		.then(|| String::from_utf8_lossy(&output.stdout).trim().to_string())
}

fn snapshot_fingerprint(folder: &str, status_z: &[u8]) -> u64 {
	let mut hasher = DefaultHasher::new();
	status_z.hash(&mut hasher);
	head_commit(folder).hash(&mut hasher);
	for path in status_z_paths(status_z) {
		match std::fs::symlink_metadata(Path::new(folder).join(path)) {
			Ok(metadata) => {
				metadata.len().hash(&mut hasher);
				metadata
					.modified()
					.ok()
					.and_then(|time| {
						time.duration_since(std::time::UNIX_EPOCH).ok()
					})
					.map(|duration| {
						(duration.as_secs(), duration.subsec_nanos())
					})
					.hash(&mut hasher);
			}
			Err(_) => 0u8.hash(&mut hasher),
		}
	}
	hasher.finish()
}

fn status_z_paths(output: &[u8]) -> Vec<String> {
	let records: Vec<&[u8]> = output
		.split(|byte| *byte == 0)
		.filter(|record| !record.is_empty())
		.collect();
	let mut paths = Vec::new();
	let mut index = 0usize;
	while let Some(record) = records.get(index) {
		if record.len() < 4 {
			index += 1;
			continue;
		}

		let status_code = &record[..2];
		paths.push(String::from_utf8_lossy(&record[3..]).into_owned());
		if status_code.contains(&b'R') || status_code.contains(&b'C') {
			index += 1;
		}
		index += 1;
	}
	paths
}

fn register_untracked_intent_to_add(
	folder: &str,
	tmp_index: &Path,
) -> Result<(), AppError> {
	let output = command_without_windows_console("git")
		.args(["add", "--intent-to-add", "."])
		.current_dir(folder)
		.env("GIT_INDEX_FILE", tmp_index)
		.output()?;

	if !output.status.success() {
		let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
		if stderr.contains("did not match any files") {
			return Ok(());
		}
		return Err(AppError::GitError(stderr));
	}

	Ok(())
}

fn compute_diff_stats_uncached(folder: &str) -> Result<GitDiffStats, AppError> {
	let (_tmp_dir, tmp_index) = create_temp_index_from_repo(folder)?;
	register_untracked_intent_to_add(folder, &tmp_index)?;

	let output = command_without_windows_console("git")
		.args([
			"diff",
			"--no-color",
			"--src-prefix=a/",
			"--dst-prefix=b/",
			"--shortstat",
			"HEAD",
		])
		.current_dir(folder)
		.env("GIT_INDEX_FILE", &tmp_index)
		.output()?;

	if output.status.success() {
		return Ok(parse_diff_stats(&output.stdout));
	}

	let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
	if is_no_head_error(&stderr) {
		Ok(GitDiffStats::default())
	} else {
		Err(AppError::GitError(stderr))
	}
}

fn compute_diff_snapshot_uncached(
	folder: &str,
) -> Result<GitDiffSnapshot, AppError> {
	let (_tmp_dir, tmp_index) = create_temp_index_from_repo(folder)?;
	register_untracked_intent_to_add(folder, &tmp_index)?;

	let output = command_without_windows_console("git")
		.args([
			"diff",
			"--no-color",
			"--src-prefix=a/",
			"--dst-prefix=b/",
			"--shortstat",
			"-p",
			"HEAD",
		])
		.current_dir(folder)
		.env("GIT_INDEX_FILE", tmp_index)
		.output()?;

	if output.status.success() {
		return Ok(split_shortstat_and_patch(&output.stdout));
	}

	let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
	if is_no_head_error(&stderr) {
		Ok(GitDiffSnapshot::default())
	} else {
		Err(AppError::GitError(stderr))
	}
}

fn split_shortstat_and_patch(stdout: &[u8]) -> GitDiffSnapshot {
	let text = String::from_utf8_lossy(stdout);
	let patch_start = if text.starts_with("diff --git ") {
		Some(0)
	} else {
		text.find("\ndiff --git ").map(|index| index + 1)
	};

	match patch_start {
		Some(index) => GitDiffSnapshot {
			diff: text[index..].to_string(),
			stats: parse_diff_stats(text[..index].as_bytes()),
		},
		None => GitDiffSnapshot {
			diff: String::new(),
			stats: parse_diff_stats(stdout),
		},
	}
}

fn is_no_head_error(stderr: &str) -> bool {
	let no_head_patterns = [
		"does not have any commits",
		"bad revision 'HEAD'",
		"invalid revision 'HEAD'",
		"unknown revision",
	];
	no_head_patterns
		.iter()
		.any(|pattern| stderr.contains(pattern))
}

fn parse_diff_stats(stdout: &[u8]) -> GitDiffStats {
	let stdout = String::from_utf8_lossy(stdout);
	let (files_changed, insertions, deletions) = stdout
		.lines()
		.find(|line| line.contains("file"))
		.map(parse_shortstat)
		.unwrap_or((0, 0, 0));

	GitDiffStats {
		files_changed,
		insertions,
		deletions,
	}
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
	let output = command_without_windows_console("git")
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
	let initial_head = head_commit(folder);
	let Some(head_oid) = initial_head else {
		return log_uncached(folder, limit);
	};
	let cache_key = (folder.to_string(), limit);

	if let Some(commits) = log_cache()
		.lock()
		.unwrap()
		.get(&cache_key)
		.filter(|entry| entry.head_oid == head_oid)
		.map(|entry| entry.commits.clone())
	{
		return Ok(commits);
	}

	let commits = log_uncached(folder, limit)?;
	if head_commit(folder).as_deref() == Some(head_oid.as_str()) {
		log_cache().lock().unwrap().insert(
			cache_key,
			CachedLog {
				head_oid,
				commits: commits.clone(),
			},
		);
	}

	Ok(commits)
}

fn log_uncached(folder: &str, limit: u32) -> Result<Vec<GitCommit>, AppError> {
	let output = command_without_windows_console("git")
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

#[cfg(test)]
fn log_cache_insert_for_test(
	folder: &str,
	limit: u32,
	head_oid: String,
	commits: Vec<GitCommit>,
) {
	log_cache()
		.lock()
		.unwrap()
		.insert((folder.to_string(), limit), CachedLog { head_oid, commits });
}

pub fn show(folder: &str, commit_hash: &str) -> Result<String, AppError> {
	validate_commit_hash(commit_hash)?;

	let output = command_without_windows_console("git")
		.args([
			"show",
			"--no-color",
			"--src-prefix=a/",
			"--dst-prefix=b/",
			"--format=",
			commit_hash,
		])
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
	cache_root: &Path,
	path: &str,
) -> Result<Option<String>, AppError> {
	let path = validate_repo_relative_path(path, "Preview file path")?;
	let file_path = Path::new(folder).join(&path);

	let metadata = match std::fs::metadata(&file_path) {
		Ok(metadata) => metadata,
		Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
			return Ok(None);
		}
		Err(error) => return Err(AppError::IoError(error)),
	};
	if metadata.is_dir() {
		return Ok(None);
	}
	if metadata.len() > MAX_BINARY_PREVIEW_BYTES as u64 {
		return Err(AppError::GitError(format!(
			"Preview file is too large: {path}"
		)));
	}

	let modified = metadata
		.modified()
		.ok()
		.and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
		.map(|duration| (duration.as_secs(), duration.subsec_nanos()))
		.unwrap_or_default();
	let mut hasher = DefaultHasher::new();
	file_path.hash(&mut hasher);
	metadata.len().hash(&mut hasher);
	modified.hash(&mut hasher);
	let cache_key = format!("{:016x}", hasher.finish());
	let cache_path = preview_cache_path(
		cache_root,
		folder,
		"working-tree",
		Some(&cache_key),
		&path,
	);

	if std::fs::metadata(&cache_path)
		.is_ok_and(|cached| cached.is_file() && cached.len() == metadata.len())
	{
		return Ok(Some(cache_path.to_string_lossy().to_string()));
	}

	let bytes = std::fs::read(&file_path)?;
	if bytes.len() as u64 != metadata.len() {
		return Err(AppError::GitError(format!(
			"Preview file size changed while reading: {path}"
		)));
	}
	write_preview_cache_file(&cache_path, &bytes)?;

	Ok(Some(cache_path.to_string_lossy().to_string()))
}

pub fn read_head_file(
	folder: &str,
	cache_root: &Path,
	path: &str,
) -> Result<Option<String>, AppError> {
	let path = validate_repo_relative_path(path, "Preview file path")?;
	let spec = format!("HEAD:{path}");
	let Some(blob_oid) = get_git_blob_oid(folder, &spec)? else {
		return Ok(None);
	};
	let cache_path =
		preview_cache_path(cache_root, folder, "head", Some(&blob_oid), &path);
	read_git_blob_to_cache(folder, &spec, &cache_path, true)
}

pub fn read_commit_file(
	folder: &str,
	cache_root: &Path,
	commit_hash: &str,
	path: &str,
) -> Result<Option<String>, AppError> {
	validate_commit_hash(commit_hash)?;
	let path = validate_repo_relative_path(path, "Preview file path")?;
	let cache_path = preview_cache_path(
		cache_root,
		folder,
		"commit",
		Some(commit_hash),
		&path,
	);
	read_git_blob_to_cache(
		folder,
		&format!("{commit_hash}:{path}"),
		&cache_path,
		true,
	)
}

pub fn read_parent_commit_file(
	folder: &str,
	cache_root: &Path,
	commit_hash: &str,
	path: &str,
) -> Result<Option<String>, AppError> {
	validate_commit_hash(commit_hash)?;
	let path = validate_repo_relative_path(path, "Preview file path")?;
	let cache_path = preview_cache_path(
		cache_root,
		folder,
		"parent-commit",
		Some(commit_hash),
		&path,
	);
	read_git_blob_to_cache(
		folder,
		&format!("{commit_hash}^:{path}"),
		&cache_path,
		true,
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
	let add_output = command_without_windows_console("git")
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

	let mut commit_command = command_without_windows_console("git");
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

	let rev_parse = command_without_windows_console("git")
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
		let restore_output = command_without_windows_console("git")
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
		let clean_output = command_without_windows_console("git")
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
	let output = command_without_windows_console("git")
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

/// Default branch name: origin/HEAD symbolic ref, else existing main/master.
fn trunk_branch_name(folder: &str) -> Option<String> {
	let output = command_without_windows_console("git")
		.args(["symbolic-ref", "--short", "refs/remotes/origin/HEAD"])
		.current_dir(folder)
		.output();
	if let Ok(o) = output {
		if o.status.success() {
			let name = String::from_utf8_lossy(&o.stdout).trim().to_string();
			if let Some(stripped) = name.strip_prefix("origin/") {
				if !stripped.is_empty() {
					return Some(stripped.to_string());
				}
			} else if !name.is_empty() {
				return Some(name);
			}
		}
	}

	["main", "master"].iter().find_map(|candidate| {
		let verified = command_without_windows_console("git")
			.args([
				"show-ref",
				"--verify",
				"--quiet",
				&format!("refs/heads/{candidate}"),
			])
			.current_dir(folder)
			.status()
			.map(|status| status.success())
			.unwrap_or(false);
		verified.then(|| (*candidate).to_string())
	})
}

/// Branches checked out in a git worktree other than `folder` itself.
fn branches_used_by_other_worktrees(folder: &str) -> HashSet<String> {
	let own_toplevel = command_without_windows_console("git")
		.args(["rev-parse", "--show-toplevel"])
		.current_dir(folder)
		.output()
		.ok()
		.filter(|o| o.status.success())
		.map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
		.unwrap_or_default();

	let output = command_without_windows_console("git")
		.args(["worktree", "list", "--porcelain"])
		.current_dir(folder)
		.output();
	let Ok(output) = output else {
		return HashSet::new();
	};
	if !output.status.success() {
		return HashSet::new();
	}

	let stdout = String::from_utf8_lossy(&output.stdout);
	let mut used = HashSet::new();
	let mut current_path: Option<String> = None;
	for line in stdout.lines() {
		if let Some(path) = line.strip_prefix("worktree ") {
			current_path = Some(path.trim().to_string());
		} else if let Some(branch_ref) = line.strip_prefix("branch ") {
			let is_own = current_path.as_deref() == Some(own_toplevel.as_str());
			if !is_own {
				if let Some(name) =
					branch_ref.trim().strip_prefix("refs/heads/")
				{
					used.insert(name.to_string());
				}
			}
		}
	}
	used
}

/// (ahead, behind) of `branch_name` relative to the current HEAD.
fn branch_ahead_behind(folder: &str, branch_name: &str) -> (u32, u32) {
	let output = command_without_windows_console("git")
		.args([
			"rev-list",
			"--left-right",
			"--count",
			&format!("HEAD...{branch_name}"),
		])
		.current_dir(folder)
		.output();

	let Ok(output) = output else {
		return (0, 0);
	};
	if !output.status.success() {
		return (0, 0);
	}

	let stdout = String::from_utf8_lossy(&output.stdout);
	let mut parts = stdout.split_whitespace();
	// left = commits only on HEAD (branch is behind), right = only on branch (ahead)
	let behind = parts.next().and_then(|v| v.parse().ok()).unwrap_or(0);
	let ahead = parts.next().and_then(|v| v.parse().ok()).unwrap_or(0);
	(ahead, behind)
}

pub fn list_branches(folder: &str) -> Result<Vec<GitBranchInfo>, AppError> {
	let output = command_without_windows_console("git")
		.args([
			"for-each-ref",
			"refs/heads",
			"--format=%(refname:short)%09%(ahead-behind:HEAD)",
			"--sort=-committerdate",
		])
		.current_dir(folder)
		.output()?;
	if !output.status.success() {
		return list_branches_per_branch(folder);
	}

	let current = branch(folder).unwrap_or_default();
	let trunk = trunk_branch_name(folder);
	let used = branches_used_by_other_worktrees(folder);

	let branches = String::from_utf8_lossy(&output.stdout)
		.lines()
		.map(str::trim)
		.filter(|line| !line.is_empty())
		.map(|line| {
			let (name, counts) = line.split_once('\t').unwrap_or((line, ""));
			let name = name.trim();
			// %(ahead-behind:HEAD) prints "ahead behind"; rev-list fallback
			// parses the opposite order from --left-right output.
			let mut parts = counts.split_whitespace();
			let ahead = parts.next().and_then(|v| v.parse().ok()).unwrap_or(0);
			let behind = parts.next().and_then(|v| v.parse().ok()).unwrap_or(0);
			let is_current = name == current;
			GitBranchInfo {
				name: name.to_string(),
				is_current,
				ahead: if is_current { 0 } else { ahead },
				behind: if is_current { 0 } else { behind },
				is_used: used.contains(name),
				is_trunk: trunk.as_deref() == Some(name),
			}
		})
		.collect();

	Ok(branches)
}

#[doc(hidden)]
pub fn list_branches_per_branch(
	folder: &str,
) -> Result<Vec<GitBranchInfo>, AppError> {
	let output = command_without_windows_console("git")
		.args([
			"for-each-ref",
			"refs/heads",
			"--format=%(refname:short)",
			"--sort=-committerdate",
		])
		.current_dir(folder)
		.output()?;
	if !output.status.success() {
		return Err(AppError::GitError(
			String::from_utf8_lossy(&output.stderr).trim().to_string(),
		));
	}

	let current = branch(folder).unwrap_or_default();
	let trunk = trunk_branch_name(folder);
	let used = branches_used_by_other_worktrees(folder);

	let branches = String::from_utf8_lossy(&output.stdout)
		.lines()
		.map(str::trim)
		.filter(|name| !name.is_empty())
		.map(|name| {
			let is_current = name == current;
			let (ahead, behind) = if is_current {
				(0, 0)
			} else {
				branch_ahead_behind(folder, name)
			};
			GitBranchInfo {
				name: name.to_string(),
				is_current,
				ahead,
				behind,
				is_used: used.contains(name),
				is_trunk: trunk.as_deref() == Some(name),
			}
		})
		.collect();

	Ok(branches)
}

pub fn checkout_branch(
	folder: &str,
	branch_name: &str,
) -> Result<(), AppError> {
	let output = command_without_windows_console("git")
		.args(["checkout", branch_name])
		.current_dir(folder)
		.output()?;
	if !output.status.success() {
		return Err(AppError::GitError(
			String::from_utf8_lossy(&output.stderr).trim().to_string(),
		));
	}
	Ok(())
}

pub fn branch_unique_commits(
	folder: &str,
	branch_name: &str,
) -> Result<Vec<String>, AppError> {
	let branch_ref = format!("refs/heads/{branch_name}");
	let other_refs = refs_except_branch(folder, &branch_ref)?;
	let mut command = command_without_windows_console("git");
	command
		.args(["rev-list", "--reverse", &branch_ref])
		.current_dir(folder);

	if !other_refs.is_empty() {
		command.arg("--not").args(&other_refs);
	}

	let output = command.output()?;
	if !output.status.success() {
		return Err(AppError::GitError(command_error(
			"git rev-list failed",
			&output,
		)));
	}

	Ok(String::from_utf8_lossy(&output.stdout)
		.lines()
		.map(str::trim)
		.filter(|line| !line.is_empty())
		.map(ToOwned::to_owned)
		.collect())
}

pub fn commit_diff_stats(
	folder: &str,
	commits: &[String],
) -> Result<GitDiffStats, AppError> {
	if commits.is_empty() {
		return Ok(GitDiffStats::default());
	}

	let output = command_without_windows_console("git")
		.args([
			"show",
			"--no-color",
			"--src-prefix=a/",
			"--dst-prefix=b/",
			"--format=",
			"--shortstat",
		])
		.args(commits)
		.current_dir(folder)
		.output()?;

	if !output.status.success() {
		return Err(AppError::GitError(command_error(
			"git show failed",
			&output,
		)));
	}

	let stdout = String::from_utf8_lossy(&output.stdout);
	Ok(sum_shortstat_lines(&stdout))
}

pub fn push(folder: &str) -> Result<(), AppError> {
	let output = command_without_windows_console("git")
		.args(["push"])
		.current_dir(folder)
		.output()?;

	if !output.status.success() {
		let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
		return Err(AppError::GitError(format!("git push failed: {stderr}")));
	}
	Ok(())
}

pub fn pull_request_status(
	folder: &str,
) -> Result<Option<GitPullRequestStatus>, AppError> {
	let branch_name = branch(folder)?;
	pull_request_status_for_branch(folder, &branch_name)
}

pub fn pull_request_status_for_branch(
	folder: &str,
	branch_name: &str,
) -> Result<Option<GitPullRequestStatus>, AppError> {
	let branch_name = branch_name.trim();
	if branch_name.is_empty() || branch_name == "HEAD" {
		return Ok(None);
	}

	let remote_owner = remote_url(folder)?.and_then(|remote| {
		parse_github_owner_and_repo(&remote).map(|(owner, _)| owner)
	});
	let Some(remote_owner) = remote_owner else {
		return Ok(None);
	};

	let mut command = command_without_windows_console("gh");
	command
		.args([
			"pr",
			"list",
			"--head",
			branch_name,
			"--state",
			"all",
			"--json",
			"number,title,state,url,isDraft,headRefName,headRepositoryOwner",
			"--limit",
			"100",
		])
		.env("GH_PROMPT_DISABLED", "1")
		.current_dir(folder);

	let output = match crate::process::output_with_timeout(
		&mut command,
		GH_COMMAND_TIMEOUT,
	) {
		Ok(Some(output)) => output,
		Ok(None) => return Ok(None),
		Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
			return Err(AppError::GitError("gh CLI not found".into()));
		}
		Err(error) => return Err(AppError::IoError(error)),
	};

	if !output.status.success() {
		let message = command_error("gh pr list failed", &output);
		if is_non_github_pr_lookup_error(&message) {
			return Ok(None);
		}
		return Err(AppError::GitError(message));
	}

	let prs = parse_pull_request_list(&output.stdout, &remote_owner)?;
	Ok(prs.into_iter().next())
}

/// Try `git worktree add -b <branch> <path>` (new branch).
/// If the branch already exists, return an error.
/// If a ref conflict blocks creation (e.g. `feat` exists, blocking `feat/auth`),
/// return an error without deleting user branches.
pub fn worktree_add(
	project_folder: &str,
	branch_name: &str,
	worktree_path: &str,
) -> Result<(), AppError> {
	let output = command_without_windows_console("git")
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
	if stderr.contains("cannot lock ref") {
		if let Some(conflicting) = extract_conflicting_ref(&stderr) {
			return Err(AppError::GitError(format!(
				"Cannot create branch '{branch_name}' because existing branch '{conflicting}' conflicts with that namespace"
			)));
		}
	}

	Err(AppError::GitError(format!(
		"git worktree add failed: {stderr}"
	)))
}

pub fn worktree_remove(
	project_folder: &str,
	worktree_path: &str,
) -> Result<(), AppError> {
	let output = command_without_windows_console("git")
		.args(["worktree", "remove", worktree_path, "--force"])
		.current_dir(project_folder)
		.output()?;

	if !output.status.success() {
		let stderr = String::from_utf8_lossy(&output.stderr);
		let normalized = stderr.to_lowercase();
		if normalized.contains("not a working tree")
			&& !Path::new(worktree_path).exists()
		{
			tracing::warn!(
				"git worktree remove skipped missing worktree: {worktree_path}"
			);
			return Ok(());
		}

		let message = command_error("git worktree remove failed", &output);
		tracing::warn!("{message}");
		return Err(AppError::GitError(message));
	}

	Ok(())
}

pub fn worktree_current_branch(
	worktree_path: &str,
) -> Result<Option<String>, AppError> {
	let output = command_without_windows_console("git")
		.args(["branch", "--show-current"])
		.current_dir(worktree_path)
		.output();

	let output = match output {
		Ok(output) => output,
		Err(error) if !Path::new(worktree_path).exists() => {
			tracing::warn!(
				"git branch --show-current skipped missing worktree: {worktree_path}: {error}"
			);
			return Ok(None);
		}
		Err(error) => return Err(AppError::from(error)),
	};

	if !output.status.success() {
		if !Path::new(worktree_path).exists() {
			tracing::warn!(
				"git branch --show-current skipped missing worktree: {worktree_path}"
			);
			return Ok(None);
		}

		return Err(AppError::GitError(command_error(
			"git branch --show-current failed",
			&output,
		)));
	}

	let branch_name =
		String::from_utf8_lossy(&output.stdout).trim().to_string();
	if branch_name.is_empty() {
		return Ok(None);
	}

	Ok(Some(branch_name))
}

pub fn branch_delete(
	project_folder: &str,
	branch_name: &str,
) -> Result<(), AppError> {
	let output = command_without_windows_console("git")
		.args(["branch", "-D", branch_name])
		.current_dir(project_folder)
		.output()?;

	if !output.status.success() {
		let stderr = String::from_utf8_lossy(&output.stderr);
		let normalized = stderr.to_lowercase();
		if normalized.contains("branch") && normalized.contains("not found") {
			tracing::warn!(
				"git branch delete skipped missing branch: {branch_name}"
			);
			return Ok(());
		}

		let message = command_error("git branch delete failed", &output);
		tracing::warn!("{message}");
		return Err(AppError::GitError(message));
	}

	Ok(())
}

fn refs_except_branch(
	folder: &str,
	branch_ref: &str,
) -> Result<Vec<String>, AppError> {
	let output = command_without_windows_console("git")
		.args(["for-each-ref", "--format=%(refname)"])
		.args(["refs/heads", "refs/remotes", "refs/tags"])
		.current_dir(folder)
		.output()?;

	if !output.status.success() {
		return Err(AppError::GitError(command_error(
			"git for-each-ref failed",
			&output,
		)));
	}

	Ok(String::from_utf8_lossy(&output.stdout)
		.lines()
		.map(str::trim)
		.filter(|line| !line.is_empty() && *line != branch_ref)
		.map(ToOwned::to_owned)
		.collect())
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

fn sum_shortstat_lines(output: &str) -> GitDiffStats {
	let mut stats = GitDiffStats::default();

	for line in output.lines().filter(|line| line.contains("file")) {
		let (files_changed, insertions, deletions) = parse_shortstat(line);
		stats.files_changed += files_changed;
		stats.insertions += insertions;
		stats.deletions += deletions;
	}

	stats
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
		if let Some(parts) = parse_git_log_commit_line(line) {
			let full_hash = parts.full_hash.to_string();
			let hash = parts.hash.to_string();
			let author_name = parts.author_name.to_string();
			let author_email = parts.author_email.to_string();
			let date = parts.date.to_string();
			let message = parts.message.to_string();

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

struct GitLogCommitLine<'a> {
	full_hash: &'a str,
	hash: &'a str,
	author_name: &'a str,
	author_email: &'a str,
	date: &'a str,
	message: &'a str,
}

fn parse_git_log_commit_line(line: &str) -> Option<GitLogCommitLine<'_>> {
	let mut parts = line.split('\x1f');
	let commit = GitLogCommitLine {
		full_hash: parts.next()?,
		hash: parts.next()?,
		author_name: parts.next()?,
		author_email: parts.next()?,
		date: parts.next()?,
		message: parts.next()?,
	};
	if parts.next().is_some() {
		return None;
	}
	Some(commit)
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

		let status_code = &record[..2];
		let path = String::from_utf8_lossy(&record[3..]).to_string();
		let status = map_porcelain_status(status_code);
		if status_code.contains(&b'R') || status_code.contains(&b'C') {
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

fn normalize_file_tree_git_status_paths(
	root: &Path,
	entries: &mut [FileTreeGitStatusEntry],
) {
	for entry in entries {
		if entry.status == "deleted" || entry.path.ends_with('/') {
			continue;
		}
		if root.join(&entry.path).is_dir() {
			entry.path.push('/');
		}
	}
}

fn map_porcelain_status(status_code: &[u8]) -> Option<&'static str> {
	if status_code.contains(&b'!') {
		return Some("ignored");
	}
	if status_code.contains(&b'?') {
		return Some("untracked");
	}
	if status_code.contains(&b'R') {
		return Some("renamed");
	}
	if status_code.contains(&b'A') {
		return Some("added");
	}
	if status_code.contains(&b'D') {
		return Some("deleted");
	}
	if status_code
		.iter()
		.any(|value| matches!(value, b'M' | b'T' | b'U' | b'C'))
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
	let output = command_without_windows_console("git")
		.args(["ls-files", "-z", "--"])
		.args(paths)
		.current_dir(folder)
		.output()?;

	if !output.status.success() {
		return Err(AppError::GitError(command_error(
			"git ls-files failed",
			&output,
		)));
	}

	let tracked_files: HashSet<String> = output
		.stdout
		.split(|byte| *byte == 0)
		.filter(|path| !path.is_empty())
		.map(|path| String::from_utf8_lossy(path).into_owned())
		.collect();

	let mut tracked_paths = Vec::new();
	let mut untracked_paths = Vec::new();

	for path in paths {
		if is_tracked_request(path, &tracked_files) {
			tracked_paths.push(path.clone());
		} else {
			untracked_paths.push(path.clone());
		}
	}

	Ok((tracked_paths, untracked_paths))
}

fn is_tracked_request(path: &str, tracked_files: &HashSet<String>) -> bool {
	let path = path.trim_end_matches('/');
	if tracked_files.contains(path) {
		return true;
	}
	let prefix = format!("{path}/");
	tracked_files
		.iter()
		.any(|tracked| tracked.starts_with(&prefix))
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

fn parse_pull_request_list(
	output: &[u8],
	expected_head_owner: &str,
) -> Result<Vec<GitPullRequestStatus>, AppError> {
	let prs: Vec<GhPullRequest> =
		serde_json::from_slice(output).map_err(|error| {
			AppError::GitError(format!(
				"Failed to parse gh pr list output: {error}"
			))
		})?;

	Ok(prs
		.into_iter()
		.filter(|pr| {
			pr.head_repository_owner.as_ref().is_some_and(|owner| {
				owner.login.eq_ignore_ascii_case(expected_head_owner)
			})
		})
		.map(|pr| GitPullRequestStatus {
			number: pr.number,
			title: pr.title,
			state: pr.state,
			url: pr.url,
			is_draft: pr.is_draft,
			head_ref_name: pr.head_ref_name,
		})
		.collect())
}

fn is_non_github_pr_lookup_error(message: &str) -> bool {
	let lower = message.to_ascii_lowercase();
	[
		"not a git repository",
		"none of the git remotes configured",
		"no github remotes found",
		"could not resolve to a repository",
	]
	.iter()
	.any(|pattern| lower.contains(pattern))
}

fn read_git_blob_to_cache(
	folder: &str,
	spec: &str,
	cache_path: &Path,
	cache_key_is_immutable: bool,
) -> Result<Option<String>, AppError> {
	if cache_key_is_immutable
		&& std::fs::metadata(cache_path)
			.is_ok_and(|metadata| metadata.is_file())
	{
		return Ok(Some(cache_path.to_string_lossy().to_string()));
	}

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

	let output = command_without_windows_console("git")
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
	let output = command_without_windows_console("git")
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

fn get_git_blob_oid(
	folder: &str,
	spec: &str,
) -> Result<Option<String>, AppError> {
	let output = command_without_windows_console("git")
		.args(["rev-parse", "--verify", "--quiet", spec])
		.current_dir(folder)
		.output()?;

	if output.status.success() {
		let oid = String::from_utf8_lossy(&output.stdout).trim().to_string();
		if oid.is_empty() {
			return Ok(None);
		}
		return Ok(Some(oid));
	}

	let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
	if stderr.is_empty() || is_missing_blob_error(&stderr) {
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
	cache_root: &Path,
	folder: &str,
	source: &str,
	commit_hash: Option<&str>,
	relative_path: &str,
) -> std::path::PathBuf {
	let mut hasher = DefaultHasher::new();
	folder.hash(&mut hasher);
	let repo_hash = hasher.finish();

	let mut cache_path =
		cache_root.join(format!("{repo_hash:016x}")).join(source);

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

fn parse_github_owner_and_repo(remote_url: &str) -> Option<(String, String)> {
	let normalized_url = remote_url.trim().trim_end_matches(".git");
	let normalized_url = normalized_url
		.split('?')
		.next()
		.unwrap_or(normalized_url)
		.split('#')
		.next()
		.unwrap_or(normalized_url)
		.trim()
		.trim_end_matches('/')
		.to_string();
	let (host, path) = split_remote_host_and_path(&normalized_url)?;

	if !is_github_host(&host) {
		return None;
	}

	let path = path
		.trim_start_matches('/')
		.trim_end_matches('/')
		.trim_end_matches(".git")
		.trim();

	if path.is_empty() {
		return None;
	}

	let mut segments = path.split('/').filter(|segment| !segment.is_empty());
	let owner = segments.next()?.to_lowercase();
	let repo = segments.next()?.to_lowercase();

	if owner.is_empty() || repo.is_empty() {
		return None;
	}

	Some((owner, repo))
}

fn split_remote_host_and_path(remote_url: &str) -> Option<(String, String)> {
	if let Some(scheme_pos) = remote_url.find("://") {
		let without_scheme = &remote_url[scheme_pos + 3..];
		let without_auth = without_scheme.split('@').next_back()?;
		let mut host_and_path = without_auth.splitn(2, '/');
		let host = normalize_host(host_and_path.next()?);
		let path = host_and_path.next()?;
		return Some((host, path.to_string()));
	}

	if let Some(colon_pos) = remote_url.find(':') {
		let host_part = &remote_url[..colon_pos];
		let path = &remote_url[colon_pos + 1..];
		if is_github_host(host_part) {
			return Some((normalize_host(host_part), path.to_string()));
		}
	}

	let mut host_and_path = remote_url.splitn(2, '/');
	let host = host_and_path.next()?;
	if !is_github_host(host) {
		return None;
	}

	let path = host_and_path.next().unwrap_or_default();
	Some((normalize_host(host), path.to_string()))
}

fn is_github_host(host: &str) -> bool {
	matches!(
		normalize_host(host).as_str(),
		"github.com" | "www.github.com"
	)
}

fn normalize_host(host: &str) -> String {
	let host = host.split('@').next_back().unwrap_or(host);
	let host = host.split(':').next().unwrap_or(host);
	host.trim().to_ascii_lowercase()
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn parse_github_owner_and_repo_with_https_url() {
		assert_eq!(
			parse_github_owner_and_repo("https://github.com/Owner/Repo.git"),
			Some(("owner".to_string(), "repo".to_string())),
		);
	}

	#[test]
	fn parse_github_owner_and_repo_with_scp_style_url() {
		assert_eq!(
			parse_github_owner_and_repo("git@github.com:Owner/Repo"),
			Some(("owner".to_string(), "repo".to_string())),
		);
	}

	#[test]
	fn parse_github_owner_and_repo_with_ssh_scheme() {
		assert_eq!(
			parse_github_owner_and_repo("ssh://git@github.com/owner/repo.git"),
			Some(("owner".to_string(), "repo".to_string())),
		);
	}

	#[test]
	fn parse_github_owner_and_repo_for_non_github_remote() {
		assert_eq!(
			parse_github_owner_and_repo("git@gitlab.com:owner/repo.git"),
			None,
		);
	}

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
	fn tracked_request_matches_files_inside_directory() {
		let tracked_files =
			HashSet::from(["src/main.rs".to_string(), "README.md".to_string()]);

		assert!(is_tracked_request("src/", &tracked_files));
		assert!(is_tracked_request("README.md", &tracked_files));
		assert!(!is_tracked_request("target/", &tracked_files));
		assert!(!is_tracked_request("scratch.txt", &tracked_files));
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
		let output = b" M src/main.rs\0?? scratch.txt\0!! target/\0R  src/new.rs\0src/old.rs\0C  src/copied.rs\0src/original.rs\0D  gone.rs\0";

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
					path: "src/copied.rs".to_string(),
					status: "modified".to_string(),
				},
				FileTreeGitStatusEntry {
					path: "gone.rs".to_string(),
					status: "deleted".to_string(),
				},
			]
		);
	}

	#[test]
	fn normalizes_file_tree_status_paths_for_existing_directories() {
		let temp_dir = tempfile::tempdir().expect("temp dir");
		let root = temp_dir.path();
		std::fs::create_dir_all(root.join("submodule"))
			.expect("create submodule dir");
		let mut entries = vec![
			FileTreeGitStatusEntry {
				path: "submodule".to_string(),
				status: "modified".to_string(),
			},
			FileTreeGitStatusEntry {
				path: "deleted-dir".to_string(),
				status: "deleted".to_string(),
			},
		];

		normalize_file_tree_git_status_paths(root, &mut entries);

		assert_eq!(
			entries,
			vec![
				FileTreeGitStatusEntry {
					path: "submodule/".to_string(),
					status: "modified".to_string(),
				},
				FileTreeGitStatusEntry {
					path: "deleted-dir".to_string(),
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

	#[test]
	fn parse_pull_request_list_maps_gh_json() {
		let output = br#"[{"number":42,"title":"Add PR chip","state":"OPEN","url":"https://github.com/acme/repo/pull/42","isDraft":true,"headRefName":"feature/pr-chip","headRepositoryOwner":{"login":"acme"}}]"#;

		let prs = parse_pull_request_list(output, "acme").unwrap();

		assert_eq!(
			prs,
			vec![GitPullRequestStatus {
				number: 42,
				title: "Add PR chip".to_string(),
				state: "OPEN".to_string(),
				url: "https://github.com/acme/repo/pull/42".to_string(),
				is_draft: true,
				head_ref_name: "feature/pr-chip".to_string(),
			}]
		);
	}

	#[test]
	fn parse_pull_request_list_filters_by_head_owner() {
		let output = br#"[
			{"number":41,"title":"Wrong fork","state":"OPEN","url":"https://github.com/acme/repo/pull/41","isDraft":false,"headRefName":"feature/pr-chip","headRepositoryOwner":{"login":"other-user"}},
			{"number":42,"title":"Correct owner","state":"OPEN","url":"https://github.com/acme/repo/pull/42","isDraft":false,"headRefName":"feature/pr-chip","headRepositoryOwner":{"login":"Acme"}}
		]"#;

		let prs = parse_pull_request_list(output, "acme").unwrap();

		assert_eq!(prs.len(), 1);
		assert_eq!(prs[0].number, 42);
		assert_eq!(prs[0].title, "Correct owner");
	}

	#[test]
	fn parse_pull_request_list_accepts_empty_list() {
		let prs = parse_pull_request_list(br#"[]"#, "acme").unwrap();
		assert!(prs.is_empty());
	}

	#[test]
	fn sum_shortstat_lines_adds_multiple_commit_stats() {
		let stats = sum_shortstat_lines(
			" 1 file changed, 2 insertions(+)\n\n 2 files changed, 3 deletions(-)",
		);

		assert_eq!(
			stats,
			GitDiffStats {
				files_changed: 3,
				insertions: 2,
				deletions: 3,
			}
		);
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

	#[test]
	fn parse_log_commit_line_rejects_extra_fields() {
		assert!(parse_git_log_commit_line("a\x1fb\x1fc\x1fd\x1fe\x1ff\x1fg")
			.is_none());
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
		let cache_dir = tempfile::TempDir::new().unwrap();
		let initial = vec![0_u8, 1, 2, 3];
		let modified = vec![4_u8, 5, 6, 7];

		std::fs::write(dir.join("image.bin"), &initial).unwrap();
		command_without_windows_console("git")
			.args(["add", "image.bin"])
			.current_dir(&dir)
			.output()
			.unwrap();
		command_without_windows_console("git")
			.args(["commit", "-m", "add image"])
			.current_dir(&dir)
			.output()
			.unwrap();

		std::fs::write(dir.join("image.bin"), &modified).unwrap();

		let head_preview = read_head_file(
			dir.to_string_lossy().as_ref(),
			cache_dir.path(),
			"image.bin",
		)
		.unwrap()
		.unwrap();
		let worktree_preview = read_worktree_file(
			dir.to_string_lossy().as_ref(),
			cache_dir.path(),
			"image.bin",
		)
		.unwrap()
		.unwrap();

		assert_ne!(head_preview, dir.join("image.bin").to_string_lossy());
		assert_ne!(worktree_preview, dir.join("image.bin").to_string_lossy());
		assert!(Path::new(&head_preview).starts_with(cache_dir.path()));
		assert!(Path::new(&worktree_preview).starts_with(cache_dir.path()));
		assert_eq!(std::fs::read(head_preview).unwrap(), initial);
		assert_eq!(std::fs::read(worktree_preview).unwrap(), modified);

		std::fs::remove_dir_all(dir).unwrap();
	}

	#[test]
	fn read_head_file_cache_key_changes_when_head_blob_changes() {
		let dir = create_temp_git_repo();
		let cache_dir = tempfile::TempDir::new().unwrap();
		let initial = vec![0_u8, 1, 2, 3];
		let updated_same_size = vec![4_u8, 5, 6, 7];

		std::fs::write(dir.join("image.bin"), &initial).unwrap();
		command_without_windows_console("git")
			.args(["add", "image.bin"])
			.current_dir(&dir)
			.output()
			.unwrap();
		command_without_windows_console("git")
			.args(["commit", "-m", "add image"])
			.current_dir(&dir)
			.output()
			.unwrap();

		let initial_preview = read_head_file(
			dir.to_string_lossy().as_ref(),
			cache_dir.path(),
			"image.bin",
		)
		.unwrap()
		.unwrap();

		std::fs::write(dir.join("image.bin"), &updated_same_size).unwrap();
		command_without_windows_console("git")
			.args(["add", "image.bin"])
			.current_dir(&dir)
			.output()
			.unwrap();
		command_without_windows_console("git")
			.args(["commit", "-m", "update image"])
			.current_dir(&dir)
			.output()
			.unwrap();

		let updated_preview = read_head_file(
			dir.to_string_lossy().as_ref(),
			cache_dir.path(),
			"image.bin",
		)
		.unwrap()
		.unwrap();

		assert_ne!(initial_preview, updated_preview);
		assert_eq!(std::fs::read(initial_preview).unwrap(), initial);
		assert_eq!(std::fs::read(updated_preview).unwrap(), updated_same_size);

		std::fs::remove_dir_all(dir).unwrap();
	}

	#[test]
	fn read_preview_files_from_commit_and_parent_commit() {
		let dir = create_temp_git_repo();
		let cache_dir = tempfile::TempDir::new().unwrap();
		let before = vec![1_u8, 2, 3, 4];
		let after = vec![5_u8, 6, 7, 8];

		std::fs::write(dir.join("image.bin"), &before).unwrap();
		command_without_windows_console("git")
			.args(["add", "image.bin"])
			.current_dir(&dir)
			.output()
			.unwrap();
		command_without_windows_console("git")
			.args(["commit", "-m", "add image"])
			.current_dir(&dir)
			.output()
			.unwrap();

		std::fs::write(dir.join("image.bin"), &after).unwrap();
		command_without_windows_console("git")
			.args(["add", "image.bin"])
			.current_dir(&dir)
			.output()
			.unwrap();
		command_without_windows_console("git")
			.args(["commit", "-m", "update image"])
			.current_dir(&dir)
			.output()
			.unwrap();

		let head = command_without_windows_console("git")
			.args(["rev-parse", "HEAD"])
			.current_dir(&dir)
			.output()
			.unwrap();
		let commit_hash =
			String::from_utf8_lossy(&head.stdout).trim().to_string();

		let commit_preview = read_commit_file(
			dir.to_string_lossy().as_ref(),
			cache_dir.path(),
			&commit_hash,
			"image.bin",
		)
		.unwrap()
		.unwrap();
		let parent_preview = read_parent_commit_file(
			dir.to_string_lossy().as_ref(),
			cache_dir.path(),
			&commit_hash,
			"image.bin",
		)
		.unwrap()
		.unwrap();

		assert!(Path::new(&commit_preview).starts_with(cache_dir.path()));
		assert!(Path::new(&parent_preview).starts_with(cache_dir.path()));
		assert_eq!(std::fs::read(commit_preview).unwrap(), after);
		assert_eq!(std::fs::read(parent_preview).unwrap(), before);

		std::fs::remove_dir_all(dir).unwrap();
	}

	#[test]
	fn read_preview_files_reject_large_committed_blob() {
		let dir = create_temp_git_repo();
		let cache_dir = tempfile::TempDir::new().unwrap();
		let oversized = vec![0_u8; MAX_BINARY_PREVIEW_BYTES + 1];

		std::fs::write(dir.join("large.bin"), oversized).unwrap();
		command_without_windows_console("git")
			.args(["add", "large.bin"])
			.current_dir(&dir)
			.output()
			.unwrap();
		command_without_windows_console("git")
			.args(["commit", "-m", "add large image"])
			.current_dir(&dir)
			.output()
			.unwrap();

		let error = read_head_file(
			dir.to_string_lossy().as_ref(),
			cache_dir.path(),
			"large.bin",
		)
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
		command_without_windows_console("git")
			.args(["init"])
			.current_dir(&dir)
			.output()
			.unwrap();
		command_without_windows_console("git")
			.args(["config", "user.email", "test@test.com"])
			.current_dir(&dir)
			.output()
			.unwrap();
		command_without_windows_console("git")
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
		command_without_windows_console("git")
			.args(["add", filename])
			.current_dir(dir)
			.output()
			.unwrap();
		command_without_windows_console("git")
			.args(["commit", "-m", msg])
			.current_dir(dir)
			.output()
			.unwrap();
	}

	fn force_color_output(dir: &std::path::Path) {
		command_without_windows_console("git")
			.args(["config", "color.ui", "always"])
			.current_dir(dir)
			.output()
			.unwrap();
	}

	fn force_mnemonic_prefixes(dir: &std::path::Path) {
		command_without_windows_console("git")
			.args(["config", "diff.mnemonicPrefix", "true"])
			.current_dir(dir)
			.output()
			.unwrap();
	}

	fn git_ok(dir: &std::path::Path, args: &[&str]) {
		let output = command_without_windows_console("git")
			.args(args)
			.current_dir(dir)
			.output()
			.unwrap();
		assert!(
			output.status.success(),
			"git {:?} failed: {}",
			args,
			String::from_utf8_lossy(&output.stderr),
		);
	}

	fn current_head(dir: &std::path::Path) -> String {
		let output = command_without_windows_console("git")
			.args(["rev-parse", "HEAD"])
			.current_dir(dir)
			.output()
			.unwrap();
		assert!(
			output.status.success(),
			"git rev-parse HEAD failed: {}",
			String::from_utf8_lossy(&output.stderr)
		);
		String::from_utf8_lossy(&output.stdout).trim().to_string()
	}

	fn sentinel_commit(message: &str) -> GitCommit {
		GitCommit {
			hash: "sentinel".to_string(),
			full_hash: "sentinel000000000000000000000000000000000000"
				.to_string(),
			author: GitAuthor {
				name: "Cache".to_string(),
				email: "cache@example.com".to_string(),
			},
			date: "2026-01-01T00:00:00+00:00".to_string(),
			message: message.to_string(),
			files_changed: 0,
			insertions: 0,
			deletions: 0,
		}
	}

	fn count_loose_objects(dir: &std::path::Path) -> usize {
		let objects = dir.join(".git/objects");
		let mut count = 0;
		for entry in std::fs::read_dir(&objects).into_iter().flatten().flatten()
		{
			let name = entry.file_name();
			let name = name.to_string_lossy();
			if name == "pack" || name == "info" {
				continue;
			}
			count += std::fs::read_dir(entry.path())
				.map(|entries| entries.flatten().count())
				.unwrap_or(0);
		}
		count
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
	fn list_branches_reports_diverged_ahead_behind_counts() {
		let dir = create_temp_git_repo();
		add_commit(&dir, "base.txt", "1", "base 1");
		add_commit(&dir, "base.txt", "2", "base 2");
		add_commit(&dir, "main-a.txt", "3", "main 3");
		add_commit(&dir, "main-b.txt", "4", "main 4");
		let trunk = branch(&dir.to_string_lossy()).unwrap();
		git_ok(&dir, &["checkout", "-b", "feat", "HEAD~2"]);
		add_commit(&dir, "feat-a.txt", "a", "feat a");
		add_commit(&dir, "feat-b.txt", "b", "feat b");
		add_commit(&dir, "feat-c.txt", "c", "feat c");
		git_ok(&dir, &["checkout", &trunk]);

		let branches = list_branches(&dir.to_string_lossy()).unwrap();
		let _ = std::fs::remove_dir_all(&dir);
		let feat = branches.iter().find(|item| item.name == "feat").unwrap();
		let current = branches.iter().find(|item| item.name == trunk).unwrap();

		assert_eq!(feat.ahead, 3);
		assert_eq!(feat.behind, 2);
		assert!(current.is_current);
		assert_eq!(current.ahead, 0);
		assert_eq!(current.behind, 0);
		assert_eq!(branches.iter().filter(|item| item.is_trunk).count(), 1);
	}

	#[test]
	fn list_branches_reports_purely_behind_branch() {
		let dir = create_temp_git_repo();
		add_commit(&dir, "base.txt", "1", "base 1");
		add_commit(&dir, "base.txt", "2", "base 2");
		add_commit(&dir, "base.txt", "3", "base 3");
		git_ok(&dir, &["branch", "old", "HEAD~2"]);

		let branches = list_branches(&dir.to_string_lossy()).unwrap();
		let _ = std::fs::remove_dir_all(&dir);
		let old = branches.iter().find(|item| item.name == "old").unwrap();

		assert_eq!(old.ahead, 0);
		assert_eq!(old.behind, 2);
	}

	#[test]
	fn list_branches_empty_repo_returns_empty_vec() {
		let dir = create_temp_git_repo();
		let branches = list_branches(&dir.to_string_lossy()).unwrap();
		let _ = std::fs::remove_dir_all(&dir);

		assert!(branches.is_empty());
	}

	#[test]
	fn list_branches_marks_branch_used_by_other_worktree() {
		let dir = create_temp_git_repo();
		add_commit(&dir, "base.txt", "1", "base 1");
		git_ok(&dir, &["branch", "feat"]);
		let worktree = std::env::temp_dir()
			.join(format!("git-infra-worktree-{}", uuid::Uuid::new_v4()));
		git_ok(
			&dir,
			&[
				"worktree",
				"add",
				worktree.to_string_lossy().as_ref(),
				"feat",
			],
		);

		let branches = list_branches(&dir.to_string_lossy()).unwrap();
		let _ = std::fs::remove_dir_all(&worktree);
		let _ = std::fs::remove_dir_all(&dir);
		let feat = branches.iter().find(|item| item.name == "feat").unwrap();
		let current = branches.iter().find(|item| item.is_current).unwrap();

		assert!(feat.is_used);
		assert!(!current.is_used);
	}

	#[test]
	fn list_branches_fast_path_matches_per_branch_fallback() {
		let dir = create_temp_git_repo();
		add_commit(&dir, "base.txt", "1", "base 1");
		add_commit(&dir, "base.txt", "2", "base 2");
		add_commit(&dir, "main-a.txt", "3", "main 3");
		let trunk = branch(&dir.to_string_lossy()).unwrap();
		git_ok(&dir, &["checkout", "-b", "feat", "HEAD~1"]);
		add_commit(&dir, "feat.txt", "feat", "feat");
		git_ok(&dir, &["checkout", &trunk]);

		let fast = list_branches(&dir.to_string_lossy()).unwrap();
		let fallback =
			list_branches_per_branch(&dir.to_string_lossy()).unwrap();
		let _ = std::fs::remove_dir_all(&dir);

		assert_eq!(fast, fallback);
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
	fn log_cache_hit_reuses_head_guarded_entry() {
		let dir = create_temp_git_repo();
		add_commit(&dir, "a.txt", "hello", "First");
		let head = current_head(&dir);
		log_cache_insert_for_test(
			&dir.to_string_lossy(),
			50,
			head,
			vec![sentinel_commit("cached")],
		);

		let commits = log(&dir.to_string_lossy(), 50).unwrap();
		let _ = std::fs::remove_dir_all(&dir);

		assert_eq!(commits.len(), 1);
		assert_eq!(commits[0].message, "cached");
	}

	#[test]
	fn log_cache_miss_when_head_moves() {
		let dir = create_temp_git_repo();
		add_commit(&dir, "a.txt", "hello", "First");
		let old_head = current_head(&dir);
		log_cache_insert_for_test(
			&dir.to_string_lossy(),
			50,
			old_head,
			vec![sentinel_commit("stale")],
		);
		add_commit(&dir, "b.txt", "world", "Second");

		let commits = log(&dir.to_string_lossy(), 50).unwrap();
		let _ = std::fs::remove_dir_all(&dir);

		assert_eq!(commits[0].message, "Second");
		assert!(commits.iter().all(|commit| commit.message != "stale"));
	}

	#[test]
	fn log_cache_populates_after_stable_read() {
		let dir = create_temp_git_repo();
		add_commit(&dir, "a.txt", "hello", "First");

		let uncached = log(&dir.to_string_lossy(), 50).unwrap();
		std::fs::remove_file(dir.join("a.txt")).unwrap();
		let cached = log(&dir.to_string_lossy(), 50).unwrap();
		let _ = std::fs::remove_dir_all(&dir);

		assert_eq!(cached.len(), uncached.len());
		assert_eq!(cached[0].hash, uncached[0].hash);
		assert_eq!(cached[0].message, uncached[0].message);
		assert_eq!(cached[0].files_changed, uncached[0].files_changed);
	}

	#[test]
	fn log_cache_keeps_limits_independent() {
		let dir = create_temp_git_repo();
		add_commit(&dir, "a.txt", "a", "First");
		add_commit(&dir, "b.txt", "b", "Second");
		let head = current_head(&dir);
		log_cache_insert_for_test(
			&dir.to_string_lossy(),
			1,
			head.clone(),
			vec![sentinel_commit("limit one")],
		);
		log_cache_insert_for_test(
			&dir.to_string_lossy(),
			2,
			head,
			vec![sentinel_commit("limit two")],
		);

		let one = log(&dir.to_string_lossy(), 1).unwrap();
		let two = log(&dir.to_string_lossy(), 2).unwrap();
		let _ = std::fs::remove_dir_all(&dir);

		assert_eq!(one[0].message, "limit one");
		assert_eq!(two[0].message, "limit two");
	}

	#[test]
	fn log_empty_repo_bypasses_cache_without_head() {
		let dir = create_temp_git_repo();
		log_cache_insert_for_test(
			&dir.to_string_lossy(),
			50,
			"missing-head".to_string(),
			vec![sentinel_commit("should not be returned")],
		);

		let commits = log(&dir.to_string_lossy(), 50).unwrap();
		let _ = std::fs::remove_dir_all(&dir);

		assert!(commits.is_empty());
	}

	#[test]
	fn show_returns_patch() {
		let dir = create_temp_git_repo();
		add_commit(&dir, "hello.txt", "hello world", "Add hello");

		let log_output = command_without_windows_console("git")
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
	fn show_returns_plain_patch_when_git_color_is_forced() {
		let dir = create_temp_git_repo();
		force_color_output(&dir);
		add_commit(&dir, "hello.txt", "hello world", "Add hello");

		let log_output = command_without_windows_console("git")
			.args(["log", "-1", "--format=%H"])
			.current_dir(&dir)
			.output()
			.unwrap();
		let hash = String::from_utf8_lossy(&log_output.stdout)
			.trim()
			.to_string();

		let patch = show(&dir.to_string_lossy(), &hash).unwrap();
		let _ = std::fs::remove_dir_all(&dir);

		assert!(patch.starts_with("diff --git"));
		assert!(!patch.contains("\x1b["));
		assert!(patch.contains("+hello world"));
	}

	#[test]
	fn show_returns_standard_patch_prefixes_when_mnemonic_prefixes_are_forced()
	{
		let dir = create_temp_git_repo();
		force_mnemonic_prefixes(&dir);
		add_commit(&dir, "hello.txt", "hello world", "Add hello");

		let log_output = command_without_windows_console("git")
			.args(["log", "-1", "--format=%H"])
			.current_dir(&dir)
			.output()
			.unwrap();
		let hash = String::from_utf8_lossy(&log_output.stdout)
			.trim()
			.to_string();

		let patch = show(&dir.to_string_lossy(), &hash).unwrap();
		let _ = std::fs::remove_dir_all(&dir);

		assert!(patch.starts_with("diff --git a/hello.txt b/hello.txt"));
		assert!(patch.contains("--- /dev/null"));
		assert!(patch.contains("+++ b/hello.txt"));
		assert!(!patch.contains("diff --git c/hello.txt i/hello.txt"));
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
	fn diff_returns_plain_patch_when_git_color_is_forced() {
		let dir = create_temp_git_repo();
		force_color_output(&dir);
		add_commit(&dir, "a.txt", "hello", "Init");

		std::fs::write(dir.join("a.txt"), "hello world").unwrap();

		let diff_output = diff(&dir.to_string_lossy()).unwrap();
		let _ = std::fs::remove_dir_all(&dir);

		assert!(diff_output.starts_with("diff --git"));
		assert!(!diff_output.contains("\x1b["));
		assert!(diff_output.contains("-hello"));
		assert!(diff_output.contains("+hello world"));
	}

	#[test]
	fn diff_returns_standard_patch_prefixes_when_mnemonic_prefixes_are_forced()
	{
		let dir = create_temp_git_repo();
		force_mnemonic_prefixes(&dir);
		add_commit(&dir, "a.txt", "hello", "Init");

		std::fs::write(dir.join("a.txt"), "hello world").unwrap();

		let diff_output = diff(&dir.to_string_lossy()).unwrap();
		let _ = std::fs::remove_dir_all(&dir);

		assert!(diff_output.starts_with("diff --git a/a.txt b/a.txt"));
		assert!(diff_output.contains("--- a/a.txt"));
		assert!(diff_output.contains("+++ b/a.txt"));
		assert!(!diff_output.contains("diff --git c/a.txt w/a.txt"));
		assert!(diff_output.contains("-hello"));
		assert!(diff_output.contains("+hello world"));
	}

	#[test]
	fn diff_staged_changes() {
		let dir = create_temp_git_repo();
		add_commit(&dir, "a.txt", "hello", "Init");

		std::fs::write(dir.join("a.txt"), "hello world").unwrap();
		command_without_windows_console("git")
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
		command_without_windows_console("git")
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
		command_without_windows_console("git")
			.args(["add", "build/entitlements.mac.plist"])
			.current_dir(&dir)
			.output()
			.unwrap();
		command_without_windows_console("git")
			.args(["commit", "-m", "Add tracked entitlements"])
			.current_dir(&dir)
			.output()
			.unwrap();

		std::fs::write(dir.join(".gitignore"), "build/\n").unwrap();
		command_without_windows_console("git")
			.args(["add", ".gitignore"])
			.current_dir(&dir)
			.output()
			.unwrap();
		command_without_windows_console("git")
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
	fn diff_stats_matches_snapshot_stats_including_untracked() {
		let dir = create_temp_git_repo();
		add_commit(&dir, "a.txt", "line1\nline2\n", "Init");
		std::fs::write(dir.join("a.txt"), "line1 changed\n").unwrap();
		std::fs::write(dir.join("new.txt"), "brand\nnew\n").unwrap();

		let folder = dir.to_string_lossy().to_string();
		let stats = diff_stats(&folder).unwrap();
		let snapshot = diff_snapshot(&folder).unwrap();
		let _ = std::fs::remove_dir_all(&dir);

		assert_eq!(stats, snapshot.stats);
		assert_eq!(stats.files_changed, 2);
		assert!(stats.insertions >= 3);
	}

	#[test]
	fn diff_snapshot_combined_invocation_reports_stats_and_patch() {
		let dir = create_temp_git_repo();
		add_commit(&dir, "a.txt", "old\n", "Init a");
		add_commit(&dir, "b.txt", "bye\n", "Init b");
		std::fs::write(dir.join("a.txt"), "new\nextra\n").unwrap();
		std::fs::remove_file(dir.join("b.txt")).unwrap();
		std::fs::write(dir.join("new.txt"), "one\ntwo\n").unwrap();

		let snapshot = diff_snapshot(&dir.to_string_lossy()).unwrap();
		let _ = std::fs::remove_dir_all(&dir);

		assert!(snapshot.diff.starts_with("diff --git "));
		assert!(snapshot.diff.contains("a.txt"));
		assert!(snapshot.diff.contains("b.txt"));
		assert!(snapshot.diff.contains("new.txt"));
		assert_eq!(snapshot.stats.files_changed, 3);
		assert_eq!(snapshot.stats.insertions, 4);
		assert_eq!(snapshot.stats.deletions, 2);
	}

	#[test]
	fn diff_snapshot_writes_no_loose_objects_per_poll() {
		let dir = create_temp_git_repo();
		add_commit(&dir, "a.txt", "old\n", "Init a");
		add_commit(&dir, "b.txt", "gone\n", "Init b");
		std::fs::write(dir.join("a.txt"), "new\n").unwrap();
		std::fs::remove_file(dir.join("b.txt")).unwrap();
		std::fs::write(dir.join("new.txt"), "untracked\n").unwrap();

		let before = count_loose_objects(&dir);
		diff_snapshot(&dir.to_string_lossy()).unwrap();
		let after_first = count_loose_objects(&dir);
		diff_snapshot(&dir.to_string_lossy()).unwrap();
		let after_second = count_loose_objects(&dir);
		let _ = std::fs::remove_dir_all(&dir);

		assert!(after_first.saturating_sub(before) <= 1);
		assert_eq!(after_second, after_first);
	}

	#[test]
	fn diff_snapshot_cache_detects_content_change_with_unchanged_status() {
		let dir = create_temp_git_repo();
		add_commit(&dir, "a.txt", "old\n", "Init");
		std::fs::write(dir.join("a.txt"), "first\n").unwrap();

		let first = diff_snapshot(&dir.to_string_lossy()).unwrap();
		std::fs::write(dir.join("a.txt"), "second longer\n").unwrap();
		let second = diff_snapshot(&dir.to_string_lossy()).unwrap();
		let _ = std::fs::remove_dir_all(&dir);

		assert!(first.diff.contains("+first"));
		assert!(second.diff.contains("+second longer"));
		assert_ne!(first.diff, second.diff);
	}

	#[test]
	fn diff_snapshot_when_all_tracked_files_deleted() {
		let dir = create_temp_git_repo();
		add_commit(&dir, "a.txt", "a\n", "Init a");
		add_commit(&dir, "b.txt", "b\n", "Init b");
		std::fs::remove_file(dir.join("a.txt")).unwrap();
		std::fs::remove_file(dir.join("b.txt")).unwrap();

		let snapshot = diff_snapshot(&dir.to_string_lossy()).unwrap();
		let _ = std::fs::remove_dir_all(&dir);

		assert!(snapshot.diff.contains("deleted file"));
		assert!(snapshot.diff.contains("a.txt"));
		assert!(snapshot.diff.contains("b.txt"));
		assert_eq!(snapshot.stats.files_changed, 2);
		assert_eq!(snapshot.stats.deletions, 2);
	}

	#[test]
	fn branch_unique_commits_counts_no_upstream_branch_commits() {
		let dir = create_temp_git_repo();
		add_commit(&dir, "base.txt", "base", "Init");
		command_without_windows_console("git")
			.args(["checkout", "-b", "feature/delete-risk"])
			.current_dir(&dir)
			.output()
			.unwrap();
		add_commit(&dir, "feature-a.txt", "a", "Feature A");
		add_commit(&dir, "feature-b.txt", "b", "Feature B");

		let commits = branch_unique_commits(
			&dir.to_string_lossy(),
			"feature/delete-risk",
		)
		.unwrap();
		let stats =
			commit_diff_stats(&dir.to_string_lossy(), &commits).unwrap();
		let _ = std::fs::remove_dir_all(&dir);

		assert_eq!(commits.len(), 2);
		assert_eq!(stats.files_changed, 2);
		assert_eq!(stats.insertions, 2);
		assert_eq!(stats.deletions, 0);
	}

	#[test]
	fn branch_unique_commits_ignores_commits_kept_by_another_ref() {
		let dir = create_temp_git_repo();
		add_commit(&dir, "base.txt", "base", "Init");
		command_without_windows_console("git")
			.args(["checkout", "-b", "feature/delete-risk"])
			.current_dir(&dir)
			.output()
			.unwrap();
		add_commit(&dir, "feature-a.txt", "a", "Feature A");
		command_without_windows_console("git")
			.args(["branch", "backup/delete-risk"])
			.current_dir(&dir)
			.output()
			.unwrap();

		let commits = branch_unique_commits(
			&dir.to_string_lossy(),
			"feature/delete-risk",
		)
		.unwrap();
		let _ = std::fs::remove_dir_all(&dir);

		assert!(commits.is_empty());
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

		let status = command_without_windows_console("git")
			.args(["status", "--short"])
			.current_dir(&dir)
			.output()
			.unwrap();
		assert!(String::from_utf8_lossy(&status.stdout).trim().is_empty());
	}
}
