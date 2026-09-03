/// A single side of a split-diff row.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DiffLineKind {
	Context,
	Add,
	Del,
	Header,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SplitRow {
	pub left: Option<(DiffLineKind, String)>,
	pub right: Option<(DiffLineKind, String)>,
}

/// Pair consecutive `-` / `+` runs in a unified diff into two-column rows.
/// Context and hunk headers appear on both sides; deletions stay left; additions stay right.
pub fn split_rows(diff: &str) -> Vec<SplitRow> {
	let mut rows = Vec::new();
	let mut dels = Vec::new();
	let mut adds = Vec::new();

	fn flush(rows: &mut Vec<SplitRow>, dels: &mut Vec<String>, adds: &mut Vec<String>) {
		let n = dels.len().max(adds.len());
		for i in 0..n {
			rows.push(SplitRow {
				left: dels.get(i).cloned().map(|s| (DiffLineKind::Del, s)),
				right: adds.get(i).cloned().map(|s| (DiffLineKind::Add, s)),
			});
		}
		dels.clear();
		adds.clear();
	}

	for line in diff.lines() {
		if is_header(line) {
			flush(&mut rows, &mut dels, &mut adds);
			let text = line.to_string();
			rows.push(SplitRow {
				left: Some((DiffLineKind::Header, text.clone())),
				right: Some((DiffLineKind::Header, text)),
			});
		} else if line.starts_with('+') {
			adds.push(line.to_string());
		} else if line.starts_with('-') {
			dels.push(line.to_string());
		} else {
			flush(&mut rows, &mut dels, &mut adds);
			let text = line.to_string();
			rows.push(SplitRow {
				left: Some((DiffLineKind::Context, text.clone())),
				right: Some((DiffLineKind::Context, text)),
			});
		}
	}
	flush(&mut rows, &mut dels, &mut adds);
	rows
}

pub fn rename_paths(diff: &str) -> Option<(String, String)> {
	let mut from = None;
	let mut to = None;
	for line in diff.lines() {
		if let Some(rest) = line.strip_prefix("rename from ") {
			from = Some(rest.to_string());
		} else if let Some(rest) = line.strip_prefix("rename to ") {
			to = Some(rest.to_string());
		}
	}
	match (from, to) {
		(Some(old), Some(new)) if old != new => Some((old, new)),
		_ => None,
	}
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AnnotatedLine {
	pub raw: String,
	pub kind: DiffLineKind,
	pub old_no: Option<u32>,
	pub new_no: Option<u32>,
}

pub fn annotate_unified(diff: &str) -> Vec<AnnotatedLine> {
	let mut old = 0u32;
	let mut new = 0u32;
	let mut lines = Vec::new();
	for line in diff.lines() {
		if line.starts_with("@@") {
			if let Some((o, n)) = parse_hunk_header(line) {
				old = o;
				new = n;
			}
			lines.push(AnnotatedLine {
				raw: line.to_string(),
				kind: DiffLineKind::Header,
				old_no: None,
				new_no: None,
			});
		} else if is_header(line) {
			lines.push(AnnotatedLine {
				raw: line.to_string(),
				kind: DiffLineKind::Header,
				old_no: None,
				new_no: None,
			});
		} else if line.starts_with('+') {
			lines.push(AnnotatedLine {
				raw: line.to_string(),
				kind: DiffLineKind::Add,
				old_no: None,
				new_no: Some(new),
			});
			new = new.saturating_add(1);
		} else if line.starts_with('-') {
			lines.push(AnnotatedLine {
				raw: line.to_string(),
				kind: DiffLineKind::Del,
				old_no: Some(old),
				new_no: None,
			});
			old = old.saturating_add(1);
		} else {
			lines.push(AnnotatedLine {
				raw: line.to_string(),
				kind: DiffLineKind::Context,
				old_no: Some(old),
				new_no: Some(new),
			});
			old = old.saturating_add(1);
			new = new.saturating_add(1);
		}
	}
	lines
}

pub fn parse_hunk_header(line: &str) -> Option<(u32, u32)> {
	let rest = line.strip_prefix("@@ ")?;
	let mut parts = rest.split_whitespace();
	let old = parts.next()?.strip_prefix('-')?;
	let new = parts.next()?.strip_prefix('+')?;
	let old_n = old.split(',').next()?.parse().ok()?;
	let new_n = new.split(',').next()?.parse().ok()?;
	Some((old_n, new_n))
}

fn is_header(line: &str) -> bool {
	line.starts_with("diff ")
		|| line.starts_with("index ")
		|| line.starts_with("---")
		|| line.starts_with("+++")
		|| line.starts_with("@@")
		|| line.starts_with("new file")
		|| line.starts_with("deleted file")
		|| line.starts_with("rename ")
		|| line.starts_with("similarity ")
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn pairs_replacement_on_one_row() {
		let rows = split_rows("-old\n+new\n");
		assert_eq!(
			rows,
			vec![SplitRow {
				left: Some((DiffLineKind::Del, "-old".into())),
				right: Some((DiffLineKind::Add, "+new".into())),
			}]
		);
	}

	#[test]
	fn context_appears_on_both_sides() {
		let rows = split_rows(" keep\n");
		assert_eq!(
			rows,
			vec![SplitRow {
				left: Some((DiffLineKind::Context, " keep".into())),
				right: Some((DiffLineKind::Context, " keep".into())),
			}]
		);
	}

	#[test]
	fn unmatched_deletion_leaves_right_empty() {
		let rows = split_rows("-gone\n keep\n");
		assert_eq!(
			rows,
			vec![
				SplitRow {
					left: Some((DiffLineKind::Del, "-gone".into())),
					right: None,
				},
				SplitRow {
					left: Some((DiffLineKind::Context, " keep".into())),
					right: Some((DiffLineKind::Context, " keep".into())),
				},
			]
		);
	}

	#[test]
	fn hunk_header_spans_both_columns() {
		let rows = split_rows("@@ -1,2 +1,2 @@\n-a\n+b\n");
		assert_eq!(rows[0].left.as_ref().unwrap().0, DiffLineKind::Header);
		assert_eq!(rows[0].right.as_ref().unwrap().0, DiffLineKind::Header);
		assert_eq!(rows[1].left.as_ref().unwrap().0, DiffLineKind::Del);
		assert_eq!(rows[1].right.as_ref().unwrap().0, DiffLineKind::Add);
	}

	#[test]
	fn rename_paths_reads_git_headers() {
		let diff = "diff --git a/old.rs b/new.rs\nrename from old.rs\nrename to new.rs\n";
		assert_eq!(rename_paths(diff), Some(("old.rs".into(), "new.rs".into())));
		assert_eq!(rename_paths("diff --git a/a.rs b/a.rs\n"), None);
	}

	#[test]
	fn annotate_unified_tracks_old_and_new_line_numbers() {
		let lines = annotate_unified("@@ -10,2 +12,3 @@\n keep\n-old\n+new\n+more\n");
		assert_eq!(parse_hunk_header("@@ -10,2 +12,3 @@ fn"), Some((10, 12)));
		assert_eq!(lines[1].kind, DiffLineKind::Context);
		assert_eq!(lines[1].old_no, Some(10));
		assert_eq!(lines[1].new_no, Some(12));
		assert_eq!(lines[2].kind, DiffLineKind::Del);
		assert_eq!(lines[2].old_no, Some(11));
		assert_eq!(lines[3].kind, DiffLineKind::Add);
		assert_eq!(lines[3].new_no, Some(13));
		assert_eq!(lines[4].new_no, Some(14));
	}
}
