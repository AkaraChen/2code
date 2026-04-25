//! Cancellation primitive for long-running git ops.
//!
//! `CancelToken` is a clonable Arc<AtomicBool>. The handler spawns the op
//! with a token in its scope; a separate `cancel_git_operation(op_id)`
//! Tauri command flips the flag, and the op's worker thread observes it
//! between poll intervals (or via `Child::kill`) and aborts.
//!
//! For shell-out ops like push/fetch/pull, `run_cancellable` spawns the
//! git child process, polls every 100ms for both child completion and
//! cancellation, and `kill()`s the child on cancel. Callers register the
//! token in a managed map keyed by op_id so the cancel command can find it.

use std::process::{Command, Output};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use model::error::AppError;

const POLL_INTERVAL: Duration = Duration::from_millis(100);

#[derive(Clone, Default)]
pub struct CancelToken(Arc<AtomicBool>);

impl CancelToken {
	pub fn new() -> Self {
		Self::default()
	}
	pub fn cancel(&self) {
		self.0.store(true, Ordering::Relaxed);
	}
	pub fn is_cancelled(&self) -> bool {
		self.0.load(Ordering::Relaxed)
	}
}

/// Run a git CLI command with cancellation support. Returns:
/// - Ok(output) on normal completion
/// - Err(AppError::GitError("operation cancelled")) if the token fires
/// - Err(other AppError) on spawn/IO failure
///
/// On cancel the child process is killed. Note: this uses sync poll on a
/// blocking thread; the caller is expected to be inside spawn_blocking.
pub fn run_cancellable(
	mut command: Command,
	token: &CancelToken,
) -> Result<Output, AppError> {
	let mut child = command
		.stdout(std::process::Stdio::piped())
		.stderr(std::process::Stdio::piped())
		.spawn()?;

	loop {
		match child.try_wait()? {
			Some(_status) => {
				// Process exited normally. Collect output.
				return Ok(child.wait_with_output()?);
			}
			None => {
				if token.is_cancelled() {
					let _ = child.kill();
					let _ = child.wait();
					return Err(AppError::GitError(
						"operation cancelled".to_string(),
					));
				}
				std::thread::sleep(POLL_INTERVAL);
			}
		}
	}
}

#[cfg(test)]
mod tests {
	use super::*;
	use std::time::Instant;

	#[test]
	fn token_starts_uncancelled() {
		let t = CancelToken::new();
		assert!(!t.is_cancelled());
	}

	#[test]
	fn token_cancel_propagates_to_clones() {
		let t = CancelToken::new();
		let t2 = t.clone();
		t.cancel();
		assert!(t2.is_cancelled());
	}

	#[test]
	fn run_cancellable_completes_normally_for_fast_command() {
		let token = CancelToken::new();
		let mut cmd = Command::new("git");
		cmd.arg("--version");
		let result = run_cancellable(cmd, &token).expect("git --version");
		assert!(result.status.success());
		let stdout = String::from_utf8_lossy(&result.stdout);
		assert!(stdout.starts_with("git version"));
	}

	#[test]
	fn run_cancellable_kills_on_cancel() {
		let token = CancelToken::new();
		let token_for_thread = token.clone();
		std::thread::spawn(move || {
			std::thread::sleep(Duration::from_millis(150));
			token_for_thread.cancel();
		});

		// Use `sleep` as a stand-in for a long-running process.
		let mut cmd = Command::new("sleep");
		cmd.arg("10");
		let start = Instant::now();
		let result = run_cancellable(cmd, &token);
		let elapsed = start.elapsed();
		assert!(result.is_err());
		assert!(
			elapsed < Duration::from_secs(2),
			"expected fast cancel, took {:?}",
			elapsed
		);
		assert!(result
			.unwrap_err()
			.to_string()
			.contains("cancelled"));
	}
}
