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

	// `text_query` does double duty: if it looks like a hex commit hash
	// prefix (≥4 chars, all hex), we search by HASH instead of message.
	// Falls back to message search when not hex. We could OR them but the
	// hash case is way more common when users paste a SHA.
	let hash_prefix = filter
		.text_query
		.as_deref()
		.filter(|s| !s.is_empty())
		.filter(|s| s.len() >= 4 && s.chars().all(|c| c.is_ascii_hexdigit()))
		.map(|s| s.to_lowercase());

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
	// Only apply --grep when the text_query is NOT a hex hash prefix.
	if hash_prefix.is_none() {
		if let Some(text) = filter
			.text_query
			.as_deref()
			.filter(|s| !s.is_empty())
		{
			args.push("--grep".into());
			args.push(text.to_string());
			args.push("--regexp-ignore-case".into());
		}
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
	let mut commits = parse_log_records(&stdout);

	// Hash-prefix search: filter the parsed commits by hash. Done after
	// parsing because git log itself can't filter by hash prefix (only by
	// exact rev). For users who paste a short SHA into the search bar.
	if let Some(prefix) = hash_prefix.as_deref() {
		commits.retain(|c| c.hash.to_lowercase().starts_with(prefix));
	}

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
	// active_lanes[i] = Some(<expected next commit hash on this lane>) or
	// None for a freed lane.
	let mut active_lanes: Vec<Option<String>> = Vec::new();

	let mut rows = Vec::with_capacity(commits.len());

	for c in commits {
		// Snapshot lanes BEFORE mutating, so we can compute edges_up
		// (top-half lines coming INTO this row) accurately. Each lane that
		// was expecting this commit feeds INTO this commit's lane;
		// every other active lane passes straight through.
		let lanes_before = active_lanes.clone();

		// Find this commit's lane: a lane already expecting this hash.
		let mut lane = active_lanes
			.iter()
			.position(|slot| slot.as_deref() == Some(c.hash.as_str()));

		if lane.is_none() {
			// New tip — allocate the leftmost free slot, or extend.
			let free = active_lanes.iter().position(|s| s.is_none());
			match free {
				Some(idx) => lane = Some(idx),
				None => {
					active_lanes.push(None);
					lane = Some(active_lanes.len() - 1);
				}
			}
		}
		let lane = lane.expect("lane always assigned above");

		// edges_up: every lane on the previous row either passes through
		// or merges into this commit's lane (if it was expecting this
		// hash). This is the bit that draws "branch-out" lines for fork
		// points where two children landed on the same parent.
		let mut edges_up: Vec<GraphEdge> = Vec::new();
		for (i, slot) in lanes_before.iter().enumerate() {
			match slot {
				Some(expected) if expected == &c.hash => {
					edges_up.push(GraphEdge {
						from_lane: i as u32,
						to_lane: lane as u32,
					});
				}
				Some(_) => {
					edges_up.push(GraphEdge {
						from_lane: i as u32,
						to_lane: i as u32,
					});
				}
				None => {}
			}
		}

		// Free OTHER lanes that were expecting this hash — they merged
		// into our lane.
		for (i, slot) in active_lanes.iter_mut().enumerate() {
			if i == lane {
				continue;
			}
			if slot.as_deref() == Some(c.hash.as_str()) {
				*slot = None;
			}
		}

		// First parent inherits this lane; additional parents take fresh
		// or freed lanes.
		let parent_lanes: Vec<usize> = c
			.parents
			.iter()
			.enumerate()
			.map(|(idx, parent)| {
				if idx == 0 {
					active_lanes[lane] = Some(parent.clone());
					lane
				} else {
					let free = active_lanes.iter().position(|s| s.is_none());
					match free {
						Some(i) => {
							active_lanes[i] = Some(parent.clone());
							i
						}
						None => {
							active_lanes.push(Some(parent.clone()));
							active_lanes.len() - 1
						}
					}
				}
			})
			.collect();

		// Root commit (no parents) frees its lane.
		if c.parents.is_empty() {
			active_lanes[lane] = None;
		}

		// edges_down: one per parent (this lane → parent's lane), plus
		// pass-throughs for any OTHER active lane.
		let mut edges_down: Vec<GraphEdge> = Vec::new();
		for parent_lane in &parent_lanes {
			edges_down.push(GraphEdge {
				from_lane: lane as u32,
				to_lane: *parent_lane as u32,
			});
		}
		for (i, slot) in active_lanes.iter().enumerate() {
			if slot.is_none() {
				continue;
			}
			if parent_lanes.contains(&i) {
				continue;
			}
			edges_down.push(GraphEdge {
				from_lane: i as u32,
				to_lane: i as u32,
			});
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
			edges_up,
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
	fn branch_out_point_emits_inbound_edges() {
		// A fork: two children both point at the same parent (no merge).
		// The parent row should show edges_up containing TWO entries (one
		// from each child's lane → parent's lane), so the renderer can
		// draw both lines down into the fork point.
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

		let rows = get_commit_graph(
			&dir.path().to_string_lossy(),
			&LogFilter {
				branch: Some("--all".into()),
				..Default::default()
			},
		)
		.unwrap();

		assert_eq!(rows.len(), 3);
		// rows[0] and rows[1] are the two tip commits in some order; rows[2]
		// is the shared parent.
		let parent_row = &rows[2];
		assert_eq!(parent_row.commit.message, "base");

		// Two distinct lanes feed into the parent (one per child).
		let inbound_to_parent_lane: Vec<u32> = parent_row
			.edges_up
			.iter()
			.filter(|e| e.to_lane == parent_row.lane)
			.map(|e| e.from_lane)
			.collect();
		assert!(
			inbound_to_parent_lane.len() >= 2,
			"expected ≥2 lanes feeding the fork point, got {inbound_to_parent_lane:?}"
		);
		// And those source lanes are different (it's a real fork, not the
		// same child twice).
		let mut sorted = inbound_to_parent_lane.clone();
		sorted.sort();
		sorted.dedup();
		assert_eq!(
			sorted.len(),
			inbound_to_parent_lane.len(),
			"duplicate inbound lanes: {inbound_to_parent_lane:?}"
		);
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
	fn text_query_with_hash_prefix_searches_by_hash() {
		let dir = init_repo();
		add_commit(dir.path(), "a.txt", "subject without hex");
		let h2 = add_commit(dir.path(), "b.txt", "another subject");
		add_commit(dir.path(), "c.txt", "third");

		// Use the first 5 chars of h2 as the search query.
		let prefix: String = h2.chars().take(5).collect();
		let rows = get_commit_graph(
			&dir.path().to_string_lossy(),
			&LogFilter {
				text_query: Some(prefix.clone()),
				..Default::default()
			},
		)
		.unwrap();
		assert_eq!(rows.len(), 1, "expected only the matching commit");
		assert!(
			rows[0].commit.full_hash.starts_with(&prefix),
			"expected hash starting with {prefix}"
		);
	}

	#[test]
	fn text_query_with_non_hex_falls_back_to_message_search() {
		let dir = init_repo();
		add_commit(dir.path(), "a.txt", "feat: add a");
		add_commit(dir.path(), "b.txt", "fix: tweak b");
		add_commit(dir.path(), "c.txt", "feat: add c");

		// "fea" is hex (3 chars) but below the 4-char prefix threshold —
		// should fall back to message search.
		let rows = get_commit_graph(
			&dir.path().to_string_lossy(),
			&LogFilter {
				text_query: Some("fea".into()),
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
