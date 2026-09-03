//! Best-effort system notification sound, ported from the old Tauri handler.

pub fn play_notification(name: &str) {
	let name = name.trim().to_string();
	if !is_safe_sound_name(&name) {
		return;
	}
	std::thread::spawn(move || {
		let _ = play_now(&name);
	});
}

pub fn is_safe_sound_name(name: &str) -> bool {
	!name.is_empty()
		&& !name.contains("..")
		&& !name.contains('/')
		&& !name.contains('\\')
}

fn play_now(name: &str) -> Result<(), String> {
	#[cfg(target_os = "macos")]
	{
		let path = format!("/System/Library/Sounds/{name}.aiff");
		std::process::Command::new("afplay")
			.arg(path)
			.spawn()
			.map_err(|error| error.to_string())?;
		return Ok(());
	}

	#[cfg(target_os = "linux")]
	{
		if command_exists("canberra-gtk-play") {
			let _ = std::process::Command::new("canberra-gtk-play")
				.args(["-i", name])
				.spawn();
			return Ok(());
		}
		for player in ["pw-play", "paplay", "aplay"] {
			if command_exists(player) {
				if let Some(path) = find_linux_sound(name) {
					let _ = std::process::Command::new(player).arg(path).spawn();
					return Ok(());
				}
			}
		}
		return Ok(());
	}

	#[cfg(target_os = "windows")]
	{
		let path = std::path::PathBuf::from(
			std::env::var_os("WINDIR").unwrap_or_else(|| r"C:\Windows".into()),
		)
		.join("Media")
		.join(format!("{name}.wav"));
		if path.is_file() {
			let _ = std::process::Command::new("powershell")
				.args(["-NoProfile", "-Command"])
				.arg("$player = New-Object Media.SoundPlayer $args[0]; $player.PlaySync()")
				.arg(path)
				.spawn();
		}
		return Ok(());
	}

	#[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
	{
		let _ = name;
		Ok(())
	}
}

#[cfg(target_os = "linux")]
fn command_exists(command: &str) -> bool {
	std::env::var_os("PATH")
		.map(|paths| {
			std::env::split_paths(&paths)
				.any(|dir| dir.join(command).is_file())
		})
		.unwrap_or(false)
}

#[cfg(target_os = "linux")]
fn find_linux_sound(name: &str) -> Option<std::path::PathBuf> {
	let mut roots = Vec::new();
	if let Some(home) = std::env::var_os("HOME") {
		roots.push(std::path::PathBuf::from(home).join(".local/share/sounds"));
	}
	roots.push(std::path::PathBuf::from("/usr/share/sounds"));
	for root in roots {
		if let Some(path) = walk_sound(&root, name) {
			return Some(path);
		}
	}
	None
}

#[cfg(target_os = "linux")]
fn walk_sound(dir: &std::path::Path, name: &str) -> Option<std::path::PathBuf> {
	for entry in std::fs::read_dir(dir).ok()?.flatten() {
		let path = entry.path();
		if path.is_dir() {
			if let Some(found) = walk_sound(&path, name) {
				return Some(found);
			}
		} else if path.file_stem().and_then(|stem| stem.to_str()) == Some(name) {
			return Some(path);
		}
	}
	None
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn rejects_path_like_sound_names() {
		assert!(!is_safe_sound_name("../Glass"));
		assert!(!is_safe_sound_name(""));
		assert!(is_safe_sound_name("message"));
	}
}
