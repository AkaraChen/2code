use serde::Serialize;

#[derive(Debug, Serialize, Clone)]
pub struct BrowserApp {
	pub id: String,
	pub name: String,
}
