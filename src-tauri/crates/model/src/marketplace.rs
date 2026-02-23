use crate::schema::marketplace_agents;
use diesel::prelude::*;
use serde::{Deserialize, Serialize};

/// A registry agent record stored in the local database (user-added agents).
#[derive(Queryable, Selectable, Serialize, Clone)]
#[diesel(table_name = marketplace_agents)]
#[diesel(check_for_backend(diesel::sqlite::Sqlite))]
pub struct MarketplaceAgent {
	pub id: String,
	pub name: String,
	pub version: String,
	pub description: Option<String>,
	pub icon_url: Option<String>,
	pub repository: Option<String>,
	pub license: Option<String>,
	pub authors_json: String,
	pub added_at: String,
	pub distribution_json: String,
}

#[derive(Insertable)]
#[diesel(table_name = marketplace_agents)]
pub struct NewMarketplaceAgent<'a> {
	pub id: &'a str,
	pub name: &'a str,
	pub version: &'a str,
	pub description: Option<&'a str>,
	pub icon_url: Option<&'a str>,
	pub repository: Option<&'a str>,
	pub license: Option<&'a str>,
	pub authors_json: &'a str,
	pub distribution_json: &'a str,
}

/// Agent info from the ACP registry CDN.
/// Used as the return type for `fetch_agent_registry`.
/// `distribution` is a JSON-encoded string of the raw distribution spec.
#[derive(Serialize, Clone)]
pub struct RegistryAgentInfo {
	pub id: String,
	pub name: String,
	pub version: String,
	pub description: Option<String>,
	/// Icon URL (SVG from CDN).
	pub icon: Option<String>,
	pub repository: Option<String>,
	pub license: Option<String>,
	pub authors: Vec<String>,
	/// Distribution spec serialized as a JSON string (e.g. `{"npx":{...}}`).
	pub distribution: String,
}

/// Input for adding an agent to the local marketplace.
/// `distribution` is the JSON-encoded distribution spec forwarded from the registry.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AddMarketplaceAgentInput {
	pub id: String,
	pub name: String,
	pub version: String,
	pub description: Option<String>,
	pub icon_url: Option<String>,
	pub repository: Option<String>,
	pub license: Option<String>,
	pub authors: Vec<String>,
	pub distribution: String,
}
