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

/// The default backend used by the dispatcher. CLI for now; flips to a hybrid
/// (gix reads + CLI writes) once `GixBackend` methods are implemented.
pub fn default_backend() -> &'static dyn GitBackend {
	&CliBackend
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
	fn default_backend_returns_cli_for_now() {
		let tmp = tempfile::tempdir().expect("tmp");
		let dir = tmp.path();
		std::process::Command::new("git")
			.arg("init")
			.current_dir(dir)
			.output()
			.expect("git init");

		let folder = dir.to_string_lossy().to_string();
		// Just exercises the dispatch path; if the default ever flips to gix
		// and gix has a regression, this catches it.
		let _ = default_backend().branch(&folder).expect("default branch");
	}
}
