use std::sync::OnceLock;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DetectedApp {
	pub id: &'static str,
	pub name: &'static str,
	pub command: &'static str,
}

pub fn command_exists(command: &str) -> bool {
	if command.is_empty() {
		return false;
	}
	if let Some(paths) = std::env::var_os("PATH") {
		if std::env::split_paths(&paths).any(|dir| dir.join(command).is_file()) {
			return true;
		}
	}
	#[cfg(target_os = "macos")]
	{
		let apps = [
			("cursor", "/Applications/Cursor.app"),
			("code", "/Applications/Visual Studio Code.app"),
			("windsurf", "/Applications/Windsurf.app"),
			("zed", "/Applications/Zed.app"),
			("subl", "/Applications/Sublime Text.app"),
			("ghostty", "/Applications/Ghostty.app"),
			("kitty", "/Applications/kitty.app"),
			("warp", "/Applications/Warp.app"),
			("iterm2", "/Applications/iTerm.app"),
			("firefox", "/Applications/Firefox.app"),
			("chrome", "/Applications/Google Chrome.app"),
			("safari", "/Applications/Safari.app"),
			("edge", "/Applications/Microsoft Edge.app"),
			("brave", "/Applications/Brave Browser.app"),
			("arc", "/Applications/Arc.app"),
			("vivaldi", "/Applications/Vivaldi.app"),
			("orion", "/Applications/Orion.app"),
			("github", "/Applications/GitHub Desktop.app"),
		];
		if let Some((_, path)) = apps.iter().find(|(id, _)| *id == command) {
			return std::path::Path::new(path).exists();
		}
	}
	false
}

pub fn installed_editors() -> Vec<DetectedApp> {
	[
		DetectedApp {
			id: "vscode",
			name: "VS Code",
			command: "code",
		},
		DetectedApp {
			id: "cursor",
			name: "Cursor",
			command: "cursor",
		},
		DetectedApp {
			id: "windsurf",
			name: "Windsurf",
			command: "windsurf",
		},
		DetectedApp {
			id: "zed",
			name: "Zed",
			command: "zed",
		},
		DetectedApp {
			id: "sublime-text",
			name: "Sublime Text",
			command: "subl",
		},
	]
	.into_iter()
	.filter(|app| command_exists(app.command))
	.collect()
}

pub fn installed_terminals() -> Vec<DetectedApp> {
	[
		DetectedApp {
			id: "ghostty",
			name: "Ghostty",
			command: "ghostty",
		},
		DetectedApp {
			id: "iterm2",
			name: "iTerm2",
			command: "iterm2",
		},
		DetectedApp {
			id: "kitty",
			name: "Kitty",
			command: "kitty",
		},
		DetectedApp {
			id: "warp",
			name: "Warp",
			command: "warp",
		},
	]
	.into_iter()
	.filter(|app| command_exists(app.command))
	.collect()
}

pub fn installed_browsers() -> Vec<DetectedApp> {
	[
		DetectedApp {
			id: "safari",
			name: "Safari",
			command: "safari",
		},
		DetectedApp {
			id: "chrome",
			name: "Google Chrome",
			command: "google-chrome",
		},
		DetectedApp {
			id: "chrome-canary",
			name: "Google Chrome Canary",
			command: "google-chrome-canary",
		},
		DetectedApp {
			id: "edge",
			name: "Microsoft Edge",
			command: "microsoft-edge",
		},
		DetectedApp {
			id: "firefox",
			name: "Firefox",
			command: "firefox",
		},
		DetectedApp {
			id: "arc",
			name: "Arc",
			command: "arc",
		},
		DetectedApp {
			id: "brave",
			name: "Brave Browser",
			command: "brave",
		},
		DetectedApp {
			id: "vivaldi",
			name: "Vivaldi",
			command: "vivaldi",
		},
		DetectedApp {
			id: "orion",
			name: "Orion",
			command: "orion",
		},
		DetectedApp {
			id: "chromium",
			name: "Chromium",
			command: "chromium",
		},
	]
	.into_iter()
	.filter(|app| command_exists(app.command) || command_exists(app.id))
	.collect()
}

pub fn list_shells() -> Vec<String> {
	let mut shells = Vec::new();
	if let Ok(text) = std::fs::read_to_string("/etc/shells") {
		for line in text.lines() {
			let line = line.trim();
			if line.starts_with('/') && std::path::Path::new(line).is_file() {
				shells.push(line.to_string());
			}
		}
	}
	for fallback in ["/bin/zsh", "/bin/bash", "/bin/sh", "/usr/bin/fish"] {
		if std::path::Path::new(fallback).is_file() && !shells.iter().any(|s| s == fallback) {
			shells.push(fallback.to_string());
		}
	}
	shells
}

#[derive(Clone, Debug)]
pub struct SystemFont {
	pub family: String,
	pub is_mono: bool,
}

pub fn list_system_fonts() -> Vec<SystemFont> {
	static FONTS: OnceLock<Vec<SystemFont>> = OnceLock::new();
	FONTS.get_or_init(load_fonts).clone()
}

pub fn list_mono_fonts() -> Vec<String> {
	let mut fonts: Vec<String> = filter_fonts(&list_system_fonts(), false);
	if fonts.is_empty() {
		fonts = list_system_fonts().into_iter().map(|f| f.family).collect();
	}
	fonts
}

pub fn visible_font_families(show_all: bool) -> Vec<String> {
	if show_all {
		list_system_fonts().into_iter().map(|f| f.family).collect()
	} else {
		list_mono_fonts()
	}
}

pub fn filter_fonts(fonts: &[SystemFont], show_all: bool) -> Vec<String> {
	fonts
		.iter()
		.filter(|font| show_all || font.is_mono)
		.map(|font| font.family.clone())
		.collect()
}

fn load_fonts() -> Vec<SystemFont> {
	let mut db = fontdb::Database::new();
	db.load_system_fonts();
	let mut families = std::collections::BTreeMap::new();
	for face in db.faces() {
		for (family, _) in &face.families {
			let family = family.trim();
			if family.is_empty() {
				continue;
			}
			families
				.entry(family.to_string())
				.and_modify(|mono: &mut bool| *mono = *mono || face.monospaced)
				.or_insert(face.monospaced);
		}
	}
	families
		.into_iter()
		.map(|(family, is_mono)| SystemFont { family, is_mono })
		.collect()
}

pub fn list_system_sounds() -> Vec<String> {
	static SOUNDS: OnceLock<Vec<String>> = OnceLock::new();
	SOUNDS.get_or_init(load_sounds).clone()
}

pub fn play_system_sound(name: &str) -> Result<(), String> {
	if name.is_empty() {
		return Ok(());
	}
	play_sound_name(name)
}

pub fn send_notification(title: &str, body: &str) {
	if title.is_empty() {
		return;
	}
	#[cfg(target_os = "macos")]
	{
		let script = format!(
			"display notification {} with title {}",
			apple_script_string(body),
			apple_script_string(title)
		);
		let _ = std::process::Command::new("osascript").args(["-e", &script]).spawn();
	}
	#[cfg(target_os = "linux")]
	{
		let _ = std::process::Command::new("notify-send").args([title, body]).spawn();
	}
	#[cfg(target_os = "windows")]
	{
		let title = title.replace('\'', "''");
		let body = body.replace('\'', "''");
		let script = format!(
			"[void][Reflection.Assembly]::LoadWithPartialName('System.Windows.Forms'); $n = New-Object System.Windows.Forms.NotifyIcon; $n.Icon = [System.Drawing.SystemIcons]::Information; $n.Visible = $true; $n.ShowBalloonTip(4000, '{title}', '{body}', 'Info')"
		);
		let _ = std::process::Command::new("powershell")
			.args(["-NoProfile", "-Command", &script])
			.spawn();
	}
}

fn apple_script_string(value: &str) -> String {
	format!("\"{}\"", value.replace('\\', "\\\\").replace('"', "\\\""))
}

fn is_valid_sound_name(name: &str) -> bool {
	!name.is_empty() && !name.contains("..") && !name.contains('/') && !name.contains('\\')
}

fn load_sounds() -> Vec<String> {
	#[cfg(target_os = "macos")]
	{
		return list_macos_sounds();
	}
	#[cfg(target_os = "linux")]
	{
		return list_linux_sounds();
	}
	#[cfg(target_os = "windows")]
	{
		return list_windows_sounds();
	}
	#[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
	{
		Vec::new()
	}
}

fn play_sound_name(name: &str) -> Result<(), String> {
	#[cfg(target_os = "macos")]
	{
		return play_macos_sound(name);
	}
	#[cfg(target_os = "linux")]
	{
		return play_linux_sound(name);
	}
	#[cfg(target_os = "windows")]
	{
		return play_windows_sound(name);
	}
	#[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
	{
		let _ = name;
		Ok(())
	}
}

#[cfg(target_os = "macos")]
fn list_macos_sounds() -> Vec<String> {
	let mut sounds: Vec<String> = std::fs::read_dir("/System/Library/Sounds")
		.into_iter()
		.flatten()
		.filter_map(|entry| {
			let name = entry.ok()?.file_name().into_string().ok()?;
			name.strip_suffix(".aiff").map(|s| s.to_string())
		})
		.collect();
	sounds.sort();
	sounds
}

#[cfg(target_os = "macos")]
fn play_macos_sound(name: &str) -> Result<(), String> {
	if !is_valid_sound_name(name) {
		return Err(format!("Sound not found: {name}"));
	}
	let path = std::path::Path::new("/System/Library/Sounds").join(format!("{name}.aiff"));
	if !path.exists() {
		return Err(format!("Sound not found: {name}"));
	}
	std::process::Command::new("afplay")
		.arg(&path)
		.spawn()
		.map_err(|e| format!("Failed to play sound: {e}"))?;
	Ok(())
}

#[cfg(target_os = "linux")]
const LINUX_SOUND_EXTENSIONS: &[&str] = &["oga", "ogg", "wav", "aiff", "aif"];

#[cfg(target_os = "linux")]
fn list_linux_sounds() -> Vec<String> {
	use std::collections::BTreeSet;
	let mut sounds = BTreeSet::new();
	for root in linux_sound_roots() {
		collect_linux_sounds(&root, &mut sounds);
	}
	sounds.into_iter().collect()
}

#[cfg(target_os = "linux")]
fn play_linux_sound(name: &str) -> Result<(), String> {
	let path = find_linux_sound_file(name).ok_or_else(|| format!("Sound not found: {name}"))?;
	if command_in_path("canberra-gtk-play") {
		return spawn_player("canberra-gtk-play", &["-i", name]);
	}
	let path = path
		.to_str()
		.ok_or_else(|| format!("Sound path is not valid UTF-8: {}", path.display()))?;
	if command_in_path("pw-play") {
		return spawn_player("pw-play", &[path]);
	}
	if command_in_path("paplay") {
		return spawn_player("paplay", &[path]);
	}
	Err("No Linux sound player found.".into())
}

#[cfg(target_os = "linux")]
fn linux_sound_roots() -> Vec<std::path::PathBuf> {
	let mut dirs = Vec::new();
	if let Some(data_home) = std::env::var_os("XDG_DATA_HOME") {
		dirs.push(std::path::PathBuf::from(data_home));
	} else if let Some(home) = std::env::var_os("HOME") {
		dirs.push(std::path::PathBuf::from(home).join(".local/share"));
	}
	if let Some(data_dirs) = std::env::var_os("XDG_DATA_DIRS") {
		dirs.extend(std::env::split_paths(&data_dirs));
	} else {
		dirs.push(std::path::PathBuf::from("/usr/local/share"));
		dirs.push(std::path::PathBuf::from("/usr/share"));
	}
	dirs.into_iter()
		.map(|dir| dir.join("sounds"))
		.filter(|dir| dir.is_dir())
		.collect()
}

#[cfg(target_os = "linux")]
fn collect_linux_sounds(dir: &std::path::Path, sounds: &mut std::collections::BTreeSet<String>) {
	let Ok(entries) = std::fs::read_dir(dir) else {
		return;
	};
	for entry in entries.flatten() {
		let path = entry.path();
		if path.is_dir() {
			collect_linux_sounds(&path, sounds);
			continue;
		}
		if !is_linux_sound_file(&path) {
			continue;
		}
		if let Some(name) = path.file_stem().and_then(|name| name.to_str()) {
			sounds.insert(name.to_string());
		}
	}
}

#[cfg(target_os = "linux")]
fn find_linux_sound_file(name: &str) -> Option<std::path::PathBuf> {
	if !is_valid_sound_name(name) {
		return None;
	}
	for root in linux_sound_roots() {
		if let Some(path) = find_linux_sound_file_in_dir(&root, name) {
			return Some(path);
		}
	}
	None
}

#[cfg(target_os = "linux")]
fn find_linux_sound_file_in_dir(dir: &std::path::Path, name: &str) -> Option<std::path::PathBuf> {
	for entry in std::fs::read_dir(dir).ok()?.flatten() {
		let path = entry.path();
		if path.is_dir() {
			if let Some(found) = find_linux_sound_file_in_dir(&path, name) {
				return Some(found);
			}
			continue;
		}
		if is_linux_sound_file(&path) && path.file_stem().and_then(|stem| stem.to_str()) == Some(name) {
			return Some(path);
		}
	}
	None
}

#[cfg(target_os = "linux")]
fn is_linux_sound_file(path: &std::path::Path) -> bool {
	path.extension()
		.and_then(|extension| extension.to_str())
		.map(|extension| {
			LINUX_SOUND_EXTENSIONS
				.iter()
				.any(|allowed| extension.eq_ignore_ascii_case(allowed))
		})
		.unwrap_or(false)
}

#[cfg(target_os = "linux")]
fn command_in_path(command: &str) -> bool {
	command_exists(command)
}

#[cfg(target_os = "linux")]
fn spawn_player(program: &str, args: &[&str]) -> Result<(), String> {
	std::process::Command::new(program)
		.args(args)
		.spawn()
		.map_err(|e| format!("Failed to play sound: {e}"))?;
	Ok(())
}

#[cfg(target_os = "windows")]
fn windows_sounds_dir() -> std::path::PathBuf {
	std::path::PathBuf::from(r"C:\Windows\Media")
}

#[cfg(target_os = "windows")]
fn list_windows_sounds() -> Vec<String> {
	use std::collections::BTreeSet;
	let mut sounds = BTreeSet::new();
	collect_windows_sounds(&windows_sounds_dir(), &mut sounds);
	sounds.into_iter().collect()
}

#[cfg(target_os = "windows")]
fn collect_windows_sounds(dir: &std::path::Path, sounds: &mut std::collections::BTreeSet<String>) {
	let Ok(entries) = std::fs::read_dir(dir) else {
		return;
	};
	for entry in entries.flatten() {
		let path = entry.path();
		if path.is_dir() {
			collect_windows_sounds(&path, sounds);
			continue;
		}
		if path
			.extension()
			.and_then(|e| e.to_str())
			.is_some_and(|e| e.eq_ignore_ascii_case("wav"))
		{
			if let Some(name) = path.file_stem().and_then(|s| s.to_str()) {
				sounds.insert(name.to_string());
			}
		}
	}
}

#[cfg(target_os = "windows")]
fn play_windows_sound(name: &str) -> Result<(), String> {
	if !is_valid_sound_name(name) {
		return Err(format!("Sound not found: {name}"));
	}
	let path = find_windows_sound_file(name).ok_or_else(|| format!("Sound not found: {name}"))?;
	std::process::Command::new("powershell")
		.args([
			"-NoProfile",
			"-Command",
			&format!("(New-Object Media.SoundPlayer '{}').PlaySync()", path.display()),
		])
		.spawn()
		.map_err(|e| format!("Failed to play sound: {e}"))?;
	Ok(())
}

#[cfg(target_os = "windows")]
fn find_windows_sound_file(name: &str) -> Option<std::path::PathBuf> {
	fn walk(dir: &std::path::Path, name: &str) -> Option<std::path::PathBuf> {
		for entry in std::fs::read_dir(dir).ok()?.flatten() {
			let path = entry.path();
			if path.is_dir() {
				if let Some(found) = walk(&path, name) {
					return Some(found);
				}
			} else if path.file_stem().and_then(|s| s.to_str()) == Some(name) {
				return Some(path);
			}
		}
		None
	}
	walk(&windows_sounds_dir(), name)
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn empty_command_does_not_exist() {
		assert!(!command_exists(""));
	}

	#[test]
	fn sh_or_bash_exists_on_unix() {
		assert!(command_exists("sh") || std::path::Path::new("/bin/sh").is_file());
	}

	#[test]
	fn list_shells_includes_a_real_shell() {
		let shells = list_shells();
		assert!(
			shells
				.iter()
				.any(|s| s.ends_with("/sh") || s.ends_with("/bash") || s.ends_with("/zsh")),
			"{shells:?}"
		);
	}

	#[test]
	fn apple_script_string_escapes_quotes() {
		assert_eq!(apple_script_string(r#"say "hi""#), r#""say \"hi\"""#);
	}

	#[test]
	fn filter_fonts_respects_show_all() {
		let fonts = [
			SystemFont {
				family: "Menlo".into(),
				is_mono: true,
			},
			SystemFont {
				family: "Inter".into(),
				is_mono: false,
			},
		];
		assert_eq!(filter_fonts(&fonts, false), vec!["Menlo".to_string()]);
		assert_eq!(
			filter_fonts(&fonts, true),
			vec!["Menlo".to_string(), "Inter".to_string()]
		);
	}
}
