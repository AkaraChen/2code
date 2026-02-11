use std::fs;
use std::path::Path;
use std::process::Command;

const SOUNDS_DIR: &str = "/System/Library/Sounds";

#[tauri::command]
pub fn list_system_sounds() -> Vec<String> {
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

#[tauri::command]
pub fn play_system_sound(name: String) -> Result<(), String> {
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
