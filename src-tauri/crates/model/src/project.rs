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
