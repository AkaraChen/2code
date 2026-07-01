use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use tauri::{
	ipc::{Channel, InvokeResponseBody},
	AppHandle, Emitter, Manager,
};

use infra::db::DbPool;
use infra::pty::{PtyReadThreads, PtySessionMap};
use model::notification::{AgentStatus, AgentStatusEvent};
use model::watcher::WatchEvent;
use service::pty::{PtyContext, PtyFlushSenders, PtyLogDir};
use service::{PtyEventEmitter, WatchEventSender};

/// Per-session raw-byte output channels, keyed by session id. A terminal
/// registers its channel via `attach_pty_output` when it mounts and removes it
/// via `detach_pty_output` on teardown. PTY output is delivered as raw binary
/// frames (no JSON serialization), mirroring the file-watcher `Channel` pattern.
pub type PtyOutputSinks = Arc<Mutex<HashMap<String, Channel<InvokeResponseBody>>>>;

pub fn create_output_sinks() -> PtyOutputSinks {
	Arc::new(Mutex::new(HashMap::new()))
}

/// Tauri implementation of the PtyEventEmitter trait.
pub struct TauriPtyEmitter {
	pub app: AppHandle,
	pub sinks: PtyOutputSinks,
}

impl PtyEventEmitter for TauriPtyEmitter {
	fn emit_output(&self, session_id: &str, bytes: &[u8]) -> bool {
		// Deliver raw bytes over the session's channel. If no terminal is
		// attached yet, silently drop — those bytes live in the persisted log
		// and are replayed on restore. A send failure means the frontend went
		// away; drop the stale sink but keep the read loop (and persistence)
		// alive by returning true.
		let Ok(sinks) = self.sinks.lock() else {
			return true;
		};
		if let Some(channel) = sinks.get(session_id) {
			if channel.send(InvokeResponseBody::Raw(bytes.to_vec())).is_err() {
				drop(sinks);
				if let Ok(mut sinks) = self.sinks.lock() {
					sinks.remove(session_id);
				}
			}
		}
		true
	}

	fn emit_exit(&self, session_id: &str) {
		let _ = self.app.emit(&format!("pty-exit-{session_id}"), ());
		let _ = self.app.emit(
			"pty-agent-status",
			AgentStatusEvent {
				session_id: session_id.to_string(),
				status: AgentStatus::Idle,
			},
		);
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
		}),
		output_dir: app.state::<PtyLogDir>().0.clone(),
		helper_url: app
			.try_state::<crate::helper::HelperState>()
			.map(|s| format!("http://127.0.0.1:{}", s.port)),
		helper_bin: app
			.try_state::<crate::helper::HelperState>()
			.map(|s| s.sidecar_path.to_string_lossy().to_string()),
	}
}
