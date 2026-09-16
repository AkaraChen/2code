use std::sync::Arc;

use tauri::{ipc::Channel, AppHandle, Manager};

use infra::db::DbPool;
use model::watcher::WatchEvent;
use service::runtime::{HerdrClientGuard, RuntimeHandle};
use service::WatchEventSender;

/// Tauri implementation of the WatchEventSender trait.
pub struct TauriWatchSender(pub Channel<WatchEvent>);

impl WatchEventSender for TauriWatchSender {
	fn send(&self, event: WatchEvent) -> bool {
		self.0.send(event).is_ok()
	}
}

/// Wire the production GUI runtime. Always Herdr: resolve the pinned
/// v0.9.0 sidecar, ensure the dedicated 2code namespace, and inject JSON
/// terminal + worktree + CLI attach clients. Missing sidecar fails closed.
pub fn build_runtime(app: &AppHandle) -> RuntimeHandle {
	let db = app.state::<DbPool>().inner().clone();
	let guard = app.state::<HerdrClientGuard>();
	Arc::new(service::runtime::build_gui_runtime(
		db,
		guard.inner(),
		infra::herdr::process::default_xdg_config_home(),
	))
}
