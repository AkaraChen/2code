use std::path::Path;
use std::process::Command;

use model::error::AppError;
use model::project::{
	GitAuthor, GitCommit, GithubPrInfo, GithubPrState, GithubPrStatus,
};
use serde::Deserialize;

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

pub fn github_pr_status(folder: &str) -> Result<GithubPrStatus, AppError> {
	let branch_name = branch(folder).unwrap_or_else(|_| "main".to_string());
	let (worktree_clean, status_summary) = worktree_status(folder);
	let Some(repo) = github_repo(folder) else {
		return Ok(GithubPrStatus {
			is_github_host: false,
			branch: branch_name.clone(),
			is_main_branch: branch_name == "main",
			worktree_clean,
			status_summary,
			pr: None,
			create_url: None,
		});
	};

	let pr = find_github_pr(folder, &repo, &branch_name)
		.ok()
		.and_then(|v| v);

	Ok(GithubPrStatus {
		is_github_host: true,
		branch: branch_name.clone(),
		is_main_branch: branch_name == "main",
		worktree_clean,
		status_summary,
		pr,
		create_url: Some(format!(
			"https://github.com/{}/{}/compare/main...{}?expand=1",
			repo.owner, repo.name, branch_name
		)),
	})
}

/// Get the full diff (staged + unstaged) without affecting the real index.
/// Uses a temporary index file to stage all changes, then diffs against HEAD.
pub fn diff(folder: &str) -> Result<String, AppError> {
	let tmp_dir = tempfile::tempdir().map_err(|e| {
		AppError::GitError(format!("Failed to create temp dir: {e}"))
	})?;
	let tmp_index = tmp_dir.path().join("index");

	// Stage all changes into a fresh temporary index (git add -A builds it from scratch)
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
	run_best_effort(
		"worktree remove",
		Command::new("git")
			.args(["worktree", "remove", worktree_path, "--force"])
			.current_dir(project_folder),
	);
}

pub fn branch_delete(project_folder: &str, branch_name: &str) {
	run_best_effort(
		"branch delete",
		Command::new("git")
			.args(["branch", "-D", branch_name])
			.current_dir(project_folder),
	);
}

/// Run a git command, logging warnings on failure without propagating errors.
fn run_best_effort(label: &str, cmd: &mut Command) {
	match cmd.output() {
		Ok(o) if !o.status.success() => {
			let stderr = String::from_utf8_lossy(&o.stderr);
			tracing::warn!("git {label} failed: {stderr}");
		}
		Err(e) => {
			tracing::warn!("git {label} error: {e}");
		}
		_ => {}
	}
}

// --- Private helpers ---

#[derive(Debug, Clone)]
struct GithubRepo {
	owner: String,
	name: String,
}

#[derive(Debug, Deserialize)]
struct GhPrItem {
	number: u64,
	url: String,
	state: String,
	#[serde(rename = "mergedAt")]
	merged_at: Option<String>,
}

fn worktree_status(folder: &str) -> (bool, String) {
	let output = match Command::new("git")
		.args(["status", "--short", "--branch"])
		.current_dir(folder)
		.output()
	{
		Ok(output) => output,
		Err(_) => return (true, String::new()),
	};
	if !output.status.success() {
		return (true, String::new());
	}

	let status = String::from_utf8_lossy(&output.stdout).trim().to_string();
	if status.is_empty() {
		return (true, status);
	}

	let mut lines = status.lines();
	let mut dirty_lines = Vec::new();

	if let Some(first) = lines.next() {
		let first = first.trim();
		if !first.is_empty() && !first.starts_with("##") {
			dirty_lines.push(first);
		}
	}
	for line in lines {
		let line = line.trim();
		if !line.is_empty() {
			dirty_lines.push(line);
		}
	}

	(dirty_lines.is_empty(), status)
}

fn find_github_pr(
	folder: &str,
	repo: &GithubRepo,
	branch_name: &str,
) -> Result<Option<GithubPrInfo>, AppError> {
	let output = Command::new("gh")
		.args([
			"pr",
			"list",
			"--state",
			"all",
			"--head",
			branch_name,
			"--limit",
			"1",
			"--json",
			"number,url,state,mergedAt",
			"--repo",
			&format!("{}/{}", repo.owner, repo.name),
		])
		.current_dir(folder)
		.output()?;
	if !output.status.success() {
		let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
		return Err(AppError::GitError(stderr));
	}

	let prs: Vec<GhPrItem> =
		serde_json::from_slice(&output.stdout).map_err(|e| {
			AppError::GitError(format!("Failed to parse gh output: {e}"))
		})?;
	let Some(pr) = prs.into_iter().next() else {
		return Ok(None);
	};

	let state =
		if pr.merged_at.is_some() || pr.state.eq_ignore_ascii_case("merged") {
			GithubPrState::Merged
		} else if pr.state.eq_ignore_ascii_case("open") {
			GithubPrState::Open
		} else {
			GithubPrState::Closed
		};

	Ok(Some(GithubPrInfo {
		number: pr.number,
		url: pr.url,
		state,
	}))
}

fn github_repo(folder: &str) -> Option<GithubRepo> {
	let output = Command::new("git")
		.args(["remote", "get-url", "origin"])
		.current_dir(folder)
		.output()
		.ok()?;
	if !output.status.success() {
		return None;
	}

	let remote = String::from_utf8_lossy(&output.stdout).trim().to_string();
	parse_github_repo(&remote)
}

fn parse_github_repo(remote: &str) -> Option<GithubRepo> {
	let remote = remote.trim().trim_end_matches('/');
	if remote.is_empty() {
		return None;
	}

	if let Some(rest) = remote.strip_prefix("git@") {
		let (host, path) = rest.split_once(':')?;
		if !is_github_host(host) {
			return None;
		}
		return parse_github_owner_repo(path);
	}

	if let Some(rest) = remote.strip_prefix("ssh://") {
		let rest = rest.strip_prefix("git@").unwrap_or(rest);
		let (host, path) = rest.split_once('/')?;
		if !is_github_host(host) {
			return None;
		}
		return parse_github_owner_repo(path);
	}

	if let Some(rest) = remote
		.strip_prefix("https://")
		.or_else(|| remote.strip_prefix("http://"))
	{
		let (host, path) = rest.split_once('/')?;
		if !is_github_host(host) {
			return None;
		}
		return parse_github_owner_repo(path);
	}

	None
}

fn is_github_host(host: &str) -> bool {
	let host = host.rsplit('@').next().unwrap_or(host);
	let host = host.split(':').next().unwrap_or(host);
	host.eq_ignore_ascii_case("github.com")
}

fn parse_github_owner_repo(path: &str) -> Option<GithubRepo> {
	let path = path.trim_start_matches('/').trim_end_matches('/');
	let mut parts = path.split('/');
	let owner = parts.next()?;
	let repo = parts.next()?;
	if owner.is_empty() || repo.is_empty() {
		return None;
	}

	let repo = repo.trim_end_matches(".git");
	if repo.is_empty() {
		return None;
	}

	Some(GithubRepo {
		owner: owner.to_string(),
		name: repo.to_string(),
	})
}

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

	// --- parse_github_repo ---

	#[test]
	fn parse_github_repo_https() {
		let parsed = parse_github_repo("https://github.com/acme/workbench.git");
		assert!(parsed.is_some());
		let repo = parsed.unwrap();
		assert_eq!(repo.owner, "acme");
		assert_eq!(repo.name, "workbench");
	}

	#[test]
	fn parse_github_repo_ssh() {
		let parsed = parse_github_repo("git@github.com:acme/workbench.git");
		assert!(parsed.is_some());
		let repo = parsed.unwrap();
		assert_eq!(repo.owner, "acme");
		assert_eq!(repo.name, "workbench");
	}

	#[test]
	fn parse_github_repo_rejects_non_github() {
		let parsed = parse_github_repo("git@gitlab.com:acme/workbench.git");
		assert!(parsed.is_none());
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
}
