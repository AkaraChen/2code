use crate::diff::{self, DiffLineKind};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum ReviewSide {
	#[default]
	Additions,
	Deletions,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ReviewRange {
	pub start: u32,
	pub end: u32,
	pub side: ReviewSide,
	pub end_side: ReviewSide,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReviewComment {
	pub id: String,
	pub file_name: String,
	pub display_name: String,
	pub prev_name: Option<String>,
	pub range: ReviewRange,
	pub selected_text: String,
	pub body: String,
	pub created_at: u128,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReviewSelection {
	pub file: String,
	pub display_name: String,
	pub prev_name: Option<String>,
	pub range: ReviewRange,
}

pub fn format_review_range(range: ReviewRange) -> String {
	let start = range.start.min(range.end);
	let end = range.start.max(range.end);
	if start == end {
		format!("{start}")
	} else {
		format!("{start}-{end}")
	}
}

pub fn normalize_clipboard_block(text: &str) -> String {
	let mut lines: Vec<String> = text.split('\n').map(|line| line.trim_end().to_string()).collect();
	while lines.first().is_some_and(|l| l.is_empty()) {
		lines.remove(0);
	}
	while lines.last().is_some_and(|l| l.is_empty()) {
		lines.pop();
	}
	lines.join("\n")
}

pub fn selected_text_from_sides(additions: &[&str], deletions: &[&str], range: ReviewRange) -> String {
	let start = range.start.min(range.end);
	let end = range.start.max(range.end);
	if range.side == range.end_side {
		return side_lines(
			if range.side == ReviewSide::Additions {
				additions
			} else {
				deletions
			},
			range.side,
			start,
			end,
		);
	}
	let deletion_text = side_lines(deletions, ReviewSide::Deletions, start, end);
	let addition_text = side_lines(additions, ReviewSide::Additions, start, end);
	[
		if deletion_text.is_empty() {
			String::new()
		} else {
			format!("# deletions\n{deletion_text}")
		},
		if addition_text.is_empty() {
			String::new()
		} else {
			format!("# additions\n{addition_text}")
		},
	]
	.into_iter()
	.filter(|s| !s.is_empty())
	.collect::<Vec<_>>()
	.join("\n")
}

fn side_lines(lines: &[&str], side: ReviewSide, start: u32, end: u32) -> String {
	let prefix = match side {
		ReviewSide::Additions => '+',
		ReviewSide::Deletions => '-',
	};
	let start_ix = start.saturating_sub(1) as usize;
	let end_ix = end as usize;
	lines
		.get(start_ix..end_ix.min(lines.len()))
		.unwrap_or(&[])
		.iter()
		.map(|line| format!("{prefix}{}", line.trim_end()))
		.collect::<Vec<_>>()
		.join("\n")
}

pub fn selected_text_from_hunk(hunk: &str, range: ReviewRange) -> String {
	let annotated = diff::annotate_unified(hunk);
	let additions: Vec<String> = annotated
		.iter()
		.filter(|l| l.kind == DiffLineKind::Add)
		.map(|l| strip_diff_prefix(&l.raw))
		.collect();
	let deletions: Vec<String> = annotated
		.iter()
		.filter(|l| l.kind == DiffLineKind::Del)
		.map(|l| strip_diff_prefix(&l.raw))
		.collect();
	let add_refs: Vec<&str> = additions.iter().map(String::as_str).collect();
	let del_refs: Vec<&str> = deletions.iter().map(String::as_str).collect();
	selected_text_from_sides(&add_refs, &del_refs, range)
}

fn strip_diff_prefix(raw: &str) -> String {
	raw.chars().next().map(|_| raw[1..].to_string()).unwrap_or_default()
}

pub fn create_review_comment(
	file_name: impl Into<String>,
	prev_name: Option<String>,
	range: ReviewRange,
	selected_text: String,
	body: &str,
) -> ReviewComment {
	let file_name = file_name.into();
	let display_name = match &prev_name {
		Some(prev) if prev != &file_name => format!("{prev} -> {file_name}"),
		_ => file_name.clone(),
	};
	ReviewComment {
		id: uuid::Uuid::new_v4().to_string(),
		file_name,
		display_name,
		prev_name,
		range,
		selected_text,
		body: body.to_string(),
		created_at: std::time::SystemTime::now()
			.duration_since(std::time::UNIX_EPOCH)
			.unwrap_or_default()
			.as_millis(),
	}
}

pub fn format_review_comments_for_agent(comments: &[ReviewComment]) -> String {
	let mut lines = vec!["Please address these review comments:".to_string(), String::new()];
	for (index, comment) in comments.iter().enumerate() {
		lines.push(format!(
			"{}. {}:{}",
			index + 1,
			comment.file_name,
			format_review_range(comment.range)
		));
		lines.push("Selected diff:".into());
		lines.push("```diff".into());
		let selected = normalize_clipboard_block(&comment.selected_text);
		lines.push(if selected.is_empty() {
			"(no selected text available)".into()
		} else {
			selected
		});
		lines.push("```".into());
		lines.push("Comment:".into());
		lines.push(normalize_clipboard_block(&comment.body));
		lines.push(String::new());
	}
	lines.join("\n")
}

pub fn line_in_range(range: ReviewRange, side: ReviewSide, line_no: u32) -> bool {
	let start = range.start.min(range.end);
	let end = range.start.max(range.end);
	if line_no < start || line_no > end {
		return false;
	}
	if range.side == range.end_side {
		range.side == side
	} else {
		true
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn format_review_range_collapses_single_line() {
		assert_eq!(
			format_review_range(ReviewRange {
				start: 4,
				end: 4,
				side: ReviewSide::Additions,
				end_side: ReviewSide::Additions,
			}),
			"4"
		);
		assert_eq!(
			format_review_range(ReviewRange {
				start: 3,
				end: 1,
				side: ReviewSide::Additions,
				end_side: ReviewSide::Additions,
			}),
			"1-3"
		);
	}

	#[test]
	fn copies_selected_diff_without_extra_prefix_spaces_or_trailing_whitespace() {
		let comment = create_review_comment(
			"src/example.ts",
			None,
			ReviewRange {
				start: 1,
				end: 3,
				side: ReviewSide::Additions,
				end_side: ReviewSide::Additions,
			},
			selected_text_from_sides(
				&["  const value = 1;  ", "", "    return value;"],
				&[],
				ReviewRange {
					start: 1,
					end: 3,
					side: ReviewSide::Additions,
					end_side: ReviewSide::Additions,
				},
			),
			"\n  tighten this up  \n\n",
		);
		assert!(format_review_comments_for_agent(&[comment]).contains(
			[
				"1. src/example.ts:1-3",
				"Selected diff:",
				"```diff",
				"+  const value = 1;",
				"+",
				"+    return value;",
				"```",
				"Comment:",
				"  tighten this up",
			]
			.join("\n")
			.as_str()
		));
	}

	#[test]
	fn display_name_uses_rename_arrow() {
		let comment = create_review_comment(
			"new.rs",
			Some("old.rs".into()),
			ReviewRange {
				start: 1,
				end: 1,
				side: ReviewSide::Additions,
				end_side: ReviewSide::Additions,
			},
			"+fn main() {}".into(),
			"ok",
		);
		assert_eq!(comment.display_name, "old.rs -> new.rs");
	}
}
