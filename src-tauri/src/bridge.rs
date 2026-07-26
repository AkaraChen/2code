use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use tauri::{ipc::Channel, AppHandle, Emitter, Manager};

use infra::db::DbPool;
use infra::pty::{PtyReadThreads, PtySessionMap};
pub use infra::pty_stream::{
	create_output_receivers, create_output_sinks, PtyOutputReceiver,
	PtyOutputReceivers, PtyOutputSink, PtyOutputSinks,
};
use model::watcher::WatchEvent;
use service::pty::{PtyContext, PtyFlushSenders, PtyLogDir};
use service::{PtyEventEmitter, WatchEventSender};

#[derive(Clone, Default)]
pub struct RestoredHistories(pub Arc<Mutex<HashMap<String, Vec<u8>>>>);

/// Tauri implementation of the PtyEventEmitter trait.
pub struct TauriPtyEmitter {
	pub app: AppHandle,
	pub sinks: PtyOutputSinks,
	pub receivers: PtyOutputReceivers,
}

impl PtyEventEmitter for TauriPtyEmitter {
	fn emit_output(&self, session_id: &str, bytes: &[u8]) -> bool {
		infra::pty_stream::send_output(&self.sinks, session_id, bytes);
		true
	}

	fn emit_exit(&self, session_id: &str) {
		if let Ok(mut sinks) = self.sinks.lock() {
			sinks.remove(session_id);
		}
		if let Ok(mut receivers) = self.receivers.lock() {
			receivers.remove(session_id);
		}
		let _ = self.app.emit(&format!("pty-exit-{session_id}"), ());
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
	PtyContext {
		db: app.state::<DbPool>().inner().clone(),
		sessions: app.state::<PtySessionMap>().inner().clone(),
		flush_senders: app.state::<PtyFlushSenders>().inner().clone(),
		read_threads: app.state::<PtyReadThreads>().inner().clone(),
		emitter: Arc::new(TauriPtyEmitter {
			app: app.clone(),
			sinks: app.state::<PtyOutputSinks>().inner().clone(),
			receivers: app.state::<PtyOutputReceivers>().inner().clone(),
		}),
		output_dir: app.state::<PtyLogDir>().0.clone(),
	}
}
