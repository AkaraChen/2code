use model::watcher::WatchEvent;

pub mod filesystem;
pub mod profile;
pub mod project;
pub mod runtime;
pub mod runtime_agent;
pub mod runtime_sync;
pub mod watcher;

/// Trait for sending file watch events to the frontend.
/// Implemented by the app layer (Tauri bridge).
pub trait WatchEventSender: Send + 'static {
	/// Send a watch event. Returns false if the channel is closed.
	fn send(&self, event: WatchEvent) -> bool;
}
