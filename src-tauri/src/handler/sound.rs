#[cfg(target_os = "macos")]
const SOUNDS_DIR: &str = "/System/Library/Sounds";

#[cfg(target_os = "linux")]
const LINUX_SOUND_EXTENSIONS: &[&str] = &["oga", "ogg", "wav", "aiff", "aif"];

#[tauri::command]
pub fn list_system_sounds() -> Vec<String> {
	#[cfg(target_os = "macos")]
	{
		return list_macos_sounds();
	}

	#[cfg(target_os = "linux")]
	{
		return list_linux_sounds();
	}

	#[cfg(not(any(target_os = "macos", target_os = "linux")))]
	{
		Vec::new()
	}
}

#[tauri::command]
pub fn play_system_sound(name: String) -> Result<(), String> {
	play_sound_name(&name)
}

pub fn play_sound_name(name: &str) -> Result<(), String> {
	#[cfg(target_os = "macos")]
	{
		return play_macos_sound(name);
	}

	#[cfg(target_os = "linux")]
	{
		return play_linux_sound(name);
	}

	#[cfg(not(any(target_os = "macos", target_os = "linux")))]
	{
		let _ = name;
		Ok(())
	}
}

pub fn try_play_system_sound(name: &str) -> bool {
	if name.is_empty() {
		return false;
	}

	#[cfg(any(target_os = "macos", target_os = "linux"))]
	{
		play_sound_name(name).is_ok()
	}

	#[cfg(not(any(target_os = "macos", target_os = "linux")))]
	{
		let _ = name;
		false
	}
}

#[cfg(target_os = "macos")]
fn list_macos_sounds() -> Vec<String> {
	use std::fs;
	use std::path::Path;

	let sounds_path = Path::new(SOUNDS_DIR);
	let mut sounds: Vec<String> = fs::read_dir(sounds_path)
		.into_iter()
		.flatten()
		.filter_map(|entry| {
			let entry = entry.ok()?;
			let name = entry.file_name().into_string().ok()?;
			name.strip_suffix(".aiff").map(|s| s.to_string())
		})
		.collect();
	sounds.sort();
	sounds
}

#[cfg(target_os = "macos")]
fn play_macos_sound(name: &str) -> Result<(), String> {
	use std::path::Path;
	use std::process::Command;

	let path = Path::new(SOUNDS_DIR).join(format!("{name}.aiff"));
	if !path.exists() {
		return Err(format!("Sound not found: {name}"));
	}
	Command::new("afplay")
		.arg(&path)
		.spawn()
		.map_err(|e| format!("Failed to play sound: {e}"))?;
	Ok(())
}

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
	let path = find_linux_sound_file(name)
		.ok_or_else(|| format!("Sound not found: {name}"))?;

	if command_in_path("canberra-gtk-play") {
		return spawn_player("canberra-gtk-play", &["-i", name]);
	}

	let path = path.to_str().ok_or_else(|| {
		format!("Sound path is not valid UTF-8: {}", path.display())
	})?;

	if command_in_path("pw-play") {
		return spawn_player("pw-play", &[path]);
	}

	if command_in_path("paplay") {
		return spawn_player("paplay", &[path]);
	}

	Err(
		"No Linux sound player found. Install libcanberra, PipeWire, or PulseAudio tools."
			.to_string(),
	)
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
fn collect_linux_sounds(
	dir: &std::path::Path,
	sounds: &mut std::collections::BTreeSet<String>,
) {
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
	if name.is_empty() || name.contains('/') || name.contains('\\') {
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
fn find_linux_sound_file_in_dir(
	dir: &std::path::Path,
	name: &str,
) -> Option<std::path::PathBuf> {
	let entries = std::fs::read_dir(dir).ok()?;

	for entry in entries.flatten() {
		let path = entry.path();
		if path.is_dir() {
			if let Some(path) = find_linux_sound_file_in_dir(&path, name) {
				return Some(path);
			}
			continue;
		}

		if !is_linux_sound_file(&path) {
			continue;
		}

		if path.file_stem().and_then(|stem| stem.to_str()) == Some(name) {
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
	std::env::var_os("PATH")
		.map(|paths| {
			std::env::split_paths(&paths)
				.any(|path| path.join(command).is_file())
		})
		.unwrap_or(false)
}

#[cfg(target_os = "linux")]
fn spawn_player(program: &str, args: &[&str]) -> Result<(), String> {
	std::process::Command::new(program)
		.args(args)
		.spawn()
		.map_err(|e| format!("Failed to play sound: {e}"))?;
	Ok(())
}

#[cfg(test)]
mod tests {
	use super::*;

	#[cfg(target_os = "macos")]
	#[test]
	fn play_nonexistent_sound_returns_error() {
		let result = play_system_sound("definitely_not_a_real_sound".into());
		assert!(result.is_err());
		let err = result.unwrap_err();
		assert!(err.contains("Sound not found"));
	}

	#[cfg(target_os = "macos")]
	#[test]
	fn list_system_sounds_is_sorted() {
		let sounds = list_system_sounds();
		if sounds.len() >= 2 {
			for pair in sounds.windows(2) {
				assert!(
					pair[0] <= pair[1],
					"not sorted: {} > {}",
					pair[0],
					pair[1]
				);
			}
		}
	}

	#[cfg(target_os = "macos")]
	#[test]
	fn list_system_sounds_no_aiff_extension() {
		let sounds = list_system_sounds();
		for name in &sounds {
			assert!(
				!name.ends_with(".aiff"),
				"sound name should not have .aiff extension: {name}"
			);
		}
	}

	#[cfg(target_os = "linux")]
	#[test]
	fn linux_sound_names_are_sorted_and_extensionless() {
		let sounds = list_system_sounds();

		for pair in sounds.windows(2) {
			assert!(
				pair[0] <= pair[1],
				"not sorted: {} > {}",
				pair[0],
				pair[1]
			);
		}

		for name in &sounds {
			assert!(
				!name.contains('.'),
				"sound name includes extension: {name}"
			);
		}
	}

	#[cfg(not(any(target_os = "macos", target_os = "linux")))]
	#[test]
	fn unsupported_platform_sound_commands_are_noops() {
		assert!(list_system_sounds().is_empty());
		assert!(play_system_sound("anything".into()).is_ok());
		assert!(!try_play_system_sound("anything"));
	}
}
