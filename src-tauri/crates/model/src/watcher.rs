use serde::Serialize;

#[derive(Serialize, Clone, Debug)]
pub struct WatchEvent {
	pub project_id: String,
}
