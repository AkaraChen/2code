use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::i18n::Locale;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ThemePref {
	#[default]
	System,
	Light,
	Dark,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum RadiusPref {
	None,
	Small,
	#[default]
	Medium,
	Large,
	XLarge,
}

impl RadiusPref {
	pub fn label_key(self) -> &'static str {
		match self {
			Self::None => "radiusNone",
			Self::Small => "radiusSmall",
			Self::Medium => "radiusMedium",
			Self::Large => "radiusLarge",
			Self::XLarge => "radiusXLarge",
		}
	}

	pub fn scale(self) -> f32 {
		match self {
			Self::None => 0.0,
			Self::Small => 0.6,
			Self::Medium => 1.0,
			Self::Large => 1.4,
			Self::XLarge => 1.8,
		}
	}

	pub fn all() -> [Self; 5] {
		[Self::None, Self::Small, Self::Medium, Self::Large, Self::XLarge]
	}
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TerminalTemplatePref {
	pub id: String,
	pub name: String,
	pub shell: String,
	pub cwd: String,
	pub commands: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Prefs {
	pub language: Locale,
	pub theme: ThemePref,
	pub radius: RadiusPref,
	pub worktree_dir: String,
	pub debug_mode: bool,
	pub performance_profile: bool,
	pub show_avatars: bool,
	pub sidebar_width: f32,
	pub sidebar_collapsed: bool,
	pub collapsed_groups: Vec<String>,
	pub profile_sidebar_width: f32,
	pub profile_sidebar_open: bool,
	pub terminal_theme_dark: String,
	pub terminal_theme_light: String,
	pub sync_terminal_theme: bool,
	pub font_family: String,
	pub font_size: f32,
	pub default_shell: String,
	pub custom_shell: String,
	pub notifications: bool,
	pub notification_sound: String,
	pub topbar_controls: Vec<String>,
	pub editor_app: String,
	pub terminal_app: String,
	pub accept_beta: bool,
	pub templates: Vec<TerminalTemplatePref>,
	pub collapsed_projects: Vec<String>,
}

impl Default for Prefs {
	fn default() -> Self {
		Self {
			language: Locale::En,
			theme: ThemePref::System,
			radius: RadiusPref::Medium,
			worktree_dir: String::new(),
			debug_mode: false,
			performance_profile: false,
			show_avatars: true,
			sidebar_width: 250.0,
			sidebar_collapsed: false,
			collapsed_groups: Vec::new(),
			profile_sidebar_width: 208.0,
			profile_sidebar_open: true,
			terminal_theme_dark: "GitHub Dark".into(),
			terminal_theme_light: "GitHub Light".into(),
			sync_terminal_theme: false,
			font_family: "JetBrains Mono".into(),
			font_size: 13.0,
			default_shell: String::new(),
			custom_shell: String::new(),
			notifications: true,
			notification_sound: String::new(),
			topbar_controls: vec![
				"github-desktop".into(),
				"editor".into(),
				"terminal".into(),
				"pr-status".into(),
			],
			editor_app: "code".into(),
			terminal_app: String::new(),
			accept_beta: false,
			templates: Vec::new(),
			collapsed_projects: Vec::new(),
		}
	}
}

impl Prefs {
	pub fn load(app_data_dir: &Path) -> Self {
		let path = app_data_dir.join("gpui-prefs.json");
		std::fs::read_to_string(path)
			.ok()
			.and_then(|raw| serde_json::from_str(&raw).ok())
			.unwrap_or_default()
	}

	pub fn save(&self, app_data_dir: &Path) {
		let path = app_data_dir.join("gpui-prefs.json");
		if let Ok(raw) = serde_json::to_string_pretty(self) {
			let _ = std::fs::write(path, raw);
		}
	}

	pub fn effective_shell(&self) -> String {
		if self.default_shell == "custom" && !self.custom_shell.is_empty() {
			return self.custom_shell.clone();
		}
		if !self.default_shell.is_empty() && self.default_shell != "custom" {
			return self.default_shell.clone();
		}
		crate::backend::default_shell()
	}
}

#[derive(Debug, Clone, Copy)]
pub struct TermTheme {
	pub name: &'static str,
	pub bg: u32,
	pub fg: u32,
	pub cursor: u32,
	pub is_light: bool,
}

pub const TERM_THEMES: &[TermTheme] = &[
	TermTheme { name: "GitHub Dark", bg: 0x0d1117, fg: 0xc9d1d9, cursor: 0x58a6ff, is_light: false },
	TermTheme { name: "GitHub Light", bg: 0xffffff, fg: 0x1f2328, cursor: 0x0969da, is_light: true },
	TermTheme { name: "Dracula", bg: 0x282a36, fg: 0xf8f8f2, cursor: 0xff79c6, is_light: false },
	TermTheme { name: "Ayu Dark", bg: 0x0a0e14, fg: 0xb3b1ad, cursor: 0xffb454, is_light: false },
	TermTheme { name: "Ayu Light", bg: 0xfafafa, fg: 0x5c6773, cursor: 0xff6a00, is_light: true },
	TermTheme { name: "Solarized Dark", bg: 0x002b36, fg: 0x839496, cursor: 0x268bd2, is_light: false },
	TermTheme { name: "Solarized Light", bg: 0xfdf6e3, fg: 0x657b83, cursor: 0x268bd2, is_light: true },
	TermTheme { name: "One Dark", bg: 0x282c34, fg: 0xabb2bf, cursor: 0x61afef, is_light: false },
	TermTheme { name: "One Light", bg: 0xfafafa, fg: 0x383a42, cursor: 0x4078f2, is_light: true },
];

pub fn term_theme_by_name(name: &str) -> &'static TermTheme {
	TERM_THEMES
		.iter()
		.find(|t| t.name == name)
		.unwrap_or(&TERM_THEMES[0])
}
