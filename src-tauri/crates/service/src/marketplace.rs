use diesel::SqliteConnection;

use model::error::AppError;
use model::marketplace::{AddMarketplaceAgentInput, MarketplaceAgent, RegistryAgentInfo};

const REGISTRY_URL: &str =
	"https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json";

/// Fetch the ACP agent registry from the CDN.
/// Acts as a backend proxy to avoid CORS issues in the frontend.
pub async fn fetch_registry() -> Result<Vec<RegistryAgentInfo>, AppError> {
	/// Internal CDN-parsing type; `distribution` is kept as raw JSON value.
	#[derive(serde::Deserialize)]
	struct CdnAgent {
		id: String,
		name: String,
		version: String,
		description: Option<String>,
		icon: Option<String>,
		repository: Option<String>,
		license: Option<String>,
		#[serde(default)]
		authors: Vec<String>,
		#[serde(default)]
		distribution: serde_json::Value,
	}

	#[derive(serde::Deserialize)]
	struct RegistryResponse {
		agents: Vec<CdnAgent>,
	}

	let response = reqwest::get(REGISTRY_URL)
		.await
		.map_err(|e| AppError::PtyError(format!("Registry fetch failed: {e}")))?;

	let registry: RegistryResponse = response
		.json()
		.await
		.map_err(|e| AppError::PtyError(format!("Registry parse failed: {e}")))?;

	let agents = registry
		.agents
		.into_iter()
		.map(|a| {
			let distribution = serde_json::to_string(&a.distribution)
				.unwrap_or_else(|_| "{}".to_string());
			RegistryAgentInfo {
				id: a.id,
				name: a.name,
				version: a.version,
				description: a.description,
				icon: a.icon,
				repository: a.repository,
				license: a.license,
				authors: a.authors,
				distribution,
			}
		})
		.collect();

	Ok(agents)
}

/// Add an agent to the local marketplace database.
pub fn add_agent(
	conn: &mut SqliteConnection,
	input: &AddMarketplaceAgentInput,
) -> Result<MarketplaceAgent, AppError> {
	let authors_json = serde_json::to_string(&input.authors)
		.map_err(|e| AppError::DbError(e.to_string()))?;

	repo::marketplace::insert(
		conn,
		&model::marketplace::NewMarketplaceAgent {
			id: &input.id,
			name: &input.name,
			version: &input.version,
			description: input.description.as_deref(),
			icon_url: input.icon_url.as_deref(),
			repository: input.repository.as_deref(),
			license: input.license.as_deref(),
			authors_json: &authors_json,
			distribution_json: &input.distribution,
		},
	)
}

/// Remove an agent from the local marketplace database.
pub fn remove_agent(
	conn: &mut SqliteConnection,
	id: &str,
) -> Result<(), AppError> {
	repo::marketplace::delete(conn, id)
}

/// List all agents the user has added to their marketplace.
pub fn list_agents(
	conn: &mut SqliteConnection,
) -> Result<Vec<MarketplaceAgent>, AppError> {
	repo::marketplace::list_all(conn)
}
