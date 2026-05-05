use serde::Serialize;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QuickTaskPtyEvent {
	pub run_id: String,
	pub event: String,
	#[serde(skip_serializing_if = "Option::is_none")]
	pub data: Option<String>,
}

impl QuickTaskPtyEvent {
	pub fn output(run_id: &str, data: String) -> Self {
		Self {
			run_id: run_id.to_string(),
			event: "output".to_string(),
			data: Some(data),
		}
	}

	pub fn exit(run_id: &str) -> Self {
		Self {
			run_id: run_id.to_string(),
			event: "exit".to_string(),
			data: None,
		}
	}
}
