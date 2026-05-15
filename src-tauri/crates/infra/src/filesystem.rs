use std::collections::HashSet;
use std::path::{Component, Path, PathBuf};

use ignore::WalkBuilder;

use model::error::AppError;
use model::filesystem::FileSearchResult;

const MAX_SEARCH_RESULTS: usize = 60;

#[derive(Debug)]
struct ScoredFileMatch {
	result: FileSearchResult,
	score: u32,
}

pub fn list_file_tree_paths(root: &Path) -> Result<Vec<String>, AppError> {
	if !root.is_dir() {
		return Err(AppError::NotFound(format!(
			"Directory: {}",
			root.display()
		)));
	}

	let mut paths = Vec::new();
	let mut walker = WalkBuilder::new(root);
	walker.hidden(true);
	// The file tree is a filesystem browser. Git ignore rules should affect
	// search results and git status, not whether a user can expand/open files.
	walker.ignore(false);
	walker.git_ignore(false);
	walker.git_global(false);
	walker.git_exclude(false);
	walker.parents(true);
	walker.follow_links(false);

	for entry in walker.build() {
		let entry = entry.map_err(|error| {
			AppError::IoError(std::io::Error::other(error.to_string()))
		})?;
		let path = entry.path();
		if path == root {
			continue;
		}
		if path
			.components()
			.any(|component| component.as_os_str() == ".git")
		{
			continue;
		}

		let Some(file_type) = entry.file_type() else {
			continue;
		};
		if !file_type.is_dir() && !file_type.is_file() {
			continue;
		}

		let relative_path = path.strip_prefix(root).unwrap_or(path);
		let mut relative_path = normalize_relative_path(relative_path);
		if relative_path.is_empty() {
			continue;
		}
		if file_type.is_dir() {
			relative_path.push('/');
		}
		paths.push(relative_path);
	}

	paths.sort_by_key(|path| path.to_lowercase());

	Ok(paths)
}

pub fn list_file_tree_child_paths(
	root: &Path,
	parent_path: Option<&str>,
) -> Result<Vec<String>, AppError> {
	ensure_root_directory(root)?;

	let parent_path = parent_path
		.filter(|path| !path.trim().is_empty())
		.map(|path| validate_file_tree_relative_path(path, "Parent path"))
		.transpose()?;
	let parent_dir = parent_path
		.as_ref()
		.map_or_else(|| root.to_path_buf(), |path| root.join(path));
	if parent_path.is_some() && !parent_dir.is_dir() {
		return Err(AppError::NotFound(format!(
			"Directory: {}",
			parent_dir.display()
		)));
	}

	let mut paths = Vec::new();
	for entry in std::fs::read_dir(&parent_dir)? {
		let entry = entry?;
		let file_name = entry.file_name();
		if is_hidden_file_name(&file_name) {
			continue;
		}

		let file_type = entry.file_type()?;
		if !file_type.is_dir() && !file_type.is_file() {
			continue;
		}

		let path = entry.path();
		let relative_path = path.strip_prefix(root).unwrap_or(&path);
		let mut relative_path = normalize_relative_path(relative_path);
		if relative_path.is_empty() {
			continue;
		}
		if file_type.is_dir() {
			relative_path.push('/');
		}
		paths.push(relative_path);
	}

	paths.sort_by_key(|path| path.to_lowercase());

	Ok(paths)
}

pub fn rename_file_tree_path(
	root: &Path,
	source_path: &str,
	destination_path: &str,
) -> Result<(), AppError> {
	ensure_root_directory(root)?;
	let source_path =
		validate_file_tree_relative_path(source_path, "Source path")?;
	let destination_path =
		validate_file_tree_relative_path(destination_path, "Destination path")?;
	if source_path == destination_path {
		return Ok(());
	}

	let source = root.join(&source_path);
	if !source.exists() {
		return Err(AppError::NotFound(format!(
			"File tree path: {source_path}"
		)));
	}

	let destination = root.join(&destination_path);
	if destination.exists() {
		return Err(AppError::IoError(std::io::Error::new(
			std::io::ErrorKind::AlreadyExists,
			format!("Destination already exists: {destination_path}"),
		)));
	}

	std::fs::rename(source, destination)?;

	Ok(())
}

pub fn move_file_tree_paths(
	root: &Path,
	source_paths: &[String],
	target_dir_path: Option<&str>,
) -> Result<(), AppError> {
	ensure_root_directory(root)?;
	if source_paths.is_empty() {
		return Err(invalid_input("Select at least one path to move"));
	}

	let target_dir_path = target_dir_path
		.filter(|path| !path.trim().is_empty())
		.map(|path| validate_file_tree_relative_path(path, "Target directory"))
		.transpose()?;
	let target_dir = target_dir_path
		.as_ref()
		.map_or_else(|| root.to_path_buf(), |path| root.join(path));
	if !target_dir.is_dir() {
		return Err(AppError::NotFound(format!(
			"Target directory: {}",
			target_dir.display()
		)));
	}

	let mut seen_sources = HashSet::new();
	let mut seen_destinations = HashSet::new();
	let mut moves = Vec::new();

	for source_path in source_paths {
		let source_path =
			validate_file_tree_relative_path(source_path, "Source path")?;
		if !seen_sources.insert(source_path.clone()) {
			continue;
		}
		reject_descendant_move(&source_path, target_dir_path.as_deref())?;

		let source = root.join(&source_path);
		if !source.exists() {
			return Err(AppError::NotFound(format!(
				"File tree path: {source_path}"
			)));
		}

		let destination =
			destination_for_move(&target_dir, &source, &source_path)?;
		if source == destination {
			continue;
		}
		if destination.exists() {
			return Err(AppError::IoError(std::io::Error::new(
				std::io::ErrorKind::AlreadyExists,
				format!(
					"Destination already exists: {}",
					destination.display()
				),
			)));
		}
		if !seen_destinations.insert(destination.clone()) {
			return Err(AppError::IoError(std::io::Error::new(
				std::io::ErrorKind::AlreadyExists,
				format!(
					"Multiple sources target the same destination: {}",
					destination.display()
				),
			)));
		}

		moves.push((source, destination));
	}

	for (source, destination) in moves {
		std::fs::rename(source, destination)?;
	}

	Ok(())
}

pub fn delete_file_tree_paths(
	root: &Path,
	paths: &[String],
) -> Result<(), AppError> {
	ensure_root_directory(root)?;
	if paths.is_empty() {
		return Err(invalid_input("Select at least one path to delete"));
	}

	let mut seen_paths = HashSet::new();
	let mut delete_paths = Vec::new();

	for path in paths {
		let path = validate_file_tree_relative_path(path, "File tree path")?;
		if !seen_paths.insert(path.clone()) {
			continue;
		}

		let absolute_path = root.join(&path);
		if !absolute_path.exists() {
			return Err(AppError::NotFound(format!("File tree path: {path}")));
		}

		delete_paths.push((path, absolute_path));
	}

	delete_paths.sort_by(|(left, _), (right, _)| {
		right.matches('/').count().cmp(&left.matches('/').count())
	});

	for (_path, absolute_path) in delete_paths {
		let metadata = std::fs::symlink_metadata(&absolute_path)?;
		if metadata.file_type().is_dir() {
			std::fs::remove_dir_all(absolute_path)?;
		} else {
			std::fs::remove_file(absolute_path)?;
		}
	}

	Ok(())
}

pub fn search_files(
	root: &Path,
	query: &str,
) -> Result<Vec<FileSearchResult>, AppError> {
	let query = query.trim();
	if query.is_empty() {
		return Ok(Vec::new());
	}
	if !root.is_dir() {
		return Err(AppError::NotFound(format!(
			"Directory: {}",
			root.display()
		)));
	}

	let normalized_query = query.to_lowercase();
	let mut results = Vec::new();
	let mut walker = WalkBuilder::new(root);
	walker.hidden(false);
	walker.git_ignore(true);
	walker.git_global(true);
	walker.git_exclude(true);
	walker.parents(true);
	walker.follow_links(false);

	for entry in walker.build() {
		let entry = entry.map_err(|error| {
			AppError::IoError(std::io::Error::other(error.to_string()))
		})?;
		let path = entry.path();
		if path == root {
			continue;
		}
		if path
			.components()
			.any(|component| component.as_os_str() == ".git")
		{
			continue;
		}

		let Some(file_type) = entry.file_type() else {
			continue;
		};
		if !file_type.is_file() {
			continue;
		}

		let relative_path = path.strip_prefix(root).unwrap_or(path);
		let relative_path = normalize_relative_path(relative_path);
		let name = path
			.file_name()
			.map(|value| value.to_string_lossy().into_owned())
			.unwrap_or_else(|| relative_path.clone());

		let Some(score) =
			score_file_match(&normalized_query, &name, &relative_path)
		else {
			continue;
		};

		results.push(ScoredFileMatch {
			result: FileSearchResult {
				name,
				path: path.to_string_lossy().into_owned(),
				relative_path,
			},
			score,
		});
	}

	results.sort_by(|left, right| {
		left.score
			.cmp(&right.score)
			.then_with(|| {
				left.result
					.relative_path
					.len()
					.cmp(&right.result.relative_path.len())
			})
			.then_with(|| {
				left.result.relative_path.cmp(&right.result.relative_path)
			})
	});
	results.truncate(MAX_SEARCH_RESULTS);

	Ok(results.into_iter().map(|entry| entry.result).collect())
}

fn normalize_relative_path(path: &Path) -> String {
	let mut normalized = String::new();

	for component in path.components() {
		match component {
			Component::CurDir => {}
			Component::Normal(value) => {
				if !normalized.is_empty() {
					normalized.push('/');
				}
				normalized.push_str(&value.to_string_lossy());
			}
			other => {
				if !normalized.is_empty() {
					normalized.push('/');
				}
				normalized.push_str(&other.as_os_str().to_string_lossy());
			}
		}
	}

	normalized
}

fn is_hidden_file_name(file_name: &std::ffi::OsStr) -> bool {
	file_name.to_string_lossy().starts_with('.')
}

fn ensure_root_directory(root: &Path) -> Result<(), AppError> {
	if !root.is_dir() {
		return Err(AppError::NotFound(format!(
			"Directory: {}",
			root.display()
		)));
	}
	Ok(())
}

fn validate_file_tree_relative_path(
	path: &str,
	label: &str,
) -> Result<String, AppError> {
	let trimmed = path.trim();
	if trimmed.is_empty() {
		return Err(invalid_input(format!("{label} cannot be empty")));
	}
	if trimmed.contains('\0') {
		return Err(invalid_input(format!(
			"{label} contains invalid characters"
		)));
	}

	let without_trailing_separator =
		trimmed.trim_end_matches(['/', '\\']).to_string();
	if without_trailing_separator.is_empty() {
		return Err(invalid_input(format!("{label} cannot be root")));
	}

	let parsed = Path::new(&without_trailing_separator);
	if parsed.is_absolute() {
		return Err(invalid_input(format!(
			"{label} must be relative: {trimmed}"
		)));
	}

	let mut segments = Vec::new();
	for component in parsed.components() {
		match component {
			Component::CurDir => {}
			Component::Normal(value) => {
				let segment = value.to_string_lossy();
				if segment == ".git" {
					return Err(invalid_input(format!(
						"{label} cannot target .git metadata"
					)));
				}
				segments.push(segment.into_owned());
			}
			Component::ParentDir
			| Component::RootDir
			| Component::Prefix(_) => {
				return Err(invalid_input(format!(
					"{label} escapes worktree: {trimmed}"
				)));
			}
		}
	}

	if segments.is_empty() {
		return Err(invalid_input(format!("{label} cannot be empty")));
	}

	Ok(segments.join("/"))
}

fn destination_for_move(
	target_dir: &Path,
	source: &Path,
	source_path: &str,
) -> Result<PathBuf, AppError> {
	let file_name = source.file_name().ok_or_else(|| {
		invalid_input(format!("Source path has no file name: {source_path}"))
	})?;
	Ok(target_dir.join(file_name))
}

fn reject_descendant_move(
	source_path: &str,
	target_dir_path: Option<&str>,
) -> Result<(), AppError> {
	let Some(target_dir_path) = target_dir_path else {
		return Ok(());
	};
	if target_dir_path == source_path
		|| target_dir_path.starts_with(&format!("{source_path}/"))
	{
		return Err(invalid_input(
			"Cannot move a directory into itself or one of its descendants",
		));
	}
	Ok(())
}

fn invalid_input(message: impl Into<String>) -> AppError {
	AppError::IoError(std::io::Error::new(
		std::io::ErrorKind::InvalidInput,
		message.into(),
	))
}

fn score_file_match(
	query: &str,
	name: &str,
	relative_path: &str,
) -> Option<u32> {
	let normalized_name = name.to_lowercase();
	let normalized_path = relative_path.to_lowercase();

	if normalized_name == query {
		return Some(0);
	}
	if normalized_path == query {
		return Some(10);
	}
	if let Some(index) = normalized_name.find(query) {
		return Some(20 + index as u32 * 4 + normalized_name.len() as u32);
	}
	if let Some(score) = subsequence_score(query, &normalized_name) {
		return Some(120 + score);
	}
	if let Some(index) = normalized_path.find(query) {
		return Some(260 + index as u32 * 2 + normalized_path.len() as u32);
	}

	subsequence_score(query, &normalized_path).map(|score| 520 + score)
}

fn subsequence_score(query: &str, candidate: &str) -> Option<u32> {
	let query_chars: Vec<char> = query.chars().collect();
	if query_chars.is_empty() {
		return Some(0);
	}

	let candidate_chars: Vec<char> = candidate.chars().collect();
	let mut next_query_index = 0usize;
	let mut score = 0usize;
	let mut last_match: Option<usize> = None;

	for (index, ch) in candidate_chars.iter().enumerate() {
		if *ch != query_chars[next_query_index] {
			continue;
		}

		score += match last_match {
			Some(previous) => index.saturating_sub(previous + 1),
			None => index,
		};
		last_match = Some(index);
		next_query_index += 1;

		if next_query_index == query_chars.len() {
			score += candidate_chars.len().saturating_sub(index + 1);
			return Some(score as u32);
		}
	}

	None
}

#[cfg(test)]
mod tests {
	use super::*;
	use std::time::Instant;

	#[test]
	fn scores_exact_name_first() {
		assert_eq!(
			score_file_match("main.rs", "main.rs", "src/main.rs"),
			Some(0)
		);
	}

	#[test]
	fn prefers_name_match_over_path_match() {
		let name_score =
			score_file_match("main", "main.rs", "src/main.rs").unwrap();
		let path_score =
			score_file_match("main", "app.rs", "src/main.rs").unwrap();

		assert!(name_score < path_score);
	}

	#[test]
	fn rejects_non_matching_candidates() {
		assert_eq!(score_file_match("palette", "main.rs", "src/main.rs"), None);
	}

	#[test]
	fn normalizes_relative_path_to_forward_slashes() {
		let normalized =
			normalize_relative_path(Path::new("src/features/main.rs"));
		assert_eq!(normalized, "src/features/main.rs");
	}

	#[test]
	fn lists_file_tree_paths_as_relative_paths() {
		let temp_dir = tempfile::tempdir().expect("temp dir");
		let root = temp_dir.path();
		std::fs::create_dir_all(root.join("src/empty")).expect("create dirs");
		std::fs::write(root.join("src/main.rs"), "fn main() {}")
			.expect("write file");
		std::fs::write(root.join(".env"), "SECRET=value")
			.expect("write hidden file");

		let paths = list_file_tree_paths(root).expect("list tree paths");

		assert_eq!(
			paths,
			vec![
				"src/".to_string(),
				"src/empty/".to_string(),
				"src/main.rs".to_string(),
			]
		);
	}

	#[test]
	fn lists_file_tree_paths_including_gitignored_paths() {
		let temp_dir = tempfile::tempdir().expect("temp dir");
		let root = temp_dir.path();
		std::fs::write(root.join(".gitignore"), "node_modules/\nignored.log\n")
			.expect("write gitignore");
		std::fs::create_dir_all(root.join("node_modules/pkg"))
			.expect("create ignored dirs");
		std::fs::write(root.join("node_modules/pkg/index.ts"), "ignored")
			.expect("write ignored nested file");
		std::fs::write(root.join("ignored.log"), "ignored")
			.expect("write ignored file");

		let paths = list_file_tree_paths(root).expect("list tree paths");

		assert!(paths.contains(&"ignored.log".to_string()));
		assert!(paths.contains(&"node_modules/".to_string()));
		assert!(paths.contains(&"node_modules/pkg/".to_string()));
		assert!(paths.contains(&"node_modules/pkg/index.ts".to_string()));
	}

	#[test]
	fn lists_file_tree_child_paths_without_recursing_into_ignored_dirs() {
		let temp_dir = tempfile::tempdir().expect("temp dir");
		let root = temp_dir.path();
		std::fs::write(root.join(".gitignore"), "node_modules/\n")
			.expect("write gitignore");
		std::fs::create_dir_all(root.join("node_modules/pkg"))
			.expect("create ignored dirs");
		std::fs::write(root.join("node_modules/pkg/index.ts"), "ignored")
			.expect("write ignored nested file");
		std::fs::create_dir_all(root.join("src")).expect("create src");
		std::fs::write(root.join("src/main.rs"), "fn main() {}")
			.expect("write main");

		let root_paths =
			list_file_tree_child_paths(root, None).expect("list root children");
		let node_module_paths =
			list_file_tree_child_paths(root, Some("node_modules/"))
				.expect("list ignored dir children");

		assert_eq!(
			root_paths,
			vec!["node_modules/".to_string(), "src/".to_string()]
		);
		assert_eq!(node_module_paths, vec!["node_modules/pkg/".to_string()]);
	}

	#[test]
	#[ignore]
	fn bench_list_root_children_checks_root_once() {
		let temp_dir = tempfile::tempdir().expect("temp dir");
		let root = temp_dir.path();
		std::fs::create_dir_all(root.join("src")).expect("create src");
		std::fs::write(root.join("README.md"), "readme").expect("write file");

		let iterations = 100_000;
		let double_check_start = Instant::now();
		for _ in 0..iterations {
			assert!(root.is_dir());
			assert!(root.is_dir());
		}
		let double_check_duration = double_check_start.elapsed();

		let single_check_start = Instant::now();
		for _ in 0..iterations {
			assert!(root.is_dir());
		}
		let single_check_duration = single_check_start.elapsed();

		println!(
			"double_root_is_dir={double_check_duration:?} single_root_is_dir={single_check_duration:?} speedup={:.2}x",
			double_check_duration.as_secs_f64()
				/ single_check_duration.as_secs_f64()
		);
	}

	#[test]
	fn renames_file_tree_path_inside_root() {
		let temp_dir = tempfile::tempdir().expect("temp dir");
		let root = temp_dir.path();
		std::fs::create_dir_all(root.join("src")).expect("create src");
		std::fs::write(root.join("src/main.rs"), "fn main() {}")
			.expect("write file");

		rename_file_tree_path(root, "src/main.rs", "src/lib.rs")
			.expect("rename file");

		assert!(!root.join("src/main.rs").exists());
		assert!(root.join("src/lib.rs").exists());
	}

	#[test]
	fn rejects_file_tree_path_escape() {
		let temp_dir = tempfile::tempdir().expect("temp dir");
		let root = temp_dir.path();
		std::fs::write(root.join("main.rs"), "fn main() {}")
			.expect("write file");

		let result = rename_file_tree_path(root, "main.rs", "../main.rs");

		assert!(result.is_err());
		assert!(root.join("main.rs").exists());
	}

	#[test]
	fn moves_multiple_file_tree_paths_into_target_directory() {
		let temp_dir = tempfile::tempdir().expect("temp dir");
		let root = temp_dir.path();
		std::fs::create_dir_all(root.join("src")).expect("create src");
		std::fs::create_dir_all(root.join("target")).expect("create target");
		std::fs::write(root.join("a.txt"), "a").expect("write a");
		std::fs::write(root.join("src/b.txt"), "b").expect("write b");

		move_file_tree_paths(
			root,
			&["a.txt".to_string(), "src/b.txt".to_string()],
			Some("target/"),
		)
		.expect("move files");

		assert!(root.join("target/a.txt").exists());
		assert!(root.join("target/b.txt").exists());
		assert!(!root.join("a.txt").exists());
		assert!(!root.join("src/b.txt").exists());
	}

	#[test]
	fn rejects_moving_directory_into_its_descendant() {
		let temp_dir = tempfile::tempdir().expect("temp dir");
		let root = temp_dir.path();
		std::fs::create_dir_all(root.join("src/nested")).expect("create dirs");

		let result = move_file_tree_paths(
			root,
			&["src/".to_string()],
			Some("src/nested/"),
		);

		assert!(result.is_err());
		assert!(root.join("src/nested").exists());
	}

	#[test]
	fn deletes_files_and_directories_inside_root() {
		let temp_dir = tempfile::tempdir().expect("temp dir");
		let root = temp_dir.path();
		std::fs::create_dir_all(root.join("src/nested")).expect("create dirs");
		std::fs::write(root.join("README.md"), "readme").expect("write readme");
		std::fs::write(root.join("src/nested/main.rs"), "fn main() {}")
			.expect("write main");

		delete_file_tree_paths(
			root,
			&["README.md".to_string(), "src/".to_string()],
		)
		.expect("delete paths");

		assert!(!root.join("README.md").exists());
		assert!(!root.join("src").exists());
	}

	#[test]
	fn deletes_nested_selection_before_parent_directory() {
		let temp_dir = tempfile::tempdir().expect("temp dir");
		let root = temp_dir.path();
		std::fs::create_dir_all(root.join("src/nested")).expect("create dirs");
		std::fs::write(root.join("src/nested/main.rs"), "fn main() {}")
			.expect("write main");

		delete_file_tree_paths(
			root,
			&["src/".to_string(), "src/nested/main.rs".to_string()],
		)
		.expect("delete paths");

		assert!(!root.join("src").exists());
	}

	#[test]
	fn rejects_deleting_file_tree_path_escape() {
		let temp_dir = tempfile::tempdir().expect("temp dir");
		let root = temp_dir.path();
		std::fs::write(root.join("main.rs"), "fn main() {}")
			.expect("write file");

		let result = delete_file_tree_paths(root, &["../main.rs".to_string()]);

		assert!(result.is_err());
		assert!(root.join("main.rs").exists());
	}
}
