use serde::Serialize;

#[derive(Serialize, Clone, Debug)]
pub struct LogEntry {
	pub timestamp: u64,
	pub level: String,
	pub source: String,
	pub message: String,
}
