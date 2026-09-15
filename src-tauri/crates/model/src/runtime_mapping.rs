use diesel::prelude::*;

use crate::schema::{
	herdr_namespaces, profile_runtime_mappings, session_runtime_mappings,
};

/// Dedicated Herdr namespace row. Seeded as `2code`.
#[derive(Queryable, Selectable, Clone, Debug, Eq, PartialEq)]
#[diesel(table_name = herdr_namespaces)]
#[diesel(check_for_backend(diesel::sqlite::Sqlite))]
pub struct HerdrNamespaceRecord {
	pub name: String,
}

/// Profile → `workspace_id` association in a Herdr namespace.
///
/// `workspace_id` is the identity. Display names and `worktree_path` are
/// not stored here and are not association keys.
#[derive(Queryable, Selectable, Clone, Debug, Eq, PartialEq)]
#[diesel(table_name = profile_runtime_mappings)]
#[diesel(check_for_backend(diesel::sqlite::Sqlite))]
pub struct ProfileRuntimeMapping {
	pub profile_id: String,
	pub namespace: String,
	pub workspace_id: String,
}

#[derive(Insertable)]
#[diesel(table_name = profile_runtime_mappings)]
pub struct NewProfileRuntimeMapping<'a> {
	pub profile_id: &'a str,
	pub namespace: &'a str,
	pub workspace_id: &'a str,
}

/// Session → `pane_id` association in a Herdr namespace.
///
/// `pane_id` is the identity. `workspace_id` must match the profile
/// mapping when both exist. `terminal_id` is live-only and is not
/// persisted.
#[derive(Queryable, Selectable, Clone, Debug, Eq, PartialEq)]
#[diesel(table_name = session_runtime_mappings)]
#[diesel(check_for_backend(diesel::sqlite::Sqlite))]
pub struct SessionRuntimeMapping {
	pub session_id: String,
	pub namespace: String,
	pub workspace_id: String,
	pub pane_id: String,
}

#[derive(Insertable)]
#[diesel(table_name = session_runtime_mappings)]
pub struct NewSessionRuntimeMapping<'a> {
	pub session_id: &'a str,
	pub namespace: &'a str,
	pub workspace_id: &'a str,
	pub pane_id: &'a str,
}
