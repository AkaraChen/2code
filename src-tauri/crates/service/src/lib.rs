use model::watcher::WatchEvent;

pub mod agent;
pub mod profile;
pub mod project;
pub mod pty;
pub mod skill;
pub mod snippet;
pub mod stats;
pub mod watcher;

/// Trait for emitting PTY events to the frontend.
/// Implemented by the app layer (Tauri bridge).
pub trait PtyEventEmitter: Send + Sync + 'static {
	/// Emit terminal output text. Returns false if the channel is closed.
	fn emit_output(&self, session_id: &str, text: &str) -> bool;
	/// Emit session exit signal.
	fn emit_exit(&self, session_id: &str);
}

/// Trait for sending file watch events to the frontend.
/// Implemented by the app layer (Tauri bridge).
pub trait WatchEventSender: Send + 'static {
	/// Send a watch event. Returns false if the channel is closed.
	fn send(&self, event: WatchEvent) -> bool;
}
