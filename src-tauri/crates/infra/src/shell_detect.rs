use std::collections::HashSet;
use std::path::Path;

use serde::Serialize;

use crate::no_window::silent_command;

#[derive(Debug, Serialize, Clone)]
pub struct AvailableShell {
	pub label: String,
	pub command: String,
	pub is_default: bool,
	pub supports_integration: bool,
}

fn push_shell(
	shells: &mut Vec<AvailableShell>,
	seen: &mut HashSet<String>,
	command: impl Into<String>,
	default_command: &str,
	integration: bool,
	label: Option<&str>,
) {
	let command = command.into();
	if command.trim().is_empty() || !seen.insert(command.clone()) {
		return;
	}
	let label = label.unwrap_or(&command).to_string();
	shells.push(AvailableShell {
		label,
		is_default: command == default_command,
		supports_integration: integration,
		command,
	});
}

// ---------------------------------------------------------------------------
// Unix shell detection
// ---------------------------------------------------------------------------

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
		push_shell(shells, seen, command, default_command, true, None);
	}
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
	std::env::var("SHELL")
		.ok()
		.filter(|shell| command_exists(shell))
		.unwrap_or_else(|| "/bin/zsh".to_string())
}

#[cfg(unix)]
fn load_unix_shells(default_command: &str) -> Vec<AvailableShell> {
	let mut shells = Vec::new();
	let mut seen = HashSet::new();

	push_shell(
		&mut shells,
		&mut seen,
		default_command,
		default_command,
		true,
		None,
	);

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

// ---------------------------------------------------------------------------
// Windows shell detection
// ---------------------------------------------------------------------------

#[cfg(windows)]
fn default_shell_command() -> String {
	if let Some(pwsh_path) = find_pwsh_path() {
		format!("{} -NoLogo -NoProfile", pwsh_path)
	} else {
		"powershell.exe -NoLogo -NoProfile".to_string()
	}
}

/// Find the pwsh (PowerShell 7+) executable path.
/// Checks well-known install locations first (fast, no subprocess), then
/// falls back to `where pwsh` on PATH.
#[cfg(windows)]
pub fn find_pwsh_path() -> Option<String> {
	// Well-known install locations — check these first to avoid subprocess
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

	// Fallback: check PATH via `where`
	if let Ok(output) = silent_command("where").arg("pwsh").output() {
		if output.status.success() {
			let first = String::from_utf8_lossy(&output.stdout)
				.lines()
				.next()
				.unwrap_or("")
				.trim()
				.to_string();
			if !first.is_empty() {
				return Some(first);
			}
		}
	}

	None
}

/// Run `where <exe>` and return the first match, or None.
#[cfg(windows)]
fn find_on_path(exe: &str) -> Option<String> {
	let output = silent_command("where").arg(exe).output().ok()?;
	if !output.status.success() {
		return None;
	}
	String::from_utf8_lossy(&output.stdout)
		.lines()
		.next()
		.map(|s| s.trim().to_string())
		.filter(|s| !s.is_empty())
}

/// Detect installed WSL distributions by running `wsl -l -q`.
/// Returns a list of distro names (e.g. ["Ubuntu", "Debian"]).
/// `wsl -l -q` outputs UTF-16LE on Windows, so we decode accordingly.
#[cfg(windows)]
fn detect_wsl_distros() -> Vec<String> {
	let output = match silent_command("wsl").args(["-l", "-q"]).output() {
		Ok(o) if o.status.success() => o,
		_ => return Vec::new(),
	};

	// wsl -l -q outputs UTF-16LE (little-endian with BOM)
	let stdout = &output.stdout;
	if stdout.len() < 2 {
		return Vec::new();
	}

	// Try UTF-16LE decoding (skip BOM if present)
	let words: Vec<u16> = if stdout.len() >= 2
		&& stdout[0] == 0xFF
		&& stdout[1] == 0xFE
	{
		// Has BOM — skip first 2 bytes
		stdout[2..]
			.chunks_exact(2)
			.map(|c| u16::from_le_bytes([c[0], c[1]]))
			.collect()
	} else {
		stdout
			.chunks_exact(2)
			.map(|c| u16::from_le_bytes([c[0], c[1]]))
			.collect()
	};

	let text = String::from_utf16_lossy(&words);
	text.lines()
		.map(|l| l.trim().to_string())
		.filter(|l| !l.is_empty())
		.collect()
}

#[cfg(windows)]
fn load_windows_shells(default_command: &str) -> Vec<AvailableShell> {
	let mut shells = Vec::new();
	let mut seen = HashSet::new();

	// 1. pwsh (PowerShell 7+) — preferred default
	if let Some(pwsh_path) = find_pwsh_path() {
		push_shell(
			&mut shells,
			&mut seen,
			format!("{} -NoLogo -NoProfile", pwsh_path),
			default_command,
			true,
			Some("PowerShell 7"),
		);
	}

	// 2. powershell.exe (Windows PowerShell 5.x) — always present on Windows
	push_shell(
		&mut shells,
		&mut seen,
		"powershell.exe -NoLogo -NoProfile",
		default_command,
		true,
		Some("Windows PowerShell"),
	);

	// 3. cmd.exe — no shell integration
	push_shell(
		&mut shells,
		&mut seen,
		"cmd.exe",
		default_command,
		false,
		Some("Command Prompt"),
	);

	// 4. Git Bash — check well-known paths, then PATH
	let git_bash_candidates = [
		r"C:\Program Files\Git\bin\bash.exe",
		r"C:\Program Files (x86)\Git\bin\bash.exe",
	];
	for path in &git_bash_candidates {
		if Path::new(path).exists() {
			push_shell(
				&mut shells,
				&mut seen,
				*path,
				default_command,
				true,
				Some("Git Bash"),
			);
		}
	}
	if !seen.iter().any(|s| s.contains("Git")) {
		if let Some(bash) = find_on_path("bash.exe") {
			if bash.to_lowercase().contains("git") {
				push_shell(
					&mut shells,
					&mut seen,
					bash,
					default_command,
					true,
					Some("Git Bash"),
				);
			}
		}
	}

	// 5. WSL — detect installed distros, each as a separate entry
	let distros = detect_wsl_distros();
	if distros.is_empty() {
		// No distros detected or wsl not available — still show raw wsl.exe if it exists
		let wsl = r"C:\Windows\System32\wsl.exe";
		if Path::new(wsl).exists() {
			push_shell(
				&mut shells,
				&mut seen,
				wsl,
				default_command,
				false,
				Some("WSL"),
			);
		}
	} else {
		for distro in &distros {
			let command = format!("wsl.exe -d {}", distro);
			let label = format!("{} (WSL)", distro);
			push_shell(
				&mut shells,
				&mut seen,
				command,
				default_command,
				false,
				Some(&label),
			);
		}
	}

	shells
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

pub fn load_available_shells() -> Vec<AvailableShell> {
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
			true,
			None,
		);
		shells
	}
}
