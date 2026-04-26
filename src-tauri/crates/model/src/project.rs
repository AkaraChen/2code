use crate::profile::Profile;
use crate::schema::projects;
use diesel::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize, Serialize, Default, PartialEq, Clone)]
pub struct ProjectConfig {
	#[serde(default)]
	pub setup_script: Vec<String>,
	#[serde(default)]
	pub teardown_script: Vec<String>,
	#[serde(default)]
	pub init_script: Vec<String>,
	#[serde(default)]
	pub terminal_templates: Vec<ProjectTerminalTemplate>,
}

#[derive(Debug, Deserialize, Serialize, Default, PartialEq, Clone)]
pub struct ProjectTerminalTemplate {
	pub id: String,
	pub name: String,
	pub cwd: String,
	#[serde(default)]
	pub commands: Vec<String>,
}

#[derive(Queryable, Selectable, Serialize)]
#[diesel(table_name = projects)]
#[diesel(check_for_backend(diesel::sqlite::Sqlite))]
pub struct Project {
	pub id: String,
	pub name: String,
	pub folder: String,
	pub created_at: String,
}

#[derive(Insertable)]
#[diesel(table_name = projects)]
pub struct NewProject<'a> {
	pub id: &'a str,
	pub name: &'a str,
	pub folder: &'a str,
}

#[derive(AsChangeset)]
#[diesel(table_name = projects)]
pub struct UpdateProject {
	pub name: Option<String>,
	pub folder: Option<String>,
}

#[derive(Serialize)]
pub struct ProjectWithProfiles {
	pub id: String,
	pub name: String,
	pub folder: String,
	pub created_at: String,
	pub profiles: Vec<Profile>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct GitAuthor {
	pub name: String,
	pub email: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct GitCommit {
	pub hash: String,
	pub full_hash: String,
	pub author: GitAuthor,
	pub date: String,
	pub message: String,
	pub files_changed: u32,
	pub insertions: u32,
	pub deletions: u32,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
pub struct GitDiffStats {
	pub files_changed: u32,
	pub insertions: u32,
	pub deletions: u32,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct GitBinaryPreview {
	pub file_path: String,
}

/// Both sides of a per-file diff for language-aware rendering in the
/// Monaco DiffEditor. Either side may be `None` (added/deleted file or
/// binary). `too_large` is set when the file exceeds the diff editor's
/// safe size — the frontend should fall back to the patch view.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct FileDiffSides {
	pub original: Option<String>,
	pub modified: Option<String>,
	pub too_large: bool,
}

// ── Phase 3: log graph ──

/// What to show in the log. None means "no filter on this dimension".
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq, Eq)]
pub struct LogFilter {
	/// Branch / ref to walk from. None = HEAD.
	pub branch: Option<String>,
	/// Substring match against author name OR email (case-insensitive).
	pub author: Option<String>,
	/// ISO 8601 date or git-relative ("2 weeks ago"). Passed through to git.
	pub since: Option<String>,
	pub until: Option<String>,
	/// Path filter — only commits touching this path.
	pub path: Option<String>,
	/// Substring match against commit message (subject + body).
	pub text_query: Option<String>,
	/// Substring match against added/removed lines via `git log -G`.
	pub content_query: Option<String>,
	/// Hard cap on rows returned. Default 5000.
	pub limit: Option<u32>,
}

/// Branch / tag tip pointing at a commit.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "snake_case", tag = "kind", content = "name")]
pub enum CommitRef {
	Branch(String),
	Tag(String),
	RemoteBranch(String),
	Head,
}

/// One incoming/outgoing edge to draw between this row and the next.
/// `from_lane` is this row's source lane, `to_lane` is the lane of the
/// child / parent on the next row.
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
pub struct GraphEdge {
	pub from_lane: u32,
	pub to_lane: u32,
}

/// One commit in the graph view. Wraps GitCommit with the lane assignment
/// + edges so the frontend Canvas renderer can paint without knowing about
/// git internals.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct GraphRow {
	pub commit: GitCommit,
	/// Parent hashes (already on GitCommit? no — re-emit here for the frontend
	/// graph walker).
	pub parents: Vec<String>,
	/// 0-based lane index this commit sits on.
	pub lane: u32,
	/// Lane "color" — currently equals `lane` since we don't do branching-
	/// model coloring yet. Kept separate so we can swap in color logic later.
	pub color: u32,
	/// Edges arriving at this row from above. Each edge is
	/// (lane on row above → this row's destination lane). Includes:
	///   - the commit's own continuation from its child (lane → lane)
	///   - "branch-out" edges where another lane was also expecting this
	///     commit and merges into this commit's lane
	///   - any pass-through lanes that aren't this commit (lane → lane)
	pub edges_up: Vec<GraphEdge>,
	/// Edges leaving this row, drawn DOWN to the next row. Includes:
	///   - one edge per parent (this lane → parent's lane)
	///   - pass-through lanes that aren't this commit (lane → lane)
	pub edges_down: Vec<GraphEdge>,
	/// Branch/tag/HEAD chips pointing at this commit.
	pub refs: Vec<CommitRef>,
	/// Best-effort: is this commit ahead of its branch's upstream?
	pub needs_push: bool,
	/// GPG/SSH signature good? (`git log %G?` returned 'G' or 'U')
	pub signed: bool,
}

/// A file's change kind in the index or worktree.
#[derive(
	Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq,
)]
#[serde(rename_all = "snake_case")]
pub enum GitChangeKind {
	Added,
	Modified,
	Deleted,
	Renamed,
	Copied,
	Untracked,
	TypeChanged,
	Unmerged,
}

/// One entry in the structured index status. Either staged or unstaged
/// (the IndexStatus groups them).
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct IndexEntry {
	pub path: String,
	/// Set when `kind` is `Renamed` or `Copied`.
	pub original_path: Option<String>,
	pub kind: GitChangeKind,
}

/// Structured view of the working tree: what's staged, what's not.
/// Backs the Phase 2 GitPanel "Changes" tab. Separate from the file-tree
/// icon view (`FileTreeGitStatusEntry`) which doesn't need split staged/
/// unstaged or rename info.
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq, Eq)]
pub struct IndexStatus {
	pub staged: Vec<IndexEntry>,
	pub unstaged: Vec<IndexEntry>,
}
