use tauri::State;

use infra::db::{DbPool, DbPoolExt};
use model::error::AppError;
use model::snippet::{Snippet, UpdateSnippet};

#[tauri::command]
pub fn create_snippet(
	name: String,
	trigger: String,
	content: String,
	state: State<'_, DbPool>,
) -> Result<Snippet, AppError> {
	let conn = &mut *state.conn()?;
	service::snippet::create(conn, &name, &trigger, &content)
}

#[tauri::command]
pub fn list_snippets(
	state: State<'_, DbPool>,
) -> Result<Vec<Snippet>, AppError> {
	let conn = &mut *state.conn()?;
	service::snippet::list(conn)
}

#[tauri::command]
pub fn update_snippet(
	id: String,
	changeset: UpdateSnippet,
	state: State<'_, DbPool>,
) -> Result<Snippet, AppError> {
	let conn = &mut *state.conn()?;
	service::snippet::update(conn, &id, changeset)
}

#[tauri::command]
pub fn delete_snippet(
	id: String,
	state: State<'_, DbPool>,
) -> Result<(), AppError> {
	let conn = &mut *state.conn()?;
	service::snippet::delete(conn, &id)
}
