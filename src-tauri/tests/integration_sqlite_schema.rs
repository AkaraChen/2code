mod common;

use common::setup_db;
use diesel::prelude::*;
use diesel::sql_types::Text;

#[derive(QueryableByName)]
struct NameRow {
	#[diesel(sql_type = Text)]
	name: String,
}

fn user_table_names(conn: &mut diesel::SqliteConnection) -> Vec<String> {
	let tables: Vec<NameRow> = diesel::sql_query(
		"SELECT name FROM sqlite_master \
		 WHERE type = 'table' \
		 AND name NOT LIKE 'sqlite_%' \
		 AND name != '__diesel_schema_migrations' \
		 ORDER BY name",
	)
	.load(conn)
	.expect("user tables");
	tables.into_iter().map(|row| row.name).collect()
}

#[test]
fn live_sqlite_user_tables_are_the_catalog_allowlist() {
	let mut conn = setup_db();
	assert_eq!(
		user_table_names(&mut conn),
		vec![
			"checkout_notes".to_string(),
			"project_groups".to_string(),
			"projects".to_string(),
		]
	);
}
