use std::path::Path;

use model::error::AppError;
use model::filesystem::FileTreeGitStatusEntry;
use model::project::{GitCommit, GitDiffStats};

/// Operations that have a meaningful backend choice (CLI shell-out or gix).
///
/// Pure validation/parsing helpers and silent-by-design ops (worktree_remove,
/// branch_delete) stay as free functions in `cli` — they don't need polymorphism.
///
/// Phase 1 task #4 fills in `GixBackend` impls for the read paths (status, log,
/// diff, branch, ahead_count, read_*_file). Writes stay on `CliBackend`.
pub trait GitBackend: Send + Sync {
	// ── lifecycle ──
	fn init(&self, dir: &Path) -> Result<(), AppError>;

	// ── read paths ──
	fn branch(&self, folder: &str) -> Result<String, AppError>;
	fn status(
		&self,
		folder: &str,
	) -> Result<Vec<FileTreeGitStatusEntry>, AppError>;
	fn diff(&self, folder: &str) -> Result<String, AppError>;
	fn diff_stats(&self, folder: &str) -> Result<GitDiffStats, AppError>;
	fn log(
		&self,
		folder: &str,
		limit: u32,
	) -> Result<Vec<GitCommit>, AppError>;
	fn show(&self, folder: &str, commit_hash: &str)
		-> Result<String, AppError>;
	fn ahead_count(&self, folder: &str) -> u32;

	fn read_worktree_file(
		&self,
		folder: &str,
		path: &str,
	) -> Result<Option<String>, AppError>;
	fn read_head_file(
		&self,
		folder: &str,
		path: &str,
	) -> Result<Option<String>, AppError>;
	fn read_commit_file(
		&self,
		folder: &str,
		commit_hash: &str,
		path: &str,
	) -> Result<Option<String>, AppError>;
	fn read_parent_commit_file(
		&self,
		folder: &str,
		commit_hash: &str,
		path: &str,
	) -> Result<Option<String>, AppError>;

	// ── write paths ──
	fn commit(
		&self,
		folder: &str,
		files: &[String],
		message: &str,
		body: Option<&str>,
	) -> Result<String, AppError>;
	fn discard_changes(
		&self,
		folder: &str,
		paths: &[String],
	) -> Result<(), AppError>;
	fn push(&self, folder: &str) -> Result<(), AppError>;
	fn worktree_add(
		&self,
		project_folder: &str,
		branch_name: &str,
		worktree_path: &str,
	) -> Result<(), AppError>;
}

/// CLI shell-out backend (the original implementation).
pub struct CliBackend;

impl GitBackend for CliBackend {
	fn init(&self, dir: &Path) -> Result<(), AppError> {
		super::cli::init(dir)
	}

	fn branch(&self, folder: &str) -> Result<String, AppError> {
		super::cli::branch(folder)
	}

	fn status(
		&self,
		folder: &str,
	) -> Result<Vec<FileTreeGitStatusEntry>, AppError> {
		super::cli::status(folder)
	}

	fn diff(&self, folder: &str) -> Result<String, AppError> {
		super::cli::diff(folder)
	}

	fn diff_stats(&self, folder: &str) -> Result<GitDiffStats, AppError> {
		super::cli::diff_stats(folder)
	}

	fn log(
		&self,
		folder: &str,
		limit: u32,
	) -> Result<Vec<GitCommit>, AppError> {
		super::cli::log(folder, limit)
	}

	fn show(
		&self,
		folder: &str,
		commit_hash: &str,
	) -> Result<String, AppError> {
		super::cli::show(folder, commit_hash)
	}

	fn ahead_count(&self, folder: &str) -> u32 {
		super::cli::ahead_count(folder)
	}

	fn read_worktree_file(
		&self,
		folder: &str,
		path: &str,
	) -> Result<Option<String>, AppError> {
		super::cli::read_worktree_file(folder, path)
	}

	fn read_head_file(
		&self,
		folder: &str,
		path: &str,
	) -> Result<Option<String>, AppError> {
		super::cli::read_head_file(folder, path)
	}

	fn read_commit_file(
		&self,
		folder: &str,
		commit_hash: &str,
		path: &str,
	) -> Result<Option<String>, AppError> {
		super::cli::read_commit_file(folder, commit_hash, path)
	}

	fn read_parent_commit_file(
		&self,
		folder: &str,
		commit_hash: &str,
		path: &str,
	) -> Result<Option<String>, AppError> {
		super::cli::read_parent_commit_file(folder, commit_hash, path)
	}

	fn commit(
		&self,
		folder: &str,
		files: &[String],
		message: &str,
		body: Option<&str>,
	) -> Result<String, AppError> {
		super::cli::commit(folder, files, message, body)
	}

	fn discard_changes(
		&self,
		folder: &str,
		paths: &[String],
	) -> Result<(), AppError> {
		super::cli::discard_changes(folder, paths)
	}

	fn push(&self, folder: &str) -> Result<(), AppError> {
		super::cli::push(folder)
	}

	fn worktree_add(
		&self,
		project_folder: &str,
		branch_name: &str,
		worktree_path: &str,
	) -> Result<(), AppError> {
		super::cli::worktree_add(project_folder, branch_name, worktree_path)
	}
}

/// gix backend. Read-path methods land per Phase 1 task #4; for now every
/// method delegates to CLI so callers can switch to `GixBackend` without
/// breaking anything. Methods get re-implemented one at a time as gix code
/// lands and proves out against the existing CLI test suite.
pub struct GixBackend;

impl GitBackend for GixBackend {
	fn init(&self, dir: &Path) -> Result<(), AppError> {
		super::cli::init(dir)
	}

	fn branch(&self, folder: &str) -> Result<String, AppError> {
		super::gix::branch(folder)
	}

	fn status(
		&self,
		folder: &str,
	) -> Result<Vec<FileTreeGitStatusEntry>, AppError> {
		// gix status output format would need to match CLI byte-for-byte
		// for the file-tree icons; defer to CLI for now.
		super::cli::status(folder)
	}

	fn diff(&self, folder: &str) -> Result<String, AppError> {
		// Diff text rendering is intricate (the @pierre/diffs frontend parser
		// expects exact CLI output); keep on CLI.
		super::cli::diff(folder)
	}

	fn diff_stats(&self, folder: &str) -> Result<GitDiffStats, AppError> {
		// Same reason as diff().
		super::cli::diff_stats(folder)
	}

	fn log(
		&self,
		folder: &str,
		limit: u32,
	) -> Result<Vec<GitCommit>, AppError> {
		super::gix::log(folder, limit)
	}

	fn show(
		&self,
		folder: &str,
		commit_hash: &str,
	) -> Result<String, AppError> {
		super::cli::show(folder, commit_hash)
	}

	fn ahead_count(&self, folder: &str) -> u32 {
		super::gix::ahead_count(folder)
	}

	fn read_worktree_file(
		&self,
		folder: &str,
		path: &str,
	) -> Result<Option<String>, AppError> {
		super::cli::read_worktree_file(folder, path)
	}

	fn read_head_file(
		&self,
		folder: &str,
		path: &str,
	) -> Result<Option<String>, AppError> {
		super::cli::read_head_file(folder, path)
	}

	fn read_commit_file(
		&self,
		folder: &str,
		commit_hash: &str,
		path: &str,
	) -> Result<Option<String>, AppError> {
		super::cli::read_commit_file(folder, commit_hash, path)
	}

	fn read_parent_commit_file(
		&self,
		folder: &str,
		commit_hash: &str,
		path: &str,
	) -> Result<Option<String>, AppError> {
		super::cli::read_parent_commit_file(folder, commit_hash, path)
	}

	fn commit(
		&self,
		folder: &str,
		files: &[String],
		message: &str,
		body: Option<&str>,
	) -> Result<String, AppError> {
		super::cli::commit(folder, files, message, body)
	}

	fn discard_changes(
		&self,
		folder: &str,
		paths: &[String],
	) -> Result<(), AppError> {
		super::cli::discard_changes(folder, paths)
	}

	fn push(&self, folder: &str) -> Result<(), AppError> {
		super::cli::push(folder)
	}

	fn worktree_add(
		&self,
		project_folder: &str,
		branch_name: &str,
		worktree_path: &str,
	) -> Result<(), AppError> {
		super::cli::worktree_add(project_folder, branch_name, worktree_path)
	}
}

/// The default backend used by the dispatcher. `GixBackend` is a hybrid
/// today: gix-powered read paths (branch, log, ahead_count) and CLI for
/// everything else. As more gix implementations land, more methods on
/// `GixBackend` flip from cli:: delegation to gix:: implementations.
pub fn default_backend() -> &'static dyn GitBackend {
	&GixBackend
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn cli_backend_branch_matches_free_function() {
		// Smoke test: the trait dispatch should produce the same answer as the
		// existing free function for any temp repo. Real coverage of branch
		// behavior lives in cli.rs's test suite.
		let tmp = tempfile::tempdir().expect("tmp");
		let dir = tmp.path();
		std::process::Command::new("git")
			.arg("init")
			.current_dir(dir)
			.output()
			.expect("git init");

		let folder = dir.to_string_lossy().to_string();
		let via_trait = CliBackend.branch(&folder).expect("trait branch");
		let via_free = super::super::cli::branch(&folder).expect("free branch");
		assert_eq!(via_trait, via_free);
	}

	#[test]
	fn default_backend_branch_works() {
		let tmp = tempfile::tempdir().expect("tmp");
		let dir = tmp.path();
		std::process::Command::new("git")
			.arg("init")
			.current_dir(dir)
			.output()
			.expect("git init");

		let folder = dir.to_string_lossy().to_string();
		// Smoke test the dispatcher path. As of Phase 1 task #4 this routes
		// branch() through gix.
		let _ = default_backend().branch(&folder).expect("default branch");
	}

	#[test]
	fn default_backend_log_uses_gix() {
		let tmp = tempfile::tempdir().expect("tmp");
		let dir = tmp.path();
		std::process::Command::new("git")
			.arg("init")
			.current_dir(dir)
			.output()
			.expect("git init");
		std::process::Command::new("git")
			.args(["config", "user.name", "Test"])
			.current_dir(dir)
			.output()
			.expect("config name");
		std::process::Command::new("git")
			.args(["config", "user.email", "test@test.com"])
			.current_dir(dir)
			.output()
			.expect("config email");
		std::fs::write(dir.join("a.txt"), "a").expect("write");
		std::process::Command::new("git")
			.args(["add", "a.txt"])
			.current_dir(dir)
			.output()
			.expect("add");
		std::process::Command::new("git")
			.args(["commit", "-m", "init"])
			.current_dir(dir)
			.output()
			.expect("commit");

		let folder = dir.to_string_lossy().to_string();
		let commits = default_backend().log(&folder, 10).expect("default log");
		assert_eq!(commits.len(), 1);
		assert_eq!(commits[0].message, "init");
	}
}
