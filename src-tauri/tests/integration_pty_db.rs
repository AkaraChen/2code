mod common;

use common::setup_db;
use diesel::prelude::*;
use diesel::sql_types::{Integer, Text};

#[derive(QueryableByName)]
struct CountRow {
	#[diesel(sql_type = Integer)]
	count: i32,
}

#[derive(QueryableByName)]
struct NameRow {
	#[diesel(sql_type = Text)]
	name: String,
}

#[test]
fn pty_sessions_table_is_dropped() {
	let mut conn = setup_db();
	let row: CountRow = diesel::sql_query(
		"SELECT COUNT(*) AS count FROM sqlite_master \
		 WHERE type = 'table' AND name = 'pty_sessions'",
	)
	.get_result(&mut conn)
	.expect("sqlite_master");
	assert_eq!(row.count, 0);

	let tables: Vec<NameRow> = diesel::sql_query(
		"SELECT name FROM sqlite_master \
		 WHERE type = 'table' \
		 AND name IN ('projects', 'project_groups', 'checkout_notes') \
		 ORDER BY name",
	)
	.load(&mut conn)
	.expect("remaining tables");
	let names: Vec<String> = tables.into_iter().map(|row| row.name).collect();
	assert_eq!(
		names,
		vec![
			"checkout_notes".to_string(),
			"project_groups".to_string(),
			"projects".to_string(),
		]
	);
}

#[test]
fn sqlite_profiles_stays_absent() {
	let mut conn = setup_db();
	let row: CountRow = diesel::sql_query(
		"SELECT COUNT(*) AS count FROM sqlite_master \
		 WHERE type = 'table' AND name = 'profiles'",
	)
	.get_result(&mut conn)
	.expect("sqlite_master");
	assert_eq!(row.count, 0);
}
