use diesel::SqliteConnection;
use uuid::Uuid;

use model::error::AppError;
use model::snippet::{Snippet, UpdateSnippet};

pub fn create(
	conn: &mut SqliteConnection,
	name: &str,
	trigger: &str,
	content: &str,
) -> Result<Snippet, AppError> {
	let id = Uuid::new_v4().to_string();
	repo::snippet::insert(conn, &id, name, trigger, content)
}

pub fn list(
	conn: &mut SqliteConnection,
) -> Result<Vec<Snippet>, AppError> {
	repo::snippet::list_all(conn)
}

pub fn update(
	conn: &mut SqliteConnection,
	id: &str,
	changeset: UpdateSnippet,
) -> Result<Snippet, AppError> {
	repo::snippet::update(conn, id, changeset)
}

pub fn delete(
	conn: &mut SqliteConnection,
	id: &str,
) -> Result<(), AppError> {
	repo::snippet::delete(conn, id)
}
