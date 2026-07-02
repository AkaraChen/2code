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

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
pub struct ArchivePreviewEntry {
	pub path: String,
	pub kind: String,
	pub size: Option<u64>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct FilePreview {
	pub kind: String,
	pub file_path: String,
	pub mime_type: String,
	pub source_path: Option<String>,
	pub archive_entries: Option<Vec<ArchivePreviewEntry>>,
}

/// Result of resolving a terminal file path.
/// Either an exact match (file found at the expected path) or a list of
/// fuzzy-matched candidates when the exact path doesn't exist.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum ResolvedFilePath {
	/// The file was found at the exact path requested.
	Exact { path: String },
	/// The exact path was not found; these are fuzzy-matched candidates
	/// based on the filename component.
	Fuzzy { candidates: Vec<FileSearchResult> },
}
