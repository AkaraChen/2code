//! Reconcile persisted Herdr associations against a runtime projection.
//!
//! Mapping rows do not transfer live session or worktree ownership.
//! Identities stay `workspace_id` / `pane_id`. Labels, paths, and
//! `terminal_id` never rematch a stored association. Replaced is only
//! an explicit caller-supplied new id in namespace `2code`.

use model::runtime::RuntimeIdentityState;
use model::runtime_mapping::{ProfileRuntimeMapping, SessionRuntimeMapping};

use crate::runtime_sync::RuntimeProjection;

pub fn workspace_identity_state(
	mapping: &ProfileRuntimeMapping,
	projection: &RuntimeProjection,
) -> RuntimeIdentityState {
	if projection.workspace(&mapping.workspace_id).is_some() {
		RuntimeIdentityState::Bound
	} else {
		RuntimeIdentityState::Missing
	}
}

/// Classify a stored workspace against the projection.
///
/// `new_workspace_id` is an explicit replacement id. It is never
/// resolved from a label, path, or `worktree_path`.
pub fn workspace_identity_state_with_new_id(
	mapping: &ProfileRuntimeMapping,
	projection: &RuntimeProjection,
	new_workspace_id: &str,
) -> RuntimeIdentityState {
	classify_explicit_replace(
		projection.workspace(&mapping.workspace_id).is_some(),
		&mapping.workspace_id,
		new_workspace_id,
	)
}

pub fn pane_identity_state(
	mapping: &SessionRuntimeMapping,
	projection: &RuntimeProjection,
) -> RuntimeIdentityState {
	if projection.pane(&mapping.pane_id).is_some() {
		RuntimeIdentityState::Bound
	} else {
		RuntimeIdentityState::Missing
	}
}

/// Classify a stored pane against the projection.
///
/// `new_pane_id` is an explicit replacement id. It is never resolved
/// from `terminal_id`.
pub fn pane_identity_state_with_new_id(
	mapping: &SessionRuntimeMapping,
	projection: &RuntimeProjection,
	new_pane_id: &str,
) -> RuntimeIdentityState {
	classify_explicit_replace(
		projection.pane(&mapping.pane_id).is_some(),
		&mapping.pane_id,
		new_pane_id,
	)
}

fn classify_explicit_replace(
	stored_present: bool,
	stored_id: &str,
	new_id: &str,
) -> RuntimeIdentityState {
	if stored_present {
		RuntimeIdentityState::Bound
	} else if !new_id.is_empty() && new_id != stored_id {
		RuntimeIdentityState::Replaced
	} else {
		RuntimeIdentityState::Missing
	}
}

#[cfg(test)]
mod tests {
	use diesel::prelude::*;
	use diesel_migrations::MigrationHarness;
	use serde_json::json;

	use super::*;
	use crate::runtime::{
		HerdrStubAdapter, RuntimeSelector, TerminalRuntime, SESSION_NAME,
	};
	use model::error::AppError;
	use model::pty::{NewPtySessionRecord, PtyConfig, PtySessionMeta};
	use model::runtime::{RuntimeBackend, HERDR_NAMESPACE};
	use repo::profile;
	use repo::project;
	use repo::pty;
	use repo::runtime_mapping;

	fn setup_db() -> diesel::SqliteConnection {
		let mut conn = diesel::SqliteConnection::establish(":memory:")
			.expect("in-memory db");
		diesel::sql_query("PRAGMA foreign_keys=ON;")
			.execute(&mut conn)
			.ok();
		conn.run_pending_migrations(infra::db::MIGRATIONS)
			.expect("run migrations");
		conn
	}

	fn seed(conn: &mut diesel::SqliteConnection) {
		project::insert(conn, "proj-1", "Keep", "/repo").unwrap();
		profile::insert_default(
			conn,
			"prof-1",
			"proj-1",
			"main",
			"/repo/cache",
		)
		.unwrap();
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
		.unwrap();
	}

	fn snapshot(
		workspaces: serde_json::Value,
		panes: serde_json::Value,
	) -> serde_json::Value {
		json!({
			"type": "session_snapshot",
			"snapshot": {
				"workspaces": workspaces,
				"tabs": [],
				"panes": panes
			}
		})
	}

	fn mapping(workspace_id: &str) -> ProfileRuntimeMapping {
		ProfileRuntimeMapping {
			profile_id: "prof-1".into(),
			namespace: HERDR_NAMESPACE.into(),
			workspace_id: workspace_id.into(),
		}
	}

	fn pane_mapping(pane_id: &str) -> SessionRuntimeMapping {
		SessionRuntimeMapping {
			session_id: "sess-1".into(),
			namespace: HERDR_NAMESPACE.into(),
			workspace_id: "w1".into(),
			pane_id: pane_id.into(),
		}
	}

	#[test]
	fn namespace_matches_dedicated_2code_session() {
		assert_eq!(SESSION_NAME, HERDR_NAMESPACE);
		assert_ne!(SESSION_NAME, "default");
	}

	#[test]
	fn stored_workspace_id_is_bound_even_when_label_changes() {
		let mut projection = RuntimeProjection::new();
		projection
			.apply_snapshot(&snapshot(
				json!([{ "workspace_id": "w1", "label": "Renamed" }]),
				json!([]),
			))
			.unwrap();
		assert_eq!(
			workspace_identity_state(&mapping("w1"), &projection),
			RuntimeIdentityState::Bound
		);
	}

	#[test]
	fn label_only_and_path_only_stay_missing_and_do_not_rewrite_rows() {
		let mut conn = setup_db();
		seed(&mut conn);
		runtime_mapping::bind_profile_workspace(
			&mut conn,
			"prof-1",
			HERDR_NAMESPACE,
			"w1",
		)
		.unwrap();
		runtime_mapping::bind_session_pane(
			&mut conn,
			"sess-1",
			HERDR_NAMESPACE,
			"w1",
			"w1:p1",
		)
		.unwrap();

		let mut projection = RuntimeProjection::new();
		projection
			.apply_snapshot(&snapshot(
				json!([{ "workspace_id": "w2", "label": "App" }]),
				json!([{
					"pane_id": "w2:p1",
					"tab_id": "w2:t1",
					"workspace_id": "w2",
					"terminal_id": "term_old"
				}]),
			))
			.unwrap();

		let stored_profile =
			runtime_mapping::find_profile_mapping(&mut conn, "prof-1").unwrap();
		let stored_session =
			runtime_mapping::find_session_mapping(&mut conn, "sess-1").unwrap();
		assert_eq!(
			workspace_identity_state(&stored_profile, &projection),
			RuntimeIdentityState::Missing
		);
		assert_eq!(
			pane_identity_state(&stored_session, &projection),
			RuntimeIdentityState::Missing
		);
		assert_eq!(
			profile::find_by_id(&mut conn, "prof-1")
				.unwrap()
				.worktree_path,
			"/repo/cache"
		);
		assert_eq!(
			runtime_mapping::find_profile_mapping(&mut conn, "prof-1")
				.unwrap()
				.workspace_id,
			"w1"
		);
		assert_eq!(
			runtime_mapping::find_session_mapping(&mut conn, "sess-1")
				.unwrap()
				.pane_id,
			"w1:p1"
		);
	}

	#[test]
	fn explicit_new_id_is_replaced_and_persists_on_the_same_row() {
		let mut conn = setup_db();
		seed(&mut conn);
		runtime_mapping::bind_profile_workspace(
			&mut conn,
			"prof-1",
			HERDR_NAMESPACE,
			"w1",
		)
		.unwrap();
		runtime_mapping::bind_session_pane(
			&mut conn,
			"sess-1",
			HERDR_NAMESPACE,
			"w1",
			"w1:p1",
		)
		.unwrap();

		let mut projection = RuntimeProjection::new();
		projection
			.apply_snapshot(&snapshot(json!([]), json!([])))
			.unwrap();
		let stored_profile =
			runtime_mapping::find_profile_mapping(&mut conn, "prof-1").unwrap();
		assert_eq!(
			workspace_identity_state_with_new_id(
				&stored_profile,
				&projection,
				"w2",
			),
			RuntimeIdentityState::Replaced
		);

		let replaced_profile = runtime_mapping::replace_profile_workspace(
			&mut conn,
			"prof-1",
			HERDR_NAMESPACE,
			"w2",
		)
		.unwrap();
		assert_eq!(replaced_profile.workspace_id, "w2");
		assert_eq!(replaced_profile.profile_id, "prof-1");

		let stored_session =
			runtime_mapping::find_session_mapping(&mut conn, "sess-1").unwrap();
		assert_eq!(
			pane_identity_state_with_new_id(
				&stored_session,
				&projection,
				"w1:p2",
			),
			RuntimeIdentityState::Replaced
		);
		let replaced_session = runtime_mapping::replace_session_pane(
			&mut conn,
			"sess-1",
			HERDR_NAMESPACE,
			"w2",
			"w1:p2",
		)
		.unwrap();
		assert_eq!(replaced_session.session_id, "sess-1");
		assert_eq!(replaced_session.workspace_id, "w2");
		assert_eq!(replaced_session.pane_id, "w1:p2");
	}

	#[test]
	fn pane_stays_bound_when_terminal_id_is_new_after_restart() {
		let mut projection = RuntimeProjection::new();
		projection
			.apply_snapshot(&snapshot(
				json!([{ "workspace_id": "w1", "label": "App" }]),
				json!([{
					"pane_id": "w1:p1",
					"tab_id": "w1:t1",
					"workspace_id": "w1",
					"terminal_id": "term_new"
				}]),
			))
			.unwrap();
		assert_eq!(
			pane_identity_state(&pane_mapping("w1:p1"), &projection),
			RuntimeIdentityState::Bound
		);
		assert_eq!(projection.pane("w1:p1").unwrap().terminal_id, "term_new");
		assert_eq!(
			pane_identity_state_with_new_id(
				&pane_mapping("w1:p1"),
				&projection,
				"w1:p2",
			),
			RuntimeIdentityState::Bound
		);
	}

	#[test]
	fn mapping_rows_do_not_transfer_live_ownership() {
		let mut conn = setup_db();
		seed(&mut conn);
		runtime_mapping::bind_profile_workspace(
			&mut conn,
			"prof-1",
			HERDR_NAMESPACE,
			"w1",
		)
		.unwrap();
		runtime_mapping::bind_session_pane(
			&mut conn,
			"sess-1",
			HERDR_NAMESPACE,
			"w1",
			"w1:p1",
		)
		.unwrap();

		let selector = RuntimeSelector::default();
		selector.bind("sess-1", RuntimeBackend::Local).unwrap();
		assert_eq!(
			selector.owner("sess-1").unwrap(),
			Some(RuntimeBackend::Local)
		);
		let err = selector.bind("sess-1", RuntimeBackend::Herdr).unwrap_err();
		assert!(err.to_string().contains("owned by local"));

		let herdr = HerdrStubAdapter::new();
		let write_err = herdr.write("sess-1", b"x").unwrap_err();
		assert!(write_err
			.to_string()
			.contains("Herdr runtime is not available"));
		assert_eq!(
			herdr
				.create_session(
					&PtySessionMeta {
						profile_id: "prof-1".into(),
						title: "t".into(),
					},
					&PtyConfig {
						shell: "/bin/sh".into(),
						cwd: "/tmp".into(),
						rows: 24,
						cols: 80,
						startup_commands: Vec::new(),
					},
				)
				.unwrap_err()
				.to_string(),
			write_err.to_string()
		);
		assert!(matches!(
			AppError::from(infra::herdr::process::HerdrProcessError::Absent {
				socket: "/tmp/x.sock".into(),
			}),
			AppError::HerdrServerAbsent(_)
		));
	}

	#[test]
	fn mapping_module_does_not_own_herdr_objects() {
		let src = include_str!("runtime_mapping.rs")
			.split("#[cfg(test)]")
			.next()
			.unwrap();
		assert!(!src.contains("worktree.open"));
		assert!(!src.contains("worktree.create"));
		assert!(!src.contains("workspace.create"));
		assert!(!src.contains("pane.close"));
		assert!(!src.contains("server.stop"));
		assert!(!src.contains("ensure_herdr_listener"));
		assert!(!src.contains("events.subscribe"));
	}
}
