use std::path::{Path, PathBuf};

use model::error::AppError;

// 2code's own init scripts.
// `common` is POSIX-sh compatible — works in bash and zsh (notify hook, claude wrapper, PATH).
// `zsh` is zsh-only (zle keybindings, unsetopt).
// `fish` and `pwsh` only set env vars and PATH; file creation is done by setup_2code_home().
const DEFAULT_INIT_COMMON: &str =
	include_str!("../scripts/default_init_common.sh");
const DEFAULT_INIT_ZSH: &str = include_str!("../scripts/default_init_zsh.sh");
const DEFAULT_INIT_FISH: &str =
	include_str!("../scripts/default_init_fish.fish");
const DEFAULT_INIT_PWSH: &str =
	include_str!("../scripts/default_init_pwsh.ps1");

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
	let mut found = false;
	while end_idx < parts.len() {
		let candidate = parts[..=end_idx].join(" ");
		let lower = candidate.to_lowercase();
		if lower.ends_with(".exe")
			|| lower.ends_with(".bat")
			|| lower.ends_with(".cmd")
			|| lower.ends_with(".ps1")
			|| lower.ends_with(".sh")
			|| Path::new(&candidate).is_file()
		{
			end_idx += 1;
			found = true;
			break;
		}
		end_idx += 1;
		if end_idx > 6 {
			break;
		}
	}
	if !found {
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
	let executable_name = exe
		.rsplit(['/', '\\'])
		.next()
		.filter(|name| !name.is_empty())
		.unwrap_or(&exe);
	let basename = Path::new(executable_name)
		.file_stem()
		.and_then(|s| s.to_str())
		.unwrap_or(executable_name)
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

/// Write the 2code home directory files (notify hook, claude wrapper, settings JSON)
/// so that fish and pwsh sessions have them available without running a bash script.
/// Skipped silently if HOME is unset or any I/O fails.
fn setup_2code_home() {
	let home = std::env::var("HOME")
		.ok()
		.filter(|h| !h.is_empty())
		.or_else(|| std::env::var("USERPROFILE").ok().filter(|h| !h.is_empty()))
		.or_else(|| {
			let drive =
				std::env::var("HOMEDRIVE").ok().filter(|d| !d.is_empty());
			let path = std::env::var("HOMEPATH").ok().filter(|p| !p.is_empty());
			match (drive, path) {
				(Some(d), Some(p)) => Some(format!("{d}{p}")),
				_ => None,
			}
		});
	let home = match home {
		Some(h) => PathBuf::from(h),
		None => return,
	};
	let hooks = home.join(".2code/hooks");
	let bin = home.join(".2code/bin");
	if std::fs::create_dir_all(&hooks).is_err()
		|| std::fs::create_dir_all(&bin).is_err()
	{
		return;
	}

	let notify = hooks.join("notify.sh");
	if !notify.exists() {
		let _ = std::fs::write(
			&notify,
			"#!/bin/bash\n[[ -z \"$_2CODE_HELPER\" ]] && exit 0\n\"$_2CODE_HELPER\" notify &>/dev/null &\n",
		);
		#[cfg(unix)]
		{
			use std::os::unix::fs::PermissionsExt;
			if let Ok(meta) = std::fs::metadata(&notify) {
				let mut perms = meta.permissions();
				perms.set_mode(0o755);
				let _ = std::fs::set_permissions(&notify, perms);
			}
		}
	}

	let settings = hooks.join("claude-settings.json");
	if !settings.exists() {
		let notify_str = notify.to_string_lossy().to_string();
		let json = serde_json::json!({
			"hooks": {
				"Stop": [{ "hooks": [{ "type": "command", "command": &notify_str }] }],
				"PermissionRequest": [{ "matcher": "*", "hooks": [{ "type": "command", "command": &notify_str }] }]
			}
		});
		if let Ok(content) = serde_json::to_string(&json) {
			let _ = std::fs::write(&settings, content);
		}
	}

	let wrapper = bin.join("claude");
	if !wrapper.exists() {
		let settings_str = settings.to_string_lossy();
		let script = format!(
			concat!(
				"#!/bin/bash\n",
				"_SETTINGS=\"{s}\"\n",
				"_find_real() {{\n",
				"  local IFS=:\n",
				"  for dir in $PATH; do\n",
				"    [ -z \"$dir\" ] && continue\n",
				"    case \"${{dir%/}}\" in\n",
				"      \"$HOME/.2code/bin\") continue ;;\n",
				"    esac\n",
				"    if [ -x \"$dir/claude\" ] && [ ! -d \"$dir/claude\" ]; then\n",
				"      printf '%s\\n' \"$dir/claude\"\n",
				"      return 0\n",
				"    fi\n",
				"  done\n",
				"  return 1\n",
				"}}\n",
				"_REAL=\"$(_find_real)\"\n",
				"if [ -z \"$_REAL\" ]; then\n",
				"  echo \"2code: claude not found in PATH\" >&2\n",
				"  exit 127\n",
				"fi\n",
				"exec \"$_REAL\" --settings \"$_SETTINGS\" \"$@\"\n",
			),
			s = settings_str
		);
		let _ = std::fs::write(&wrapper, script);
		#[cfg(unix)]
		{
			use std::os::unix::fs::PermissionsExt;
			if let Ok(meta) = std::fs::metadata(&wrapper) {
				let mut perms = meta.permissions();
				perms.set_mode(0o755);
				let _ = std::fs::set_permissions(&wrapper, perms);
			}
		}
	}

	// Windows: PowerShell/CMD cannot execute extensionless files from PATH.
	// Create a claude.cmd batch wrapper alongside the bash script.
	#[cfg(windows)]
	{
		let cmd_wrapper = bin.join("claude.cmd");
		if !cmd_wrapper.exists() {
			let settings_str = settings.to_string_lossy();
			let cmd_script = format!(
				concat!(
					"@echo off\r\n",
					"setlocal\r\n",
					"set \"_SETTINGS={s}\"\r\n",
					"for /f \"delims=\" %%d in ('where claude 2^>nul') do (\r\n",
					"    if /i not \"%%~dpd\"==\"%~dp0\" (\r\n",
					"        \"%%d\" --settings \"%_SETTINGS%\" %*\r\n",
					"        exit /b %ERRORLEVEL%\r\n",
					"    )\r\n",
					")\r\n",
					"echo 2code: claude not found in PATH >&2\r\n",
					"exit /b 127\r\n",
				),
				s = settings_str
			);
			let _ = std::fs::write(&cmd_wrapper, cmd_script);
		}
	}
}

/// Prepare shell integration injection for the given shell type.
/// This writes the necessary scripts to a temp directory and returns
/// an injection descriptor telling the PTY layer what to do.
pub fn prepare_shell_injection(
	session_id: &str,
	shell_type: ShellType,
	project_init_scripts: &[String],
) -> Result<ShellInjection, AppError> {
	let dir = std::env::temp_dir()
		.join(format!("2code-init-{}-{session_id}", std::process::id()));
	std::fs::create_dir_all(&dir)?;

	match shell_type {
		ShellType::Zsh => prepare_zsh(&dir, project_init_scripts),
		ShellType::Bash => prepare_bash(&dir, project_init_scripts),
		ShellType::Fish => prepare_fish(&dir),
		ShellType::Pwsh => prepare_pwsh(&dir),
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
/// Project init scripts are skipped because they are POSIX shell syntax,
/// incompatible with Fish.
fn prepare_fish(dir: &Path) -> Result<ShellInjection, AppError> {
	setup_2code_home();
	let init_script = dir.join("shellIntegration.fish");
	let script = format!(
		"{vsc}\n\n# === 2code common init ===\n{common}\n",
		vsc = VSC_FISH,
		common = DEFAULT_INIT_FISH.trim_end(),
	);
	std::fs::write(&init_script, script)?;
	Ok(ShellInjection::Fish { init_script })
}

/// Pwsh: VS Code's approach — use `-noexit -command '. "<path>"'`.
/// Project init scripts are skipped because they are POSIX shell syntax,
/// incompatible with PowerShell.
fn prepare_pwsh(dir: &Path) -> Result<ShellInjection, AppError> {
	setup_2code_home();
	let init_script = dir.join("shellIntegration.ps1");
	let script = format!(
		"{vsc}\n\n# === 2code common init ===\n{common}\n",
		vsc = VSC_PWSH,
		common = DEFAULT_INIT_PWSH.trim_end(),
	);
	std::fs::write(&init_script, script)?;
	Ok(ShellInjection::Pwsh { init_script })
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn extract_exe_simple_basename() {
		assert_eq!(extract_exe("bash"), "bash");
		assert_eq!(extract_exe("pwsh -NoLogo"), "pwsh");
	}

	#[test]
	fn extract_exe_unix_path_with_args() {
		assert_eq!(extract_exe("/usr/bin/zsh -l"), "/usr/bin/zsh");
		assert_eq!(extract_exe("/bin/bash --login"), "/bin/bash");
	}

	#[test]
	fn extract_exe_windows_path_with_spaces() {
		assert_eq!(
			extract_exe(
				"C:\\Program Files\\PowerShell\\7\\pwsh.exe -NoLogo -NoProfile"
			),
			"C:\\Program Files\\PowerShell\\7\\pwsh.exe"
		);
	}

	#[test]
	fn extract_exe_path_with_spaces_no_extension_with_flag() {
		// Path containing spaces, no .exe/.sh suffix, followed by a flag.
		// The fallback must split at the first flag-looking token, not swallow it.
		assert_eq!(
			extract_exe("C:\\Program Files\\nu\\nu --login"),
			"C:\\Program Files\\nu\\nu"
		);
	}

	#[test]
	fn extract_exe_path_with_spaces_no_extension_no_flag() {
		// Path containing spaces, no extension, no following flag — keep the whole thing.
		assert_eq!(
			extract_exe("C:\\Program Files\\nu\\nu"),
			"C:\\Program Files\\nu\\nu"
		);
	}

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
	fn detect_pwsh_windows_path_with_spaces() {
		assert_eq!(
			detect_shell_type(
				"C:\\Program Files\\PowerShell\\7\\pwsh.exe -NoLogo -NoProfile"
			),
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
	fn prepare_fish_includes_common_init() {
		let inj = prepare_shell_injection("test-fish-2", ShellType::Fish, &[])
			.unwrap();
		match inj {
			ShellInjection::Fish { init_script } => {
				assert!(init_script.exists());
				let content = std::fs::read_to_string(&init_script).unwrap();
				// VS Code integration must be present.
				assert!(content.contains("VSCODE_SHELL_INTEGRATION"));
				// 2code common init must be present
				assert!(content.contains("2code common init"));
				assert!(content.contains("fish_add_path"));
				assert!(content.contains("_2CODE_HOME"));
				// Project init must NOT be present (POSIX syntax, incompatible)
				assert!(!content.contains("2code project init"));
				std::fs::remove_dir_all(init_script.parent().unwrap()).ok();
			}
			_ => panic!("Expected Fish injection"),
		}
	}

	#[test]
	fn prepare_pwsh_includes_common_init() {
		let inj = prepare_shell_injection("test-pwsh-1", ShellType::Pwsh, &[])
			.unwrap();
		match inj {
			ShellInjection::Pwsh { init_script } => {
				assert!(init_script.exists());
				let content = std::fs::read_to_string(&init_script).unwrap();
				// VS Code integration must be present.
				assert!(content.contains("__VSCodeState"));
				// 2code common init must be present
				assert!(content.contains("2code common init"));
				assert!(content.contains("_2CODE_HOME"));
				// Project init must NOT be present (POSIX syntax, incompatible)
				assert!(!content.contains("2code project init"));
				std::fs::remove_dir_all(init_script.parent().unwrap()).ok();
			}
			_ => panic!("Expected Pwsh injection"),
		}
	}
}
