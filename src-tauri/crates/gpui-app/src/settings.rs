use std::path::PathBuf;

use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
	pub locale: String,
	pub theme: String,
	pub debug_mode: bool,
	pub performance_profile: bool,
	pub terminal_font: String,
	pub terminal_font_size: f32,
	pub worktree_dir: String,
}

impl Default for AppSettings {
	fn default() -> Self {
		Self {
			locale: "en".into(),
			theme: "system".into(),
			debug_mode: false,
			performance_profile: false,
			terminal_font: "JetBrains Mono".into(),
			terminal_font_size: 13.0,
			worktree_dir: String::new(),
		}
	}
}

impl AppSettings {
	pub fn is_dark(&self, system_dark: bool) -> bool {
		match self.theme.as_str() {
			"dark" => true,
			"light" => false,
			_ => system_dark,
		}
	}

	pub fn load(path: &PathBuf) -> Self {
		std::fs::read_to_string(path)
			.ok()
			.and_then(|raw| serde_json::from_str(&raw).ok())
			.unwrap_or_default()
	}

	pub fn save(&self, path: &PathBuf) -> std::io::Result<()> {
		if let Some(parent) = path.parent() {
			std::fs::create_dir_all(parent)?;
		}
		std::fs::write(path, serde_json::to_string_pretty(self).unwrap_or_default())
	}
}

#[cfg(test)]
mod tests {
	use super::*;
	use tempfile::tempdir;

	#[test]
	fn default_settings_match_current_app() {
		let settings = AppSettings::default();
		assert_eq!(settings.locale, "en");
		assert_eq!(settings.theme, "system");
		assert_eq!(settings.terminal_font_size, 13.0);
	}

	#[test]
	fn theme_resolution_follows_explicit_and_system_values() {
		let mut settings = AppSettings::default();
		assert!(!settings.is_dark(false));
		assert!(settings.is_dark(true));
		settings.theme = "dark".into();
		assert!(settings.is_dark(false));
		settings.theme = "light".into();
		assert!(!settings.is_dark(true));
	}

	#[test]
	fn settings_round_trip_on_disk() {
		let dir = tempdir().unwrap();
		let path = dir.path().join("settings.json");
		let mut settings = AppSettings::default();
		settings.theme = "dark".into();
		settings.debug_mode = true;
		settings.save(&path).unwrap();
		assert_eq!(AppSettings::load(&path), settings);
	}
}
