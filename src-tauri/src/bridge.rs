use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use tauri::{ipc::Channel, AppHandle, Emitter, Manager};
use tokio::sync::mpsc;

use infra::db::DbPool;
use infra::pty::{PtyReadThreads, PtySessionMap};
use model::watcher::WatchEvent;
use service::pty::{PtyContext, PtyFlushSenders, PtyLogDir};
use service::{PtyEventEmitter, WatchEventSender};

pub struct PtyOutputSink {
	pub stream_id: String,
	pub sender: mpsc::UnboundedSender<Vec<u8>>,
}

pub struct PtyOutputReceiver {
	pub stream_id: String,
	pub receiver: mpsc::UnboundedReceiver<Vec<u8>>,
}

pub type PtyOutputSinks = Arc<Mutex<HashMap<String, PtyOutputSink>>>;
pub type PtyOutputReceivers = Arc<Mutex<HashMap<String, PtyOutputReceiver>>>;

pub fn create_output_sinks() -> PtyOutputSinks {
	Arc::new(Mutex::new(HashMap::new()))
}

pub fn create_output_receivers() -> PtyOutputReceivers {
	Arc::new(Mutex::new(HashMap::new()))
}

/// Tauri implementation of the PtyEventEmitter trait.
pub struct TauriPtyEmitter {
	pub app: AppHandle,
	pub sinks: PtyOutputSinks,
	pub receivers: PtyOutputReceivers,
}

impl PtyEventEmitter for TauriPtyEmitter {
	fn emit_output(&self, session_id: &str, bytes: &[u8]) -> bool {
		let Ok(sinks) = self.sinks.lock() else {
			return true;
		};
		let should_detach = sinks
			.get(session_id)
			.is_some_and(|sink| sink.sender.send(bytes.to_vec()).is_err());
		drop(sinks);

		if should_detach {
			if let Ok(mut sinks) = self.sinks.lock() {
				sinks.remove(session_id);
			}
		}

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
