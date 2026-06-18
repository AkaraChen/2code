use std::fs::{self, OpenOptions};
use std::io::{sink, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use model::error::AppError;
use serde::Serialize;
use tracing_chrome::TraceStyle;
use tracing_subscriber::filter::filter_fn;
use tracing_subscriber::layer::SubscriberExt;
use tracing_subscriber::util::SubscriberInitExt;
use tracing_subscriber::Layer;

pub struct DevProfileState {
	app_data_dir: PathBuf,
	enabled: Mutex<bool>,
	trace_enabled: Arc<AtomicBool>,
	run_dir: Mutex<Option<PathBuf>>,
	frontend_path: Mutex<Option<PathBuf>>,
	_guard: Mutex<Option<tracing_chrome::FlushGuard>>,
}

#[derive(Serialize)]
struct Manifest<'a> {
	started_at_unix_ms: u128,
	backend_trace: &'a str,
	frontend_events: &'a str,
}

fn unix_ms() -> u128 {
	SystemTime::now()
		.duration_since(UNIX_EPOCH)
		.unwrap_or_default()
		.as_millis()
}

fn initial_profile_enabled() -> bool {
	std::env::var("TWOCODE_PROFILE")
		.map(|value| value == "1")
		.unwrap_or(false)
}

fn create_profile_run(
	app_data_dir: &Path,
) -> Result<(PathBuf, PathBuf, PathBuf), AppError> {
	let timestamp = unix_ms();
	let run_dir = app_data_dir
		.join("profiles")
		.join(format!("profile-{timestamp}"));
	let backend_path = run_dir.join("backend-trace.json");
	let frontend_path = run_dir.join("frontend-perf.jsonl");

	fs::create_dir_all(&run_dir).map_err(AppError::IoError)?;
	let manifest = Manifest {
		started_at_unix_ms: timestamp,
		backend_trace: "backend-trace.json",
		frontend_events: "frontend-perf.jsonl",
	};
	let manifest_json = serde_json::to_vec_pretty(&manifest)
		.map_err(|err| AppError::IoError(std::io::Error::other(err)))?;
	fs::write(run_dir.join("manifest.json"), manifest_json)
		.map_err(AppError::IoError)?;

	Ok((run_dir, backend_path, frontend_path))
}

pub fn init(
	app_data_dir: &Path,
	channel_layer: infra::logger::ChannelLayer,
) -> DevProfileState {
	let fmt_layer = tracing_subscriber::fmt::layer()
		.with_target(true)
		.with_level(true);

	let (chrome_layer, guard) = tracing_chrome::ChromeLayerBuilder::new()
		.writer(sink())
		.include_args(true)
		.trace_style(TraceStyle::Async)
		.build();
	let trace_enabled = Arc::new(AtomicBool::new(false));
	let trace_filter_enabled = trace_enabled.clone();

	tracing_subscriber::registry()
		.with(fmt_layer)
		.with(channel_layer)
		.with(chrome_layer.with_filter(filter_fn(move |_| {
			trace_filter_enabled.load(Ordering::Relaxed)
		})))
		.init();

	let state = DevProfileState {
		app_data_dir: app_data_dir.to_path_buf(),
		enabled: Mutex::new(false),
		trace_enabled,
		run_dir: Mutex::new(None),
		frontend_path: Mutex::new(None),
		_guard: Mutex::new(Some(guard)),
	};

	if initial_profile_enabled() {
		state
			.set_enabled(true)
			.expect("enable initial performance profiling");
	}

	state
}

impl DevProfileState {
	pub fn enabled(&self) -> bool {
		self.enabled.lock().map(|value| *value).unwrap_or(false)
	}

	pub fn run_dir(&self) -> Option<PathBuf> {
		self.run_dir.lock().ok().and_then(|value| value.clone())
	}

	pub fn set_enabled(
		&self,
		enabled: bool,
	) -> Result<Option<PathBuf>, AppError> {
		let mut enabled_guard =
			self.enabled.lock().map_err(|_| AppError::LockError)?;
		if enabled == *enabled_guard {
			return Ok(self.run_dir());
		}

		let guard = self._guard.lock().map_err(|_| AppError::LockError)?;
		let Some(trace_guard) = guard.as_ref() else {
			return Ok(None);
		};

		if enabled {
			let (run_dir, backend_path, frontend_path) =
				create_profile_run(&self.app_data_dir)?;
			let backend_file =
				fs::File::create(&backend_path).map_err(AppError::IoError)?;
			trace_guard.start_new(Some(Box::new(backend_file)));
			self.trace_enabled.store(true, Ordering::Relaxed);
			*self.run_dir.lock().map_err(|_| AppError::LockError)? =
				Some(run_dir.clone());
			*self.frontend_path.lock().map_err(|_| AppError::LockError)? =
				Some(frontend_path);
			*enabled_guard = true;
			tracing::info!(
				target: "profiler",
				path = %run_dir.display(),
				"performance profiling enabled"
			);
			Ok(Some(run_dir))
		} else {
			self.trace_enabled.store(false, Ordering::Relaxed);
			trace_guard.start_new(Some(Box::new(sink())));
			*enabled_guard = false;
			*self.run_dir.lock().map_err(|_| AppError::LockError)? = None;
			*self.frontend_path.lock().map_err(|_| AppError::LockError)? = None;
			tracing::info!(target: "profiler", "performance profiling disabled");
			Ok(None)
		}
	}

	pub fn append_jsonl<T: Serialize>(
		&self,
		entries: &[T],
	) -> Result<(), AppError> {
		if entries.is_empty() {
			return Ok(());
		}
		let path = self
			.frontend_path
			.lock()
			.map_err(|_| AppError::LockError)?
			.clone();
		let Some(path) = path else {
			return Ok(());
		};

		let mut file = OpenOptions::new()
			.create(true)
			.append(true)
			.open(path)
			.map_err(AppError::IoError)?;

		for entry in entries {
			serde_json::to_writer(&mut file, entry)
				.map_err(|err| AppError::IoError(std::io::Error::other(err)))?;
			file.write_all(b"\n").map_err(AppError::IoError)?;
		}

		Ok(())
	}

	pub fn finish(&self) {
		if let Some(run_dir) = self.run_dir() {
			tracing::info!(target: "profiler", path = %run_dir.display(), "profile flushed");
		}
		if let Ok(mut guard) = self._guard.lock() {
			guard.take();
		}
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	#[derive(Serialize)]
	struct Event<'a> {
		name: &'a str,
	}

	#[test]
	fn append_jsonl_writes_one_event_per_line() {
		let path = std::env::temp_dir()
			.join(format!("2code-profile-test-{}.jsonl", unix_ms()));
		let state = DevProfileState {
			app_data_dir: std::env::temp_dir(),
			enabled: Mutex::new(true),
			trace_enabled: Arc::new(AtomicBool::new(true)),
			run_dir: Mutex::new(None),
			frontend_path: Mutex::new(Some(path.clone())),
			_guard: Mutex::new(None),
		};

		state
			.append_jsonl(&[Event { name: "one" }, Event { name: "two" }])
			.expect("append events");

		let content = fs::read_to_string(&path).expect("read events");
		let _ = fs::remove_file(&path);

		assert_eq!(content.lines().count(), 2);
		assert!(content.contains("\"one\""));
		assert!(content.contains("\"two\""));
	}

	#[test]
	fn create_profile_run_writes_manifest() {
		let root = std::env::temp_dir()
			.join(format!("2code-profile-run-test-{}", unix_ms()));

		let (run_dir, backend_path, frontend_path) =
			create_profile_run(&root).expect("create run");

		assert!(run_dir.exists());
		assert_eq!(backend_path.file_name().unwrap(), "backend-trace.json");
		assert_eq!(frontend_path.file_name().unwrap(), "frontend-perf.jsonl");
		assert!(run_dir.join("manifest.json").exists());

		let _ = fs::remove_dir_all(root);
	}
}
