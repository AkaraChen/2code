use diesel::SqliteConnection;

use model::error::AppError;
use model::marketplace::{AddMarketplaceAgentInput, MarketplaceAgent, RegistryAgentInfo};

const REGISTRY_URL: &str =
	"https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json";

/// Fetch the ACP agent registry from the CDN.
/// Acts as a backend proxy to avoid CORS issues in the frontend.
pub async fn fetch_registry() -> Result<Vec<RegistryAgentInfo>, AppError> {
	#[derive(serde::Deserialize)]
	struct RegistryResponse {
		agents: Vec<RegistryAgentInfo>,
	}

	let response = reqwest::get(REGISTRY_URL)
		.await
		.map_err(|e| AppError::PtyError(format!("Registry fetch failed: {e}")))?;

	let registry: RegistryResponse = response
		.json()
		.await
		.map_err(|e| AppError::PtyError(format!("Registry parse failed: {e}")))?;

	Ok(registry.agents)
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
		&input.id,
		&input.name,
		&input.version,
		input.description.as_deref(),
		input.icon_url.as_deref(),
		input.repository.as_deref(),
		input.license.as_deref(),
		&authors_json,
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
