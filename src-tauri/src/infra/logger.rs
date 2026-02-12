use std::fmt;
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use tauri::ipc::Channel;
use tracing::field::{Field, Visit};
use tracing::Level;
use tracing_subscriber::layer::Context;
use tracing_subscriber::Layer;

use crate::model::debug::LogEntry;

/// A tracing Layer that forwards log events to a Tauri Channel when active.
pub struct ChannelLayer {
	tx: Arc<Mutex<Option<mpsc::Sender<LogEntry>>>>,
}

/// Clonable handle to attach/detach the frontend transport.
#[derive(Clone)]
pub struct ChannelLayerHandle {
	tx: Arc<Mutex<Option<mpsc::Sender<LogEntry>>>>,
}

impl ChannelLayer {
	pub fn new() -> (Self, ChannelLayerHandle) {
		let tx = Arc::new(Mutex::new(None));
		(ChannelLayer { tx: tx.clone() }, ChannelLayerHandle { tx })
	}
}

impl ChannelLayerHandle {
	/// Start forwarding log events to the given Tauri channel.
	/// Spawns a thread that reads from the internal mpsc and sends to the Channel.
	pub fn attach(&self, channel: Channel<LogEntry>) {
		let (sender, receiver) = mpsc::channel::<LogEntry>();

		// Set the sender so the Layer starts forwarding
		if let Ok(mut guard) = self.tx.lock() {
			*guard = Some(sender);
		}

		// Spawn forwarder thread
		std::thread::spawn(move || {
			while let Ok(entry) = receiver.recv() {
				if channel.send(entry).is_err() {
					break;
				}
			}
		});
	}

	/// Stop forwarding. Drops the sender, which causes the forwarder thread to exit.
	pub fn detach(&self) {
		if let Ok(mut guard) = self.tx.lock() {
			*guard = None;
		}
	}
}

/// Visitor that collects event fields into a message string.
struct MessageVisitor {
	message: String,
	fields: Vec<(String, String)>,
}

impl MessageVisitor {
	fn new() -> Self {
		Self {
			message: String::new(),
			fields: Vec::new(),
		}
	}

	fn into_message(self) -> String {
		if self.fields.is_empty() {
			return self.message;
		}
		let field_str: Vec<String> = self
			.fields
			.into_iter()
			.map(|(k, v)| format!("{k}={v}"))
			.collect();
		if self.message.is_empty() {
			field_str.join(" ")
		} else {
			format!("{} {}", self.message, field_str.join(" "))
		}
	}
}

impl Visit for MessageVisitor {
	fn record_debug(&mut self, field: &Field, value: &dyn fmt::Debug) {
		if field.name() == "message" {
			self.message = format!("{value:?}");
		} else {
			self.fields
				.push((field.name().to_string(), format!("{value:?}")));
		}
	}

	fn record_str(&mut self, field: &Field, value: &str) {
		if field.name() == "message" {
			self.message = value.to_string();
		} else {
			self.fields
				.push((field.name().to_string(), value.to_string()));
		}
	}
}

impl<S: tracing::Subscriber> Layer<S> for ChannelLayer {
	fn on_event(&self, event: &tracing::Event<'_>, _ctx: Context<'_, S>) {
		let meta = event.metadata();

		// Only forward info level and above
		if *meta.level() > Level::INFO {
			return;
		}

		// Only try sending if there's an active sender
		let sender = {
			let Ok(guard) = self.tx.lock() else {
				return;
			};
			guard.clone()
		};
		let Some(tx) = sender else {
			return;
		};

		let mut visitor = MessageVisitor::new();
		event.record(&mut visitor);

		let timestamp = SystemTime::now()
			.duration_since(UNIX_EPOCH)
			.unwrap_or_default()
			.as_millis() as u64;

		let entry = LogEntry {
			timestamp,
			level: meta.level().to_string(),
			source: meta.target().to_string(),
			message: visitor.into_message(),
		};

		// Fire-and-forget — don't block the logging call
		let _ = tx.send(entry);
	}
}
