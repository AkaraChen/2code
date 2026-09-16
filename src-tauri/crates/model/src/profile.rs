use diesel::prelude::*;
use serde::{Deserialize, Serialize};

use crate::project::GitDiffStats;
use crate::schema::checkout_notes;

/// Derived GUI profile. Not a sqlite `profiles` row.
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
pub struct Profile {
	pub id: String,
	pub project_id: String,
	pub branch_name: String,
	/// Live checkout path (Herdr cwd / worktree path).
	pub worktree_path: String,
	pub created_at: String,
	pub is_default: bool,
	pub notes: String,
}

/// Notes for one project checkout path. Not stored in Herdr.
#[derive(Queryable, Selectable, Serialize, Clone, Debug, PartialEq)]
#[diesel(table_name = checkout_notes)]
#[diesel(check_for_backend(diesel::sqlite::Sqlite))]
pub struct CheckoutNote {
	pub project_id: String,
	pub checkout_path: String,
	pub notes: String,
	pub created_at: String,
}

#[derive(Insertable)]
#[diesel(table_name = checkout_notes)]
pub struct NewCheckoutNote<'a> {
	pub project_id: &'a str,
	pub checkout_path: &'a str,
	pub notes: &'a str,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
pub struct ProfileDeleteCheck {
	pub working_tree_diff: GitDiffStats,
	pub unpushed_commit_count: u32,
	pub unpushed_commit_diff: GitDiffStats,
	pub total_diff: GitDiffStats,
}
