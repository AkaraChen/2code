use crate::schema::profiles;
use diesel::prelude::*;
use serde::{Deserialize, Serialize};

use crate::project::GitDiffStats;

#[derive(Queryable, Selectable, Serialize)]
#[diesel(table_name = profiles)]
#[diesel(check_for_backend(diesel::sqlite::Sqlite))]
pub struct Profile {
	pub id: String,
	pub project_id: String,
	pub branch_name: String,
	pub worktree_path: String,
	pub created_at: String,
	pub is_default: bool,
}

#[derive(Insertable)]
#[diesel(table_name = profiles)]
pub struct NewProfile<'a> {
	pub id: &'a str,
	pub project_id: &'a str,
	pub branch_name: &'a str,
	pub worktree_path: &'a str,
	pub is_default: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
pub struct ProfileDeleteCheck {
	pub working_tree_diff: GitDiffStats,
	pub unpushed_commit_count: u32,
	pub unpushed_commit_diff: GitDiffStats,
	pub total_diff: GitDiffStats,
}
