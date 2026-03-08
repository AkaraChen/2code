use diesel::prelude::*;

use model::error::AppError;
use model::marketplace::{MarketplaceAgent, NewMarketplaceAgent};
use model::schema::marketplace_agents;

pub fn insert(
	conn: &mut SqliteConnection,
	record: &NewMarketplaceAgent<'_>,
) -> Result<MarketplaceAgent, AppError> {
	diesel::insert_into(marketplace_agents::table)
		.values(record)
		.execute(conn)
		.map_err(|e| AppError::DbError(e.to_string()))?;
	marketplace_agents::table
		.find(record.id)
		.select(MarketplaceAgent::as_select())
		.first(conn)
		.map_err(|e| AppError::DbError(e.to_string()))
}

pub fn list_all(
	conn: &mut SqliteConnection,
) -> Result<Vec<MarketplaceAgent>, AppError> {
	marketplace_agents::table
		.select(MarketplaceAgent::as_select())
		.order(marketplace_agents::added_at.asc())
		.load(conn)
		.map_err(|e| AppError::DbError(e.to_string()))
}

pub fn find(
	conn: &mut SqliteConnection,
	id: &str,
) -> Result<Option<MarketplaceAgent>, AppError> {
	marketplace_agents::table
		.find(id)
		.select(MarketplaceAgent::as_select())
		.first(conn)
		.optional()
		.map_err(|e| AppError::DbError(e.to_string()))
}

pub fn delete(conn: &mut SqliteConnection, id: &str) -> Result<(), AppError> {
	let rows = diesel::delete(marketplace_agents::table.find(id))
		.execute(conn)
		.map_err(|e| AppError::DbError(e.to_string()))?;
	if rows == 0 {
		return Err(AppError::NotFound(format!("MarketplaceAgent: {id}")));
	}
	Ok(())
}
