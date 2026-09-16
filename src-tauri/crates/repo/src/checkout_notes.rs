use diesel::prelude::*;

use model::error::AppError;
use model::profile::{CheckoutNote, NewCheckoutNote};
use model::schema::checkout_notes;

pub fn list_all(
	conn: &mut SqliteConnection,
) -> Result<Vec<CheckoutNote>, AppError> {
	checkout_notes::table
		.select(CheckoutNote::as_select())
		.load(conn)
		.map_err(|e| AppError::DbError(e.to_string()))
}

pub fn list_by_project(
	conn: &mut SqliteConnection,
	project_id: &str,
) -> Result<Vec<CheckoutNote>, AppError> {
	checkout_notes::table
		.filter(checkout_notes::project_id.eq(project_id))
		.select(CheckoutNote::as_select())
		.load(conn)
		.map_err(|e| AppError::DbError(e.to_string()))
}

pub fn find(
	conn: &mut SqliteConnection,
	project_id: &str,
	checkout_path: &str,
) -> Result<Option<CheckoutNote>, AppError> {
	checkout_notes::table
		.find((project_id, checkout_path))
		.select(CheckoutNote::as_select())
		.first(conn)
		.optional()
		.map_err(|e| AppError::DbError(e.to_string()))
}

pub fn upsert(
	conn: &mut SqliteConnection,
	project_id: &str,
	checkout_path: &str,
	notes: &str,
) -> Result<CheckoutNote, AppError> {
	diesel::insert_into(checkout_notes::table)
		.values(&NewCheckoutNote {
			project_id,
			checkout_path,
			notes,
		})
		.on_conflict((
			checkout_notes::project_id,
			checkout_notes::checkout_path,
		))
		.do_update()
		.set(checkout_notes::notes.eq(notes))
		.execute(conn)
		.map_err(|e| AppError::DbError(e.to_string()))?;

	find(conn, project_id, checkout_path)?.ok_or_else(|| {
		AppError::DbError("checkout notes upsert did not persist".into())
	})
}

#[cfg(test)]
mod tests {
	use super::*;
	use crate::project;
	use crate::test_utils::setup_db;

	#[test]
	fn upsert_round_trips_notes_by_project_and_path() {
		let mut conn = setup_db();
		project::insert(&mut conn, "proj-1", "Project", "/repo")
			.expect("insert project");

		let first = upsert(&mut conn, "proj-1", "/repo", "hello").unwrap();
		assert_eq!(first.notes, "hello");
		assert_eq!(first.checkout_path, "/repo");

		let second = upsert(&mut conn, "proj-1", "/repo", "updated").unwrap();
		assert_eq!(second.notes, "updated");
		assert_eq!(second.created_at, first.created_at);

		let listed = list_by_project(&mut conn, "proj-1").unwrap();
		assert_eq!(listed.len(), 1);
		assert_eq!(listed[0].notes, "updated");
	}

	#[test]
	fn cascade_delete_removes_checkout_notes() {
		let mut conn = setup_db();
		project::insert(&mut conn, "proj-1", "Project", "/repo")
			.expect("insert project");
		upsert(&mut conn, "proj-1", "/repo", "hello").unwrap();

		project::delete(&mut conn, "proj-1").unwrap();

		assert!(list_all(&mut conn).unwrap().is_empty());
	}
}
