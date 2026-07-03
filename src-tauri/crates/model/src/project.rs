use crate::profile::Profile;
use crate::schema::projects;
use diesel::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize, Serialize, Default, PartialEq, Clone)]
pub struct ProjectConfig {
	#[serde(default, skip_serializing_if = "Option::is_none")]
	pub worktree_dir: Option<String>,
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
	pub group_id: Option<String>,
	pub sort_order: i32,
	pub pinned_at: Option<String>,
	pub pinned_order: Option<i32>,
}

#[derive(Insertable)]
#[diesel(table_name = projects)]
pub struct NewProject<'a> {
	pub id: &'a str,
	pub name: &'a str,
	pub folder: &'a str,
	pub group_id: Option<&'a str>,
	pub sort_order: i32,
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
	pub group_id: Option<String>,
	pub sort_order: i32,
	pub pinned_at: Option<String>,
	pub pinned_order: Option<i32>,
	pub profiles: Vec<Profile>,
}

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSidebarLayoutUpdate {
	pub kind: String,
	pub id: String,
	pub group_id: Option<String>,
	pub sort_order: Option<i32>,
	pub pinned_order: Option<i32>,
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

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
pub struct GitDiffSnapshot {
	pub diff: String,
	pub stats: GitDiffStats,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct GitBranchInfo {
	pub name: String,
	pub is_current: bool,
	pub ahead: u32,
	pub behind: u32,
	/// Checked out in another git worktree — checkout here would fail.
	pub is_used: bool,
	/// The repository's default branch (origin/HEAD, else main/master).
	pub is_trunk: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct GitBinaryPreview {
	pub file_path: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct GitPullRequestStatus {
	pub number: u32,
	pub title: String,
	pub state: String,
	pub url: String,
	pub is_draft: bool,
	pub head_ref_name: String,
}
