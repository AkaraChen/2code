use diesel::prelude::*;

use model::error::AppError;
use model::runtime::HERDR_NAMESPACE;
use model::runtime_mapping::{
	HerdrNamespaceRecord, NewProfileRuntimeMapping, NewSessionRuntimeMapping,
	ProfileRuntimeMapping, SessionRuntimeMapping,
};
use model::schema::{
	herdr_namespaces, profile_runtime_mappings, pty_sessions,
	session_runtime_mappings,
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

pub fn list_profile_mappings(
	conn: &mut SqliteConnection,
) -> Result<Vec<ProfileRuntimeMapping>, AppError> {
	profile_runtime_mappings::table
		.select(ProfileRuntimeMapping::as_select())
		.load(conn)
		.map_err(|e| AppError::DbError(e.to_string()))
}

fn refuse_stolen_workspace(
	conn: &mut SqliteConnection,
	namespace: &str,
	workspace_id: &str,
	profile_id: &str,
) -> Result<(), AppError> {
	if let Some(existing) = optional_found(find_profile_by_workspace(
		conn,
		namespace,
		workspace_id,
	))? {
		if existing.profile_id != profile_id {
			return Err(AppError::RuntimeMappingAlreadyBound(format!(
				"workspace {workspace_id} is already bound to profile {}",
				existing.profile_id
			)));
		}
	}
	Ok(())
}

fn refuse_stolen_pane(
	conn: &mut SqliteConnection,
	namespace: &str,
	pane_id: &str,
	session_id: &str,
) -> Result<(), AppError> {
	if let Some(existing) =
		optional_found(find_session_by_pane(conn, namespace, pane_id))?
	{
		if existing.session_id != session_id {
			return Err(AppError::RuntimeMappingAlreadyBound(format!(
				"pane {pane_id} is already bound to session {}",
				existing.session_id
			)));
		}
	}
	Ok(())
}

fn require_session_workspace_matches_profile(
	conn: &mut SqliteConnection,
	session_id: &str,
	workspace_id: &str,
) -> Result<(), AppError> {
	let profile_id: String = pty_sessions::table
		.find(session_id)
		.select(pty_sessions::profile_id)
		.first(conn)
		.map_err(|_| AppError::NotFound(format!("Session: {session_id}")))?;
	if let Some(profile) =
		optional_found(find_profile_mapping(conn, &profile_id))?
	{
		if profile.workspace_id != workspace_id {
			return Err(AppError::RuntimeMappingAlreadyBound(format!(
				"session workspace_id {workspace_id} does not match profile {} workspace_id {}",
				profile.profile_id, profile.workspace_id
			)));
		}
	}
	Ok(())
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
		return Err(AppError::RuntimeMappingReplaced(format!(
			"profile {profile_id} is bound to workspace {}; use replace for {workspace_id}",
			existing.workspace_id
		)));
	}

	refuse_stolen_workspace(conn, namespace, workspace_id, profile_id)?;

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

pub fn replace_profile_workspace(
	conn: &mut SqliteConnection,
	profile_id: &str,
	namespace: &str,
	workspace_id: &str,
) -> Result<ProfileRuntimeMapping, AppError> {
	require_2code_identity(namespace, workspace_id, "workspace_id")?;
	let Some(existing) =
		optional_found(find_profile_mapping(conn, profile_id))?
	else {
		return Err(AppError::RuntimeMappingMissing(format!(
			"profile {profile_id}"
		)));
	};
	if existing.workspace_id == workspace_id && existing.namespace == namespace
	{
		return Ok(existing);
	}
	refuse_stolen_workspace(conn, namespace, workspace_id, profile_id)?;
	// Old pane_ids belong to the previous workspace. Unbind first so a
	// crash cannot leave session rows pointing at a different id (#416).
	unbind_session_mappings_for_profile(conn, profile_id)?;
	diesel::update(profile_runtime_mappings::table.find(profile_id))
		.set(profile_runtime_mappings::workspace_id.eq(workspace_id))
		.execute(conn)
		.map_err(|e| AppError::DbError(e.to_string()))?;
	find_profile_mapping(conn, profile_id)
}

fn unbind_session_mappings_for_profile(
	conn: &mut SqliteConnection,
	profile_id: &str,
) -> Result<(), AppError> {
	let session_ids = crate::pty::list_ids_by_profile(conn, profile_id)?;
	for session_id in session_ids {
		if optional_found(find_session_mapping(conn, &session_id))?.is_some() {
			unbind_session_pane(conn, &session_id)?;
		}
	}
	Ok(())
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
	workspace_id: &str,
	pane_id: &str,
) -> Result<SessionRuntimeMapping, AppError> {
	require_2code_identity(namespace, workspace_id, "workspace_id")?;
	require_2code_identity(namespace, pane_id, "pane_id")?;
	require_session_workspace_matches_profile(conn, session_id, workspace_id)?;

	if let Some(existing) =
		optional_found(find_session_mapping(conn, session_id))?
	{
		if existing.pane_id == pane_id
			&& existing.workspace_id == workspace_id
			&& existing.namespace == namespace
		{
			return Ok(existing);
		}
		return Err(AppError::RuntimeMappingReplaced(format!(
			"session {session_id} is bound to pane {}; use replace for {pane_id}",
			existing.pane_id
		)));
	}

	refuse_stolen_pane(conn, namespace, pane_id, session_id)?;

	diesel::insert_into(session_runtime_mappings::table)
		.values(&NewSessionRuntimeMapping {
			session_id,
			namespace,
			workspace_id,
			pane_id,
		})
		.execute(conn)
		.map_err(|e| AppError::DbError(e.to_string()))?;

	find_session_mapping(conn, session_id)
}

pub fn replace_session_pane(
	conn: &mut SqliteConnection,
	session_id: &str,
	namespace: &str,
	workspace_id: &str,
	pane_id: &str,
) -> Result<SessionRuntimeMapping, AppError> {
	require_2code_identity(namespace, workspace_id, "workspace_id")?;
	require_2code_identity(namespace, pane_id, "pane_id")?;
	require_session_workspace_matches_profile(conn, session_id, workspace_id)?;
	let Some(existing) =
		optional_found(find_session_mapping(conn, session_id))?
	else {
		return Err(AppError::RuntimeMappingMissing(format!(
			"session {session_id}"
		)));
	};
	if existing.pane_id == pane_id
		&& existing.workspace_id == workspace_id
		&& existing.namespace == namespace
	{
		return Ok(existing);
	}
	refuse_stolen_pane(conn, namespace, pane_id, session_id)?;
	diesel::update(session_runtime_mappings::table.find(session_id))
		.set((
			session_runtime_mappings::workspace_id.eq(workspace_id),
			session_runtime_mappings::pane_id.eq(pane_id),
		))
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

pub fn list_session_mappings_for_workspace(
	conn: &mut SqliteConnection,
	namespace: &str,
	workspace_id: &str,
) -> Result<Vec<SessionRuntimeMapping>, AppError> {
	session_runtime_mappings::table
		.filter(session_runtime_mappings::namespace.eq(namespace))
		.filter(session_runtime_mappings::workspace_id.eq(workspace_id))
		.select(SessionRuntimeMapping::as_select())
		.order(session_runtime_mappings::pane_id.asc())
		.load(conn)
		.map_err(|e| AppError::DbError(e.to_string()))
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
		bind_session_pane(&mut conn, "sess-1", HERDR_NAMESPACE, "w1", "w1:p1")
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

		let session = bind_session_pane(
			&mut conn,
			"sess-1",
			HERDR_NAMESPACE,
			"w1",
			"w1:p1",
		)
		.unwrap();
		assert_eq!(session.pane_id, "w1:p1");
		assert_eq!(session.workspace_id, "w1");

		let listed = list_profile_mappings(&mut conn).unwrap();
		assert_eq!(listed.len(), 1);
		assert_eq!(listed[0].profile_id, "prof-1");
		assert_eq!(listed[0].workspace_id, "w1");

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
	fn list_session_mappings_for_workspace_uses_pane_id() {
		let mut conn = setup_db();
		seed_catalog(&mut conn);
		bind_profile_workspace(&mut conn, "prof-1", HERDR_NAMESPACE, "w1")
			.unwrap();
		bind_session_pane(&mut conn, "sess-1", HERDR_NAMESPACE, "w1", "w1:p1")
			.unwrap();
		let listed = list_session_mappings_for_workspace(
			&mut conn,
			HERDR_NAMESPACE,
			"w1",
		)
		.unwrap();
		assert_eq!(listed.len(), 1);
		assert_eq!(listed[0].pane_id, "w1:p1");
		assert!(list_session_mappings_for_workspace(
			&mut conn,
			HERDR_NAMESPACE,
			"missing",
		)
		.unwrap()
		.is_empty());
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

		let conflict =
			bind_profile_workspace(&mut conn, "prof-1", HERDR_NAMESPACE, "w2")
				.unwrap_err();
		assert!(matches!(conflict, AppError::RuntimeMappingReplaced(_)));

		let stolen =
			bind_profile_workspace(&mut conn, "prof-2", HERDR_NAMESPACE, "w1")
				.unwrap_err();
		assert!(matches!(stolen, AppError::RuntimeMappingAlreadyBound(_)));
		assert!(stolen
			.to_string()
			.contains("already bound to profile prof-1"));
	}

	#[test]
	fn explicit_replace_persists_new_workspace_id_on_the_same_row() {
		let mut conn = setup_db();
		seed_catalog(&mut conn);
		bind_profile_workspace(&mut conn, "prof-1", HERDR_NAMESPACE, "w1")
			.unwrap();

		let missing = replace_profile_workspace(
			&mut conn,
			"prof-2",
			HERDR_NAMESPACE,
			"w3",
		)
		.unwrap_err();
		assert!(matches!(missing, AppError::RuntimeMappingMissing(_)));

		let replaced = replace_profile_workspace(
			&mut conn,
			"prof-1",
			HERDR_NAMESPACE,
			"w2",
		)
		.unwrap();
		assert_eq!(replaced.profile_id, "prof-1");
		assert_eq!(replaced.workspace_id, "w2");
		assert_eq!(
			find_profile_mapping(&mut conn, "prof-1")
				.unwrap()
				.workspace_id,
			"w2"
		);

		bind_profile_workspace(&mut conn, "prof-2", HERDR_NAMESPACE, "w3")
			.unwrap();
		let stolen = replace_profile_workspace(
			&mut conn,
			"prof-1",
			HERDR_NAMESPACE,
			"w3",
		)
		.unwrap_err();
		assert!(matches!(stolen, AppError::RuntimeMappingAlreadyBound(_)));
		assert_eq!(
			find_profile_mapping(&mut conn, "prof-1")
				.unwrap()
				.workspace_id,
			"w2"
		);
	}

	#[test]
	fn profile_replace_unbinds_stale_session_workspace_ids() {
		let mut conn = setup_db();
		seed_catalog(&mut conn);
		bind_profile_workspace(&mut conn, "prof-1", HERDR_NAMESPACE, "w1")
			.unwrap();
		bind_session_pane(&mut conn, "sess-1", HERDR_NAMESPACE, "w1", "w1:p1")
			.unwrap();
		bind_profile_workspace(&mut conn, "prof-2", HERDR_NAMESPACE, "w2")
			.unwrap();
		bind_session_pane(&mut conn, "sess-2", HERDR_NAMESPACE, "w2", "w2:p1")
			.unwrap();

		let same = replace_profile_workspace(
			&mut conn,
			"prof-1",
			HERDR_NAMESPACE,
			"w1",
		)
		.unwrap();
		assert_eq!(same.workspace_id, "w1");
		assert_eq!(
			find_session_mapping(&mut conn, "sess-1").unwrap().pane_id,
			"w1:p1"
		);

		let replaced = replace_profile_workspace(
			&mut conn,
			"prof-1",
			HERDR_NAMESPACE,
			"w3",
		)
		.unwrap();
		assert_eq!(replaced.workspace_id, "w3");
		assert!(find_session_mapping(&mut conn, "sess-1").is_err());
		assert_eq!(
			find_session_mapping(&mut conn, "sess-2")
				.unwrap()
				.workspace_id,
			"w2"
		);
		assert_eq!(
			find_profile_mapping(&mut conn, "prof-1")
				.unwrap()
				.workspace_id,
			"w3"
		);
	}

	#[test]
	fn uniqueness_is_one_pane_per_session_and_one_session_per_pane() {
		let mut conn = setup_db();
		seed_catalog(&mut conn);

		bind_session_pane(&mut conn, "sess-1", HERDR_NAMESPACE, "w1", "w1:p1")
			.unwrap();
		bind_session_pane(&mut conn, "sess-1", HERDR_NAMESPACE, "w1", "w1:p1")
			.unwrap();

		let conflict = bind_session_pane(
			&mut conn,
			"sess-1",
			HERDR_NAMESPACE,
			"w1",
			"w1:p2",
		)
		.unwrap_err();
		assert!(matches!(conflict, AppError::RuntimeMappingReplaced(_)));

		let stolen = bind_session_pane(
			&mut conn,
			"sess-2",
			HERDR_NAMESPACE,
			"w1",
			"w1:p1",
		)
		.unwrap_err();
		assert!(matches!(stolen, AppError::RuntimeMappingAlreadyBound(_)));
		assert!(stolen
			.to_string()
			.contains("already bound to session sess-1"));
	}

	#[test]
	fn explicit_replace_persists_new_pane_id_on_the_same_row() {
		let mut conn = setup_db();
		seed_catalog(&mut conn);
		bind_session_pane(&mut conn, "sess-1", HERDR_NAMESPACE, "w1", "w1:p1")
			.unwrap();

		let missing = replace_session_pane(
			&mut conn,
			"sess-2",
			HERDR_NAMESPACE,
			"w2",
			"w2:p1",
		)
		.unwrap_err();
		assert!(matches!(missing, AppError::RuntimeMappingMissing(_)));

		let replaced = replace_session_pane(
			&mut conn,
			"sess-1",
			HERDR_NAMESPACE,
			"w1",
			"w1:p2",
		)
		.unwrap();
		assert_eq!(replaced.session_id, "sess-1");
		assert_eq!(replaced.workspace_id, "w1");
		assert_eq!(replaced.pane_id, "w1:p2");
	}

	#[test]
	fn session_workspace_id_must_match_bound_profile_workspace() {
		let mut conn = setup_db();
		seed_catalog(&mut conn);
		bind_profile_workspace(&mut conn, "prof-1", HERDR_NAMESPACE, "w1")
			.unwrap();

		let mismatch = bind_session_pane(
			&mut conn,
			"sess-1",
			HERDR_NAMESPACE,
			"w2",
			"w2:p1",
		)
		.unwrap_err();
		assert!(matches!(mismatch, AppError::RuntimeMappingAlreadyBound(_)));
		assert!(mismatch.to_string().contains("does not match profile"));

		let bound = bind_session_pane(
			&mut conn,
			"sess-1",
			HERDR_NAMESPACE,
			"w1",
			"w1:p1",
		)
		.unwrap();
		assert_eq!(bound.workspace_id, "w1");

		let replace_mismatch = replace_session_pane(
			&mut conn,
			"sess-1",
			HERDR_NAMESPACE,
			"w2",
			"w1:p2",
		)
		.unwrap_err();
		assert!(matches!(
			replace_mismatch,
			AppError::RuntimeMappingAlreadyBound(_)
		));
		assert_eq!(
			find_session_mapping(&mut conn, "sess-1").unwrap().pane_id,
			"w1:p1"
		);
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
		let pane =
			bind_session_pane(&mut conn, "sess-1", HERDR_NAMESPACE, "w1", "")
				.unwrap_err();
		assert!(pane.to_string().contains("pane_id is required"));
	}

	#[test]
	fn cascade_delete_removes_mappings_without_keeping_identities() {
		let mut conn = setup_db();
		seed_catalog(&mut conn);
		bind_profile_workspace(&mut conn, "prof-2", HERDR_NAMESPACE, "w2")
			.unwrap();
		bind_session_pane(&mut conn, "sess-2", HERDR_NAMESPACE, "w2", "w2:p1")
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
		bind_session_pane(&mut conn, "sess-1", HERDR_NAMESPACE, "w1", "w1:p1")
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
				 (session_id, namespace, workspace_id, pane_id) \
				 VALUES ('sess-2', '2code', 'w1', 'w1:p1');",
			)
			.is_err());
	}
}
