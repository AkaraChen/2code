use tauri::State;

use infra::db::{DbPool, DbPoolExt};
use model::error::AppError;
use model::stats::HomepageStats;

#[tauri::command]
pub fn get_homepage_stats(
	state: State<'_, DbPool>,
) -> Result<HomepageStats, AppError> {
	let conn = &mut *state.conn()?;
	service::stats::get_homepage_stats(conn)
}
