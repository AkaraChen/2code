use std::sync::Arc;

use tauri::{ipc::Channel, AppHandle, Emitter, Manager};

use infra::db::DbPool;
use infra::pty::{PtyReadThreads, PtySessionMap};
use model::watcher::WatchEvent;
use service::pty::{PtyContext, PtyFlushSenders};
use service::{PtyEventEmitter, WatchEventSender};

/// Tauri implementation of the PtyEventEmitter trait.
pub struct TauriPtyEmitter(pub AppHandle);

impl PtyEventEmitter for TauriPtyEmitter {
	fn emit_output(&self, session_id: &str, text: &str) -> bool {
		self.0
			.emit(&format!("pty-output-{session_id}"), text)
			.is_ok()
	}

	fn emit_exit(&self, session_id: &str) {
		let _ = self.0.emit(&format!("pty-exit-{session_id}"), ());
	}
}

/// Tauri implementation of the WatchEventSender trait.
pub struct TauriWatchSender(pub Channel<WatchEvent>);

impl WatchEventSender for TauriWatchSender {
	fn send(&self, event: WatchEvent) -> bool {
		self.0.send(event).is_ok()
	}
}

/// Build a PtyContext from the Tauri AppHandle by extracting all managed state.
pub fn build_pty_context(app: &AppHandle) -> PtyContext {
	let helper = app.try_state::<crate::helper::HelperState>();
	PtyContext {
		db: app.state::<DbPool>().inner().clone(),
		sessions: app.state::<PtySessionMap>().inner().clone(),
		flush_senders: app.state::<PtyFlushSenders>().inner().clone(),
		read_threads: app.state::<PtyReadThreads>().inner().clone(),
		emitter: Arc::new(TauriPtyEmitter(app.clone())),
		helper_url: helper
			.as_ref()
			.map(|s| format!("http://127.0.0.1:{}", s.port)),
		helper_bin: helper
			.as_ref()
			.map(|s| s.sidecar_path.to_string_lossy().to_string()),
	}
}
