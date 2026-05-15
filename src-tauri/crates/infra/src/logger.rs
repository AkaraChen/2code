use std::fmt::{self, Write};
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

		let mut message = self.message;
		for (key, value) in self.fields {
			if !message.is_empty() {
				message.push(' ');
			}
			let _ = write!(message, "{key}={value}");
		}
		message
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

#[cfg(test)]
mod tests {
	use std::sync::mpsc;
	use std::time::Duration;
	use std::time::Instant;

	use tracing_subscriber::prelude::*;

	use super::ChannelLayer;
	use super::MessageVisitor;

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
	fn message_visitor_formats_message_and_fields() {
		let visitor = MessageVisitor {
			message: "hello".to_string(),
			fields: vec![
				("answer".to_string(), "42".to_string()),
				("ok".to_string(), "true".to_string()),
			],
		};

		assert_eq!(visitor.into_message(), "hello answer=42 ok=true");
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

	fn format_with_collect_join(
		message: &str,
		fields: &[(String, String)],
	) -> String {
		let field_str: Vec<String> = fields
			.iter()
			.map(|(key, value)| format!("{key}={value}"))
			.collect();
		if message.is_empty() {
			field_str.join(" ")
		} else {
			format!("{} {}", message, field_str.join(" "))
		}
	}

	fn format_with_direct_write(
		message: &str,
		fields: &[(String, String)],
	) -> String {
		let visitor = MessageVisitor {
			message: message.to_string(),
			fields: fields.to_vec(),
		};
		visitor.into_message()
	}

	#[test]
	#[ignore]
	fn benchmark_message_visitor_formatting() {
		let fields: Vec<(String, String)> = (0..16)
			.map(|index| {
				(format!("field_{index}"), format!("value_{}", index * 17))
			})
			.collect();
		let iterations = 200_000;

		let start = Instant::now();
		let mut collect_join_len = 0;
		for _ in 0..iterations {
			collect_join_len +=
				format_with_collect_join("log message", &fields).len();
		}
		let collect_join = start.elapsed();

		let start = Instant::now();
		let mut direct_write_len = 0;
		for _ in 0..iterations {
			direct_write_len +=
				format_with_direct_write("log message", &fields).len();
		}
		let direct_write = start.elapsed();

		assert_eq!(collect_join_len, direct_write_len);
		println!(
			"collect_join={collect_join:?} direct_write={direct_write:?} speedup={:.2}x",
			collect_join.as_secs_f64() / direct_write.as_secs_f64()
		);
	}
}
