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

/// Detect shell type from the shell command string.
pub fn detect_shell_type(shell_cmd: &str) -> ShellType {
	// Take the basename of the first token (the executable)
	let exe = shell_cmd.split_whitespace().next().unwrap_or(shell_cmd);
	let basename = Path::new(exe)
		.file_stem()
		.and_then(|s| s.to_str())
		.unwrap_or(exe)
		.to_lowercase();

	match basename.as_str() {
		"zsh" => ShellType::Zsh,
		"bash" | "sh" => ShellType::Bash,
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
	use std::process::Command;

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

	#[test]
	#[cfg(unix)]
	fn default_common_init_wraps_agent_status_hooks() {
		let temp = tempfile::tempdir().unwrap();
		let home = temp.path().join("home with space");
		let real_bin = temp.path().join("real-bin");
		let marker = temp.path().join("marker");
		std::fs::create_dir_all(&home).unwrap();
		std::fs::create_dir_all(&real_bin).unwrap();
		std::fs::create_dir_all(&marker).unwrap();
		let user_opencode_dir = home.join(".config/opencode");
		let user_opencode_plugins = user_opencode_dir.join("plugins");
		std::fs::create_dir_all(&user_opencode_plugins).unwrap();
		std::fs::write(
			user_opencode_dir.join("opencode.json"),
			r#"{"model":"test"}"#,
		)
		.unwrap();
		std::fs::write(
			user_opencode_plugins.join("user-plugin.js"),
			"export const UserPlugin = async () => ({});\n",
		)
		.unwrap();

		write_fake_executable(
			&real_bin.join("claude"),
			r#"#!/bin/sh
printf '%s\n' "$@" >"$MARKER/claude.args"
"#,
		);
		write_fake_executable(
			&real_bin.join("codex"),
			r#"#!/bin/sh
printf '%s\n' "$@" >"$MARKER/codex.args"
"#,
		);
		write_fake_executable(
			&real_bin.join("opencode"),
			r#"#!/bin/sh
printf '%s\n' "$OPENCODE_CONFIG_DIR" >"$MARKER/opencode.config_dir"
printf '%s\n' "$@" >"$MARKER/opencode.args"
"#,
		);
		write_fake_executable(
			&marker.join("helper"),
			&format!(
				r#"#!/bin/sh
printf '%s\n' "$*" >>"{}"
"#,
				marker.join("helper.args").display()
			),
		);

		let init_file = temp.path().join("default_init_common.sh");
		std::fs::write(&init_file, DEFAULT_INIT_COMMON).unwrap();
		let shell = format!(
			r#". "{}"
claude --version
codex exec "say ok"
opencode --version
"#,
			init_file.display()
		);

		let output = Command::new("/bin/bash")
			.arg("--noprofile")
			.arg("--norc")
			.arg("-c")
			.arg(shell)
			.env("HOME", &home)
			.env("MARKER", &marker)
			.env(
				"PATH",
				format!("{}:/usr/bin:/bin", real_bin.to_string_lossy()),
			)
			.output()
			.unwrap();
		assert!(
			output.status.success(),
			"init failed\nstdout:\n{}\nstderr:\n{}",
			String::from_utf8_lossy(&output.stdout),
			String::from_utf8_lossy(&output.stderr),
		);

		let hooks_dir = home.join(".2code/hooks");
		let claude_args =
			std::fs::read_to_string(marker.join("claude.args")).unwrap();
		assert!(claude_args.contains("--settings\n"));
		assert!(claude_args.contains(&format!(
			"{}\n",
			hooks_dir.join("claude-settings.json").display()
		)));

		let codex_args =
			std::fs::read_to_string(marker.join("codex.args")).unwrap();
		assert!(codex_args.contains("hooks.UserPromptSubmit"));
		assert!(codex_args.contains("hooks.PermissionRequest"));
		assert!(codex_args.contains("hooks.Stop"));
		assert!(codex_args.contains(
			&hooks_dir.join("status-running.sh").display().to_string()
		));
		assert!(codex_args.contains(
			&hooks_dir.join("status-waiting.sh").display().to_string()
		));
		assert!(codex_args
			.contains(&hooks_dir.join("status-idle.sh").display().to_string()));

		let opencode_dir = home.join(".2code/opencode");
		assert_eq!(
			std::fs::read_to_string(marker.join("opencode.config_dir"))
				.unwrap()
				.trim(),
			opencode_dir.display().to_string()
		);
		let opencode_plugin = std::fs::read_to_string(
			opencode_dir.join("plugins/2code-status.js"),
		)
		.unwrap();
		assert!(opencode_plugin.contains("permission.asked"));
		assert!(opencode_plugin.contains("tool.execute.before"));
		assert_eq!(
			std::fs::read_link(opencode_dir.join("opencode.json")).unwrap(),
			user_opencode_dir.join("opencode.json")
		);
		assert_eq!(
			std::fs::read_link(opencode_dir.join("plugins/user-plugin.js"))
				.unwrap(),
			user_opencode_plugins.join("user-plugin.js")
		);

		let claude_settings: serde_json::Value = serde_json::from_str(
			&std::fs::read_to_string(hooks_dir.join("claude-settings.json"))
				.unwrap(),
		)
		.unwrap();
		assert_eq!(
			claude_settings["hooks"]["UserPromptSubmit"][0]["hooks"][0]
				["command"],
			format!("'{}'", hooks_dir.join("status-running.sh").display())
		);
		assert_eq!(
			claude_settings["hooks"]["PermissionRequest"][0]["hooks"][0]
				["command"],
			format!("'{}'", hooks_dir.join("status-waiting.sh").display())
		);
		assert_eq!(
			claude_settings["hooks"]["Stop"][0]["hooks"][0]["command"],
			format!("'{}'", hooks_dir.join("status-idle.sh").display())
		);

		let output = Command::new("/bin/bash")
			.arg("--noprofile")
			.arg("--norc")
			.arg("-c")
			.arg(format!(
				"'{}'; '{}'; '{}'; sleep 1",
				hooks_dir.join("status-running.sh").display(),
				hooks_dir.join("status-waiting.sh").display(),
				hooks_dir.join("status-idle.sh").display()
			))
			.env("_2CODE_HELPER", marker.join("helper"))
			.env("_2CODE_HELPER_URL", "http://127.0.0.1:1")
			.env("_2CODE_SESSION_ID", "test-session")
			.env("MARKER", &marker)
			.output()
			.unwrap();
		assert!(
			output.status.success(),
			"hook command failed\nstdout:\n{}\nstderr:\n{}",
			String::from_utf8_lossy(&output.stdout),
			String::from_utf8_lossy(&output.stderr),
		);
		let helper_args =
			std::fs::read_to_string(marker.join("helper.args")).unwrap();
		assert!(helper_args.contains("status running"));
		assert!(helper_args.contains("status waiting"));
		assert!(helper_args.contains("status idle"));
		assert!(helper_args.contains("notify"));
	}

	#[cfg(unix)]
	fn write_fake_executable(path: &Path, content: &str) {
		use std::os::unix::fs::PermissionsExt;

		std::fs::write(path, content).unwrap();
		let mut permissions = std::fs::metadata(path).unwrap().permissions();
		permissions.set_mode(0o755);
		std::fs::set_permissions(path, permissions).unwrap();
	}
}
