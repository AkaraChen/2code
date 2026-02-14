use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::Ordering;
use std::sync::mpsc;
use std::time::{Duration, Instant};

use notify::{recommended_watcher, Event, EventKind, RecursiveMode, Watcher};

use infra::db::DbPool;
use infra::watcher::WatcherShutdownFlag;
use model::watcher::WatchEvent;

use crate::WatchEventSender;

const DB_POLL_INTERVAL: Duration = Duration::from_secs(3);
const RECV_TIMEOUT: Duration = Duration::from_millis(100);
const DEBOUNCE_DURATION: Duration = Duration::from_millis(500);

struct ProjectWatcher {
	// The watcher must be kept alive — dropping it stops watching.
	_watcher: Box<dyn Watcher + Send>,
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
	let (tx, rx) = mpsc::channel::<(String, PathBuf)>();

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
			Ok((project_id, _path)) => {
				let now = Instant::now();
				let should_send = last_event
					.get(&project_id)
					.map(|t| now.duration_since(*t) >= DEBOUNCE_DURATION)
					.unwrap_or(true);

				if should_send {
					last_event.insert(project_id.clone(), now);
					tracing::info!(target: "watcher", %project_id, "file changed");
					let event = WatchEvent { project_id };
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
	tx: &mpsc::Sender<(String, PathBuf)>,
	watchers: &mut HashMap<String, ProjectWatcher>,
) {
	let projects = match db.lock() {
		Ok(mut conn) => match repo::project::list_all(&mut conn) {
			Ok(p) => p,
			Err(e) => {
				tracing::warn!("Watcher: failed to list projects: {e}");
				return;
			}
		},
		Err(_) => return,
	};

	let current_ids: std::collections::HashSet<String> =
		projects.iter().map(|p| p.id.clone()).collect();

	// Remove watchers for deleted projects
	watchers.retain(|id, _| current_ids.contains(id));

	// Add watchers for new projects
	for project in projects {
		if watchers.contains_key(&project.id) {
			continue;
		}

		let folder = project.folder.clone();
		let project_id = project.id.clone();
		let tx_clone = tx.clone();

		let watcher = recommended_watcher(move |res: Result<Event, _>| {
			if let Ok(event) = res {
				let dominated = matches!(
					event.kind,
					EventKind::Modify(_)
						| EventKind::Create(_)
						| EventKind::Remove(_)
				);
				if dominated {
					for path in &event.paths {
						// Skip .git internal files to reduce noise
						if path.components().any(|c| c.as_os_str() == ".git") {
							continue;
						}
						let _ =
							tx_clone.send((project_id.clone(), path.clone()));
					}
				}
			}
		});

		match watcher {
			Ok(mut w) => {
				let path = std::path::Path::new(&folder);
				if path.exists() {
					if let Err(e) = w.watch(path, RecursiveMode::Recursive) {
						tracing::warn!("Watcher: failed to watch {folder}: {e}");
						continue;
					}
					watchers.insert(
						project.id.clone(),
						ProjectWatcher {
							_watcher: Box::new(w),
						},
					);
				}
			}
			Err(e) => {
				tracing::warn!(
					"Watcher: failed to create watcher for {folder}: {e}"
				);
			}
		}
	}
}
