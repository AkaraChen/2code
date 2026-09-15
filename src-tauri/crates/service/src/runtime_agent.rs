//! Map projected Herdr pane agent state onto 2code sessions.
//!
//! Lookup is `pane_id` in namespace `2code`. Unmapped panes are ignored.
//! Missing or replaced panes fail closed (no DTO, no Local fallback).

use diesel::SqliteConnection;
use model::error::AppError;
use model::runtime::{
	RuntimeIdentityState, SessionAgentStatus, HERDR_NAMESPACE,
};
use model::runtime_mapping::SessionRuntimeMapping;

use crate::runtime_mapping::pane_identity_state;
use crate::runtime_sync::{ProjectedPane, RuntimeProjection};

pub fn session_agent_from_pane(
	session_id: &str,
	pane: &ProjectedPane,
) -> SessionAgentStatus {
	SessionAgentStatus {
		session_id: session_id.to_string(),
		status: pane.agent_status.clone(),
		agent_name: pane
			.agent_identity
			.as_ref()
			.and_then(|identity| identity.display_name().map(str::to_string)),
	}
}

pub fn mapped_agent_for_pane(
	conn: &mut SqliteConnection,
	projection: &RuntimeProjection,
	pane_id: &str,
) -> Result<Option<SessionAgentStatus>, AppError> {
	let mapping = match repo::runtime_mapping::find_session_by_pane(
		conn,
		HERDR_NAMESPACE,
		pane_id,
	) {
		Ok(mapping) => mapping,
		Err(AppError::NotFound(_)) => return Ok(None),
		Err(err) => return Err(err),
	};
	mapped_agent_for_mapping(projection, &mapping)
}

pub fn mapped_agent_for_session(
	conn: &mut SqliteConnection,
	projection: &RuntimeProjection,
	session_id: &str,
) -> Result<Option<SessionAgentStatus>, AppError> {
	let mapping =
		match repo::runtime_mapping::find_session_mapping(conn, session_id) {
			Ok(mapping) => mapping,
			Err(AppError::NotFound(_)) => return Ok(None),
			Err(err) => return Err(err),
		};
	if mapping.namespace != HERDR_NAMESPACE {
		return Ok(None);
	}
	mapped_agent_for_mapping(projection, &mapping)
}

fn mapped_agent_for_mapping(
	projection: &RuntimeProjection,
	mapping: &SessionRuntimeMapping,
) -> Result<Option<SessionAgentStatus>, AppError> {
	match pane_identity_state(mapping, projection) {
		RuntimeIdentityState::Bound => {
			let pane = projection.pane(&mapping.pane_id).ok_or_else(|| {
				AppError::RuntimeMappingMissing(format!(
					"pane {} is missing",
					mapping.pane_id
				))
			})?;
			Ok(Some(session_agent_from_pane(&mapping.session_id, pane)))
		}
		RuntimeIdentityState::Missing | RuntimeIdentityState::Replaced => {
			Ok(None)
		}
	}
}

#[cfg(test)]
mod tests {
	use diesel::prelude::*;
	use diesel_migrations::MigrationHarness;
	use serde_json::json;

	use super::*;
	use crate::runtime_sync::{ApplyOutcome, RuntimeEvent, RuntimeReconciler};
	use model::pty::NewPtySessionRecord;
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
		runtime_mapping::bind_profile_workspace(
			conn,
			"prof-1",
			HERDR_NAMESPACE,
			"w1",
		)
		.unwrap();
		runtime_mapping::bind_session_pane(
			conn,
			"sess-1",
			HERDR_NAMESPACE,
			"w1",
			"w1:p1",
		)
		.unwrap();
	}

	fn snapshot(
		panes: serde_json::Value,
		agents: serde_json::Value,
	) -> serde_json::Value {
		json!({
			"type": "session_snapshot",
			"snapshot": {
				"workspaces": [{
					"workspace_id": "w1",
					"label": "App"
				}],
				"tabs": [{
					"tab_id": "w1:t1",
					"workspace_id": "w1",
					"label": "App"
				}],
				"panes": panes,
				"agents": agents
			}
		})
	}

	fn pane(id: &str, status: &str) -> serde_json::Value {
		json!({
			"pane_id": id,
			"tab_id": "w1:t1",
			"workspace_id": "w1",
			"terminal_id": "term_a",
			"revision": 1,
			"agent_status": status
		})
	}

	fn projection_from(status: &str) -> RuntimeProjection {
		let mut projection = RuntimeProjection::new();
		projection
			.apply_snapshot(&snapshot(
				json!([pane("w1:p1", status)]),
				json!([]),
			))
			.unwrap();
		projection
	}

	#[test]
	fn unknown_snapshot_maps_to_the_mapped_session() {
		let mut conn = setup_db();
		seed(&mut conn);
		let dto = mapped_agent_for_session(
			&mut conn,
			&projection_from("unknown"),
			"sess-1",
		)
		.unwrap()
		.expect("mapped");
		assert_eq!(dto.session_id, "sess-1");
		assert_eq!(dto.status, "unknown");
		assert_eq!(dto.agent_name, None);
	}

	#[test]
	fn agent_status_events_update_the_mapped_session() {
		let mut conn = setup_db();
		seed(&mut conn);
		let mut rec = RuntimeReconciler::new();
		let gen = rec
			.bootstrap(
				&snapshot(json!([pane("w1:p1", "unknown")]), json!([])),
				&[],
			)
			.unwrap();
		for status in ["working", "blocked", "done", "idle"] {
			assert_eq!(
				rec.apply_event(&RuntimeEvent::new(
					gen,
					"pane_agent_status_changed",
					json!({
						"pane_id": "w1:p1",
						"workspace_id": "w1",
						"agent_status": status,
						"agent": "claude",
						"display_agent": "Claude Code"
					}),
				)),
				ApplyOutcome::Applied
			);
			let dto =
				mapped_agent_for_pane(&mut conn, rec.projection(), "w1:p1")
					.unwrap()
					.expect("mapped");
			assert_eq!(dto.session_id, "sess-1");
			assert_eq!(dto.status, status);
			assert_eq!(dto.agent_name.as_deref(), Some("Claude Code"));
		}
	}

	#[test]
	fn unmapped_pane_id_is_ignored() {
		let mut conn = setup_db();
		seed(&mut conn);
		let mut projection = RuntimeProjection::new();
		projection
			.apply_snapshot(&snapshot(
				json!([pane("w1:p1", "unknown"), pane("w1:p2", "working")]),
				json!([]),
			))
			.unwrap();
		assert!(mapped_agent_for_pane(&mut conn, &projection, "w1:p2")
			.unwrap()
			.is_none());
		assert_eq!(
			mapped_agent_for_pane(&mut conn, &projection, "w1:p1")
				.unwrap()
				.unwrap()
				.session_id,
			"sess-1"
		);
	}

	#[test]
	fn missing_pane_fails_closed() {
		let mut conn = setup_db();
		seed(&mut conn);
		let projection = RuntimeProjection::new();
		assert!(mapped_agent_for_session(&mut conn, &projection, "sess-1")
			.unwrap()
			.is_none());
	}

	#[test]
	fn unknown_session_is_ignored() {
		let mut conn = setup_db();
		seed(&mut conn);
		assert!(mapped_agent_for_session(
			&mut conn,
			&projection_from("working"),
			"ghost",
		)
		.unwrap()
		.is_none());
	}
}
