//! File-tree and diff helpers for the native workspace.

use std::collections::{HashMap, HashSet};

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct FileRow {
	pub path: String,
	pub name: String,
	pub depth: u32,
	pub is_dir: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DiffKind {
	Context,
	Add,
	Del,
	Hunk,
	Meta,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DiffLine {
	pub kind: DiffKind,
	pub text: String,
}

pub fn is_dir_path(path: &str) -> bool {
	path.ends_with('/')
}

pub fn file_name(path: &str) -> &str {
	let trimmed = path.trim_end_matches('/');
	trimmed.rsplit('/').next().unwrap_or(trimmed)
}

pub fn language_for_path(path: &str) -> &'static str {
	match path.rsplit('.').next().unwrap_or("") {
		"rs" => "rust",
		"ts" | "tsx" => "typescript",
		"js" | "jsx" | "mjs" | "cjs" => "javascript",
		"json" => "json",
		"md" | "mdx" => "markdown",
		"py" => "python",
		"go" => "go",
		"toml" => "toml",
		"yml" | "yaml" => "yaml",
		"css" => "css",
		"html" | "htm" => "html",
		"sh" | "bash" | "zsh" => "bash",
		"sql" => "sql",
		_ => "plaintext",
	}
}

pub fn visible_file_rows(
	tree: &HashMap<String, Vec<String>>,
	expanded: &HashSet<String>,
) -> Vec<FileRow> {
	let mut rows = Vec::new();
	push_rows("", 0, tree, expanded, &mut rows);
	rows
}

fn push_rows(
	parent: &str,
	depth: u32,
	tree: &HashMap<String, Vec<String>>,
	expanded: &HashSet<String>,
	rows: &mut Vec<FileRow>,
) {
	let Some(children) = tree.get(parent) else {
		return;
	};
	for path in children {
		let is_dir = is_dir_path(path);
		rows.push(FileRow {
			path: path.clone(),
			name: file_name(path).to_string(),
			depth,
			is_dir,
		});
		if is_dir && expanded.contains(path) {
			push_rows(path, depth + 1, tree, expanded, rows);
		}
	}
}

pub fn git_badge_for(path: &str, entries: &[(String, String)]) -> Option<String> {
	let normalized = path.trim_end_matches('/');
	if let Some((_, status)) = entries.iter().find(|(entry, _)| entry == normalized) {
		return Some(status.clone());
	}
	if is_dir_path(path) {
		let prefix = format!("{normalized}/");
		return entries
			.iter()
			.find(|(entry, _)| entry.starts_with(&prefix))
			.map(|(_, status)| status.clone());
	}
	None
}

pub fn color_diff(diff: &str) -> Vec<DiffLine> {
	diff.lines()
		.map(|line| DiffLine {
			kind: diff_kind(line),
			text: line.to_string(),
		})
		.collect()
}

fn diff_kind(line: &str) -> DiffKind {
	if line.starts_with("diff ")
		|| line.starts_with("index ")
		|| line.starts_with("+++")
		|| line.starts_with("---")
		|| line.starts_with("new file")
		|| line.starts_with("deleted file")
	{
		DiffKind::Meta
	} else if line.starts_with("@@") {
		DiffKind::Hunk
	} else if line.starts_with('+') {
		DiffKind::Add
	} else if line.starts_with('-') {
		DiffKind::Del
	} else {
		DiffKind::Context
	}
}

pub fn filter_unified_diff(diff: &str, path: Option<&str>) -> String {
	let Some(path) = path.filter(|path| !path.is_empty()) else {
		return diff.to_string();
	};
	let mut out = String::new();
	let mut include = false;
	let mut saw_header = false;
	for line in diff.lines() {
		if line.starts_with("diff --git ") {
			saw_header = true;
			include = line.contains(path);
		}
		if include {
			out.push_str(line);
			out.push('\n');
		}
	}
	if !saw_header || out.is_empty() {
		diff.to_string()
	} else {
		out
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn directory_paths_end_with_slash() {
		assert!(is_dir_path("src/"));
		assert!(!is_dir_path("src/lib.rs"));
		assert_eq!(file_name("src/lib.rs"), "lib.rs");
		assert_eq!(file_name("src/"), "src");
	}

	#[test]
	fn language_maps_common_extensions() {
		assert_eq!(language_for_path("app.rs"), "rust");
		assert_eq!(language_for_path("notes.md"), "markdown");
		assert_eq!(language_for_path("README"), "plaintext");
	}

	#[test]
	fn visible_rows_expand_only_open_directories() {
		let mut tree = HashMap::new();
		tree.insert(
			String::new(),
			vec!["README.md".into(), "src/".into(), "Cargo.toml".into()],
		);
		tree.insert("src/".into(), vec!["src/lib.rs".into(), "src/app.rs".into()]);
		let rows = visible_file_rows(&tree, &HashSet::new());
		assert_eq!(
			rows.iter().map(|row| row.path.as_str()).collect::<Vec<_>>(),
			vec!["README.md", "src/", "Cargo.toml"]
		);
		let expanded = HashSet::from(["src/".into()]);
		let rows = visible_file_rows(&tree, &expanded);
		assert_eq!(
			rows.iter().map(|row| row.path.as_str()).collect::<Vec<_>>(),
			vec!["README.md", "src/", "src/lib.rs", "src/app.rs", "Cargo.toml"]
		);
		assert_eq!(rows[2].depth, 1);
	}

	#[test]
	fn git_badge_matches_files_and_directory_children() {
		let entries = vec![
			("src/lib.rs".into(), "M".into()),
			("README.md".into(), "A".into()),
		];
		assert_eq!(git_badge_for("src/lib.rs", &entries).as_deref(), Some("M"));
		assert_eq!(git_badge_for("src/", &entries).as_deref(), Some("M"));
		assert_eq!(git_badge_for("docs/", &entries), None);
	}

	#[test]
	fn color_diff_classifies_unified_lines() {
		let lines = color_diff("diff --git a/a.rs b/a.rs\n@@ -1 +1 @@\n-old\n+new\n context\n");
		assert_eq!(lines[0].kind, DiffKind::Meta);
		assert_eq!(lines[1].kind, DiffKind::Hunk);
		assert_eq!(lines[2].kind, DiffKind::Del);
		assert_eq!(lines[3].kind, DiffKind::Add);
		assert_eq!(lines[4].kind, DiffKind::Context);
	}

	#[test]
	fn filter_unified_diff_keeps_the_selected_file() {
		let diff = "diff --git a/one.rs b/one.rs\n+one\ndiff --git a/two.rs b/two.rs\n+two\n";
		assert_eq!(
			filter_unified_diff(diff, Some("two.rs")),
			"diff --git a/two.rs b/two.rs\n+two\n"
		);
		assert_eq!(filter_unified_diff(diff, None), diff);
	}
}
