use std::collections::HashMap;
use std::io::Write;
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;

use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};

use model::error::AppError;

use crate::shell_init::ShellInjection;

pub struct PtySession {
	pub master: Box<dyn MasterPty + Send>,
	pub writer: Box<dyn Write + Send>,
	pub child: Box<dyn portable_pty::Child + Send + Sync>,
}

pub type PtySessionMap = Arc<Mutex<HashMap<String, PtySession>>>;
/// Tracks background PTY read thread handles so they can be joined on exit,
/// ensuring persistence threads flush their output buffers before the process terminates.
pub type PtyReadThreads = Arc<Mutex<Vec<JoinHandle<()>>>>;

pub struct CreateSessionOptions<'a> {
	pub session_id: &'a str,
	pub shell: &'a str,
	pub cwd: &'a str,
	pub rows: u16,
	pub cols: u16,
	pub injection: &'a ShellInjection,
}

pub fn create_session_map() -> PtySessionMap {
	Arc::new(Mutex::new(HashMap::new()))
}

pub fn create_thread_tracker() -> PtyReadThreads {
	Arc::new(Mutex::new(Vec::new()))
}

/// Join all tracked read threads, blocking until they complete.
/// This ensures each read thread's persistence sub-thread flushes its output buffer.
pub fn join_all_read_threads(threads: &PtyReadThreads) {
	let handles: Vec<JoinHandle<()>> = {
		let Ok(mut guard) = threads.lock() else {
			return;
		};
		guard.drain(..).collect()
	};

	for handle in handles {
		let _ = handle.join();
	}
}

pub fn create_session(
	sessions: &PtySessionMap,
	options: CreateSessionOptions<'_>,
) -> Result<Box<dyn std::io::Read + Send>, AppError> {
	let pty_system = native_pty_system();

	let pair = pty_system
		.openpty(PtySize {
			rows: options.rows,
			cols: options.cols,
			pixel_width: 0,
			pixel_height: 0,
		})
		.map_err(|e| AppError::PtyError(e.to_string()))?;

	// Build the command with shell-specific args based on injection type
	let mut cmd = build_injected_command(options.shell, options.injection);

	// Common env vars for all shells
	cmd.env("TERM", "xterm-256color");
	cmd.env("TERM_PROGRAM", "vscode"); // Makes VS Code's shell integration scripts work
	cmd.env("VSCODE_INJECTION", "1"); // Tells scripts they were injected (not manually installed)

	// Apply shell-specific env vars
	if let ShellInjection::Zsh {
		zdotdir,
		user_zdotdir,
	} = options.injection
	{
		cmd.env("ZDOTDIR", zdotdir.to_string_lossy().as_ref());
		cmd.env("USER_ZDOTDIR", user_zdotdir.as_str());
	}

	if !options.cwd.is_empty() {
		cmd.cwd(options.cwd);
	}

	let child = pair
		.slave
		.spawn_command(cmd)
		.map_err(|e| AppError::PtyError(e.to_string()))?;

	let reader = pair
		.master
		.try_clone_reader()
		.map_err(|e| AppError::PtyError(e.to_string()))?;

	let writer = pair
		.master
		.take_writer()
		.map_err(|e| AppError::PtyError(e.to_string()))?;

	let session = PtySession {
		master: pair.master,
		writer,
		child,
	};

	sessions
		.lock()
		.map_err(|_| AppError::LockError)?
		.insert(options.session_id.to_string(), session);

	// Drop the slave to avoid blocking
	drop(pair.slave);

	Ok(reader)
}

/// Parse a shell command string into (program, args), handling paths with spaces.
/// e.g. `"C:\\Program Files\\PowerShell\\7-preview\\pwsh.exe -NoLogo -NoProfile"`
/// → `("C:\\Program Files\\PowerShell\\7-preview\\pwsh.exe", ["-NoLogo", "-NoProfile"])`
fn parse_shell_command(shell: &str) -> (String, Vec<String>) {
	let shell = shell.trim();
	let parts: Vec<&str> = shell.split_whitespace().collect();
	if parts.is_empty() {
		return (shell.to_string(), vec![]);
	}
	let first = parts[0];
	let looks_like_path = first.len() >= 2 && first.as_bytes()[1] == b':' // C: D: etc
		|| first.contains('/') || first.contains('\\');

	if !looks_like_path || parts.len() == 1 {
		return (
			first.to_string(),
			parts[1..].iter().map(|s| s.to_string()).collect(),
		);
	}

	// Reconstruct the path by joining tokens until we hit one ending with a
	// known extension or the first arg starting with '-'.
	let mut end_idx = 1;
	while end_idx < parts.len() {
		let candidate = parts[..=end_idx].join(" ");
		if candidate.to_lowercase().ends_with(".exe")
			|| candidate.to_lowercase().ends_with(".bat")
			|| candidate.to_lowercase().ends_with(".cmd")
			|| candidate.to_lowercase().ends_with(".ps1")
			|| candidate.to_lowercase().ends_with(".sh")
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
	let program = parts[..end_idx].join(" ");
	let args = parts[end_idx..].iter().map(|s| s.to_string()).collect();
	(program, args)
}

/// Build a CommandBuilder with the right executable and args for the given injection type.
fn build_injected_command(
	shell: &str,
	injection: &ShellInjection,
) -> CommandBuilder {
	// Parse the shell command, handling paths with spaces like
	// "C:\Program Files\PowerShell\7-preview\pwsh.exe -NoLogo -NoProfile"
	let (program, existing_args) = parse_shell_command(shell);

	match injection {
		ShellInjection::Bash { init_file } => {
			// bash --init-file /path/to/shellIntegration-bash.sh
			let mut cmd = CommandBuilder::new(program);
			cmd.arg("--init-file");
			cmd.arg(init_file.to_string_lossy().as_ref());
			cmd
		}
		ShellInjection::Zsh { .. } => {
			// zsh -i  (ZDOTDIR is set via env var, scripts are in the dir)
			let mut cmd = CommandBuilder::new(program);
			cmd.arg("-i");
			cmd
		}
		ShellInjection::Fish { init_script } => {
			// fish --init-command 'source "/path/to/shellIntegration.fish"'
			let mut cmd = CommandBuilder::new(program);
			for arg in &existing_args {
				cmd.arg(arg.as_str());
			}
			cmd.arg("--init-command");
			cmd.arg(format!("source \"{}\"", init_script.to_string_lossy()));
			cmd
		}
		ShellInjection::Pwsh { init_script } => {
			// pwsh -noexit -command '. "/path/to/shellIntegration.ps1"'
			let mut cmd = CommandBuilder::new(program);
			// Keep existing args like -NoLogo but filter out conflicting ones
			for arg in &existing_args {
				let lower = arg.to_lowercase();
				if lower != "-noexit" && lower != "-command" && lower != "-c" {
					cmd.arg(arg.as_str());
				}
			}
			cmd.arg("-noexit");
			cmd.arg("-command");
			cmd.arg(format!(". \"{}\"", init_script.to_string_lossy()));
			cmd
		}
		ShellInjection::None => {
			// Unknown shell — just run as-is with original args
			let mut cmd = CommandBuilder::new(program);
			for arg in &existing_args {
				cmd.arg(arg.as_str());
			}
			cmd
		}
	}
}

pub fn write_to_pty(
	sessions: &PtySessionMap,
	session_id: &str,
	data: &[u8],
) -> Result<(), AppError> {
	let mut map = sessions.lock().map_err(|_| AppError::LockError)?;
	let session = map.get_mut(session_id).ok_or_else(|| {
		AppError::PtyError(format!("Session not found: {}", session_id))
	})?;

	session
		.writer
		.write_all(data)
		.map_err(|e| AppError::PtyError(e.to_string()))?;
	session
		.writer
		.flush()
		.map_err(|e| AppError::PtyError(e.to_string()))?;

	Ok(())
}

pub fn resize_pty(
	sessions: &PtySessionMap,
	session_id: &str,
	rows: u16,
	cols: u16,
) -> Result<(), AppError> {
	let map = sessions.lock().map_err(|_| AppError::LockError)?;
	let session = map.get(session_id).ok_or_else(|| {
		AppError::PtyError(format!("Session not found: {}", session_id))
	})?;

	session
		.master
		.resize(PtySize {
			rows,
			cols,
			pixel_width: 0,
			pixel_height: 0,
		})
		.map_err(|e| AppError::PtyError(e.to_string()))?;

	Ok(())
}

pub fn close_session(
	sessions: &PtySessionMap,
	session_id: &str,
) -> Result<(), AppError> {
	let mut map = sessions.lock().map_err(|_| AppError::LockError)?;
	if let Some(mut session) = map.remove(session_id) {
		let _ = session.child.kill();
		let _ = session.child.wait();
	}
	Ok(())
}

pub fn close_all_sessions(sessions: &PtySessionMap) {
	if let Ok(mut map) = sessions.lock() {
		for (_, mut session) in map.drain() {
			let _ = session.child.kill();
			let _ = session.child.wait();
		}
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn create_session_map_starts_empty() {
		let map = create_session_map();
		let inner = map.lock().unwrap();
		assert!(inner.is_empty());
	}

	#[test]
	fn write_to_nonexistent_session_returns_error() {
		let sessions = create_session_map();
		let result = write_to_pty(&sessions, "nonexistent", b"hello");
		assert!(result.is_err());
		let err = result.unwrap_err().to_string();
		assert!(err.contains("Session not found"));
	}

	#[test]
	fn resize_nonexistent_session_returns_error() {
		let sessions = create_session_map();
		let result = resize_pty(&sessions, "nonexistent", 24, 80);
		assert!(result.is_err());
		let err = result.unwrap_err().to_string();
		assert!(err.contains("Session not found"));
	}

	#[test]
	fn close_nonexistent_session_is_ok() {
		let sessions = create_session_map();
		let result = close_session(&sessions, "nonexistent");
		assert!(result.is_ok());
	}

	#[test]
	fn close_all_on_empty_map_no_panic() {
		let sessions = create_session_map();
		close_all_sessions(&sessions); // should not panic
	}

	#[test]
	fn create_thread_tracker_starts_empty() {
		let tracker = create_thread_tracker();
		let inner = tracker.lock().unwrap();
		assert!(inner.is_empty());
	}

	#[test]
	fn join_all_read_threads_with_real_threads() {
		let tracker = create_thread_tracker();
		{
			let mut guard = tracker.lock().unwrap();
			for _ in 0..3 {
				guard.push(std::thread::spawn(|| {}));
			}
			assert_eq!(guard.len(), 3);
		}
		join_all_read_threads(&tracker);
		let guard = tracker.lock().unwrap();
		assert!(guard.is_empty(), "Vec should be drained after join");
	}

	#[test]
	fn join_all_read_threads_empty() {
		let tracker = create_thread_tracker();
		join_all_read_threads(&tracker); // should not panic
	}

	#[test]
	fn parse_shell_simple() {
		let (prog, args) = parse_shell_command("bash");
		assert_eq!(prog, "bash");
		assert!(args.is_empty());
	}

	#[test]
	fn parse_shell_with_args() {
		let (prog, args) =
			parse_shell_command("powershell.exe -NoLogo -NoProfile");
		assert_eq!(prog, "powershell.exe");
		assert_eq!(args, vec!["-NoLogo".to_string(), "-NoProfile".to_string()]);
	}

	#[test]
	fn parse_shell_path_with_spaces() {
		let (prog, args) = parse_shell_command(
			r"C:\Program Files\PowerShell\7-preview\pwsh.exe -NoLogo -NoProfile",
		);
		assert_eq!(prog, r"C:\Program Files\PowerShell\7-preview\pwsh.exe");
		assert_eq!(args, vec!["-NoLogo".to_string(), "-NoProfile".to_string()]);
	}

	#[test]
	fn parse_shell_git_bash() {
		let (prog, args) =
			parse_shell_command(r"C:\Program Files\Git\bin\bash.exe");
		assert_eq!(prog, r"C:\Program Files\Git\bin\bash.exe");
		assert!(args.is_empty());
	}
}
