use model::watcher::WatchEvent;

pub mod filesystem;
pub mod profile;
pub mod project;
pub mod pty;
pub mod watcher;

/// Trait for emitting PTY events to the frontend.
/// Implemented by the app layer (Tauri bridge).
pub trait PtyEventEmitter: Send + Sync + 'static {
	/// Emit terminal output bytes to the frontend for the given session.
	///
	/// May block when the frontend consumer lags. Call only from a dedicated
	/// OS thread, never from within a Tokio runtime.
	fn emit_output(&self, session_id: &str, bytes: &[u8]) -> bool;
	/// Emit session exit signal.
	fn emit_exit(&self, session_id: &str);
}

/// Trait for sending file watch events to the frontend.
/// Implemented by the app layer (Tauri bridge).
pub trait WatchEventSender: Send + 'static {
	/// Send a watch event. Returns false if the channel is closed.
	fn send(&self, event: WatchEvent) -> bool;
}
