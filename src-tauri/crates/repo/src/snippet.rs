use diesel::prelude::*;

use model::error::AppError;
use model::schema::snippets;
use model::snippet::{NewSnippet, Snippet, UpdateSnippet};

pub fn insert(
	conn: &mut SqliteConnection,
	id: &str,
	name: &str,
	trigger: &str,
	content: &str,
) -> Result<Snippet, AppError> {
	diesel::insert_into(snippets::table)
		.values(&NewSnippet {
			id,
			name,
			trigger,
			content,
		})
		.execute(conn)
		.map_err(|e| AppError::DbError(e.to_string()))?;
	snippets::table
		.find(id)
		.select(Snippet::as_select())
		.first(conn)
		.map_err(|e| AppError::DbError(e.to_string()))
}

pub fn list_all(
	conn: &mut SqliteConnection,
) -> Result<Vec<Snippet>, AppError> {
	snippets::table
		.select(Snippet::as_select())
		.order(snippets::created_at.asc())
		.load(conn)
		.map_err(|e| AppError::DbError(e.to_string()))
}

pub fn update(
	conn: &mut SqliteConnection,
	id: &str,
	changeset: UpdateSnippet,
) -> Result<Snippet, AppError> {
	let target = snippets::table.find(id);

	if changeset.name.is_none()
		&& changeset.trigger.is_none()
		&& changeset.content.is_none()
	{
		return target
			.select(Snippet::as_select())
			.first(conn)
			.map_err(|_| AppError::NotFound(format!("Snippet: {id}")));
	}

	let rows = diesel::update(target)
		.set(&changeset)
		.execute(conn)
		.map_err(|e| AppError::DbError(e.to_string()))?;

	if rows == 0 {
		return Err(AppError::NotFound(format!("Snippet: {id}")));
	}

	target
		.select(Snippet::as_select())
		.first(conn)
		.map_err(|e| AppError::DbError(e.to_string()))
}

pub fn delete(conn: &mut SqliteConnection, id: &str) -> Result<(), AppError> {
	let rows = diesel::delete(snippets::table.find(id))
		.execute(conn)
		.map_err(|e| AppError::DbError(e.to_string()))?;
	if rows == 0 {
		return Err(AppError::NotFound(format!("Snippet: {id}")));
	}
	Ok(())
}

#[cfg(test)]
mod tests {
	use super::*;
	use diesel_migrations::MigrationHarness;
	use infra::db::MIGRATIONS;

	fn setup_db() -> SqliteConnection {
		let mut conn =
			SqliteConnection::establish(":memory:").expect("in-memory db");
		diesel::sql_query("PRAGMA foreign_keys=ON;")
			.execute(&mut conn)
			.ok();
		conn.run_pending_migrations(MIGRATIONS)
			.expect("run migrations");
		conn
	}

	#[test]
	fn insert_and_list() {
		let mut conn = setup_db();
		let s =
			insert(&mut conn, "s1", "Clear Screen", "cls", "clear").unwrap();
		assert_eq!(s.trigger, "cls");
		assert_eq!(s.name, "Clear Screen");
		let all = list_all(&mut conn).unwrap();
		assert_eq!(all.len(), 1);
	}

	#[test]
	fn insert_duplicate_trigger() {
		let mut conn = setup_db();
		insert(&mut conn, "s1", "Clear", "cls", "clear").unwrap();
		let err = insert(&mut conn, "s2", "Clear2", "cls", "clear");
		assert!(err.is_err());
	}

	#[test]
	fn list_empty() {
		let mut conn = setup_db();
		let list = list_all(&mut conn).unwrap();
		assert!(list.is_empty());
	}

	#[test]
	fn update_name() {
		let mut conn = setup_db();
		insert(&mut conn, "s1", "Old", "cls", "clear").unwrap();
		let updated = update(
			&mut conn,
			"s1",
			UpdateSnippet {
				name: Some("New".into()),
				trigger: None,
				content: None,
			},
		)
		.unwrap();
		assert_eq!(updated.name, "New");
	}

	#[test]
	fn update_nonexistent() {
		let mut conn = setup_db();
		let result = update(
			&mut conn,
			"nope",
			UpdateSnippet {
				name: Some("X".into()),
				trigger: None,
				content: None,
			},
		);
		assert!(result.is_err());
	}

	#[test]
	fn update_no_changes_returns_current() {
		let mut conn = setup_db();
		insert(&mut conn, "s1", "Test", "t", "content").unwrap();
		let result = update(
			&mut conn,
			"s1",
			UpdateSnippet {
				name: None,
				trigger: None,
				content: None,
			},
		)
		.unwrap();
		assert_eq!(result.name, "Test");
	}

	#[test]
	fn delete_success() {
		let mut conn = setup_db();
		insert(&mut conn, "s1", "Del", "cls", "clear").unwrap();
		delete(&mut conn, "s1").unwrap();
		assert!(list_all(&mut conn).unwrap().is_empty());
	}

	#[test]
	fn delete_nonexistent() {
		let mut conn = setup_db();
		assert!(delete(&mut conn, "nope").is_err());
	}
}
