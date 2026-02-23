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

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum GithubPrState {
	Open,
	Closed,
	Merged,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct GithubPrInfo {
	pub number: u64,
	pub url: String,
	pub state: GithubPrState,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct GithubPrStatus {
	pub is_github_host: bool,
	pub branch: String,
	pub is_main_branch: bool,
	pub worktree_clean: bool,
	pub status_summary: String,
	pub pr: Option<GithubPrInfo>,
	pub create_url: Option<String>,
}
