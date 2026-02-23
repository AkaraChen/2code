use tauri::State;

use infra::db::{DbPool, DbPoolExt};
use model::error::AppError;
use model::marketplace::{AddMarketplaceAgentInput, MarketplaceAgent, RegistryAgentInfo};

/// Fetch the ACP agent registry from the CDN.
/// Proxied through the backend to avoid CORS issues in the frontend.
#[tauri::command]
pub async fn fetch_agent_registry() -> Result<Vec<RegistryAgentInfo>, AppError> {
	service::marketplace::fetch_registry().await
}

/// List all agents the user has added to their local marketplace.
#[tauri::command]
pub fn list_marketplace_agents(
	state: State<'_, DbPool>,
) -> Result<Vec<MarketplaceAgent>, AppError> {
	let conn = &mut *state.conn()?;
	service::marketplace::list_agents(conn)
}

/// Add an agent from the registry to the local marketplace.
#[tauri::command]
pub fn add_marketplace_agent(
	input: AddMarketplaceAgentInput,
	state: State<'_, DbPool>,
) -> Result<MarketplaceAgent, AppError> {
	let conn = &mut *state.conn()?;
	service::marketplace::add_agent(conn, &input)
}

/// Remove an agent from the local marketplace.
#[tauri::command]
pub fn remove_marketplace_agent(
	id: String,
	state: State<'_, DbPool>,
) -> Result<(), AppError> {
	let conn = &mut *state.conn()?;
	service::marketplace::remove_agent(conn, &id)
}
