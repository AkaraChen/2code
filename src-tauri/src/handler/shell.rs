#[cfg(windows)]
use infra::no_window::command_without_windows_console;
use serde::Serialize;
use std::collections::HashSet;
use std::path::Path;
use std::sync::OnceLock;

#[derive(Debug, Serialize, Clone)]
pub struct AvailableShell {
	pub label: String,
	pub command: String,
	pub is_default: bool,
}

static AVAILABLE_SHELLS: OnceLock<Vec<AvailableShell>> = OnceLock::new();

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

/// An App Execution Alias (`%LOCALAPPDATA%\Microsoft\WindowsApps\*.exe`) is a
/// zero-byte reparse point whose `IO_REPARSE_TAG_APPEXECLINK` is only honored
/// by the Windows shell/loader. portable_pty's ConPTY spawn path does not
/// resolve it, so spawning the alias path produces no child and the terminal
/// stays blank. We must skip these stubs in favor of the real binary.
#[cfg(windows)]
fn is_app_exec_alias_stub(path: &str) -> bool {
	let lower = path.to_lowercase().replace('/', "\\");
	if !lower.contains("\\microsoft\\windowsapps\\") {
		return false;
	}
	std::fs::metadata(path)
		.map(|m| m.len() == 0)
		.unwrap_or(false)
}

/// Parse a dotted version string (e.g. `"7.4.10"`) into a numeric vector for
/// correct ordering. Lexicographic string comparison misorders multi-digit
/// segments — `"7.4.10" < "7.4.9"` as strings, but `[7,4,10] > [7,4,9]`.
/// Non-numeric segments become 0, which is fine for the Store package naming
/// scheme we encounter here.
#[cfg(windows)]
fn parse_version(s: &str) -> Vec<u32> {
	s.split('.').map(|p| p.parse().unwrap_or(0)).collect()
}

/// Probe `C:\Program Files\WindowsApps` for a Microsoft Store install of pwsh.
/// Reading this directory often fails for standard users due to ACLs, so this
/// is best-effort — callers must handle `None`.
#[cfg(windows)]
fn find_store_pwsh() -> Option<String> {
	let store_root = Path::new(r"C:\Program Files\WindowsApps");
	let entries = std::fs::read_dir(store_root).ok()?;
	let mut best: Option<(Vec<u32>, String)> = None;
	for entry in entries.flatten() {
		let name = entry.file_name().to_string_lossy().into_owned();
		if !name.starts_with("Microsoft.PowerShell_") || !name.contains("_x64_")
		{
			continue;
		}
		let pwsh = entry.path().join("pwsh.exe");
		if !pwsh.is_file() {
			continue;
		}
		let version = parse_version(
			name.strip_prefix("Microsoft.PowerShell_")
				.and_then(|s| s.split("_x64_").next())
				.unwrap_or(""),
		);
		let pwsh_str = pwsh.to_string_lossy().into_owned();
		match &best {
			None => best = Some((version, pwsh_str)),
			Some((v, _)) if version > *v => best = Some((version, pwsh_str)),
			_ => {}
		}
	}
	best.map(|(_, p)| p)
}

#[cfg(windows)]
fn find_pwsh_path() -> Option<String> {
	let candidates = [
		r"C:\Program Files\PowerShell\7\pwsh.exe",
		r"C:\Program Files\PowerShell\7-preview\pwsh.exe",
		r"C:\Program Files (x86)\PowerShell\7\pwsh.exe",
	];
	for path in &candidates {
		if Path::new(path).exists() {
			return Some(path.to_string());
		}
	}
	if let Some(p) = find_store_pwsh() {
		return Some(p);
	}
	// Fallback: check PATH via `where`, skipping App Execution Alias stubs.
	let output = command_without_windows_console("where")
		.arg("pwsh")
		.output()
		.ok()?;
	if output.status.success() {
		let stdout = String::from_utf8_lossy(&output.stdout).into_owned();
		for line in stdout.lines() {
			let path = line.trim();
			if path.is_empty() || is_app_exec_alias_stub(path) {
				continue;
			}
			return Some(path.to_string());
		}
	}
	None
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
	if let Some(path) = find_pwsh_path() {
		format!("{} -NoLogo -NoProfile", path)
	} else {
		"powershell.exe -NoLogo -NoProfile".to_string()
	}
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
	// PowerShell 7 (pwsh) — preferred over 5.1
	if let Some(pwsh_path) = find_pwsh_path() {
		push_shell(
			&mut shells,
			&mut seen,
			format!("{} -NoLogo -NoProfile", pwsh_path),
			default_command,
		);
	}
	// Windows PowerShell 5.1
	push_shell(
		&mut shells,
		&mut seen,
		"powershell.exe -NoLogo -NoProfile",
		default_command,
	);
	// cmd
	push_shell(&mut shells, &mut seen, "cmd.exe", default_command);
	// Git Bash
	for path in &[
		r"C:\Program Files\Git\bin\bash.exe",
		r"C:\Program Files (x86)\Git\bin\bash.exe",
	] {
		if Path::new(path).exists() {
			push_shell(&mut shells, &mut seen, *path, default_command);
		}
	}
	// WSL
	let wsl = r"C:\Windows\System32\wsl.exe";
	if Path::new(wsl).exists() {
		push_shell(&mut shells, &mut seen, wsl, default_command);
	}
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

fn cached_available_shells() -> Vec<AvailableShell> {
	AVAILABLE_SHELLS.get_or_init(load_available_shells).clone()
}

#[tauri::command]
pub async fn list_available_shells() -> Vec<AvailableShell> {
	tauri::async_runtime::spawn_blocking(cached_available_shells)
		.await
		.unwrap_or_default()
}
