//! Phase 3: log + graph row computation.
//!
//! Walks the commit log (via `git log` because filters like --author /
//! --grep / -G aren't ergonomic in gix today), then runs straight-branch
//! lane assignment in pure Rust over the ordered commits.
//!
//! Lane assignment algorithm (the "git-graph-classic" / IntelliJ-style):
//!   - active_lanes: Vec<Option<expected_next_commit_hash>>
//!   - For each commit (newest → oldest, the order git log emits):
//!       * find the lane already expecting this commit (its "child" lane).
//!         If none, allocate a new lane (it's a tip).
//!       * mark all OTHER lanes that were waiting for THIS commit as
//!         resolved: they merge into this lane (we record edges).
//!       * the commit's first parent inherits this lane. Additional
//!         parents get new lanes (or reuse a freed one).
//!   - The commit's `edges_down` describes which next-row lane each of
//!     its parents lives on, so the renderer can draw lines.
//!
//! Color = lane index for now. Branching-model coloring (main vs. feature
//! tips) is a follow-up.

use std::collections::HashMap;
use std::process::Command;

use model::error::AppError;
use model::project::{
	CommitRef, GitAuthor, GitCommit, GraphEdge, GraphRow, LogFilter,
};

const DEFAULT_LIMIT: u32 = 5000;
const RECORD_SEP: &str = "\x1f";
const FIELD_SEP: &str = "\x1e";

pub fn get_commit_graph(
	folder: &str,
	filter: &LogFilter,
) -> Result<Vec<GraphRow>, AppError> {
	let limit = filter.limit.unwrap_or(DEFAULT_LIMIT).min(50_000);

	// Build `git log` args.
	let mut args: Vec<String> = vec![
		"log".into(),
		format!("-{limit}"),
		// %H = full hash, %P = parents (space-sep), %an %ae = author,
		// %aI = ISO date, %s = subject, %G? = signed status
		format!(
			"--format=%H{FIELD_SEP}%P{FIELD_SEP}%an{FIELD_SEP}%ae{FIELD_SEP}%aI{FIELD_SEP}%s{FIELD_SEP}%G?{RECORD_SEP}"
		),
	];

	if let Some(author) = filter.author.as_deref().filter(|s| !s.is_empty()) {
		args.push("--author".into());
		args.push(author.to_string());
	}
	if let Some(text) = filter.text_query.as_deref().filter(|s| !s.is_empty()) {
		args.push("--grep".into());
		args.push(text.to_string());
		args.push("--regexp-ignore-case".into());
	}
	if let Some(content) = filter
		.content_query
		.as_deref()
		.filter(|s| !s.is_empty())
	{
		args.push(format!("-G{content}"));
	}
	if let Some(since) = filter.since.as_deref().filter(|s| !s.is_empty()) {
		args.push("--since".into());
		args.push(since.to_string());
	}
	if let Some(until) = filter.until.as_deref().filter(|s| !s.is_empty()) {
		args.push("--until".into());
		args.push(until.to_string());
	}

	let branch = filter
		.branch
		.as_deref()
		.filter(|s| !s.is_empty())
		.unwrap_or("HEAD");
	args.push(branch.to_string());

	if let Some(path) = filter.path.as_deref().filter(|s| !s.is_empty()) {
		args.push("--".into());
		args.push(path.to_string());
	}

	let output = Command::new("git")
		.args(&args)
		.current_dir(folder)
		.output()?;
	if !output.status.success() {
		let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
		// Empty repo or bad ref — return empty rather than erroring; the
		// frontend already shows "no commits" for that case.
		if stderr.contains("does not have any commits")
			|| stderr.contains("unknown revision")
			|| stderr.contains("bad revision")
		{
			return Ok(Vec::new());
		}
		return Err(AppError::GitError(stderr));
	}

	let stdout = String::from_utf8_lossy(&output.stdout);
	let commits = parse_log_records(&stdout);

	let refs_by_hash = read_refs(folder).unwrap_or_default();
	let head_hash = read_head_hash(folder).ok();
	let upstream_set = read_upstream_set(folder).unwrap_or_default();

	Ok(assign_lanes(
		commits,
		&refs_by_hash,
		head_hash.as_deref(),
		&upstream_set,
	))
}

#[derive(Debug, Clone)]
struct LogCommit {
	hash: String,
	parents: Vec<String>,
	author_name: String,
	author_email: String,
	date: String,
	subject: String,
	signed: bool,
}

fn parse_log_records(stdout: &str) -> Vec<LogCommit> {
	let mut out = Vec::new();
	for record in stdout.split(RECORD_SEP) {
		let record = record.trim_start_matches('\n');
		if record.is_empty() {
			continue;
		}
		let mut fields = record.split(FIELD_SEP);
		let hash = fields.next().unwrap_or("").trim().to_string();
		if hash.is_empty() {
			continue;
		}
		let parents: Vec<String> = fields
			.next()
			.unwrap_or("")
			.split_whitespace()
			.map(|s| s.to_string())
			.collect();
		let author_name = fields.next().unwrap_or("").to_string();
		let author_email = fields.next().unwrap_or("").to_string();
		let date = fields.next().unwrap_or("").to_string();
		let subject = fields.next().unwrap_or("").to_string();
		let g_status = fields.next().unwrap_or("").trim();
		let signed = matches!(g_status, "G" | "U" | "X" | "Y" | "B");

		out.push(LogCommit {
			hash,
			parents,
			author_name,
			author_email,
			date,
			subject,
			signed,
		});
	}
	out
}

fn read_refs(
	folder: &str,
) -> Result<HashMap<String, Vec<CommitRef>>, AppError> {
	let output = Command::new("git")
		.args(["for-each-ref", "--format=%(objectname) %(refname)"])
		.current_dir(folder)
		.output()?;
	if !output.status.success() {
		return Err(AppError::GitError(
			String::from_utf8_lossy(&output.stderr).trim().to_string(),
		));
	}
	let mut map: HashMap<String, Vec<CommitRef>> = HashMap::new();
	for line in String::from_utf8_lossy(&output.stdout).lines() {
		let mut parts = line.splitn(2, ' ');
		let hash = parts.next().unwrap_or("").to_string();
		let refname = parts.next().unwrap_or("");
		if hash.is_empty() || refname.is_empty() {
			continue;
		}
		let entry = if let Some(name) = refname.strip_prefix("refs/heads/") {
			CommitRef::Branch(name.to_string())
		} else if let Some(name) = refname.strip_prefix("refs/tags/") {
			CommitRef::Tag(name.to_string())
		} else if let Some(name) = refname.strip_prefix("refs/remotes/") {
			CommitRef::RemoteBranch(name.to_string())
		} else {
			continue;
		};
		map.entry(hash).or_default().push(entry);
	}
	Ok(map)
}

fn read_head_hash(folder: &str) -> Result<String, AppError> {
	let output = Command::new("git")
		.args(["rev-parse", "HEAD"])
		.current_dir(folder)
		.output()?;
	if !output.status.success() {
		return Err(AppError::GitError(
			String::from_utf8_lossy(&output.stderr).trim().to_string(),
		));
	}
	Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

/// Set of commit hashes already present on the upstream tracking branch.
/// Used to mark `needs_push` on commits not yet pushed.
fn read_upstream_set(
	folder: &str,
) -> Result<std::collections::HashSet<String>, AppError> {
	let output = Command::new("git")
		.args(["rev-list", "@{u}"])
		.current_dir(folder)
		.output()?;
	if !output.status.success() {
		// No upstream configured; that's fine — return empty.
		return Ok(Default::default());
	}
	Ok(String::from_utf8_lossy(&output.stdout)
		.lines()
		.map(|s| s.trim().to_string())
		.filter(|s| !s.is_empty())
		.collect())
}

fn assign_lanes(
	commits: Vec<LogCommit>,
	refs_by_hash: &HashMap<String, Vec<CommitRef>>,
	head_hash: Option<&str>,
	upstream_set: &std::collections::HashSet<String>,
) -> Vec<GraphRow> {
	// active_lanes[i] = Some(<expected next commit hash on this lane>) or None
	// for a freed lane.
	let mut active_lanes: Vec<Option<String>> = Vec::new();

	let mut rows = Vec::with_capacity(commits.len());

	for c in commits {
		// Find this commit's lane: a lane currently expecting this hash.
		let mut lane = active_lanes
			.iter()
			.position(|slot| slot.as_deref() == Some(c.hash.as_str()));

		if lane.is_none() {
			// New tip — allocate a lane (reuse the leftmost free slot).
			let free = active_lanes.iter().position(|s| s.is_none());
			match free {
				Some(idx) => {
					lane = Some(idx);
				}
				None => {
					active_lanes.push(None);
					lane = Some(active_lanes.len() - 1);
				}
			}
		}

		let lane = lane.expect("lane always assigned above");

		// Free any OTHER lane that was also expecting this hash (merge target).
		for (i, slot) in active_lanes.iter_mut().enumerate() {
			if i == lane {
				continue;
			}
			if slot.as_deref() == Some(c.hash.as_str()) {
				*slot = None;
			}
		}

		// First parent inherits this lane; additional parents get new lanes
		// (reusing free slots).
		let mut edges_down: Vec<GraphEdge> = Vec::new();
		for (idx, parent) in c.parents.iter().enumerate() {
			let target_lane = if idx == 0 {
				active_lanes[lane] = Some(parent.clone());
				lane
			} else {
				let free = active_lanes.iter().position(|s| s.is_none());
				match free {
					Some(idx) => {
						active_lanes[idx] = Some(parent.clone());
						idx
					}
					None => {
						active_lanes.push(Some(parent.clone()));
						active_lanes.len() - 1
					}
				}
			};
			edges_down.push(GraphEdge {
				from_lane: lane as u32,
				to_lane: target_lane as u32,
			});
		}

		// If the commit had no parents (root), free its lane.
		if c.parents.is_empty() {
			active_lanes[lane] = None;
		}

		let mut refs = refs_by_hash.get(&c.hash).cloned().unwrap_or_default();
		if Some(c.hash.as_str()) == head_hash {
			refs.insert(0, CommitRef::Head);
		}

		let needs_push = !upstream_set.contains(&c.hash);

		let short_hash: String = c.hash.chars().take(7).collect();
		let row = GraphRow {
			commit: GitCommit {
				hash: short_hash,
				full_hash: c.hash.clone(),
				author: GitAuthor {
					name: c.author_name,
					email: c.author_email,
				},
				date: c.date,
				message: c.subject,
				files_changed: 0,
				insertions: 0,
				deletions: 0,
			},
			parents: c.parents.clone(),
			lane: lane as u32,
			color: lane as u32,
			edges_down,
			refs,
			needs_push,
			signed: c.signed,
		};
		rows.push(row);
	}

	rows
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
			.args(["config", "user.email", "test@test.com"])
			.current_dir(dir.path())
			.output()
			.unwrap();
		Cmd::new("git")
			.args(["config", "user.name", "Test"])
			.current_dir(dir.path())
			.output()
			.unwrap();
		dir
	}

	fn add_commit(dir: &std::path::Path, file: &str, msg: &str) -> String {
		std::fs::write(dir.join(file), file).unwrap();
		Cmd::new("git")
			.args(["add", file])
			.current_dir(dir)
			.output()
			.unwrap();
		Cmd::new("git")
			.args(["commit", "-m", msg])
			.current_dir(dir)
			.output()
			.unwrap();
		let out = Cmd::new("git")
			.args(["rev-parse", "HEAD"])
			.current_dir(dir)
			.output()
			.unwrap();
		String::from_utf8_lossy(&out.stdout).trim().to_string()
	}

	#[test]
	fn empty_filter_walks_linear_history() {
		let dir = init_repo();
		add_commit(dir.path(), "a.txt", "first");
		add_commit(dir.path(), "b.txt", "second");
		add_commit(dir.path(), "c.txt", "third");

		let rows = get_commit_graph(
			&dir.path().to_string_lossy(),
			&LogFilter::default(),
		)
		.unwrap();

		assert_eq!(rows.len(), 3);
		assert_eq!(rows[0].commit.message, "third");
		assert_eq!(rows[0].lane, 0);
		assert_eq!(rows[1].lane, 0);
		assert_eq!(rows[2].lane, 0);
		assert_eq!(rows[0].edges_down.len(), 1);
		assert_eq!(rows[0].edges_down[0].from_lane, 0);
		assert_eq!(rows[0].edges_down[0].to_lane, 0);
		assert_eq!(rows[2].edges_down.len(), 0);
	}

	#[test]
	fn merge_commit_uses_two_lanes() {
		let dir = init_repo();
		add_commit(dir.path(), "a.txt", "base");

		Cmd::new("git")
			.args(["checkout", "-b", "feature"])
			.current_dir(dir.path())
			.output()
			.unwrap();
		add_commit(dir.path(), "b.txt", "on feature");
		Cmd::new("git")
			.args(["checkout", "-"])
			.current_dir(dir.path())
			.output()
			.unwrap();
		add_commit(dir.path(), "c.txt", "on main");
		Cmd::new("git")
			.args(["merge", "feature", "--no-ff", "-m", "merge feature"])
			.current_dir(dir.path())
			.output()
			.unwrap();

		let rows = get_commit_graph(
			&dir.path().to_string_lossy(),
			&LogFilter::default(),
		)
		.unwrap();

		assert!(rows.len() >= 4, "expected ≥4 rows, got {}", rows.len());
		assert_eq!(rows[0].commit.message, "merge feature");
		assert_eq!(rows[0].edges_down.len(), 2);
		assert_ne!(
			rows[0].edges_down[0].to_lane,
			rows[0].edges_down[1].to_lane
		);
	}

	#[test]
	fn limit_caps_rows() {
		let dir = init_repo();
		for i in 0..5 {
			add_commit(dir.path(), &format!("f{i}.txt"), &format!("c{i}"));
		}
		let rows = get_commit_graph(
			&dir.path().to_string_lossy(),
			&LogFilter {
				limit: Some(3),
				..Default::default()
			},
		)
		.unwrap();
		assert_eq!(rows.len(), 3);
	}

	#[test]
	fn author_filter_narrows_rows() {
		let dir = init_repo();
		add_commit(dir.path(), "a.txt", "by Test");

		std::fs::write(dir.path().join("b.txt"), "b").unwrap();
		Cmd::new("git")
			.args(["add", "b.txt"])
			.current_dir(dir.path())
			.output()
			.unwrap();
		Cmd::new("git")
			.args([
				"-c", "user.email=other@x.com", "-c", "user.name=Other",
				"commit", "-m", "by Other",
			])
			.current_dir(dir.path())
			.output()
			.unwrap();

		let rows = get_commit_graph(
			&dir.path().to_string_lossy(),
			&LogFilter {
				author: Some("Other".into()),
				..Default::default()
			},
		)
		.unwrap();
		assert_eq!(rows.len(), 1);
		assert_eq!(rows[0].commit.author.name, "Other");
	}

	#[test]
	fn text_query_filters_by_subject() {
		let dir = init_repo();
		add_commit(dir.path(), "a.txt", "feat: add a");
		add_commit(dir.path(), "b.txt", "fix: tweak b");
		add_commit(dir.path(), "c.txt", "feat: add c");

		let rows = get_commit_graph(
			&dir.path().to_string_lossy(),
			&LogFilter {
				text_query: Some("feat".into()),
				..Default::default()
			},
		)
		.unwrap();
		assert_eq!(rows.len(), 2);
		assert!(rows.iter().all(|r| r.commit.message.contains("feat")));
	}

	#[test]
	fn empty_repo_returns_empty() {
		let dir = init_repo();
		let rows = get_commit_graph(
			&dir.path().to_string_lossy(),
			&LogFilter::default(),
		)
		.unwrap();
		assert!(rows.is_empty());
	}

	#[test]
	fn refs_attached_to_branch_tip() {
		let dir = init_repo();
		add_commit(dir.path(), "a.txt", "first");
		Cmd::new("git")
			.args(["branch", "feature"])
			.current_dir(dir.path())
			.output()
			.unwrap();
		Cmd::new("git")
			.args(["tag", "v1"])
			.current_dir(dir.path())
			.output()
			.unwrap();

		let rows = get_commit_graph(
			&dir.path().to_string_lossy(),
			&LogFilter::default(),
		)
		.unwrap();
		assert_eq!(rows.len(), 1);
		let names: Vec<String> = rows[0]
			.refs
			.iter()
			.map(|r| match r {
				CommitRef::Branch(n) => format!("branch:{n}"),
				CommitRef::Tag(n) => format!("tag:{n}"),
				CommitRef::RemoteBranch(n) => format!("remote:{n}"),
				CommitRef::Head => "HEAD".to_string(),
			})
			.collect();
		assert!(names.contains(&"HEAD".to_string()), "got {names:?}");
		assert!(names.iter().any(|n| n.starts_with("branch:")));
		assert!(
			names.iter().any(|n| n == "tag:v1"),
			"v1 tag missing: {names:?}"
		);
	}
}
