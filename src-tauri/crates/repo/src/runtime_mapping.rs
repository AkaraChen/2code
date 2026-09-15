use diesel::prelude::*;

use model::error::AppError;
use model::runtime::HERDR_NAMESPACE;
use model::runtime_mapping::{
	HerdrNamespaceRecord, NewProfileRuntimeMapping, NewSessionRuntimeMapping,
	ProfileRuntimeMapping, SessionRuntimeMapping,
};
use model::schema::{
	herdr_namespaces, profile_runtime_mappings, session_runtime_mappings,
};

pub fn list_namespaces(
	conn: &mut SqliteConnection,
) -> Result<Vec<HerdrNamespaceRecord>, AppError> {
	herdr_namespaces::table
		.select(HerdrNamespaceRecord::as_select())
		.order(herdr_namespaces::name.asc())
		.load(conn)
		.map_err(|e| AppError::DbError(e.to_string()))
}

fn optional_found<T>(
	result: Result<T, AppError>,
) -> Result<Option<T>, AppError> {
	match result {
		Ok(value) => Ok(Some(value)),
		Err(AppError::NotFound(_)) => Ok(None),
		Err(err) => Err(err),
	}
}

fn require_2code_identity(
	namespace: &str,
	identity: &str,
	kind: &str,
) -> Result<(), AppError> {
	if namespace != HERDR_NAMESPACE {
		return Err(AppError::DbError(format!(
			"runtime mappings must use the {HERDR_NAMESPACE} namespace"
		)));
	}
	if identity.is_empty() {
		return Err(AppError::DbError(format!("{kind} is required")));
	}
	Ok(())
}

pub fn find_profile_mapping(
	conn: &mut SqliteConnection,
	profile_id: &str,
) -> Result<ProfileRuntimeMapping, AppError> {
	profile_runtime_mappings::table
		.find(profile_id)
		.select(ProfileRuntimeMapping::as_select())
		.first(conn)
		.map_err(|_| {
			AppError::NotFound(format!("Profile runtime mapping: {profile_id}"))
		})
}

pub fn find_profile_by_workspace(
	conn: &mut SqliteConnection,
	namespace: &str,
	workspace_id: &str,
) -> Result<ProfileRuntimeMapping, AppError> {
	profile_runtime_mappings::table
		.filter(profile_runtime_mappings::namespace.eq(namespace))
		.filter(profile_runtime_mappings::workspace_id.eq(workspace_id))
		.select(ProfileRuntimeMapping::as_select())
		.first(conn)
		.map_err(|_| {
			AppError::NotFound(format!(
				"Profile runtime mapping for workspace: {workspace_id}"
			))
		})
}

pub fn bind_profile_workspace(
	conn: &mut SqliteConnection,
	profile_id: &str,
	namespace: &str,
	workspace_id: &str,
) -> Result<ProfileRuntimeMapping, AppError> {
	require_2code_identity(namespace, workspace_id, "workspace_id")?;

	if let Some(existing) =
		optional_found(find_profile_mapping(conn, profile_id))?
	{
		if existing.workspace_id == workspace_id
			&& existing.namespace == namespace
		{
			return Ok(existing);
		}
		return Err(AppError::DbError(format!(
			"profile {profile_id} is already bound to workspace {}",
			existing.workspace_id
		)));
	}

	if let Some(existing) = optional_found(find_profile_by_workspace(
		conn,
		namespace,
		workspace_id,
	))? {
		return Err(AppError::DbError(format!(
			"workspace {workspace_id} is already bound to profile {}",
			existing.profile_id
		)));
	}

	diesel::insert_into(profile_runtime_mappings::table)
		.values(&NewProfileRuntimeMapping {
			profile_id,
			namespace,
			workspace_id,
		})
		.execute(conn)
		.map_err(|e| AppError::DbError(e.to_string()))?;

	find_profile_mapping(conn, profile_id)
}

pub fn unbind_profile_workspace(
	conn: &mut SqliteConnection,
	profile_id: &str,
) -> Result<(), AppError> {
	let deleted =
		diesel::delete(profile_runtime_mappings::table.find(profile_id))
			.execute(conn)
			.map_err(|e| AppError::DbError(e.to_string()))?;
	if deleted == 0 {
		return Err(AppError::NotFound(format!(
			"Profile runtime mapping: {profile_id}"
		)));
	}
	Ok(())
}

pub fn find_session_mapping(
	conn: &mut SqliteConnection,
	session_id: &str,
) -> Result<SessionRuntimeMapping, AppError> {
	session_runtime_mappings::table
		.find(session_id)
		.select(SessionRuntimeMapping::as_select())
		.first(conn)
		.map_err(|_| {
			AppError::NotFound(format!("Session runtime mapping: {session_id}"))
		})
}

pub fn find_session_by_pane(
	conn: &mut SqliteConnection,
	namespace: &str,
	pane_id: &str,
) -> Result<SessionRuntimeMapping, AppError> {
	session_runtime_mappings::table
		.filter(session_runtime_mappings::namespace.eq(namespace))
		.filter(session_runtime_mappings::pane_id.eq(pane_id))
		.select(SessionRuntimeMapping::as_select())
		.first(conn)
		.map_err(|_| {
			AppError::NotFound(format!(
				"Session runtime mapping for pane: {pane_id}"
			))
		})
}

pub fn bind_session_pane(
	conn: &mut SqliteConnection,
	session_id: &str,
	namespace: &str,
	pane_id: &str,
) -> Result<SessionRuntimeMapping, AppError> {
	require_2code_identity(namespace, pane_id, "pane_id")?;

	if let Some(existing) =
		optional_found(find_session_mapping(conn, session_id))?
	{
		if existing.pane_id == pane_id && existing.namespace == namespace {
			return Ok(existing);
		}
		return Err(AppError::DbError(format!(
			"session {session_id} is already bound to pane {}",
			existing.pane_id
		)));
	}

	if let Some(existing) =
		optional_found(find_session_by_pane(conn, namespace, pane_id))?
	{
		return Err(AppError::DbError(format!(
			"pane {pane_id} is already bound to session {}",
			existing.session_id
		)));
	}

	diesel::insert_into(session_runtime_mappings::table)
		.values(&NewSessionRuntimeMapping {
			session_id,
			namespace,
			pane_id,
		})
		.execute(conn)
		.map_err(|e| AppError::DbError(e.to_string()))?;

	find_session_mapping(conn, session_id)
}

pub fn unbind_session_pane(
	conn: &mut SqliteConnection,
	session_id: &str,
) -> Result<(), AppError> {
	let deleted =
		diesel::delete(session_runtime_mappings::table.find(session_id))
			.execute(conn)
			.map_err(|e| AppError::DbError(e.to_string()))?;
	if deleted == 0 {
		return Err(AppError::NotFound(format!(
			"Session runtime mapping: {session_id}"
		)));
	}
	Ok(())
}

#[cfg(test)]
mod tests {
	use super::*;
	use crate::profile;
	use crate::project;
	use crate::pty;
	use crate::test_utils::setup_db;
	use diesel::connection::SimpleConnection;
	use model::pty::{NewPtySessionRecord, PtySessionRecord};
	use model::schema::{projects, pty_sessions};

	fn seed_catalog(conn: &mut SqliteConnection) {
		project::insert(conn, "proj-1", "Keep", "/repo").expect("project");
		diesel::update(projects::table.find("proj-1"))
			.set(projects::sort_order.eq(42))
			.execute(conn)
			.expect("sort order");
		profile::insert_default(
			conn,
			"prof-1",
			"proj-1",
			"main",
			"/repo/cache",
		)
		.expect("profile");
		profile::update_notes(conn, "prof-1", "keep-notes").expect("notes");
		profile::insert(conn, "prof-2", "proj-1", "dev", "/repo/dev")
			.expect("second profile");
		pty::insert_session(
			conn,
			&NewPtySessionRecord {
				id: "sess-1",
				profile_id: "prof-1",
				title: "Shell",
				shell: "/bin/sh",
				cwd: "/repo",
				cols: 80,
				rows: 24,
			},
		)
		.expect("session");
		pty::insert_session(
			conn,
			&NewPtySessionRecord {
				id: "sess-2",
				profile_id: "prof-2",
				title: "Shell",
				shell: "/bin/sh",
				cwd: "/repo/dev",
				cols: 80,
				rows: 24,
			},
		)
		.expect("session 2");
	}

	#[test]
	fn lists_the_dedicated_2code_namespace() {
		let mut conn = setup_db();
		let names: Vec<String> = list_namespaces(&mut conn)
			.unwrap()
			.into_iter()
			.map(|ns| ns.name)
			.collect();
		assert_eq!(names, vec![HERDR_NAMESPACE.to_string()]);
		assert!(!names.iter().any(|name| name == "default"));
	}

	#[test]
	fn bind_preserves_catalog_ids_notes_order_and_worktree_cache() {
		let mut conn = setup_db();
		seed_catalog(&mut conn);

		bind_profile_workspace(&mut conn, "prof-1", HERDR_NAMESPACE, "w1")
			.unwrap();
		bind_session_pane(&mut conn, "sess-1", HERDR_NAMESPACE, "w1:p1")
			.unwrap();

		let profile = profile::find_by_id(&mut conn, "prof-1").unwrap();
		assert_eq!(profile.id, "prof-1");
		assert_eq!(profile.notes, "keep-notes");
		assert_eq!(profile.worktree_path, "/repo/cache");
		let sort_order: i32 = projects::table
			.find("proj-1")
			.select(projects::sort_order)
			.first(&mut conn)
			.unwrap();
		assert_eq!(sort_order, 42);
		let session = pty_sessions::table
			.find("sess-1")
			.select(PtySessionRecord::as_select())
			.first(&mut conn)
			.unwrap();
		assert_eq!(session.id, "sess-1");
	}

	#[test]
	fn bind_is_workspace_id_and_pane_id_never_label_or_terminal() {
		let mut conn = setup_db();
		seed_catalog(&mut conn);

		let profile =
			bind_profile_workspace(&mut conn, "prof-1", HERDR_NAMESPACE, "w1")
				.unwrap();
		assert_eq!(profile.workspace_id, "w1");
		assert_eq!(profile.namespace, HERDR_NAMESPACE);

		let session =
			bind_session_pane(&mut conn, "sess-1", HERDR_NAMESPACE, "w1:p1")
				.unwrap();
		assert_eq!(session.pane_id, "w1:p1");

		let production = include_str!("runtime_mapping.rs")
			.split("#[cfg(test)]")
			.next()
			.unwrap();
		assert!(!production.contains("terminal_id"));
		assert!(!production.contains("label"));
		assert!(!production.contains("worktree.open"));
		assert!(!production.contains("workspace.create"));
		assert!(!production.contains("pane.close"));
		assert!(!production.contains("server.stop"));
	}

	#[test]
	fn uniqueness_is_one_workspace_per_profile_and_one_profile_per_workspace() {
		let mut conn = setup_db();
		seed_catalog(&mut conn);

		bind_profile_workspace(&mut conn, "prof-1", HERDR_NAMESPACE, "w1")
			.unwrap();
		let same =
			bind_profile_workspace(&mut conn, "prof-1", HERDR_NAMESPACE, "w1")
				.unwrap();
		assert_eq!(same.workspace_id, "w1");

		let replace =
			bind_profile_workspace(&mut conn, "prof-1", HERDR_NAMESPACE, "w2")
				.unwrap_err();
		assert!(replace
			.to_string()
			.contains("already bound to workspace w1"));

		let stolen =
			bind_profile_workspace(&mut conn, "prof-2", HERDR_NAMESPACE, "w1")
				.unwrap_err();
		assert!(stolen
			.to_string()
			.contains("already bound to profile prof-1"));
	}

	#[test]
	fn uniqueness_is_one_pane_per_session_and_one_session_per_pane() {
		let mut conn = setup_db();
		seed_catalog(&mut conn);

		bind_session_pane(&mut conn, "sess-1", HERDR_NAMESPACE, "w1:p1")
			.unwrap();
		bind_session_pane(&mut conn, "sess-1", HERDR_NAMESPACE, "w1:p1")
			.unwrap();

		let replace =
			bind_session_pane(&mut conn, "sess-1", HERDR_NAMESPACE, "w1:p2")
				.unwrap_err();
		assert!(replace.to_string().contains("already bound to pane w1:p1"));

		let stolen =
			bind_session_pane(&mut conn, "sess-2", HERDR_NAMESPACE, "w1:p1")
				.unwrap_err();
		assert!(stolen
			.to_string()
			.contains("already bound to session sess-1"));
	}

	#[test]
	fn refuses_default_namespace_and_empty_identities() {
		let mut conn = setup_db();
		seed_catalog(&mut conn);

		let ns = bind_profile_workspace(&mut conn, "prof-1", "default", "w1")
			.unwrap_err();
		assert!(ns.to_string().contains("2code"));
		let empty =
			bind_profile_workspace(&mut conn, "prof-1", HERDR_NAMESPACE, "")
				.unwrap_err();
		assert!(empty.to_string().contains("workspace_id is required"));
		let pane = bind_session_pane(&mut conn, "sess-1", HERDR_NAMESPACE, "")
			.unwrap_err();
		assert!(pane.to_string().contains("pane_id is required"));
	}

	#[test]
	fn cascade_delete_removes_mappings_without_keeping_identities() {
		let mut conn = setup_db();
		seed_catalog(&mut conn);
		bind_profile_workspace(&mut conn, "prof-2", HERDR_NAMESPACE, "w2")
			.unwrap();
		bind_session_pane(&mut conn, "sess-2", HERDR_NAMESPACE, "w2:p1")
			.unwrap();

		profile::delete(&mut conn, "prof-2").unwrap();

		assert!(find_profile_mapping(&mut conn, "prof-2").is_err());
		assert!(find_session_mapping(&mut conn, "sess-2").is_err());
		assert!(find_profile_by_workspace(&mut conn, HERDR_NAMESPACE, "w2")
			.is_err());
	}

	#[test]
	fn sqlite_unique_constraints_reject_duplicate_identities() {
		let mut conn = setup_db();
		seed_catalog(&mut conn);
		bind_profile_workspace(&mut conn, "prof-1", HERDR_NAMESPACE, "w1")
			.unwrap();
		bind_session_pane(&mut conn, "sess-1", HERDR_NAMESPACE, "w1:p1")
			.unwrap();

		assert!(conn
			.batch_execute(
				"INSERT INTO profile_runtime_mappings \
				 (profile_id, namespace, workspace_id) \
				 VALUES ('prof-2', '2code', 'w1');",
			)
			.is_err());
		assert!(conn
			.batch_execute(
				"INSERT INTO session_runtime_mappings \
				 (session_id, namespace, pane_id) \
				 VALUES ('sess-2', '2code', 'w1:p1');",
			)
			.is_err());
	}
}
