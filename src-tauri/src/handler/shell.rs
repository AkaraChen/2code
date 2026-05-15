use serde::Serialize;
use std::collections::HashSet;
use std::path::Path;

#[derive(Debug, Serialize, Clone)]
pub struct AvailableShell {
	pub label: String,
	pub command: String,
	pub is_default: bool,
}

fn shell_label(command: &str) -> String {
	command.to_string()
}

fn push_shell(
	shells: &mut Vec<AvailableShell>,
	seen: &mut HashSet<String>,
	command: impl Into<String>,
	default_command: &str,
) {
	let command = command.into();
	if command.trim().is_empty() || !seen.insert(command.clone()) {
		return;
	}

	shells.push(AvailableShell {
		label: shell_label(&command),
		is_default: command == default_command,
		command,
	});
}

#[cfg(unix)]
fn command_exists(command: &str) -> bool {
	Path::new(command).is_file()
}

#[cfg(unix)]
fn push_existing_shell(
	shells: &mut Vec<AvailableShell>,
	seen: &mut HashSet<String>,
	command: &str,
	default_command: &str,
) {
	let command = command.trim();
	if command.is_empty() || command.starts_with('#') || seen.contains(command)
	{
		return;
	}
	if command_exists(command) {
		push_shell(shells, seen, command, default_command);
	}
}

#[cfg(windows)]
fn command_exists(_command: &str) -> bool {
	true
}

#[cfg(target_os = "linux")]
fn default_shell_command() -> String {
	std::env::var("SHELL")
		.ok()
		.filter(|shell| command_exists(shell))
		.unwrap_or_else(|| "/bin/bash".to_string())
}

#[cfg(target_os = "macos")]
fn default_shell_command() -> String {
	"/bin/zsh".to_string()
}

#[cfg(windows)]
fn default_shell_command() -> String {
	"powershell.exe -NoLogo -NoProfile".to_string()
}

#[cfg(all(not(target_os = "linux"), not(target_os = "macos"), not(windows)))]
fn default_shell_command() -> String {
	std::env::var("SHELL")
		.ok()
		.filter(|shell| command_exists(shell))
		.unwrap_or_else(|| "/bin/sh".to_string())
}

#[cfg(unix)]
fn load_unix_shells(default_command: &str) -> Vec<AvailableShell> {
	let mut shells = Vec::new();
	let mut seen = HashSet::new();

	push_shell(&mut shells, &mut seen, default_command, default_command);

	if let Ok(contents) = std::fs::read_to_string("/etc/shells") {
		for line in contents.lines() {
			push_existing_shell(&mut shells, &mut seen, line, default_command);
		}
	}

	for command in [
		"/bin/bash",
		"/usr/bin/bash",
		"/bin/zsh",
		"/usr/bin/zsh",
		"/bin/fish",
		"/usr/bin/fish",
		"/bin/sh",
		"/usr/bin/sh",
	] {
		push_existing_shell(&mut shells, &mut seen, command, default_command);
	}

	shells
}

#[cfg(windows)]
fn load_windows_shells(default_command: &str) -> Vec<AvailableShell> {
	let mut shells = Vec::new();
	let mut seen = HashSet::new();
	push_shell(
		&mut shells,
		&mut seen,
		"powershell.exe -NoLogo -NoProfile",
		default_command,
	);
	push_shell(&mut shells, &mut seen, "cmd.exe", default_command);
	shells
}

fn load_available_shells() -> Vec<AvailableShell> {
	let default_command = default_shell_command();

	#[cfg(windows)]
	{
		load_windows_shells(&default_command)
	}

	#[cfg(unix)]
	{
		load_unix_shells(&default_command)
	}

	#[cfg(not(any(unix, windows)))]
	{
		let mut shells = Vec::new();
		let mut seen = HashSet::new();
		push_shell(
			&mut shells,
			&mut seen,
			default_command.clone(),
			&default_command,
		);
		shells
	}
}

#[tauri::command]
pub async fn list_available_shells() -> Vec<AvailableShell> {
	tauri::async_runtime::spawn_blocking(load_available_shells)
		.await
		.unwrap_or_default()
}
