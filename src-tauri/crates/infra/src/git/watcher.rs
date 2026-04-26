//! Git state file watcher.
//!
//! Watches `.git/HEAD`, `.git/refs/`, `.git/index` (and the worktree's
//! `.git` file for worktrees) for changes. Fires a debounced callback when
//! the repo state actually changes — e.g., user committed, switched branch,
//! pulled, fetched, or rebased.
//!
//! Debounce: 200ms — git commands often touch multiple files in rapid
//! succession (e.g., commit touches index, HEAD, refs/heads/<branch>).
//!
//! Circuit breaker: if events fire more than 10 times per second sustained
//! for 1 second, the watcher backs off for 30s and falls back to polling
//! by emitting a single event every 30s. Protects against pathological
//! rebase loops or `git gc` storms.
//!
//! The `WatchHandle` keeps the watcher alive — drop it to stop watching.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use notify::{recommended_watcher, EventKind, RecursiveMode, Watcher};

use model::error::AppError;

const DEBOUNCE: Duration = Duration::from_millis(200);
const RATE_LIMIT_WINDOW: Duration = Duration::from_secs(1);
const RATE_LIMIT_MAX_EVENTS: u32 = 10;
const BACKOFF_DURATION: Duration = Duration::from_secs(30);

/// Handle returned by `watch_git_dir`. Drop to stop watching.
pub struct WatchHandle {
	stop: Arc<AtomicBool>,
	// Keeping the watcher alive is required by `notify`.
	_watcher: Box<dyn Watcher + Send + Sync>,
}

impl WatchHandle {
	pub fn stop(self) {
		self.stop.store(true, Ordering::Relaxed);
		// _watcher dropped at end of scope.
	}
}

impl Drop for WatchHandle {
	fn drop(&mut self) {
		self.stop.store(true, Ordering::Relaxed);
	}
}

/// Watch the .git directory inside `folder`. Calls `on_change` (debounced)
/// when relevant git state files change. Returns a handle that stops
/// watching when dropped. Errors if `folder` isn't a git repo — callers
/// (handlers) should pre-check via `is_git_repo` and skip this entirely.
pub fn watch_git_dir(
	folder: &str,
	on_change: impl Fn() + Send + Sync + 'static,
) -> Result<WatchHandle, AppError> {
	let git_dir = resolve_git_dir(Path::new(folder))?;

	let stop = Arc::new(AtomicBool::new(false));
	let stop_for_callback = stop.clone();

	// State held inside the notify callback closure.
	let state = Arc::new(std::sync::Mutex::new(WatcherState {
		last_emit: None,
		window_start: Instant::now(),
		window_count: 0,
		backoff_until: None,
	}));

	let on_change = Arc::new(on_change);
	let state_for_cb = state.clone();
	let on_change_for_cb = on_change.clone();

	let mut watcher = recommended_watcher(
		move |res: Result<notify::Event, notify::Error>| {
			if stop_for_callback.load(Ordering::Relaxed) {
				return;
			}
			let Ok(event) = res else {
				return;
			};
			if !is_relevant(&event) {
				return;
			}

			let mut s = match state_for_cb.lock() {
				Ok(s) => s,
				Err(_) => return,
			};
			let now = Instant::now();

			// Circuit breaker: if backing off, suppress (the polling thread
			// below emits the periodic ping during backoff).
			if let Some(until) = s.backoff_until {
				if now < until {
					return;
				}
				s.backoff_until = None;
				s.window_count = 0;
				s.window_start = now;
			}

			// Rate-limit window
			if now.duration_since(s.window_start) >= RATE_LIMIT_WINDOW {
				s.window_start = now;
				s.window_count = 0;
			}
			s.window_count += 1;
			if s.window_count > RATE_LIMIT_MAX_EVENTS {
				s.backoff_until = Some(now + BACKOFF_DURATION);
				tracing::warn!(
					target: "git.watcher",
					"event storm detected, backing off for 30s",
				);
				return;
			}

			// Debounce
			let should_emit = match s.last_emit {
				Some(t) => now.duration_since(t) >= DEBOUNCE,
				None => true,
			};
			if should_emit {
				s.last_emit = Some(now);
				drop(s);
				on_change_for_cb();
			}
		},
	)
	.map_err(|e| AppError::GitError(format!("git watcher: {e}")))?;

	// Watch the git_dir non-recursively (HEAD, index live at the top level)
	// plus refs/ recursively (branches/tags can be nested).
	watcher
		.watch(&git_dir, RecursiveMode::NonRecursive)
		.map_err(|e| {
			AppError::GitError(format!(
				"git watcher: watch {} failed: {}",
				git_dir.display(),
				e
			))
		})?;
	let refs_dir = git_dir.join("refs");
	if refs_dir.exists() {
		// Best-effort; refs may be packed and live as a single file.
		let _ = watcher.watch(&refs_dir, RecursiveMode::Recursive);
	}

	// Backoff polling thread: while the circuit breaker is tripped,
	// emit a single ping every BACKOFF_DURATION so the frontend doesn't
	// stay stale.
	let stop_poll = stop.clone();
	let state_poll = state.clone();
	std::thread::spawn(move || loop {
		std::thread::sleep(BACKOFF_DURATION);
		if stop_poll.load(Ordering::Relaxed) {
			break;
		}
		let in_backoff = match state_poll.lock() {
			Ok(s) => s.backoff_until.map(|u| Instant::now() < u).unwrap_or(false),
			Err(_) => false,
		};
		if in_backoff {
			on_change();
		}
	});

	Ok(WatchHandle {
		stop,
		_watcher: Box::new(watcher),
	})
}

struct WatcherState {
	last_emit: Option<Instant>,
	window_start: Instant,
	window_count: u32,
	backoff_until: Option<Instant>,
}

fn resolve_git_dir(folder: &Path) -> Result<PathBuf, AppError> {
	let direct = folder.join(".git");
	if !direct.exists() {
		return Err(AppError::GitError(format!(
			"not a git repo: {}",
			folder.display()
		)));
	}
	if direct.is_dir() {
		return Ok(direct);
	}
	// Worktree: .git is a file containing "gitdir: <path>"
	let contents = std::fs::read_to_string(&direct)?;
	for line in contents.lines() {
		if let Some(path) = line.strip_prefix("gitdir:") {
			let resolved = PathBuf::from(path.trim());
			if resolved.is_absolute() {
				return Ok(resolved);
			}
			return Ok(folder.join(resolved));
		}
	}
	Err(AppError::GitError(format!(
		"unrecognized .git file format in {}",
		folder.display()
	)))
}

fn is_relevant(event: &notify::Event) -> bool {
	if !matches!(
		event.kind,
		EventKind::Modify(_) | EventKind::Create(_) | EventKind::Remove(_)
	) {
		return false;
	}
	for path in &event.paths {
		let Some(name) = path.file_name().and_then(|s| s.to_str()) else {
			continue;
		};
		if name == "HEAD" || name == "index" || name == "packed-refs" {
			return true;
		}
		// refs/heads/*, refs/tags/*, refs/remotes/*/* — anything inside refs/
		if path.components().any(|c| c.as_os_str() == "refs") {
			return true;
		}
		// MERGE_HEAD / REBASE_* / CHERRY_PICK_HEAD signal in-progress ops
		if name.starts_with("MERGE_")
			|| name.starts_with("REBASE_")
			|| name.starts_with("CHERRY_PICK_")
			|| name == "ORIG_HEAD"
			|| name == "FETCH_HEAD"
		{
			return true;
		}
	}
	false
}

#[cfg(test)]
mod tests {
	use super::*;
	use std::process::Command as Cmd;
	use std::sync::atomic::AtomicU32;
	use tempfile::TempDir;

	fn init_repo() -> TempDir {
		let dir = TempDir::new().expect("tempdir");
		Cmd::new("git").arg("init").current_dir(dir.path()).output().unwrap();
		Cmd::new("git")
			.args(["config", "user.name", "Test"])
			.current_dir(dir.path())
			.output()
			.unwrap();
		Cmd::new("git")
			.args(["config", "user.email", "test@test.com"])
			.current_dir(dir.path())
			.output()
			.unwrap();
		dir
	}

	#[test]
	fn fires_on_commit() {
		let dir = init_repo();
		let folder = dir.path().to_string_lossy().to_string();

		let counter = Arc::new(AtomicU32::new(0));
		let counter_clone = counter.clone();
		let _handle = watch_git_dir(&folder, move || {
			counter_clone.fetch_add(1, Ordering::Relaxed);
		})
		.expect("watch");

		// Give the watcher a moment to settle.
		std::thread::sleep(Duration::from_millis(100));

		std::fs::write(dir.path().join("a.txt"), "a").unwrap();
		Cmd::new("git")
			.args(["add", "a.txt"])
			.current_dir(dir.path())
			.output()
			.unwrap();
		Cmd::new("git")
			.args(["commit", "-m", "init"])
			.current_dir(dir.path())
			.output()
			.unwrap();

		// Wait for debounced event.
		std::thread::sleep(Duration::from_millis(500));
		assert!(
			counter.load(Ordering::Relaxed) >= 1,
			"expected at least one event from commit"
		);
	}

	#[test]
	fn debounces_rapid_changes() {
		let dir = init_repo();
		let folder = dir.path().to_string_lossy().to_string();

		let counter = Arc::new(AtomicU32::new(0));
		let counter_clone = counter.clone();
		let _handle = watch_git_dir(&folder, move || {
			counter_clone.fetch_add(1, Ordering::Relaxed);
		})
		.expect("watch");
		std::thread::sleep(Duration::from_millis(100));

		// Touch HEAD repeatedly.
		let head = dir.path().join(".git/HEAD");
		for _ in 0..5 {
			let contents = std::fs::read_to_string(&head).unwrap();
			std::fs::write(&head, contents).unwrap();
			std::thread::sleep(Duration::from_millis(20));
		}

		// Debounce window is 200ms; 5 events spread over 100ms should produce
		// at most 1 callback (the first one).
		std::thread::sleep(Duration::from_millis(400));
		let count = counter.load(Ordering::Relaxed);
		assert!(count <= 2, "expected debounced count, got {count}");
	}

	#[test]
	fn ignores_irrelevant_files() {
		let dir = init_repo();
		let folder = dir.path().to_string_lossy().to_string();

		let counter = Arc::new(AtomicU32::new(0));
		let counter_clone = counter.clone();
		let _handle = watch_git_dir(&folder, move || {
			counter_clone.fetch_add(1, Ordering::Relaxed);
		})
		.expect("watch");
		std::thread::sleep(Duration::from_millis(100));

		// Write to a .git internal file we don't care about.
		std::fs::write(dir.path().join(".git/description"), "x").unwrap();

		std::thread::sleep(Duration::from_millis(400));
		assert_eq!(
			counter.load(Ordering::Relaxed),
			0,
			"description should not trigger callback"
		);
	}

	#[test]
	fn errors_on_non_repo() {
		let dir = TempDir::new().expect("tempdir");
		let folder = dir.path().to_string_lossy().to_string();
		let result = watch_git_dir(&folder, || {});
		assert!(result.is_err());
	}

	#[test]
	fn drop_handle_stops_watching() {
		let dir = init_repo();
		let folder = dir.path().to_string_lossy().to_string();

		let counter = Arc::new(AtomicU32::new(0));
		let counter_clone = counter.clone();
		{
			let _handle = watch_git_dir(&folder, move || {
				counter_clone.fetch_add(1, Ordering::Relaxed);
			})
			.expect("watch");
			std::thread::sleep(Duration::from_millis(100));
			// handle dropped here
		}

		// Touch HEAD after handle dropped.
		std::thread::sleep(Duration::from_millis(100));
		let head = dir.path().join(".git/HEAD");
		let contents = std::fs::read_to_string(&head).unwrap();
		std::fs::write(&head, contents).unwrap();

		std::thread::sleep(Duration::from_millis(400));
		// Allow at most the events fired before drop (could be 0 or 1).
		assert!(counter.load(Ordering::Relaxed) <= 1);
	}
}
