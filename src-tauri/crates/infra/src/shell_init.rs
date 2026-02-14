use std::path::PathBuf;

use model::error::AppError;

const DEFAULT_INIT: &str = include_str!("../scripts/default_init.sh");

/// Create a temp directory with `.zshenv` for shell init injection.
/// Returns the path to the temp directory (to be set as ZDOTDIR).
pub fn prepare_init_dir(
	session_id: &str,
	project_init_scripts: &[String],
) -> Result<PathBuf, AppError> {
	let dir = std::env::temp_dir().join(format!("2code-init-{session_id}"));
	std::fs::create_dir_all(&dir)?;

	let project_init = project_init_scripts.join("\n");
	let zshenv = build_zshenv(DEFAULT_INIT, &project_init);
	std::fs::write(dir.join(".zshenv"), zshenv)?;

	Ok(dir)
}

fn build_zshenv(default_init: &str, project_init: &str) -> String {
	format!(
		r#"# 2code shell init — this file self-cleans after first prompt
# Save init dir for cleanup, restore ZDOTDIR immediately
_2code_init_dir="$ZDOTDIR"
if [[ -n "$_2CODE_ORIG_ZDOTDIR" ]]; then
  export ZDOTDIR="$_2CODE_ORIG_ZDOTDIR"
  unset _2CODE_ORIG_ZDOTDIR
else
  unset ZDOTDIR
fi

# Source user's .zshenv (ZDOTDIR is already correct)
[[ -f "${{ZDOTDIR:-$HOME}}/.zshenv" ]] && source "${{ZDOTDIR:-$HOME}}/.zshenv"

# Register one-shot init hook (runs after .zshrc, before first prompt)
_2code_init() {{
  add-zsh-hook -d precmd _2code_init
  unfunction _2code_init 2>/dev/null

  # === 2code default init ===
{default_init}

  # === 2code project init ===
{project_init}

  # Cleanup
  command rm -rf "$_2code_init_dir"
  unset _2code_init_dir
}}
autoload -Uz add-zsh-hook
add-zsh-hook precmd _2code_init
"#,
		default_init = default_init.trim_end(),
		project_init = project_init.trim_end(),
	)
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn prepare_init_dir_creates_zshenv() {
		let dir = prepare_init_dir("test-session-1", &[]).unwrap();
		assert!(dir.exists());
		assert!(dir.join(".zshenv").exists());

		// Cleanup
		std::fs::remove_dir_all(&dir).ok();
	}

	#[test]
	fn zshenv_contains_default_init() {
		let dir = prepare_init_dir("test-session-2", &[]).unwrap();
		let content = std::fs::read_to_string(dir.join(".zshenv")).unwrap();

		assert!(content.contains("2code default init"));
		assert!(content.contains(DEFAULT_INIT.trim_end()));

		std::fs::remove_dir_all(&dir).ok();
	}

	#[test]
	fn zshenv_contains_project_init() {
		let scripts =
			vec!["echo HELLO".to_string(), "export FOO=bar".to_string()];
		let dir = prepare_init_dir("test-session-3", &scripts).unwrap();
		let content = std::fs::read_to_string(dir.join(".zshenv")).unwrap();

		assert!(content.contains("echo HELLO"));
		assert!(content.contains("export FOO=bar"));

		std::fs::remove_dir_all(&dir).ok();
	}

	#[test]
	fn zshenv_empty_project_init() {
		let zshenv = build_zshenv("# default", "");
		assert!(zshenv.contains("# default"));
		assert!(zshenv.contains("2code project init"));
	}

	#[test]
	fn zshenv_restores_zdotdir() {
		let zshenv = build_zshenv("", "");
		assert!(zshenv.contains("_2CODE_ORIG_ZDOTDIR"));
		assert!(zshenv.contains("unset ZDOTDIR"));
	}

	#[test]
	fn zshenv_sources_user_zshenv() {
		let zshenv = build_zshenv("", "");
		assert!(zshenv.contains(r#"source "${ZDOTDIR:-$HOME}/.zshenv""#));
	}

	#[test]
	fn zshenv_self_cleans() {
		let zshenv = build_zshenv("", "");
		assert!(zshenv.contains(r#"command rm -rf "$_2code_init_dir""#));
	}
}
