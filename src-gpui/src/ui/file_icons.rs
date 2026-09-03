use gpui_component::IconName;

/// Language-colored file-type icon used by the tree, tabs, palette, and Git list.
/// Pierre's SVG sprite is not available in GPUI; this maps the same extensions
/// onto Lucide names plus a token color so types stay distinguishable.
pub fn file_icon(path: &str, is_dir: bool, expanded: bool) -> IconName {
	if is_dir {
		return if expanded {
			IconName::FolderOpen
		} else {
			IconName::Folder
		};
	}
	match file_kind(path) {
		FileKind::Markdown | FileKind::Text => IconName::BookOpen,
		FileKind::Config => IconName::Settings,
		FileKind::Git => IconName::GitHub,
		FileKind::Shell => IconName::SquareTerminal,
		FileKind::Image => IconName::GalleryVerticalEnd,
		FileKind::Code => IconName::File,
		FileKind::Other => IconName::File,
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
		FileKind::Code => code_color(path),
		FileKind::Other => 0x8b949e,
	}
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum FileKind {
	Markdown,
	Text,
	Config,
	Git,
	Shell,
	Image,
	Code,
	Other,
}

pub(crate) fn file_kind(path: &str) -> FileKind {
	let name = std::path::Path::new(path)
		.file_name()
		.and_then(|n| n.to_str())
		.unwrap_or(path)
		.to_ascii_lowercase();
	if matches!(
		name.as_str(),
		".gitignore" | ".gitattributes" | ".gitmodules" | ".gitkeep"
	) {
		return FileKind::Git;
	}
	let ext = name.rsplit_once('.').map(|(_, e)| e).unwrap_or("");
	match ext {
		"md" | "mdx" | "markdown" => FileKind::Markdown,
		"txt" | "rst" | "rtf" | "log" => FileKind::Text,
		"json" | "jsonc" | "toml" | "yml" | "yaml" | "ini" | "env" | "editorconfig" => FileKind::Config,
		"sh" | "zsh" | "bash" | "fish" | "ps1" | "bat" | "cmd" => FileKind::Shell,
		"png" | "jpg" | "jpeg" | "gif" | "webp" | "svg" | "bmp" | "ico" | "avif" => FileKind::Image,
		"rs" | "ts" | "tsx" | "js" | "jsx" | "mjs" | "cjs" | "py" | "go" | "java" | "kt" | "c" | "cc" | "cpp"
		| "cxx" | "h" | "hpp" | "cs" | "rb" | "php" | "swift" | "scala" | "lua" | "zig" | "nim" | "ex" | "exs"
		| "erl" | "hs" | "ml" | "clj" | "dart" | "vue" | "svelte" | "css" | "scss" | "less" | "html" | "htm"
		| "xml" | "sql" | "graphql" | "proto" => FileKind::Code,
		_ => FileKind::Other,
	}
}

fn code_color(path: &str) -> u32 {
	let ext = std::path::Path::new(path)
		.extension()
		.and_then(|e| e.to_str())
		.unwrap_or("")
		.to_ascii_lowercase();
	match ext.as_str() {
		"rs" => 0xdea584,
		"ts" | "tsx" => 0x3178c6,
		"js" | "jsx" | "mjs" | "cjs" => 0xf1e05a,
		"py" => 0x3572a5,
		"go" => 0x00add8,
		"java" | "kt" => 0xb07219,
		"c" | "h" => 0x555555,
		"cc" | "cpp" | "cxx" | "hpp" => 0xf34b7d,
		"css" | "scss" | "less" => 0x563d7c,
		"html" | "htm" => 0xe34c26,
		"vue" => 0x41b883,
		"svelte" => 0xff3e00,
		"sql" => 0xe38c00,
		_ => 0x4fc1ff,
	}
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
		assert_eq!(file_kind("notes.unknown"), FileKind::Other);
	}

	#[test]
	fn rust_and_typescript_use_distinct_colors() {
		assert_ne!(file_icon_color("lib.rs", false), file_icon_color("app.ts", false));
	}
}
