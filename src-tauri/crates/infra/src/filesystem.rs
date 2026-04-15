use std::path::{Component, Path};

use ignore::WalkBuilder;

use model::error::AppError;
use model::filesystem::FileSearchResult;

const MAX_SEARCH_RESULTS: usize = 60;

#[derive(Debug)]
struct ScoredFileMatch {
	result: FileSearchResult,
	score: u32,
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
}
