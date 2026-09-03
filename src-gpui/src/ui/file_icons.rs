use gpui::{div, prelude::*, px, rgb, AnyElement, IntoElement};
use gpui_component::{Icon, IconName, StyledExt};

/// Language-colored file-type mark used by the tree, tabs, palette, and Git list.
/// Pierre's SVG sprite is not available in GPUI; Lucide names plus a two-letter
/// language badge keep types distinguishable the way the complete icon set did.
pub fn file_icon(path: &str, is_dir: bool, expanded: bool) -> IconName {
	if is_dir {
		return if expanded {
			IconName::FolderOpen
		} else {
			IconName::Folder
		};
	}
	match file_kind(path) {
		FileKind::Markdown => IconName::BookOpen,
		FileKind::Text => IconName::File,
		FileKind::Config => IconName::Settings,
		FileKind::Git => IconName::GitHub,
		FileKind::Shell => IconName::SquareTerminal,
		FileKind::Image => IconName::GalleryVerticalEnd,
		FileKind::Html => IconName::Globe,
		FileKind::Css => IconName::Palette,
		FileKind::Archive => IconName::Frame,
		FileKind::Pdf => IconName::File,
		FileKind::Lock => IconName::Asterisk,
		FileKind::Code | FileKind::Other => IconName::File,
	}
}

pub fn file_icon_color(path: &str, is_dir: bool) -> u32 {
	if is_dir {
		return 0xc9a227;
	}
	match file_kind(path) {
		FileKind::Markdown => 0x519aba,
		FileKind::Text => 0xa0a0a0,
		FileKind::Config => 0xcbcb41,
		FileKind::Git => 0xf05032,
		FileKind::Shell => 0x89e051,
		FileKind::Image => 0xa074c4,
		FileKind::Html => 0xe34c26,
		FileKind::Css => 0x563d7c,
		FileKind::Archive => 0xcb8b41,
		FileKind::Pdf => 0xe23b2d,
		FileKind::Lock => 0x8b949e,
		FileKind::Code => code_color(path),
		FileKind::Other => 0x8b949e,
	}
}

pub fn file_glyph(path: &str, is_dir: bool, expanded: bool, size: f32) -> AnyElement {
	if is_dir || !matches!(file_kind(path), FileKind::Code) {
		return Icon::new(file_icon(path, is_dir, expanded))
			.w(px(size))
			.text_color(rgb(file_icon_color(path, is_dir)))
			.into_any_element();
	}
	let (label, color) = lang_mark(path);
	div()
		.size(px(size))
		.rounded_sm()
		.bg(rgb(color))
		.text_color(gpui::white())
		.flex()
		.items_center()
		.justify_center()
		.text_size(px((size * 0.55).max(7.)))
		.font_semibold()
		.child(label)
		.into_any_element()
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum FileKind {
	Markdown,
	Text,
	Config,
	Git,
	Shell,
	Image,
	Html,
	Css,
	Archive,
	Pdf,
	Lock,
	Code,
	Other,
}

pub(crate) fn file_kind(path: &str) -> FileKind {
	let name = file_name(path);
	if matches!(
		name.as_str(),
		".gitignore" | ".gitattributes" | ".gitmodules" | ".gitkeep"
	) {
		return FileKind::Git;
	}
	if matches!(
		name.as_str(),
		"dockerfile" | "docker-compose.yml" | "docker-compose.yaml"
	) {
		return FileKind::Shell;
	}
	if name.ends_with(".lock") || name == "bun.lockb" || name == "package-lock.json" || name == "pnpm-lock.yaml" {
		return FileKind::Lock;
	}
	let ext = name.rsplit_once('.').map(|(_, e)| e).unwrap_or("");
	match ext {
		"md" | "mdx" | "markdown" => FileKind::Markdown,
		"txt" | "rst" | "rtf" | "log" => FileKind::Text,
		"json" | "jsonc" | "toml" | "yml" | "yaml" | "ini" | "env" | "editorconfig" => FileKind::Config,
		"sh" | "zsh" | "bash" | "fish" | "ps1" | "bat" | "cmd" => FileKind::Shell,
		"png" | "jpg" | "jpeg" | "gif" | "webp" | "svg" | "bmp" | "ico" | "avif" => FileKind::Image,
		"html" | "htm" => FileKind::Html,
		"css" | "scss" | "less" => FileKind::Css,
		"zip" | "tar" | "gz" | "tgz" | "rar" | "7z" | "bz2" | "xz" => FileKind::Archive,
		"pdf" => FileKind::Pdf,
		"rs" | "ts" | "tsx" | "js" | "jsx" | "mjs" | "cjs" | "py" | "go" | "java" | "kt" | "c" | "cc" | "cpp"
		| "cxx" | "h" | "hpp" | "cs" | "rb" | "php" | "swift" | "scala" | "lua" | "zig" | "nim" | "ex" | "exs"
		| "erl" | "hs" | "ml" | "clj" | "dart" | "vue" | "svelte" | "sql" | "graphql" | "proto" => FileKind::Code,
		_ => FileKind::Other,
	}
}

pub(crate) fn lang_mark(path: &str) -> (&'static str, u32) {
	let ext = file_name(path)
		.rsplit_once('.')
		.map(|(_, e)| e.to_string())
		.unwrap_or_default();
	match ext.as_str() {
		"rs" => ("RS", 0xdea584),
		"ts" | "tsx" => ("TS", 0x3178c6),
		"js" | "jsx" | "mjs" | "cjs" => ("JS", 0xf1e05a),
		"py" => ("PY", 0x3572a5),
		"go" => ("GO", 0x00add8),
		"java" => ("JV", 0xb07219),
		"kt" => ("KT", 0xb07219),
		"c" | "h" => ("C", 0x555555),
		"cc" | "cpp" | "cxx" | "hpp" => ("C+", 0xf34b7d),
		"cs" => ("C#", 0x178600),
		"rb" => ("RB", 0x701516),
		"php" => ("PH", 0x4f5d95),
		"swift" => ("SW", 0xf05138),
		"scala" => ("SC", 0xc22d40),
		"lua" => ("LU", 0x000080),
		"zig" => ("ZG", 0xec915c),
		"nim" => ("NI", 0xffe953),
		"ex" | "exs" => ("EX", 0x6e4a7e),
		"erl" => ("ER", 0xb83998),
		"hs" => ("HS", 0x5e5086),
		"ml" => ("ML", 0xe37933),
		"clj" => ("CL", 0x5881d8),
		"dart" => ("DA", 0x00b4ab),
		"vue" => ("VU", 0x41b883),
		"svelte" => ("SV", 0xff3e00),
		"sql" => ("SQ", 0xe38c00),
		"graphql" => ("GQ", 0xe10098),
		"proto" => ("PB", 0x4fc1ff),
		_ => ("•", 0x4fc1ff),
	}
}

fn file_name(path: &str) -> String {
	std::path::Path::new(path)
		.file_name()
		.and_then(|n| n.to_str())
		.unwrap_or(path)
		.to_ascii_lowercase()
}

fn code_color(path: &str) -> u32 {
	lang_mark(path).1
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn directories_use_folder_kind_colors() {
		assert_eq!(file_icon_color("src", true), 0xc9a227);
	}

	#[test]
	fn extensions_map_to_kinds() {
		assert_eq!(file_kind("README.md"), FileKind::Markdown);
		assert_eq!(file_kind("Cargo.toml"), FileKind::Config);
		assert_eq!(file_kind(".gitignore"), FileKind::Git);
		assert_eq!(file_kind("setup.sh"), FileKind::Shell);
		assert_eq!(file_kind("logo.png"), FileKind::Image);
		assert_eq!(file_kind("main.rs"), FileKind::Code);
		assert_eq!(file_kind("index.html"), FileKind::Html);
		assert_eq!(file_kind("app.css"), FileKind::Css);
		assert_eq!(file_kind("dist.zip"), FileKind::Archive);
		assert_eq!(file_kind("spec.pdf"), FileKind::Pdf);
		assert_eq!(file_kind("Cargo.lock"), FileKind::Lock);
		assert_eq!(file_kind("notes.unknown"), FileKind::Other);
	}

	#[test]
	fn rust_and_typescript_use_distinct_colors() {
		assert_ne!(file_icon_color("lib.rs", false), file_icon_color("app.ts", false));
	}

	#[test]
	fn language_marks_are_distinct_for_common_code() {
		assert_eq!(lang_mark("lib.rs").0, "RS");
		assert_eq!(lang_mark("app.ts").0, "TS");
		assert_eq!(lang_mark("main.py").0, "PY");
		assert_eq!(lang_mark("mod.go").0, "GO");
		assert_ne!(lang_mark("lib.rs").1, lang_mark("app.ts").1);
		assert_eq!(file_kind("index.html"), FileKind::Html);
		assert_eq!(file_kind("app.css"), FileKind::Css);
		assert_eq!(file_kind("dist.zip"), FileKind::Archive);
	}

	#[test]
	fn html_css_and_archives_use_distinct_kinds() {
		assert_eq!(file_kind("index.html"), FileKind::Html);
		assert_eq!(file_kind("theme.scss"), FileKind::Css);
		assert_eq!(file_kind("bundle.tar.gz"), FileKind::Archive);
		assert_ne!(
			file_icon_color("index.html", false),
			file_icon_color("theme.scss", false)
		);
		assert_ne!(file_icon_color("dist.zip", false), file_icon_color("main.rs", false));
	}
}
