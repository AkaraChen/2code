use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use model::error::AppError;
use serde::Serialize;
use tracing_chrome::TraceStyle;
use tracing_subscriber::layer::SubscriberExt;
use tracing_subscriber::util::SubscriberInitExt;

pub struct DevProfileState {
	enabled: bool,
	run_dir: Option<PathBuf>,
	frontend_path: Option<PathBuf>,
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

fn profile_enabled() -> bool {
	tauri::is_dev()
		&& std::env::var("TWOCODE_PROFILE")
			.map(|value| value != "0")
			.unwrap_or(true)
}

pub fn init(
	app_data_dir: &Path,
	channel_layer: infra::logger::ChannelLayer,
) -> DevProfileState {
	let fmt_layer = tracing_subscriber::fmt::layer()
		.with_target(true)
		.with_level(true);

	if !profile_enabled() {
		tracing_subscriber::registry()
			.with(fmt_layer)
			.with(channel_layer)
			.init();
		return DevProfileState {
			enabled: false,
			run_dir: None,
			frontend_path: None,
			_guard: Mutex::new(None),
		};
	}

	let run_dir = app_data_dir
		.join("profiles")
		.join(format!("dev-{}", unix_ms()));
	let backend_path = run_dir.join("backend-trace.json");
	let frontend_path = run_dir.join("frontend-perf.jsonl");

	fs::create_dir_all(&run_dir).expect("failed to create dev profile dir");
	let manifest = Manifest {
		started_at_unix_ms: unix_ms(),
		backend_trace: "backend-trace.json",
		frontend_events: "frontend-perf.jsonl",
	};
	let manifest_json = serde_json::to_vec_pretty(&manifest)
		.expect("serialize profile manifest");
	fs::write(run_dir.join("manifest.json"), manifest_json)
		.expect("write profile manifest");

	let (chrome_layer, guard) = tracing_chrome::ChromeLayerBuilder::new()
		.file(&backend_path)
		.include_args(true)
		.trace_style(TraceStyle::Async)
		.build();

	tracing_subscriber::registry()
		.with(fmt_layer)
		.with(channel_layer)
		.with(chrome_layer)
		.init();

	tracing::info!(
		target: "profiler",
		path = %run_dir.display(),
		"dev profiling enabled"
	);

	DevProfileState {
		enabled: true,
		run_dir: Some(run_dir),
		frontend_path: Some(frontend_path),
		_guard: Mutex::new(Some(guard)),
	}
}

impl DevProfileState {
	pub fn enabled(&self) -> bool {
		self.enabled
	}

	pub fn append_jsonl<T: Serialize>(
		&self,
		entries: &[T],
	) -> Result<(), AppError> {
		if entries.is_empty() {
			return Ok(());
		}
		let Some(path) = &self.frontend_path else {
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
		if let Ok(mut guard) = self._guard.lock() {
			guard.take();
		}
		if let Some(run_dir) = &self.run_dir {
			tracing::info!(
				target: "profiler",
				path = %run_dir.display(),
				"dev profile flushed"
			);
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
			enabled: true,
			run_dir: None,
			frontend_path: Some(path.clone()),
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
}
