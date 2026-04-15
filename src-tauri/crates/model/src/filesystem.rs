use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct FileEntry {
	pub name: String,
	pub path: String,
	pub is_dir: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct FileSearchResult {
	pub name: String,
	pub path: String,
	pub relative_path: String,
}
