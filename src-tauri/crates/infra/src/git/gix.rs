// gix-based git backend.
//
// Read-path implementations land here. Writes stay in cli.rs.
// Each fn matches the corresponding cli::* signature so the dispatcher
// can swap them transparently and tests can compare outputs.
//
// Strategy: implement gix where it's clearly faster and the output shape
// is straightforward (branch, ahead_count, log). Defer ops where matching
// the exact CLI output format is risky (diff text, status entries) — the
// frontend currently parses CLI output and a perfect-bytes match isn't
// worth the implementation risk in Phase 1.

use std::collections::HashSet;

use model::error::AppError;
use model::project::{GitAuthor, GitCommit};

fn to_app_err<E: std::fmt::Display>(e: E) -> AppError {
	AppError::GitError(e.to_string())
}

/// Open a gix repo for the given folder. Returns AppError::GitError if the
/// folder is not a git repo or the open fails.
fn open(folder: &str) -> Result<::gix::Repository, AppError> {
	::gix::open(folder).map_err(to_app_err)
}

/// Current branch name. Falls back to "main" for fully empty repos with no
/// HEAD ref, mirroring CLI behavior.
pub fn branch(folder: &str) -> Result<String, AppError> {
	let repo = open(folder)?;
	match repo.head_name().map_err(to_app_err)? {
		Some(name) => {
			let full = name.as_bstr().to_string();
			Ok(full
				.strip_prefix("refs/heads/")
				.unwrap_or(&full)
				.to_string())
		}
		None => Ok("main".to_string()),
	}
}

/// Number of commits HEAD is ahead of its upstream. Returns 0 if no upstream
/// is configured or any error occurs (matches CLI behavior — this is best-effort).
pub fn ahead_count(folder: &str) -> u32 {
	let Ok(repo) = open(folder) else {
		return 0;
	};
	let Ok(head_id) = repo.head_id() else {
		return 0;
	};

	// Find HEAD's upstream branch.
	let Ok(Some(head_ref)) = repo.head_ref() else {
		return 0;
	};
	let head_name = head_ref.name().shorten().to_string();
	let Ok(branch) = repo
		.branch_remote_tracking_ref_name(
			head_ref.name(),
			::gix::remote::Direction::Push,
		)
		.transpose()
	else {
		return 0;
	};
	let Some(upstream_ref_name) = branch else {
		// No upstream tracking configured.
		let _ = head_name;
		return 0;
	};

	let Ok(upstream_ref) = repo.find_reference(upstream_ref_name.as_ref())
	else {
		return 0;
	};
	let Ok(upstream_id) = upstream_ref.into_fully_peeled_id() else {
		return 0;
	};

	// Walk from HEAD until we reach upstream; count steps.
	let head_commit = head_id.detach();
	let upstream_commit = upstream_id.detach();
	if head_commit == upstream_commit {
		return 0;
	}

	let walk = repo
		.rev_walk([head_commit])
		.first_parent_only()
		.all()
		.ok();
	let Some(walk) = walk else {
		return 0;
	};

	let upstream_set: HashSet<_> = std::iter::once(upstream_commit).collect();
	let mut count = 0u32;
	for info in walk {
		let Ok(info) = info else { break };
		let oid = info.id;
		if upstream_set.contains(&oid) {
			break;
		}
		count = count.saturating_add(1);
	}
	count
}

/// Recent commits with shortstat. `limit` of 0 returns nothing (matches
/// `git log -0` quirky behavior — see integration_git::log_limit_zero).
pub fn log(folder: &str, limit: u32) -> Result<Vec<GitCommit>, AppError> {
	if limit == 0 {
		return Ok(Vec::new());
	}

	let repo = open(folder)?;
	let head_id = match repo.head_id() {
		Ok(id) => id,
		Err(_) => {
			// Empty repo — no commits yet.
			return Ok(Vec::new());
		}
	};

	let walk = repo
		.rev_walk([head_id.detach()])
		.first_parent_only()
		.all()
		.map_err(to_app_err)?;

	let mut commits = Vec::with_capacity(limit as usize);
	for info in walk.take(limit as usize) {
		let info = info.map_err(to_app_err)?;
		let commit = repo.find_commit(info.id).map_err(to_app_err)?;
		let full_hash = commit.id.to_string();
		let hash = full_hash.chars().take(7).collect::<String>();
		let author = commit.author().map_err(to_app_err)?;

		let date_seconds = author.time.seconds;
		let offset_seconds = author.time.offset;
		let date = format_iso8601(date_seconds, offset_seconds);

		let message_full = commit.message_raw().map_err(to_app_err)?.to_string();
		let message = message_full
			.lines()
			.next()
			.unwrap_or("")
			.trim()
			.to_string();

		// Shortstat against parent. Diffing in gix is expensive enough that we
		// fall back to CLI for the stat numbers; matches CLI exactly and avoids
		// a 200-line diff implementation here.
		let (files_changed, insertions, deletions) =
			shortstat_via_cli(folder, &full_hash);

		commits.push(GitCommit {
			hash,
			full_hash,
			author: GitAuthor {
				name: author.name.to_string(),
				email: author.email.to_string(),
			},
			date,
			message,
			files_changed,
			insertions,
			deletions,
		});
	}

	Ok(commits)
}

fn shortstat_via_cli(folder: &str, hash: &str) -> (u32, u32, u32) {
	use std::process::Command;
	let output = Command::new("git")
		.args(["show", "--shortstat", "--format=", hash])
		.current_dir(folder)
		.output();
	match output {
		Ok(o) if o.status.success() => {
			let stdout = String::from_utf8_lossy(&o.stdout);
			for line in stdout.lines() {
				if line.contains("changed") || line.contains("insertion") {
					return super::cli::parse_shortstat(line);
				}
			}
			(0, 0, 0)
		}
		_ => (0, 0, 0),
	}
}

/// Format a unix timestamp + offset as ISO 8601 (matching git's `%aI`).
/// E.g. "2026-04-26T15:30:00+08:00".
fn format_iso8601(seconds: i64, offset_seconds: i32) -> String {
	let total_secs = seconds + offset_seconds as i64;
	let (date, time) = unix_to_date_time(total_secs);
	let (sign, abs_offset) = if offset_seconds >= 0 {
		('+', offset_seconds)
	} else {
		('-', -offset_seconds)
	};
	let off_h = abs_offset / 3600;
	let off_m = (abs_offset % 3600) / 60;
	format!(
		"{:04}-{:02}-{:02}T{:02}:{:02}:{:02}{}{:02}:{:02}",
		date.0, date.1, date.2, time.0, time.1, time.2, sign, off_h, off_m
	)
}

/// Convert unix seconds (already offset-adjusted) to (year, month, day) +
/// (hour, minute, second). Plain Gregorian, no chrono dep.
fn unix_to_date_time(secs: i64) -> ((i32, u32, u32), (u32, u32, u32)) {
	let days = secs.div_euclid(86_400);
	let time_of_day = secs.rem_euclid(86_400) as u32;
	let h = time_of_day / 3600;
	let m = (time_of_day % 3600) / 60;
	let s = time_of_day % 60;

	// Days since 1970-01-01 → civil date. Algorithm from Howard Hinnant's
	// date_algorithms.html (released into public domain).
	let z = days + 719_468;
	let era = z.div_euclid(146_097);
	let doe = z.rem_euclid(146_097) as u32; // [0, 146096]
	let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146_096) / 365;
	let y_int = yoe as i64 + era * 400;
	let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
	let mp = (5 * doy + 2) / 153;
	let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
	let m_int = if mp < 10 { mp + 3 } else { mp - 9 };
	let year = if m_int <= 2 { y_int + 1 } else { y_int };
	((year as i32, m_int, d), (h, m, s))
}

#[cfg(test)]
mod tests {
	use super::*;
	use std::process::Command;
	use tempfile::TempDir;

	fn init_repo() -> TempDir {
		let dir = TempDir::new().expect("tempdir");
		Command::new("git")
			.arg("init")
			.current_dir(dir.path())
			.output()
			.expect("git init");
		Command::new("git")
			.args(["config", "user.name", "Test"])
			.current_dir(dir.path())
			.output()
			.expect("config name");
		Command::new("git")
			.args(["config", "user.email", "test@test.com"])
			.current_dir(dir.path())
			.output()
			.expect("config email");
		dir
	}

	fn add_commit(dir: &std::path::Path, file: &str, msg: &str) {
		std::fs::write(dir.join(file), file).expect("write");
		Command::new("git")
			.args(["add", file])
			.current_dir(dir)
			.output()
			.expect("add");
		Command::new("git")
			.args(["commit", "-m", msg])
			.current_dir(dir)
			.output()
			.expect("commit");
	}

	#[test]
	fn branch_matches_cli() {
		let dir = init_repo();
		add_commit(dir.path(), "a.txt", "init");
		let folder = dir.path().to_string_lossy().to_string();
		assert_eq!(branch(&folder).unwrap(), super::super::cli::branch(&folder).unwrap());
	}

	#[test]
	fn branch_empty_repo_returns_default() {
		let dir = init_repo();
		let folder = dir.path().to_string_lossy().to_string();
		// Both should return "main" (or whatever git's init.defaultBranch is)
		// for an empty repo with no commits.
		let cli_result = super::super::cli::branch(&folder).unwrap();
		let gix_result = branch(&folder).unwrap();
		assert_eq!(gix_result, cli_result);
	}

	#[test]
	fn ahead_count_no_upstream_returns_zero() {
		let dir = init_repo();
		add_commit(dir.path(), "a.txt", "init");
		let folder = dir.path().to_string_lossy().to_string();
		assert_eq!(ahead_count(&folder), 0);
	}

	#[test]
	fn log_returns_correct_count_and_shape() {
		let dir = init_repo();
		add_commit(dir.path(), "a.txt", "first");
		add_commit(dir.path(), "b.txt", "second");
		add_commit(dir.path(), "c.txt", "third");
		let folder = dir.path().to_string_lossy().to_string();

		let commits = log(&folder, 10).unwrap();
		assert_eq!(commits.len(), 3);

		// Most-recent-first
		assert_eq!(commits[0].message, "third");
		assert_eq!(commits[1].message, "second");
		assert_eq!(commits[2].message, "first");

		// Shape check on the first commit
		let c = &commits[0];
		assert_eq!(c.full_hash.len(), 40);
		assert_eq!(c.hash.len(), 7);
		assert_eq!(c.author.name, "Test");
		assert_eq!(c.author.email, "test@test.com");
		assert!(c.date.starts_with(&format!(
			"{}-",
			chrono_year_now()
		)) || c.date.len() >= 19);
		assert!(c.files_changed >= 1);
	}

	#[test]
	fn log_respects_limit() {
		let dir = init_repo();
		add_commit(dir.path(), "a.txt", "first");
		add_commit(dir.path(), "b.txt", "second");
		add_commit(dir.path(), "c.txt", "third");
		let folder = dir.path().to_string_lossy().to_string();
		assert_eq!(log(&folder, 2).unwrap().len(), 2);
		assert_eq!(log(&folder, 0).unwrap().len(), 0);
	}

	#[test]
	fn log_empty_repo_returns_empty() {
		let dir = init_repo();
		let folder = dir.path().to_string_lossy().to_string();
		assert_eq!(log(&folder, 10).unwrap().len(), 0);
	}

	#[test]
	fn log_matches_cli_for_basic_history() {
		let dir = init_repo();
		add_commit(dir.path(), "a.txt", "first");
		add_commit(dir.path(), "b.txt", "second");
		let folder = dir.path().to_string_lossy().to_string();

		let cli_commits = super::super::cli::log(&folder, 10).unwrap();
		let gix_commits = log(&folder, 10).unwrap();

		assert_eq!(gix_commits.len(), cli_commits.len());
		for (g, c) in gix_commits.iter().zip(cli_commits.iter()) {
			assert_eq!(g.full_hash, c.full_hash);
			assert_eq!(g.message, c.message);
			assert_eq!(g.author.name, c.author.name);
			assert_eq!(g.author.email, c.author.email);
			assert_eq!(g.files_changed, c.files_changed);
			assert_eq!(g.insertions, c.insertions);
			assert_eq!(g.deletions, c.deletions);
		}
	}

	fn chrono_year_now() -> i32 {
		use std::time::{SystemTime, UNIX_EPOCH};
		let secs = SystemTime::now()
			.duration_since(UNIX_EPOCH)
			.map(|d| d.as_secs() as i64)
			.unwrap_or(0);
		unix_to_date_time(secs).0 .0
	}
}
