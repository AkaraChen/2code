use std::collections::{HashMap, HashSet};
use std::path::Path;
use std::sync::atomic::Ordering;
use std::sync::mpsc;
use std::time::{Duration, Instant};

use notify::{recommended_watcher, Event, EventKind, RecursiveMode, Watcher};

use infra::db::DbPool;
use infra::watcher::WatcherShutdownFlag;
use model::project::ProjectWithProfiles;
use model::watcher::WatchEvent;

use crate::WatchEventSender;

const DB_POLL_INTERVAL: Duration = Duration::from_secs(3);
const RECV_TIMEOUT: Duration = Duration::from_millis(100);
const DEBOUNCE_DURATION: Duration = Duration::from_millis(500);
const MAX_DEBOUNCE_KEYS: usize = 1024;

struct ProjectWatcher {
	// The watcher must be kept alive — dropping it stops watching.
	_watcher: Box<dyn Watcher + Send>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct WatchTarget {
	key: String,
	project_id: String,
	profile_id: Option<String>,
	root_path: String,
}

pub fn start(
	sender: Box<dyn WatchEventSender>,
	db: DbPool,
	shutdown: WatcherShutdownFlag,
) {
	std::thread::spawn(move || {
		run_coordinator(sender, db, shutdown);
	});
}

fn run_coordinator(
	sender: Box<dyn WatchEventSender>,
	db: DbPool,
	shutdown: WatcherShutdownFlag,
) {
	let (tx, rx) = mpsc::channel::<WatchEvent>();

	let mut watchers: HashMap<String, ProjectWatcher> = HashMap::new();
	let mut last_poll = Instant::now() - DB_POLL_INTERVAL;
	let mut last_event: HashMap<String, Instant> = HashMap::new();

	loop {
		if shutdown.load(Ordering::Relaxed) {
			break;
		}

		// Poll DB for project list periodically
		if last_poll.elapsed() >= DB_POLL_INTERVAL {
			last_poll = Instant::now();
			reconcile_watchers(&db, &tx, &mut watchers);
		}

		// Receive filesystem events with timeout
		match rx.recv_timeout(RECV_TIMEOUT) {
			Ok(event) => {
				let now = Instant::now();
				prune_debounce_cache(&mut last_event, now);
				let event_key = watch_event_debounce_key(&event);
				let should_send = last_event
					.get(&event_key)
					.map(|t| now.duration_since(*t) >= DEBOUNCE_DURATION)
					.unwrap_or(true);

				if should_send {
					last_event.insert(event_key, now);
					tracing::trace!(
						target: "watcher",
						project_id = %event.project_id,
						profile_id = ?event.profile_id,
						path = ?event.path,
						"file changed"
					);
					if !sender.send(event) {
						// Channel closed — frontend dropped it
						break;
					}
				}
			}
			Err(mpsc::RecvTimeoutError::Timeout) => {}
			Err(mpsc::RecvTimeoutError::Disconnected) => break,
		}
	}
}

fn reconcile_watchers(
	db: &DbPool,
	tx: &mpsc::Sender<WatchEvent>,
	watchers: &mut HashMap<String, ProjectWatcher>,
) {
	let targets = match db.lock() {
		Ok(mut conn) => {
			match repo::project::list_all_with_profiles(&mut conn) {
				Ok(p) => p,
				Err(e) => {
					tracing::warn!("Watcher: failed to list projects: {e}");
					return;
				}
			}
		}
		Err(_) => return,
	};
	let targets = watcher_targets(&targets);

	let current_keys: HashSet<String> =
		targets.iter().map(|target| target.key.clone()).collect();

	// Remove watchers for deleted projects/profiles
	watchers.retain(|key, _| current_keys.contains(key));

	// Add watchers for new roots
	for target in targets {
		if watchers.contains_key(&target.key) {
			continue;
		}

		let root_path = target.root_path.clone();
		let tx_clone = tx.clone();
		let target_for_event = target.clone();

		let watcher = recommended_watcher(move |res: Result<Event, _>| {
			if let Ok(event) = res {
				let dominated = matches!(
					event.kind,
					EventKind::Modify(_)
						| EventKind::Create(_)
						| EventKind::Remove(_)
				);
				if dominated {
					if let Some(event) =
						watch_event_for_notify_event(&target_for_event, &event)
					{
						let _ = tx_clone.send(event);
					}
				}
			}
		});

		match watcher {
			Ok(mut w) => {
				let path = Path::new(&root_path);
				if path.exists() {
					if let Err(e) = w.watch(path, RecursiveMode::Recursive) {
						tracing::warn!(
							"Watcher: failed to watch {root_path}: {e}"
						);
						continue;
					}
					watchers.insert(
						target.key,
						ProjectWatcher {
							_watcher: Box::new(w),
						},
					);
				}
			}
			Err(e) => {
				tracing::warn!(
					"Watcher: failed to create watcher for {root_path}: {e}"
				);
			}
		}
	}
}

fn watcher_targets(projects: &[ProjectWithProfiles]) -> Vec<WatchTarget> {
	let mut targets = Vec::new();

	for project in projects {
		let mut has_project_root_profile = false;

		for profile in &project.profiles {
			if profile.worktree_path == project.folder {
				has_project_root_profile = true;
			}

			targets.push(WatchTarget {
				key: format!(
					"profile:{}:{}",
					profile.id, profile.worktree_path
				),
				project_id: project.id.clone(),
				profile_id: Some(profile.id.clone()),
				root_path: profile.worktree_path.clone(),
			});
		}

		if !has_project_root_profile {
			targets.push(WatchTarget {
				key: format!("project:{}:{}", project.id, project.folder),
				project_id: project.id.clone(),
				profile_id: None,
				root_path: project.folder.clone(),
			});
		}
	}
	targets.sort_by(|left, right| left.key.cmp(&right.key));
	targets
}

fn prune_debounce_cache(
	last_event: &mut HashMap<String, Instant>,
	now: Instant,
) {
	last_event.retain(|_, timestamp| {
		now.duration_since(*timestamp) < DEBOUNCE_DURATION
	});

	if last_event.len() <= MAX_DEBOUNCE_KEYS {
		return;
	}

	let mut entries = last_event
		.iter()
		.map(|(key, timestamp)| (key.clone(), *timestamp))
		.collect::<Vec<_>>();
	entries.sort_by_key(|(_, timestamp)| *timestamp);

	let remove_count = last_event.len().saturating_sub(MAX_DEBOUNCE_KEYS);
	for (key, _) in entries.into_iter().take(remove_count) {
		last_event.remove(&key);
	}
}

fn watch_event_debounce_key(event: &WatchEvent) -> String {
	format!(
		"{}:{}:{}",
		event.project_id,
		event.profile_id.as_deref().unwrap_or(""),
		event.path.as_deref().unwrap_or("")
	)
}

fn watch_event_for_notify_event(
	target: &WatchTarget,
	event: &Event,
) -> Option<WatchEvent> {
	let paths = event
		.paths
		.iter()
		.filter(|path| !path.components().any(|c| c.as_os_str() == ".git"))
		.collect::<Vec<_>>();
	if paths.is_empty() {
		return None;
	}

	let root = Path::new(&target.root_path);
	let relative_paths = paths
		.iter()
		.filter_map(|path| relative_event_path(root, path))
		.collect::<Vec<_>>();
	let path = if relative_paths.len() == 1 {
		relative_paths.into_iter().next()
	} else {
		None
	};

	Some(WatchEvent {
		project_id: target.project_id.clone(),
		profile_id: target.profile_id.clone(),
		root_path: target.root_path.clone(),
		path,
	})
}

fn relative_event_path(root: &Path, path: &Path) -> Option<String> {
	let relative = path.strip_prefix(root).ok()?;
	let normalized = normalize_relative_path(relative);
	if normalized.is_empty() {
		None
	} else {
		Some(normalized)
	}
}

fn normalize_relative_path(path: &Path) -> String {
	let mut normalized = String::new();
	for component in path.components() {
		let std::path::Component::Normal(value) = component else {
			continue;
		};
		if !normalized.is_empty() {
			normalized.push('/');
		}
		normalized.push_str(&value.to_string_lossy());
	}
	normalized
}

#[cfg(test)]
mod tests {
	use model::profile::Profile;

	use super::*;

	fn profile(
		id: &str,
		project_id: &str,
		worktree_path: &str,
		is_default: bool,
	) -> Profile {
		Profile {
			id: id.to_string(),
			project_id: project_id.to_string(),
			branch_name: if is_default { "main" } else { "feature" }
				.to_string(),
			worktree_path: worktree_path.to_string(),
			created_at: "2026-01-01T00:00:00Z".to_string(),
			is_default,
			notes: String::new(),
		}
	}

	fn project_with_profiles(
		id: &str,
		folder: &str,
		profiles: Vec<Profile>,
	) -> ProjectWithProfiles {
		ProjectWithProfiles {
			id: id.to_string(),
			name: id.to_string(),
			folder: folder.to_string(),
			created_at: "2026-01-01T00:00:00Z".to_string(),
			group_id: None,
			sort_order: 1000,
			pinned_at: None,
			pinned_order: None,
			profiles,
		}
	}

	#[test]
	fn watcher_targets_include_profile_worktrees_and_dedupe_default_root() {
		let projects = vec![project_with_profiles(
			"project-1",
			"/repo",
			vec![
				profile("default-1", "project-1", "/repo", true),
				profile(
					"profile-1",
					"project-1",
					"/workspace/profile-1",
					false,
				),
			],
		)];

		let targets = watcher_targets(&projects);

		assert_eq!(targets.len(), 2);
		assert!(targets.iter().any(|target| {
			target.root_path == "/repo"
				&& target.project_id == "project-1"
				&& target.profile_id.as_deref() == Some("default-1")
		}));
		assert!(targets.iter().any(|target| {
			target.root_path == "/workspace/profile-1"
				&& target.project_id == "project-1"
				&& target.profile_id.as_deref() == Some("profile-1")
		}));
	}

	#[test]
	fn watcher_targets_keep_project_root_without_profiles() {
		let projects =
			vec![project_with_profiles("project-1", "/repo", vec![])];

		let targets = watcher_targets(&projects);

		assert_eq!(targets.len(), 1);
		assert_eq!(targets[0].root_path, "/repo");
		assert_eq!(targets[0].profile_id, None);
	}

	#[test]
	fn watcher_targets_preserve_duplicate_project_folders() {
		let projects = vec![
			project_with_profiles(
				"project-1",
				"/repo",
				vec![profile("default-1", "project-1", "/repo", true)],
			),
			project_with_profiles(
				"project-2",
				"/repo",
				vec![profile("default-2", "project-2", "/repo", true)],
			),
		];

		let targets = watcher_targets(&projects);

		assert_eq!(targets.len(), 2);
		assert!(targets.iter().any(|target| {
			target.root_path == "/repo"
				&& target.project_id == "project-1"
				&& target.profile_id.as_deref() == Some("default-1")
		}));
		assert!(targets.iter().any(|target| {
			target.root_path == "/repo"
				&& target.project_id == "project-2"
				&& target.profile_id.as_deref() == Some("default-2")
		}));
	}

	#[test]
	fn prune_debounce_cache_removes_expired_entries_and_bounds_size() {
		let now = Instant::now();
		let expired = now - DEBOUNCE_DURATION - Duration::from_millis(1);
		let fresh = now - Duration::from_millis(1);
		let mut last_event = HashMap::from([("expired".to_string(), expired)]);

		for index in 0..(MAX_DEBOUNCE_KEYS + 10) {
			last_event.insert(
				format!("fresh-{index}"),
				fresh + Duration::from_nanos(index as u64),
			);
		}

		prune_debounce_cache(&mut last_event, now);

		assert!(!last_event.contains_key("expired"));
		assert_eq!(last_event.len(), MAX_DEBOUNCE_KEYS);
		for index in 0..10 {
			assert!(!last_event.contains_key(&format!("fresh-{index}")));
		}
	}

	#[test]
	fn relative_event_path_is_root_relative() {
		let root = Path::new("/repo");

		assert_eq!(
			relative_event_path(root, Path::new("/repo/src/main.rs")),
			Some("src/main.rs".to_string()),
		);
		assert_eq!(relative_event_path(root, Path::new("/repo")), None);
		assert_eq!(
			relative_event_path(root, Path::new("/other/main.rs")),
			None
		);
	}
}
