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

	let current_ids: std::collections::HashSet<&str> =
		projects.iter().map(|p| p.id.as_str()).collect();

	// Remove watchers for deleted projects
	watchers.retain(|id, _| current_ids.contains(id.as_str()));

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
						tracing::warn!(
							"Watcher: failed to watch {folder}: {e}"
						);
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

#[cfg(test)]
mod tests {
	use std::collections::{HashMap, HashSet};
	use std::time::Instant;

	use model::project::Project;

	fn make_projects(count: usize) -> Vec<Project> {
		(0..count)
			.map(|index| Project {
				id: format!("project-{index:05}"),
				name: format!("Project {index}"),
				folder: format!("/tmp/project-{index:05}"),
				created_at: "2026-05-15T00:00:00Z".to_string(),
				group_id: None,
			})
			.collect()
	}

	fn make_watcher_ids(count: usize) -> HashMap<String, ()> {
		(0..count)
			.map(|index| {
				let id = if index % 5 == 0 {
					format!("deleted-project-{index:05}")
				} else {
					format!("project-{index:05}")
				};
				(id, ())
			})
			.collect()
	}

	fn retain_with_cloned_ids(
		projects: &[Project],
		watchers: &mut HashMap<String, ()>,
	) {
		let current_ids: HashSet<String> =
			projects.iter().map(|p| p.id.clone()).collect();
		watchers.retain(|id, _| current_ids.contains(id));
	}

	fn retain_with_borrowed_ids(
		projects: &[Project],
		watchers: &mut HashMap<String, ()>,
	) {
		let current_ids: HashSet<&str> =
			projects.iter().map(|p| p.id.as_str()).collect();
		watchers.retain(|id, _| current_ids.contains(id.as_str()));
	}

	#[test]
	#[ignore = "benchmark: run with --release -- --ignored --nocapture"]
	fn watcher_reconcile_ids_benchmark() {
		let projects = make_projects(10_000);
		let baseline_watchers = make_watcher_ids(12_000);

		let mut cloned_watchers = baseline_watchers.clone();
		let cloned_start = Instant::now();
		for _ in 0..250 {
			cloned_watchers = baseline_watchers.clone();
			retain_with_cloned_ids(&projects, &mut cloned_watchers);
		}
		let cloned_duration = cloned_start.elapsed();

		let mut borrowed_watchers = baseline_watchers.clone();
		let borrowed_start = Instant::now();
		for _ in 0..250 {
			borrowed_watchers = baseline_watchers.clone();
			retain_with_borrowed_ids(&projects, &mut borrowed_watchers);
		}
		let borrowed_duration = borrowed_start.elapsed();

		assert_eq!(cloned_watchers, borrowed_watchers);

		println!(
			"watcher reconcile ids benchmark: cloned_ids={:?} borrowed_ids={:?} speedup={:.2}x",
			cloned_duration,
			borrowed_duration,
			cloned_duration.as_secs_f64() / borrowed_duration.as_secs_f64()
		);
	}
}
