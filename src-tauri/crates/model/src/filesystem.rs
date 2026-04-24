use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct FileSearchResult {
	pub name: String,
	pub path: String,
	pub relative_path: String,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
pub struct FileTreeGitStatusEntry {
	pub path: String,
	pub status: String,
}
