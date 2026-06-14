use serde::Serialize;

#[derive(Serialize, Clone, Debug)]
pub struct WatchEvent {
	pub project_id: String,
	pub profile_id: Option<String>,
	pub root_path: String,
	pub path: Option<String>,
}
