use std::path::{Path, PathBuf};

use model::error::AppError;

// 2code's own init scripts.
// `common` is POSIX-sh compatible — works in bash and zsh (notify hook, claude wrapper, PATH).
// `zsh` is zsh-only (zle keybindings, unsetopt).
const DEFAULT_INIT_COMMON: &str =
	include_str!("../scripts/default_init_common.sh");
const DEFAULT_INIT_ZSH: &str = include_str!("../scripts/default_init_zsh.sh");

// VS Code shell integration scripts (MIT licensed, from microsoft/vscode)
const VSC_BASH: &str = include_str!("../scripts/shellIntegration-bash.sh");
const VSC_ZSH_RC: &str = include_str!("../scripts/shellIntegration-rc.zsh");
const VSC_ZSH_ENV: &str = include_str!("../scripts/shellIntegration-env.zsh");
const VSC_ZSH_PROFILE: &str =
	include_str!("../scripts/shellIntegration-profile.zsh");
const VSC_ZSH_LOGIN: &str =
	include_str!("../scripts/shellIntegration-login.zsh");
const VSC_FISH: &str = include_str!("../scripts/shellIntegration.fish");
const VSC_PWSH: &str = include_str!("../scripts/shellIntegration.ps1");

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ShellType {
	Zsh,
	Bash,
	Fish,
	Pwsh,
	Unknown,
}

/// Extract just the executable path from a shell command string, handling paths with spaces.
/// E.g. `"C:\Program Files\PowerShell\7\pwsh.exe -NoLogo -NoProfile"` → `"C:\Program Files\PowerShell\7\pwsh.exe"`
pub(crate) fn extract_exe(cmd: &str) -> String {
	let cmd = cmd.trim();
	let parts: Vec<&str> = cmd.split_whitespace().collect();
	if parts.is_empty() {
		return cmd.to_string();
	}
	let first = parts[0];
	let looks_like_path = (first.len() >= 2 && first.as_bytes()[1] == b':')
		|| first.contains('/')
		|| first.contains('\\');
	if !looks_like_path || parts.len() == 1 {
		return first.to_string();
	}
	let mut end_idx = 1;
	while end_idx < parts.len() {
		let candidate = parts[..=end_idx].join(" ");
		let lower = candidate.to_lowercase();
		if lower.ends_with(".exe")
			|| lower.ends_with(".bat")
			|| lower.ends_with(".cmd")
			|| lower.ends_with(".ps1")
			|| lower.ends_with(".sh")
			|| Path::new(&candidate).exists()
		{
			end_idx += 1;
			break;
		}
		end_idx += 1;
		if end_idx > 6 {
			break;
		}
	}
	if end_idx > parts.len() {
		end_idx = parts
			.iter()
			.position(|p| p.starts_with('-'))
			.unwrap_or(parts.len());
		if end_idx == 0 {
			end_idx = 1;
		}
	}
	parts[..end_idx].join(" ")
}

/// Detect shell type from the shell command string.
pub fn detect_shell_type(shell_cmd: &str) -> ShellType {
	let exe = extract_exe(shell_cmd);
	let basename = Path::new(&exe)
		.file_stem()
		.and_then(|s| s.to_str())
		.unwrap_or(&exe)
		.to_lowercase();

	match basename.as_str() {
		"zsh" => ShellType::Zsh,
		"bash" => ShellType::Bash,
		"sh" => ShellType::Unknown,
		"fish" => ShellType::Fish,
		"pwsh" | "powershell" => ShellType::Pwsh,
		_ => ShellType::Unknown,
	}
}

/// Result of preparing shell injection — tells the PTY layer what args/env to set.
#[derive(Debug)]
pub enum ShellInjection {
	/// Zsh: set ZDOTDIR to this dir (contains .zshrc, .zshenv, .zprofile, .zlogin)
	Zsh {
		zdotdir: PathBuf,
		user_zdotdir: String,
	},
	/// Bash: pass `--init-file <path>` to bash
	Bash { init_file: PathBuf },
	/// Fish: pass `--init-command 'source "<path>"'`
	Fish { init_script: PathBuf },
	/// Pwsh: pass `-noexit -command '. "<path>"'`
	Pwsh { init_script: PathBuf },
	/// Unknown shell — no injection, just run as-is
	None,
}

/// Prepare shell integration injection for the given shell type.
/// This writes the necessary scripts to a temp directory and returns
/// an injection descriptor telling the PTY layer what to do.
pub fn prepare_shell_injection(
	session_id: &str,
	shell_type: ShellType,
	project_init_scripts: &[String],
) -> Result<ShellInjection, AppError> {
	let dir = std::env::temp_dir().join(format!("2code-init-{session_id}"));
	std::fs::create_dir_all(&dir)?;

	match shell_type {
		ShellType::Zsh => prepare_zsh(&dir, project_init_scripts),
		ShellType::Bash => prepare_bash(&dir, project_init_scripts),
		ShellType::Fish => prepare_fish(&dir, project_init_scripts),
		ShellType::Pwsh => prepare_pwsh(&dir, project_init_scripts),
		ShellType::Unknown => Ok(ShellInjection::None),
	}
}

/// Zsh: VS Code's approach — set ZDOTDIR to a temp dir containing the integration scripts.
/// The .zshenv sources the user's real .zshenv, .zshrc sources the user's real .zshrc,
/// and both inject shell integration hooks.
fn prepare_zsh(
	dir: &Path,
	project_init_scripts: &[String],
) -> Result<ShellInjection, AppError> {
	// Write VS Code's zsh scripts into the ZDOTDIR
	std::fs::write(dir.join(".zshenv"), VSC_ZSH_ENV)?;
	std::fs::write(dir.join(".zprofile"), VSC_ZSH_PROFILE)?;
	std::fs::write(dir.join(".zlogin"), VSC_ZSH_LOGIN)?;

	// For .zshrc: append 2code's own init (common: claude wrapper + PATH; zsh: keybindings)
	// and project scripts after VS Code's shell integration.
	let project_init = project_init_scripts.join("\n");
	let zshrc = format!(
        "{vsc_rc}\n\n# === 2code common init ===\n{common}\n\n# === 2code zsh init ===\n{zsh_only}\n\n# === 2code project init ===\n{project_init}\n",
        vsc_rc = VSC_ZSH_RC,
        common = DEFAULT_INIT_COMMON.trim_end(),
        zsh_only = DEFAULT_INIT_ZSH.trim_end(),
        project_init = project_init.trim_end(),
    );
	std::fs::write(dir.join(".zshrc"), zshrc)?;

	let user_zdotdir = std::env::var("ZDOTDIR")
		.or_else(|_| std::env::var("HOME"))
		.unwrap_or_else(|_| "~".to_string());

	Ok(ShellInjection::Zsh {
		zdotdir: dir.to_path_buf(),
		user_zdotdir,
	})
}

/// Bash: VS Code's approach — use `--init-file` to point to the integration script.
/// The script itself sources ~/.bashrc when VSCODE_INJECTION=1.
fn prepare_bash(
	dir: &Path,
	project_init_scripts: &[String],
) -> Result<ShellInjection, AppError> {
	// Write VS Code's bash script, then append 2code's common init + project init.
	// (zsh-only parts like zle keybindings are not included.)
	let project_init = project_init_scripts.join("\n");
	let script = format!(
        "{vsc_bash}\n\n# === 2code common init ===\n{common}\n\n# === 2code project init ===\n{project_init}\n",
        vsc_bash = VSC_BASH,
        common = DEFAULT_INIT_COMMON.trim_end(),
        project_init = project_init.trim_end(),
    );

	let init_file = dir.join("shellIntegration-bash.sh");
	std::fs::write(&init_file, script)?;

	Ok(ShellInjection::Bash { init_file })
}

/// Fish: VS Code's approach — use `--init-command 'source "<path>"'`.
fn prepare_fish(
	dir: &Path,
	project_init_scripts: &[String],
) -> Result<ShellInjection, AppError> {
	let init_script = dir.join("shellIntegration.fish");
	let project_init = project_init_scripts.join("\n");
	let script = format!(
		"{vsc}\n\n# === 2code project init ===\n{project_init}\n",
		vsc = VSC_FISH,
		project_init = project_init.trim_end(),
	);
	std::fs::write(&init_script, script)?;
	Ok(ShellInjection::Fish { init_script })
}

/// Pwsh: VS Code's approach — use `-noexit -command '. "<path>"'`.
fn prepare_pwsh(
	dir: &Path,
	project_init_scripts: &[String],
) -> Result<ShellInjection, AppError> {
	let init_script = dir.join("shellIntegration.ps1");
	let project_init = project_init_scripts.join("\n");
	let script = format!(
		"{vsc}\n\n# === 2code project init ===\n{project_init}\n",
		vsc = VSC_PWSH,
		project_init = project_init.trim_end(),
	);
	std::fs::write(&init_script, script)?;
	Ok(ShellInjection::Pwsh { init_script })
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn detect_zsh() {
		assert_eq!(detect_shell_type("/bin/zsh"), ShellType::Zsh);
		assert_eq!(detect_shell_type("/usr/bin/zsh"), ShellType::Zsh);
	}

	#[test]
	fn detect_bash() {
		assert_eq!(detect_shell_type("/bin/bash"), ShellType::Bash);
		assert_eq!(detect_shell_type("bash"), ShellType::Bash);
	}

	#[test]
	fn detect_fish() {
		assert_eq!(detect_shell_type("/usr/bin/fish"), ShellType::Fish);
	}

	#[test]
	fn detect_pwsh() {
		assert_eq!(detect_shell_type("pwsh"), ShellType::Pwsh);
		assert_eq!(
			detect_shell_type("powershell.exe -NoLogo"),
			ShellType::Pwsh
		);
	}

	#[test]
	fn detect_unknown() {
		assert_eq!(detect_shell_type("nushell"), ShellType::Unknown);
	}

	#[test]
	fn prepare_bash_creates_init_file() {
		let inj = prepare_shell_injection("test-bash-1", ShellType::Bash, &[])
			.unwrap();
		match inj {
			ShellInjection::Bash { init_file } => {
				assert!(init_file.exists());
				let content = std::fs::read_to_string(&init_file).unwrap();
				assert!(content.contains("VSCODE_SHELL_INTEGRATION"));
				assert!(content.contains("2code common init"));
				assert!(content.contains("_2CODE_HOME"));
				// zsh-only stuff must NOT leak into bash
				assert!(!content.contains("bindkey"));
				assert!(!content.contains("unsetopt"));
				// cleanup
				std::fs::remove_dir_all(init_file.parent().unwrap()).ok();
			}
			_ => panic!("Expected Bash injection"),
		}
	}

	#[test]
	fn prepare_zsh_creates_all_dotfiles() {
		let inj = prepare_shell_injection(
			"test-zsh-1",
			ShellType::Zsh,
			&["echo HELLO".to_string()],
		)
		.unwrap();
		match inj {
			ShellInjection::Zsh { zdotdir, .. } => {
				assert!(zdotdir.join(".zshenv").exists());
				assert!(zdotdir.join(".zshrc").exists());
				assert!(zdotdir.join(".zprofile").exists());
				assert!(zdotdir.join(".zlogin").exists());
				let rc =
					std::fs::read_to_string(zdotdir.join(".zshrc")).unwrap();
				assert!(rc.contains("VSCODE_SHELL_INTEGRATION"));
				assert!(rc.contains("echo HELLO"));
				assert!(rc.contains("2code common init"));
				assert!(rc.contains("2code zsh init"));
				assert!(rc.contains("_2CODE_HOME")); // common
				assert!(rc.contains("bindkey '^J'")); // zsh-only
				std::fs::remove_dir_all(&zdotdir).ok();
			}
			_ => panic!("Expected Zsh injection"),
		}
	}

	#[test]
	fn prepare_fish_creates_script() {
		let inj = prepare_shell_injection("test-fish-1", ShellType::Fish, &[])
			.unwrap();
		match inj {
			ShellInjection::Fish { init_script } => {
				assert!(init_script.exists());
				std::fs::remove_dir_all(init_script.parent().unwrap()).ok();
			}
			_ => panic!("Expected Fish injection"),
		}
	}
}
