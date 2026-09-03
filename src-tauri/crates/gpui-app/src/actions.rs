//! Pure helpers for native-shell Git and file actions.

pub fn commit_paths(changed: &[String], selected: Option<&str>) -> Vec<String> {
	if let Some(path) = selected {
		if changed.iter().any(|item| item == path) {
			return vec![path.to_string()];
		}
	}
	changed.to_vec()
}

pub fn discard_paths(changed: &[String], selected: Option<&str>) -> Vec<String> {
	commit_paths(changed, selected)
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn commit_uses_selected_file_when_it_is_in_the_change_list() {
		let changed = vec!["src/a.rs".into(), "src/b.rs".into()];
		assert_eq!(
			commit_paths(&changed, Some("src/b.rs")),
			vec!["src/b.rs".to_string()]
		);
	}

	#[test]
	fn commit_falls_back_to_all_changed_files() {
		let changed = vec!["src/a.rs".into(), "src/b.rs".into()];
		assert_eq!(commit_paths(&changed, Some("missing.rs")), changed);
		assert_eq!(commit_paths(&changed, None), changed);
	}
}
