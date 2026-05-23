use serde::Serialize;

#[derive(Debug, Serialize, Clone)]
pub struct InstalledBrowser {
	pub id: String,
	pub name: String,
}
