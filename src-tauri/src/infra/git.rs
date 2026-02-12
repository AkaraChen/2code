use std::path::Path;
use std::process::Command;

use crate::error::{AppError, AppResult};
use crate::model::project::{GitAuthor, GitCommit};

pub fn init(dir: &Path) -> AppResult<()> {
	let output = Command::new("git").arg("init").current_dir(dir).output()?;

	if !output.status.success() {
		let stderr = String::from_utf8_lossy(&output.stderr);
		return Err(AppError::PtyError(format!("git init failed: {stderr}")));
	}
	Ok(())
}

pub fn branch(folder: &str) -> AppResult<String> {
	let output = Command::new("git")
		.args(["rev-parse", "--abbrev-ref", "HEAD"])
		.current_dir(folder)
		.output()?;
	if !output.status.success() {
		return Err(AppError::GitError(
			String::from_utf8_lossy(&output.stderr).trim().to_string(),
		));
	}
	Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

pub fn diff(folder: &str) -> AppResult<String> {
	let output = Command::new("git")
		.args(["diff"])
		.current_dir(folder)
		.output()?;

	Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

pub fn log(folder: &str, limit: u32) -> AppResult<Vec<GitCommit>> {
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

pub fn show(folder: &str, commit_hash: &str) -> AppResult<String> {
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
) -> AppResult<()> {
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
			log::warn!("git worktree remove failed: {stderr}");
		}
		Err(e) => {
			log::warn!("git worktree remove error: {e}");
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
			log::warn!("git branch delete failed: {stderr}");
		}
		Err(e) => {
			log::warn!("git branch delete error: {e}");
		}
		_ => {}
	}
}

// --- Private helpers ---

pub fn validate_commit_hash(hash: &str) -> AppResult<()> {
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
		// merge commits or empty commits may lack shortstat
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
	fn branch_non_git_dir() {
		let dir = std::env::temp_dir()
			.join(format!("no-git-infra-{}", uuid::Uuid::new_v4()));
		std::fs::create_dir_all(&dir).unwrap();
		let result = branch(&dir.to_string_lossy());
		let _ = std::fs::remove_dir_all(&dir);
		assert!(result.is_err());
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
}
