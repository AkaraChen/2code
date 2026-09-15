//! Reconcile persisted Herdr associations against a runtime projection.
//!
//! Mapping rows do not transfer live session or worktree ownership.
//! Identities stay `workspace_id` / `pane_id`; labels, paths, and
//! `terminal_id` never rebind a stored association.

use model::runtime::RuntimeIdentityState;
use model::runtime_mapping::{ProfileRuntimeMapping, SessionRuntimeMapping};

use crate::runtime_sync::RuntimeProjection;

/// Observed substitute for a stored identity. A different id matched by
/// label, path, or `terminal_id` is [`RuntimeIdentityState::Replaced`].
#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct RuntimeIdentityCandidate<'a> {
	pub workspace_id: Option<&'a str>,
	pub pane_id: Option<&'a str>,
	pub label: Option<&'a str>,
	pub path: Option<&'a str>,
	pub terminal_id: Option<&'a str>,
}

pub fn workspace_identity_state(
	mapping: &ProfileRuntimeMapping,
	projection: &RuntimeProjection,
) -> RuntimeIdentityState {
	workspace_identity_state_with_candidate(
		mapping,
		projection,
		&RuntimeIdentityCandidate::default(),
	)
}

pub fn workspace_identity_state_with_candidate(
	mapping: &ProfileRuntimeMapping,
	projection: &RuntimeProjection,
	candidate: &RuntimeIdentityCandidate<'_>,
) -> RuntimeIdentityState {
	if projection.workspace(&mapping.workspace_id).is_some() {
		return RuntimeIdentityState::Bound;
	}

	let different_id = candidate
		.workspace_id
		.is_some_and(|id| id != mapping.workspace_id);
	let label_match = candidate.label.is_some_and(|label| {
		projection.workspace_ids().iter().any(|id| {
			id != &mapping.workspace_id
				&& projection
					.workspace(id)
					.is_some_and(|workspace| workspace.label == label)
		})
	});
	if different_id || label_match {
		return RuntimeIdentityState::Replaced;
	}
	RuntimeIdentityState::Missing
}

pub fn pane_identity_state(
	mapping: &SessionRuntimeMapping,
	projection: &RuntimeProjection,
) -> RuntimeIdentityState {
	pane_identity_state_with_candidate(
		mapping,
		projection,
		&RuntimeIdentityCandidate::default(),
	)
}

pub fn pane_identity_state_with_candidate(
	mapping: &SessionRuntimeMapping,
	projection: &RuntimeProjection,
	candidate: &RuntimeIdentityCandidate<'_>,
) -> RuntimeIdentityState {
	if projection.pane(&mapping.pane_id).is_some() {
		return RuntimeIdentityState::Bound;
	}

	let different_pane =
		candidate.pane_id.is_some_and(|id| id != mapping.pane_id);
	let terminal_match = candidate.terminal_id.is_some_and(|terminal_id| {
		projection.pane_ids().iter().any(|id| {
			id != &mapping.pane_id
				&& projection
					.pane(id)
					.is_some_and(|pane| pane.terminal_id == terminal_id)
		})
	});
	if different_pane || terminal_match {
		return RuntimeIdentityState::Replaced;
	}
	RuntimeIdentityState::Missing
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
	fn missing_workspace_id_is_explicit_and_does_not_rebind_by_label() {
		let mut projection = RuntimeProjection::new();
		projection
			.apply_snapshot(&snapshot(
				json!([{ "workspace_id": "w2", "label": "App" }]),
				json!([]),
			))
			.unwrap();
		let stored = mapping("w1");
		assert_eq!(
			workspace_identity_state(&stored, &projection),
			RuntimeIdentityState::Missing
		);
		assert_eq!(
			workspace_identity_state_with_candidate(
				&stored,
				&projection,
				&RuntimeIdentityCandidate {
					workspace_id: Some("w2"),
					label: Some("App"),
					path: Some("/repo/cache"),
					..Default::default()
				},
			),
			RuntimeIdentityState::Replaced
		);
		assert_eq!(stored.workspace_id, "w1");
	}

	#[test]
	fn pane_stays_bound_when_terminal_id_is_replaced_after_restart() {
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
	}

	#[test]
	fn missing_pane_id_does_not_rebind_by_terminal_id() {
		let mut projection = RuntimeProjection::new();
		projection
			.apply_snapshot(&snapshot(
				json!([{ "workspace_id": "w1", "label": "App" }]),
				json!([{
					"pane_id": "w1:p2",
					"tab_id": "w1:t1",
					"workspace_id": "w1",
					"terminal_id": "term_old"
				}]),
			))
			.unwrap();
		let stored = pane_mapping("w1:p1");
		assert_eq!(
			pane_identity_state(&stored, &projection),
			RuntimeIdentityState::Missing
		);
		assert_eq!(
			pane_identity_state_with_candidate(
				&stored,
				&projection,
				&RuntimeIdentityCandidate {
					pane_id: Some("w1:p2"),
					terminal_id: Some("term_old"),
					..Default::default()
				},
			),
			RuntimeIdentityState::Replaced
		);
		assert_eq!(stored.pane_id, "w1:p1");
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
