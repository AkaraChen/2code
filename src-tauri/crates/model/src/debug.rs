use serde::{Deserialize, Serialize};

#[derive(Serialize, Clone, Debug)]
pub struct LogEntry {
	pub timestamp: u64,
	pub level: String,
	pub source: String,
	pub message: String,
}

#[derive(Deserialize, Serialize, Clone, Debug)]
pub struct FrontendProfileEvent {
	pub name: String,
	pub entry_type: String,
	pub start_time: f64,
	pub duration: f64,
	pub detail: Option<String>,
}
