use std::fmt;
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use tracing::field::{Field, Visit};
use tracing::Level;
use tracing_subscriber::layer::Context;
use tracing_subscriber::Layer;

use model::debug::LogEntry;

/// A tracing Layer that forwards log events to an attached sink when active.
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
	/// Start forwarding log events to the given sink function.
	/// Spawns a thread that reads from the internal mpsc and calls the sink.
	/// The sink should return `true` to continue, `false` to stop.
	pub fn attach(&self, sink: impl Fn(LogEntry) -> bool + Send + 'static) {
		let (sender, receiver) = mpsc::channel::<LogEntry>();

		// Set the sender so the Layer starts forwarding
		if let Ok(mut guard) = self.tx.lock() {
			*guard = Some(sender);
		}

		// Spawn forwarder thread
		std::thread::spawn(move || {
			while let Ok(entry) = receiver.recv() {
				if !sink(entry) {
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
	fields: String,
}

impl MessageVisitor {
	fn new() -> Self {
		Self {
			message: String::new(),
			fields: String::new(),
		}
	}

	fn into_message(self) -> String {
		if self.fields.is_empty() {
			return self.message;
		}
		if self.message.is_empty() {
			self.fields
		} else {
			format!("{} {}", self.message, self.fields)
		}
	}

	fn push_field(&mut self, name: &str, value: impl fmt::Display) {
		if !self.fields.is_empty() {
			self.fields.push(' ');
		}
		use std::fmt::Write as _;
		let _ = write!(&mut self.fields, "{name}={value}");
	}
}

impl Visit for MessageVisitor {
	fn record_debug(&mut self, field: &Field, value: &dyn fmt::Debug) {
		if field.name() == "message" {
			self.message = format!("{value:?}");
		} else {
			self.push_field(field.name(), format_args!("{value:?}"));
		}
	}

	fn record_str(&mut self, field: &Field, value: &str) {
		if field.name() == "message" {
			self.message = value.to_string();
		} else {
			self.push_field(field.name(), value);
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

#[cfg(test)]
mod tests {
	use std::sync::mpsc;
	use std::time::Duration;
	use std::time::Instant;

	use tracing_subscriber::prelude::*;

	use super::ChannelLayer;
	use super::MessageVisitor;

	struct OldMessageVisitor {
		message: String,
		fields: Vec<(String, String)>,
	}

	impl OldMessageVisitor {
		fn new() -> Self {
			Self {
				message: String::new(),
				fields: Vec::new(),
			}
		}

		fn record_field(&mut self, name: &str, value: &str) {
			self.fields.push((name.to_string(), value.to_string()));
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

	#[test]
	fn forwards_info_events_with_target_and_fields() {
		let (layer, handle) = ChannelLayer::new();
		let (tx, rx) = mpsc::channel();
		handle.attach(move |entry| {
			tx.send(entry).expect("send log entry");
			false
		});

		let subscriber = tracing_subscriber::registry().with(layer);
		tracing::subscriber::with_default(subscriber, || {
			tracing::info!(target: "logger-test", answer = 42, "hello");
		});

		let entry = rx
			.recv_timeout(Duration::from_secs(1))
			.expect("receive log entry");
		assert_eq!(entry.level, "INFO");
		assert_eq!(entry.source, "logger-test");
		assert!(entry.message.contains("hello"));
		assert!(entry.message.contains("answer=42"));
	}

	#[test]
	fn ignores_debug_events() {
		let (layer, handle) = ChannelLayer::new();
		let (tx, rx) = mpsc::channel();
		handle.attach(move |entry| {
			tx.send(entry).expect("send log entry");
			true
		});

		let subscriber = tracing_subscriber::registry().with(layer);
		tracing::subscriber::with_default(subscriber, || {
			tracing::debug!(target: "logger-test", "skip me");
		});

		assert!(rx.recv_timeout(Duration::from_millis(200)).is_err());
	}

	#[test]
	fn detach_stops_forwarding_new_events() {
		let (layer, handle) = ChannelLayer::new();
		let (tx, rx) = mpsc::channel();
		handle.attach(move |entry| {
			tx.send(entry).expect("send log entry");
			true
		});
		handle.detach();

		let subscriber = tracing_subscriber::registry().with(layer);
		tracing::subscriber::with_default(subscriber, || {
			tracing::info!(target: "logger-test", "ignored");
		});

		assert!(rx.recv_timeout(Duration::from_millis(200)).is_err());
	}

	#[test]
	#[ignore]
	fn bench_logger_message_fields_without_vec_join() {
		let fields = [
			("session_id", "\"s-123\""),
			("profile_id", "\"p-123\""),
			("bytes", "4096"),
			("target", "\"pty\""),
			("elapsed_ms", "17"),
		];
		let iterations = 200_000;

		let old_start = Instant::now();
		for _ in 0..iterations {
			let mut visitor = OldMessageVisitor::new();
			visitor.message = "persist: appended".to_string();
			for (name, value) in fields {
				visitor.record_field(name, value);
			}
			assert!(visitor.into_message().contains("session_id"));
		}
		let old_duration = old_start.elapsed();

		let new_start = Instant::now();
		for _ in 0..iterations {
			let mut visitor = MessageVisitor::new();
			visitor.message = "persist: appended".to_string();
			for (name, value) in fields {
				visitor.push_field(name, value);
			}
			assert!(visitor.into_message().contains("session_id"));
		}
		let new_duration = new_start.elapsed();

		println!(
			"vec_join_fields={old_duration:?} direct_fields={new_duration:?} speedup={:.2}x",
			old_duration.as_secs_f64() / new_duration.as_secs_f64()
		);
	}
}
