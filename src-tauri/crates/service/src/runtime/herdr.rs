//! Herdr terminal lifecycle: create, list, and explicit close.
//!
//! Write/resize/history/restore stay fail-closed (Task 10). A missing
//! client keeps the Task 2 stub behavior. Identities are `pane_id` in
//! namespace `2code`. `terminal_id` is never persisted.

use std::collections::HashSet;
use std::sync::{Arc, Mutex};

use infra::db::DbPool;
use infra::herdr::transport::{HerdrClient, PaneView, TabCreateResult};
use model::error::AppError;
use model::pty::{
	NewPtySessionRecord, PtyConfig, PtySessionMeta, PtySessionRecord,
	RestoreResult,
};
use model::runtime::{
	CreateSessionResult, RuntimeBackend, RuntimeIdentityState, HERDR_NAMESPACE,
};
use serde_json::Value;
use uuid::Uuid;

use crate::runtime_mapping::{pane_identity_state, workspace_identity_state};
use crate::runtime_sync::RuntimeProjection;

use super::TerminalRuntime;

const UNAVAILABLE: &str = "Herdr runtime is not available";

/// JSON terminal lifecycle used by the Herdr adapter. Implementors must
/// not auto-replay `tab.create` / `pane.close`.
pub trait HerdrTerminalClient: Send + Sync {
	fn tab_create(
		&self,
		workspace_id: &str,
		label: &str,
	) -> Result<TabCreateResult, AppError>;

	fn pane_list(&self, workspace_id: &str) -> Result<Vec<PaneView>, AppError>;

	fn pane_get(&self, pane_id: &str) -> Result<Option<PaneView>, AppError>;

	fn pane_close(&self, pane_id: &str) -> Result<(), AppError>;

	fn session_snapshot(&self) -> Result<Value, AppError>;
}

/// Typed JSON client. Does not attach frames or stop the Herdr server.
pub struct HerdrJsonTerminals {
	client: HerdrClient,
}

impl HerdrJsonTerminals {
	pub fn new(client: HerdrClient) -> Self {
		Self { client }
	}
}

impl HerdrTerminalClient for HerdrJsonTerminals {
	fn tab_create(
		&self,
		workspace_id: &str,
		label: &str,
	) -> Result<TabCreateResult, AppError> {
		self.client
			.tab_create(workspace_id, label)
			.map_err(AppError::from)
	}

	fn pane_list(&self, workspace_id: &str) -> Result<Vec<PaneView>, AppError> {
		self.client.pane_list(workspace_id).map_err(AppError::from)
	}

	fn pane_get(&self, pane_id: &str) -> Result<Option<PaneView>, AppError> {
		self.client.pane_get(pane_id).map_err(AppError::from)
	}

	fn pane_close(&self, pane_id: &str) -> Result<(), AppError> {
		self.client.pane_close(pane_id).map_err(AppError::from)
	}

	fn session_snapshot(&self) -> Result<Value, AppError> {
		self.client
			.session_snapshot()
			.map(|success| success.result)
			.map_err(AppError::from)
	}
}

struct HerdrLifecycle {
	db: DbPool,
	client: Arc<dyn HerdrTerminalClient>,
}

/// Herdr adapter. Without a client, lifecycle stays fail-closed.
#[derive(Default)]
pub struct HerdrStubAdapter {
	ops: Mutex<Vec<&'static str>>,
	lifecycle: Option<HerdrLifecycle>,
}

impl HerdrStubAdapter {
	pub fn new() -> Self {
		Self::default()
	}

	pub fn with_terminal_client(
		db: DbPool,
		client: Arc<dyn HerdrTerminalClient>,
	) -> Self {
		Self {
			ops: Mutex::new(Vec::new()),
			lifecycle: Some(HerdrLifecycle { db, client }),
		}
	}

	fn fail(&self, op: &'static str) -> AppError {
		self.record(op);
		AppError::PtyError(UNAVAILABLE.to_string())
	}

	fn record(&self, op: &'static str) {
		if let Ok(mut ops) = self.ops.lock() {
			ops.push(op);
		}
	}

	pub fn recorded_ops(&self) -> Vec<&'static str> {
		self.ops.lock().map(|ops| ops.clone()).unwrap_or_default()
	}

	/// Read-only `events.subscribe` + `session.snapshot` projection.
	/// Does not create, close, or attach terminals.
	pub fn open_runtime_sync(
		endpoint: &super::HerdrEndpoint,
	) -> Result<crate::runtime_sync::HerdrRuntimeSync, AppError> {
		crate::runtime_sync::HerdrRuntimeSync::connect(endpoint)
	}

	fn lifecycle(&self) -> Result<&HerdrLifecycle, AppError> {
		self.lifecycle
			.as_ref()
			.ok_or_else(|| AppError::PtyError(UNAVAILABLE.to_string()))
	}
}

/// Adopted workspace root is `{workspace_id}:p1`. Splits are not reused
/// for extra 2code terminals; those use `tab.create`.
pub(crate) fn unbound_adopted_root_pane(
	workspace_id: &str,
	panes: &[PaneView],
	bound: &HashSet<String>,
) -> Option<String> {
	let root_id = format!("{workspace_id}:p1");
	panes.iter().find_map(|pane| {
		if pane.pane_id == root_id && !bound.contains(&pane.pane_id) {
			Some(pane.pane_id.clone())
		} else {
			None
		}
	})
}

fn new_unbound_panes<'a>(
	before: &[PaneView],
	after: &'a [PaneView],
	bound: &HashSet<String>,
) -> Vec<&'a PaneView> {
	after
		.iter()
		.filter(|pane| {
			!bound.contains(&pane.pane_id)
				&& before.iter().all(|old| old.pane_id != pane.pane_id)
		})
		.collect()
}

fn snapshot_panes_for_workspace(
	snapshot: &Value,
	workspace_id: &str,
) -> Result<Vec<PaneView>, AppError> {
	let mut projection = RuntimeProjection::new();
	projection.apply_snapshot(snapshot)?;
	Ok(projection
		.pane_ids()
		.into_iter()
		.filter_map(|id| {
			let pane = projection.pane(&id)?;
			if pane.workspace_id == workspace_id {
				Some(PaneView {
					pane_id: pane.pane_id.clone(),
					tab_id: pane.tab_id.clone(),
					workspace_id: pane.workspace_id.clone(),
				})
			} else {
				None
			}
		})
		.collect())
}

fn reconcile_created_pane(
	client: &dyn HerdrTerminalClient,
	workspace_id: &str,
	before: &[PaneView],
	bound: &HashSet<String>,
) -> Result<String, AppError> {
	if let Ok(after) = client.pane_list(workspace_id) {
		let found = new_unbound_panes(before, &after, bound);
		if found.len() == 1 {
			return Ok(found[0].pane_id.clone());
		}
	}
	let snapshot = client.session_snapshot()?;
	let after = snapshot_panes_for_workspace(&snapshot, workspace_id)?;
	let found = new_unbound_panes(before, &after, bound);
	if found.len() == 1 {
		return Ok(found[0].pane_id.clone());
	}
	Err(AppError::HerdrUncertainOutcome(
		"tab.create outcome is uncertain; not replaying".into(),
	))
}

fn pane_is_absent(
	client: &dyn HerdrTerminalClient,
	workspace_id: &str,
	pane_id: &str,
) -> Result<bool, AppError> {
	if client.pane_get(pane_id)?.is_none() {
		return Ok(true);
	}
	if let Ok(listed) = client.pane_list(workspace_id) {
		if listed.iter().all(|pane| pane.pane_id != pane_id) {
			return Ok(true);
		}
	}
	let snapshot = client.session_snapshot()?;
	let mut projection = RuntimeProjection::new();
	projection.apply_snapshot(&snapshot)?;
	Ok(projection.pane(pane_id).is_none())
}

fn workspace_is_absent(
	client: &dyn HerdrTerminalClient,
	workspace_id: &str,
) -> Result<bool, AppError> {
	let snapshot = client.session_snapshot()?;
	let mut projection = RuntimeProjection::new();
	projection.apply_snapshot(&snapshot)?;
	Ok(projection.workspace(workspace_id).is_none())
}

impl HerdrLifecycle {
	fn with_db<T>(
		&self,
		f: impl FnOnce(&mut diesel::SqliteConnection) -> Result<T, AppError>,
	) -> Result<T, AppError> {
		let mut conn = self.db.lock().map_err(|_| AppError::LockError)?;
		f(&mut conn)
	}

	fn bound_pane_ids(
		&self,
		workspace_id: &str,
	) -> Result<HashSet<String>, AppError> {
		self.with_db(|conn| {
			Ok(repo::runtime_mapping::list_session_mappings_for_workspace(
				conn,
				HERDR_NAMESPACE,
				workspace_id,
			)?
			.into_iter()
			.map(|mapping| mapping.pane_id)
			.collect())
		})
	}

	fn bound_workspace(&self, profile_id: &str) -> Result<String, AppError> {
		let mapping = self.with_db(|conn| {
			match repo::runtime_mapping::find_profile_mapping(conn, profile_id)
			{
				Ok(mapping) => Ok(mapping),
				Err(AppError::NotFound(_)) => {
					Err(AppError::RuntimeMappingMissing(format!(
						"profile {profile_id} has no Herdr workspace"
					)))
				}
				Err(err) => Err(err),
			}
		})?;
		let snapshot = self.client.session_snapshot()?;
		let mut projection = RuntimeProjection::new();
		projection.apply_snapshot(&snapshot)?;
		match workspace_identity_state(&mapping, &projection) {
			RuntimeIdentityState::Bound => Ok(mapping.workspace_id),
			RuntimeIdentityState::Missing => {
				Err(AppError::RuntimeMappingMissing(format!(
					"workspace {} is missing",
					mapping.workspace_id
				)))
			}
			RuntimeIdentityState::Replaced => {
				Err(AppError::RuntimeMappingReplaced(format!(
					"workspace {}",
					mapping.workspace_id
				)))
			}
		}
	}

	fn persist_session(
		&self,
		meta: &PtySessionMeta,
		config: &PtyConfig,
		workspace_id: &str,
		pane_id: &str,
	) -> Result<CreateSessionResult, AppError> {
		let session_id = Uuid::new_v4().to_string();
		self.with_db(|conn| {
			repo::pty::insert_session(
				conn,
				&NewPtySessionRecord {
					id: &session_id,
					profile_id: &meta.profile_id,
					title: &meta.title,
					shell: &config.shell,
					cwd: &config.cwd,
					cols: config.cols as i32,
					rows: config.rows as i32,
				},
			)?;
			if let Err(err) = repo::runtime_mapping::bind_session_pane(
				conn,
				&session_id,
				HERDR_NAMESPACE,
				workspace_id,
				pane_id,
			) {
				let _ = repo::pty::delete_session(conn, &session_id);
				return Err(err);
			}
			Ok(())
		})?;
		Ok(CreateSessionResult { session_id })
	}

	fn persist_created_pane(
		&self,
		meta: &PtySessionMeta,
		config: &PtyConfig,
		workspace_id: &str,
		pane_id: &str,
		close_on_bind_failure: bool,
	) -> Result<CreateSessionResult, AppError> {
		match self.persist_session(meta, config, workspace_id, pane_id) {
			Ok(created) => Ok(created),
			Err(err) => {
				if close_on_bind_failure {
					let _ = self.client.pane_close(pane_id);
				}
				Err(err)
			}
		}
	}

	fn create_session(
		&self,
		meta: &PtySessionMeta,
		config: &PtyConfig,
	) -> Result<CreateSessionResult, AppError> {
		let workspace_id = self.bound_workspace(&meta.profile_id)?;
		let bound = self.bound_pane_ids(&workspace_id)?;
		let listed = self.client.pane_list(&workspace_id)?;
		if let Some(pane_id) =
			unbound_adopted_root_pane(&workspace_id, &listed, &bound)
		{
			return self.persist_created_pane(
				meta,
				config,
				&workspace_id,
				&pane_id,
				false,
			);
		}
		let pane_id = match self.client.tab_create(&workspace_id, &meta.title) {
			Ok(created) => created.pane_id,
			Err(AppError::HerdrUncertainOutcome(_)) => reconcile_created_pane(
				self.client.as_ref(),
				&workspace_id,
				&listed,
				&bound,
			)?,
			Err(err) => return Err(err),
		};
		let already = listed.iter().any(|pane| pane.pane_id == pane_id);
		self.persist_created_pane(
			meta,
			config,
			&workspace_id,
			&pane_id,
			!already,
		)
	}

	fn close_session(&self, session_id: &str) -> Result<(), AppError> {
		let mapping = self.with_db(|conn| {
			repo::runtime_mapping::find_session_mapping(conn, session_id)
		})?;
		match self.client.pane_close(&mapping.pane_id) {
			Ok(()) => self.finish_close(session_id),
			Err(AppError::HerdrUncertainOutcome(_)) => {
				if pane_is_absent(
					self.client.as_ref(),
					&mapping.workspace_id,
					&mapping.pane_id,
				)? {
					self.finish_close(session_id)
				} else {
					Err(AppError::HerdrUncertainOutcome(format!(
						"pane.close {} is uncertain; not replaying",
						mapping.pane_id
					)))
				}
			}
			Err(err) => Err(err),
		}
	}

	fn finish_close(&self, session_id: &str) -> Result<(), AppError> {
		let mapping = self.with_db(|conn| {
			repo::runtime_mapping::find_session_mapping(conn, session_id)
		})?;
		self.with_db(|conn| {
			match repo::runtime_mapping::unbind_session_pane(conn, session_id) {
				Ok(()) | Err(AppError::NotFound(_)) => {}
				Err(err) => return Err(err),
			}
			repo::pty::mark_closed(conn, session_id);
			Ok(())
		})?;
		if workspace_is_absent(self.client.as_ref(), &mapping.workspace_id)? {
			self.with_db(|conn| {
				let profile =
					match repo::runtime_mapping::find_profile_by_workspace(
						conn,
						HERDR_NAMESPACE,
						&mapping.workspace_id,
					) {
						Ok(profile) => profile,
						Err(AppError::NotFound(_)) => return Ok(()),
						Err(err) => return Err(err),
					};
				match repo::runtime_mapping::unbind_profile_workspace(
					conn,
					&profile.profile_id,
				) {
					Ok(()) | Err(AppError::NotFound(_)) => Ok(()),
					Err(err) => Err(err),
				}
			})?;
		}
		Ok(())
	}

	fn list_project_sessions(
		&self,
		project_id: &str,
	) -> Result<Vec<PtySessionRecord>, AppError> {
		let sessions = self.with_db(|conn| {
			let sessions = repo::pty::list_by_project(conn, project_id)?;
			let mut mapped = Vec::new();
			for session in sessions {
				if let Ok(mapping) = repo::runtime_mapping::find_session_mapping(
					conn,
					&session.id,
				) {
					mapped.push((session, mapping));
				}
			}
			Ok(mapped)
		})?;
		let snapshot = self.client.session_snapshot()?;
		let mut projection = RuntimeProjection::new();
		projection.apply_snapshot(&snapshot)?;
		Ok(sessions
			.into_iter()
			.filter(|(_, mapping)| {
				pane_identity_state(mapping, &projection)
					== RuntimeIdentityState::Bound
			})
			.map(|(session, _)| session)
			.collect())
	}

	fn delete_session(&self, session_id: &str) -> Result<(), AppError> {
		self.with_db(|conn| {
			match repo::runtime_mapping::unbind_session_pane(conn, session_id) {
				Ok(()) | Err(AppError::NotFound(_)) => {}
				Err(err) => return Err(err),
			}
			repo::pty::delete_session(conn, session_id)
		})
	}
}

impl TerminalRuntime for HerdrStubAdapter {
	fn selected_backend(&self) -> RuntimeBackend {
		RuntimeBackend::Herdr
	}

	fn create_session(
		&self,
		meta: &PtySessionMeta,
		config: &PtyConfig,
	) -> Result<CreateSessionResult, AppError> {
		self.record("create");
		self.lifecycle()?.create_session(meta, config)
	}

	fn restore_session(
		&self,
		_old_session_id: &str,
		_meta: &PtySessionMeta,
		_config: &PtyConfig,
	) -> Result<RestoreResult, AppError> {
		Err(self.fail("restore"))
	}

	fn close_session(&self, session_id: &str) -> Result<(), AppError> {
		self.record("close");
		self.lifecycle()?.close_session(session_id)
	}

	fn list_project_sessions(
		&self,
		project_id: &str,
	) -> Result<Vec<PtySessionRecord>, AppError> {
		self.record("list");
		self.lifecycle()?.list_project_sessions(project_id)
	}

	fn delete_session(&self, session_id: &str) -> Result<(), AppError> {
		self.record("delete");
		self.lifecycle()?.delete_session(session_id)
	}

	fn write(&self, _session_id: &str, _data: &[u8]) -> Result<(), AppError> {
		Err(self.fail("write"))
	}

	fn resize(
		&self,
		_session_id: &str,
		_rows: u16,
		_cols: u16,
	) -> Result<(), AppError> {
		Err(self.fail("resize"))
	}

	fn history(&self, _session_id: &str) -> Result<Vec<u8>, AppError> {
		Err(self.fail("history"))
	}

	fn flush(&self, _session_id: &str) -> Result<(), AppError> {
		Err(self.fail("flush"))
	}

	fn clear(&self, _session_id: &str) -> Result<(), AppError> {
		Err(self.fail("clear"))
	}
}

#[cfg(test)]
mod tests {
	use std::collections::HashMap;
	use std::sync::{Arc, Mutex};

	use diesel::prelude::*;
	use diesel_migrations::MigrationHarness;
	use infra::pty::{PtyReadThreads, PtySessionMap};
	use serde_json::json;

	use super::*;
	use crate::pty::{create_flush_senders, PtyContext};
	use crate::runtime::{LocalAdapter, RuntimeRouter, RuntimeSelector};
	use crate::PtyEventEmitter;
	use model::runtime::RuntimeBackend;

	struct TestEmitter;

	impl PtyEventEmitter for TestEmitter {
		fn emit_output(&self, _session_id: &str, _bytes: &[u8]) -> bool {
			true
		}

		fn emit_exit(&self, _session_id: &str) {}
	}

	fn setup_db() -> DbPool {
		let mut conn =
			SqliteConnection::establish(":memory:").expect("in-memory db");
		diesel::sql_query("PRAGMA foreign_keys=ON;")
			.execute(&mut conn)
			.ok();
		conn.run_pending_migrations(infra::db::MIGRATIONS)
			.expect("run migrations");
		Arc::new(Mutex::new(conn))
	}

	struct FakeState {
		panes: HashMap<String, Vec<PaneView>>,
		tab_create_calls: usize,
		pane_close_calls: usize,
		methods: Vec<String>,
		create_error: Option<AppError>,
		close_error: Option<AppError>,
		create_lands: bool,
		close_lands: bool,
		already_open_create: bool,
		next_extra: u32,
		on_list: Option<Arc<dyn Fn() + Send + Sync>>,
	}

	fn remove_pane(panes: &mut HashMap<String, Vec<PaneView>>, pane_id: &str) {
		for listed in panes.values_mut() {
			listed.retain(|pane| pane.pane_id != pane_id);
		}
		panes.retain(|_, listed| !listed.is_empty());
	}

	struct FakeTerminals {
		state: Mutex<FakeState>,
	}

	impl FakeTerminals {
		fn with_root(workspace_id: &str) -> Self {
			let pane = PaneView {
				pane_id: format!("{workspace_id}:p1"),
				tab_id: format!("{workspace_id}:t1"),
				workspace_id: workspace_id.to_string(),
			};
			let mut panes = HashMap::new();
			panes.insert(workspace_id.to_string(), vec![pane]);
			Self {
				state: Mutex::new(FakeState {
					panes,
					tab_create_calls: 0,
					pane_close_calls: 0,
					methods: Vec::new(),
					create_error: None,
					close_error: None,
					create_lands: false,
					close_lands: false,
					already_open_create: false,
					next_extra: 2,
					on_list: None,
				}),
			}
		}

		fn calls(&self) -> Vec<String> {
			self.state.lock().unwrap().methods.clone()
		}

		fn tab_create_calls(&self) -> usize {
			self.state.lock().unwrap().tab_create_calls
		}

		fn pane_close_calls(&self) -> usize {
			self.state.lock().unwrap().pane_close_calls
		}
	}

	impl HerdrTerminalClient for FakeTerminals {
		fn tab_create(
			&self,
			workspace_id: &str,
			_label: &str,
		) -> Result<TabCreateResult, AppError> {
			let mut state = self.state.lock().unwrap();
			state.methods.push("tab.create".into());
			state.tab_create_calls += 1;
			if state.already_open_create {
				let pane = state
					.panes
					.get(workspace_id)
					.and_then(|panes| panes.first())
					.cloned()
					.ok_or_else(|| {
						AppError::PtyError("no pane to reuse".into())
					})?;
				return Ok(TabCreateResult {
					workspace_id: workspace_id.to_string(),
					tab_id: pane.tab_id,
					pane_id: pane.pane_id,
				});
			}
			if let Some(err) = state.create_error.take() {
				if state.create_lands {
					let n = state.next_extra;
					state.next_extra += 1;
					let pane = PaneView {
						pane_id: format!("{workspace_id}:p{n}"),
						tab_id: format!("{workspace_id}:t{n}"),
						workspace_id: workspace_id.to_string(),
					};
					state
						.panes
						.entry(workspace_id.to_string())
						.or_default()
						.push(pane);
				}
				return Err(err);
			}
			let n = state.next_extra;
			state.next_extra += 1;
			let pane = PaneView {
				pane_id: format!("{workspace_id}:p{n}"),
				tab_id: format!("{workspace_id}:t{n}"),
				workspace_id: workspace_id.to_string(),
			};
			let created = TabCreateResult {
				workspace_id: workspace_id.to_string(),
				tab_id: pane.tab_id.clone(),
				pane_id: pane.pane_id.clone(),
			};
			state
				.panes
				.entry(workspace_id.to_string())
				.or_default()
				.push(pane);
			Ok(created)
		}

		fn pane_list(
			&self,
			workspace_id: &str,
		) -> Result<Vec<PaneView>, AppError> {
			let hook;
			let listed;
			{
				let mut state = self.state.lock().unwrap();
				state.methods.push("pane.list".into());
				listed =
					state.panes.get(workspace_id).cloned().unwrap_or_default();
				hook = state.on_list.clone();
			}
			if let Some(hook) = hook {
				hook();
			}
			Ok(listed)
		}

		fn pane_get(
			&self,
			pane_id: &str,
		) -> Result<Option<PaneView>, AppError> {
			let mut state = self.state.lock().unwrap();
			state.methods.push("pane.get".into());
			Ok(state
				.panes
				.values()
				.flatten()
				.find(|pane| pane.pane_id == pane_id)
				.cloned())
		}

		fn pane_close(&self, pane_id: &str) -> Result<(), AppError> {
			let mut state = self.state.lock().unwrap();
			state.methods.push("pane.close".into());
			state.pane_close_calls += 1;
			if let Some(err) = state.close_error.take() {
				if state.close_lands {
					remove_pane(&mut state.panes, pane_id);
				}
				return Err(err);
			}
			remove_pane(&mut state.panes, pane_id);
			Ok(())
		}

		fn session_snapshot(&self) -> Result<Value, AppError> {
			let mut state = self.state.lock().unwrap();
			state.methods.push("session.snapshot".into());
			let mut workspaces = Vec::new();
			let mut tabs = Vec::new();
			let mut panes = Vec::new();
			for (workspace_id, listed) in &state.panes {
				workspaces.push(json!({
					"workspace_id": workspace_id,
					"label": workspace_id
				}));
				for pane in listed {
					tabs.push(json!({
						"tab_id": pane.tab_id,
						"workspace_id": pane.workspace_id,
						"label": ""
					}));
					panes.push(json!({
						"pane_id": pane.pane_id,
						"tab_id": pane.tab_id,
						"workspace_id": pane.workspace_id,
						"terminal_id": "term_live",
						"revision": 1
					}));
				}
			}
			Ok(json!({
				"type": "session_snapshot",
				"snapshot": {
					"workspaces": workspaces,
					"tabs": tabs,
					"panes": panes
				}
			}))
		}
	}

	struct Fixture {
		db: DbPool,
		fake: Arc<FakeTerminals>,
		adapter: HerdrStubAdapter,
		sessions: PtySessionMap,
		read_threads: PtyReadThreads,
		cwd: tempfile::TempDir,
	}

	impl Fixture {
		fn new() -> Self {
			let cwd = tempfile::tempdir().unwrap();
			let folder = cwd.path().to_string_lossy().replace('\'', "");
			let db = setup_db();
			{
				let mut conn = db.lock().unwrap();
				diesel::sql_query(format!(
					"INSERT INTO projects (id, name, folder, created_at) VALUES ('p1', 'Test', '{folder}', datetime('now'))"
				))
				.execute(&mut *conn)
				.unwrap();
				diesel::sql_query(format!(
					"INSERT INTO profiles (id, project_id, branch_name, worktree_path, created_at, is_default) VALUES ('pr1', 'p1', 'main', '{folder}', datetime('now'), 1)"
				))
				.execute(&mut *conn)
				.unwrap();
				repo::runtime_mapping::bind_profile_workspace(
					&mut conn,
					"pr1",
					HERDR_NAMESPACE,
					"w1",
				)
				.unwrap();
			}
			let fake = Arc::new(FakeTerminals::with_root("w1"));
			let adapter = HerdrStubAdapter::with_terminal_client(
				db.clone(),
				fake.clone(),
			);
			let sessions = infra::pty::create_session_map();
			let read_threads = infra::pty::create_thread_tracker();
			Self {
				db,
				fake,
				adapter,
				sessions,
				read_threads,
				cwd,
			}
		}

		fn router(&self) -> RuntimeRouter {
			let logs = self.cwd.path().join("pty-logs");
			std::fs::create_dir_all(&logs).unwrap();
			RuntimeRouter::with_backend(
				RuntimeBackend::Herdr,
				LocalAdapter::new(PtyContext {
					db: self.db.clone(),
					sessions: self.sessions.clone(),
					flush_senders: create_flush_senders(),
					read_threads: self.read_threads.clone(),
					emitter: Arc::new(TestEmitter),
					output_dir: logs,
				}),
				HerdrStubAdapter::with_terminal_client(
					self.db.clone(),
					self.fake.clone(),
				),
			)
		}

		fn meta() -> PtySessionMeta {
			PtySessionMeta {
				profile_id: "pr1".to_string(),
				title: "shell".to_string(),
			}
		}

		fn config(&self) -> PtyConfig {
			PtyConfig {
				shell: "/bin/sh".into(),
				cwd: self.cwd.path().to_string_lossy().into_owned(),
				rows: 24,
				cols: 80,
				startup_commands: Vec::new(),
			}
		}

		fn mapping(&self, session_id: &str) -> String {
			let mut conn = self.db.lock().unwrap();
			repo::runtime_mapping::find_session_mapping(&mut conn, session_id)
				.unwrap()
				.pane_id
		}

		fn insert_session_row(&self, session_id: &str) {
			let mut conn = self.db.lock().unwrap();
			repo::pty::insert_session(
				&mut conn,
				&NewPtySessionRecord {
					id: session_id,
					profile_id: "pr1",
					title: "steal",
					shell: "/bin/sh",
					cwd: "/tmp",
					cols: 80,
					rows: 24,
				},
			)
			.unwrap();
		}

		fn bind_pane(&self, session_id: &str, pane_id: &str) {
			let mut conn = self.db.lock().unwrap();
			repo::runtime_mapping::bind_session_pane(
				&mut conn,
				session_id,
				HERDR_NAMESPACE,
				"w1",
				pane_id,
			)
			.unwrap();
		}

		fn profile_workspace_id(&self) -> Option<String> {
			let mut conn = self.db.lock().unwrap();
			repo::runtime_mapping::find_profile_mapping(&mut conn, "pr1")
				.ok()
				.map(|mapping| mapping.workspace_id)
		}
	}

	impl Drop for Fixture {
		fn drop(&mut self) {
			infra::pty::close_all_sessions(&self.sessions);
			infra::pty::join_all_read_threads(&self.read_threads);
		}
	}

	#[test]
	fn unbound_root_pane_is_workspace_p1_not_a_split() {
		let panes = vec![
			PaneView {
				pane_id: "w1:p1".into(),
				tab_id: "w1:t1".into(),
				workspace_id: "w1".into(),
			},
			PaneView {
				pane_id: "w1:p2".into(),
				tab_id: "w1:t1".into(),
				workspace_id: "w1".into(),
			},
		];
		let empty = HashSet::new();
		assert_eq!(
			unbound_adopted_root_pane("w1", &panes, &empty).as_deref(),
			Some("w1:p1")
		);
		let mut bound = HashSet::new();
		bound.insert("w1:p1".into());
		assert_eq!(unbound_adopted_root_pane("w1", &panes, &bound), None);
	}

	#[test]
	fn create_reuses_unbound_adopted_root_pane() {
		let fx = Fixture::new();
		let created = fx
			.adapter
			.create_session(&Fixture::meta(), &fx.config())
			.unwrap();
		assert_eq!(fx.mapping(&created.session_id), "w1:p1");
		assert_eq!(fx.fake.tab_create_calls(), 0);
		assert!(fx.fake.calls().contains(&"pane.list".to_string()));
		assert!(!fx.fake.calls().contains(&"tab.create".to_string()));
		assert_eq!(fx.sessions.lock().unwrap().len(), 0);
		assert_ne!(fx.mapping(&created.session_id), "term_live");
	}

	#[test]
	fn extra_terminals_use_tab_create_not_split() {
		let fx = Fixture::new();
		let first = fx
			.adapter
			.create_session(&Fixture::meta(), &fx.config())
			.unwrap();
		let second = fx
			.adapter
			.create_session(&Fixture::meta(), &fx.config())
			.unwrap();
		assert_eq!(fx.mapping(&first.session_id), "w1:p1");
		assert_eq!(fx.mapping(&second.session_id), "w1:p2");
		assert_eq!(fx.fake.tab_create_calls(), 1);
		assert!(!fx.fake.calls().iter().any(|m| m == "pane.split"));
		assert_eq!(fx.sessions.lock().unwrap().len(), 0);
	}

	#[test]
	fn close_maps_to_pane_close_and_list_drops_the_pane() {
		let fx = Fixture::new();
		let created = fx
			.adapter
			.create_session(&Fixture::meta(), &fx.config())
			.unwrap();
		fx.adapter.close_session(&created.session_id).unwrap();
		assert_eq!(fx.fake.pane_close_calls(), 1);
		assert!(fx.fake.calls().iter().any(|m| m == "pane.close"));
		let listed = fx.adapter.list_project_sessions("p1").unwrap();
		assert!(listed
			.iter()
			.all(|session| session.id != created.session_id));
		let mut conn = fx.db.lock().unwrap();
		assert!(repo::runtime_mapping::find_session_mapping(
			&mut conn,
			&created.session_id
		)
		.is_err());
	}

	#[test]
	fn uncertain_tab_create_reconciles_without_replay() {
		let fx = Fixture::new();
		fx.adapter
			.create_session(&Fixture::meta(), &fx.config())
			.unwrap();
		{
			let mut state = fx.fake.state.lock().unwrap();
			state.create_error = Some(AppError::HerdrUncertainOutcome(
				"tab.create dropped".into(),
			));
			state.create_lands = true;
		}
		let extra = fx
			.adapter
			.create_session(&Fixture::meta(), &fx.config())
			.unwrap();
		assert_eq!(fx.mapping(&extra.session_id), "w1:p2");
		assert_eq!(fx.fake.tab_create_calls(), 1);
		assert!(fx.fake.calls().contains(&"pane.list".to_string()));
	}

	#[test]
	fn uncertain_tab_create_without_a_new_pane_is_not_replayed() {
		let fx = Fixture::new();
		fx.adapter
			.create_session(&Fixture::meta(), &fx.config())
			.unwrap();
		{
			let mut state = fx.fake.state.lock().unwrap();
			state.create_error = Some(AppError::HerdrUncertainOutcome(
				"tab.create dropped".into(),
			));
			state.create_lands = false;
		}
		let err = fx
			.adapter
			.create_session(&Fixture::meta(), &fx.config())
			.unwrap_err();
		assert!(err.to_string().contains("uncertain"));
		assert_eq!(fx.fake.tab_create_calls(), 1);
	}

	#[test]
	fn uncertain_pane_close_reconciles_via_get_list_snapshot() {
		let fx = Fixture::new();
		let created = fx
			.adapter
			.create_session(&Fixture::meta(), &fx.config())
			.unwrap();
		{
			let mut state = fx.fake.state.lock().unwrap();
			state.close_error = Some(AppError::HerdrUncertainOutcome(
				"pane.close dropped".into(),
			));
			state.close_lands = true;
		}
		fx.adapter.close_session(&created.session_id).unwrap();
		assert_eq!(fx.fake.pane_close_calls(), 1);
		assert!(fx.fake.calls().contains(&"pane.get".to_string()));
	}

	#[test]
	fn uncertain_pane_close_still_present_is_not_replayed() {
		let fx = Fixture::new();
		let created = fx
			.adapter
			.create_session(&Fixture::meta(), &fx.config())
			.unwrap();
		{
			let mut state = fx.fake.state.lock().unwrap();
			state.close_error = Some(AppError::HerdrUncertainOutcome(
				"pane.close dropped".into(),
			));
			state.close_lands = false;
		}
		let err = fx.adapter.close_session(&created.session_id).unwrap_err();
		assert!(err.to_string().contains("uncertain"));
		assert_eq!(fx.fake.pane_close_calls(), 1);
		let mut conn = fx.db.lock().unwrap();
		assert!(repo::runtime_mapping::find_session_mapping(
			&mut conn,
			&created.session_id
		)
		.is_ok());
	}

	#[test]
	fn write_resize_history_restore_stay_fail_closed() {
		let fx = Fixture::new();
		let created = fx
			.adapter
			.create_session(&Fixture::meta(), &fx.config())
			.unwrap();
		assert!(fx.adapter.write(&created.session_id, b"x").is_err());
		assert!(fx.adapter.resize(&created.session_id, 24, 80).is_err());
		assert!(fx.adapter.history(&created.session_id).is_err());
		assert!(fx
			.adapter
			.restore_session(
				&created.session_id,
				&Fixture::meta(),
				&fx.config()
			)
			.is_err());
		assert!(!fx.fake.calls().iter().any(|m| m.contains("send")));
		assert_eq!(fx.sessions.lock().unwrap().len(), 0);
	}

	#[test]
	fn router_herdr_create_does_not_spawn_local_pty() {
		let fx = Fixture::new();
		let router = fx.router();
		let created = router
			.create_session(&Fixture::meta(), &fx.config())
			.unwrap();
		assert_eq!(
			router.owner(&created.session_id).unwrap(),
			Some(RuntimeBackend::Herdr)
		);
		assert_eq!(fx.sessions.lock().unwrap().len(), 0);
		assert!(router.write(&created.session_id, b"x").is_err());
		assert_eq!(fx.sessions.lock().unwrap().len(), 0);
	}

	#[test]
	fn production_create_close_do_not_use_forbidden_ops() {
		let src = include_str!("herdr.rs")
			.split("#[cfg(test)]")
			.next()
			.unwrap();
		assert!(src.contains("tab.create") || src.contains("tab_create"));
		assert!(src.contains("pane.close") || src.contains("pane_close"));
		assert!(src.contains("pane.list") || src.contains("pane_list"));
		assert!(src.contains("pane.get") || src.contains("pane_get"));
		assert!(!src.contains("worktree.create"));
		assert!(!src.contains("worktree.open"));
		assert!(!src.contains("worktree.remove"));
		assert!(!src.contains("workspace.create"));
		assert!(!src.contains("pane.split"));
		assert!(!src.contains("server.stop"));
		assert!(!src.contains("herdr-client.sock"));
		assert!(!src.contains("terminal session"));
	}

	#[test]
	fn gui_detach_is_not_pane_close() {
		let pty = include_str!("../../../../src/handler/pty.rs");
		let detach = pty
			.split("pub fn detach_pty_output")
			.nth(1)
			.unwrap()
			.split("pub fn flush_pty_output")
			.next()
			.unwrap();
		assert!(!detach.contains("close_session"));
		assert!(!detach.contains("pane.close"));
		let close = pty
			.split("pub fn close_pty_session")
			.nth(1)
			.unwrap()
			.split("pub async fn list_project_sessions")
			.next()
			.unwrap();
		assert!(close.contains("close_session"));
	}

	#[test]
	fn missing_workspace_mapping_fails_closed_without_tab_create() {
		let fx = Fixture::new();
		{
			let mut conn = fx.db.lock().unwrap();
			repo::runtime_mapping::unbind_profile_workspace(&mut conn, "pr1")
				.unwrap();
		}
		let err = fx
			.adapter
			.create_session(&Fixture::meta(), &fx.config())
			.unwrap_err();
		assert!(err.to_string().contains("missing"));
		assert_eq!(fx.fake.tab_create_calls(), 0);
		assert_eq!(fx.sessions.lock().unwrap().len(), 0);
	}

	#[test]
	fn missing_projected_workspace_fails_closed() {
		let fx = Fixture::new();
		{
			let mut conn = fx.db.lock().unwrap();
			repo::runtime_mapping::unbind_profile_workspace(&mut conn, "pr1")
				.unwrap();
			repo::runtime_mapping::bind_profile_workspace(
				&mut conn,
				"pr1",
				HERDR_NAMESPACE,
				"w-gone",
			)
			.unwrap();
		}
		let err = fx
			.adapter
			.create_session(&Fixture::meta(), &fx.config())
			.unwrap_err();
		assert!(err.to_string().contains("missing"));
		assert_eq!(fx.fake.tab_create_calls(), 0);
		assert_eq!(fx.sessions.lock().unwrap().len(), 0);
	}

	#[test]
	fn already_style_duplicate_create_is_not_a_second_pane() {
		let fx = Fixture::new();
		let first = fx
			.adapter
			.create_session(&Fixture::meta(), &fx.config())
			.unwrap();
		{
			let mut state = fx.fake.state.lock().unwrap();
			state.already_open_create = true;
		}
		let err = fx
			.adapter
			.create_session(&Fixture::meta(), &fx.config())
			.unwrap_err();
		assert!(err.to_string().contains("already bound"));
		assert_eq!(fx.fake.tab_create_calls(), 1);
		assert_eq!(fx.fake.pane_close_calls(), 0);
		assert_eq!(fx.mapping(&first.session_id), "w1:p1");
		assert_eq!(fx.fake.state.lock().unwrap().panes["w1"].len(), 1);
	}

	#[test]
	fn bind_failure_after_tab_create_closes_the_new_pane() {
		let fx = Fixture::new();
		fx.insert_session_row("sess-steal");
		fx.bind_pane("sess-steal", "w1:p2");
		let first = fx
			.adapter
			.create_session(&Fixture::meta(), &fx.config())
			.unwrap();
		let err = fx
			.adapter
			.create_session(&Fixture::meta(), &fx.config())
			.unwrap_err();
		assert!(err.to_string().contains("already bound"));
		assert_eq!(fx.fake.tab_create_calls(), 1);
		assert_eq!(fx.fake.pane_close_calls(), 1);
		assert_eq!(fx.mapping(&first.session_id), "w1:p1");
		let panes = fx.fake.state.lock().unwrap().panes["w1"].clone();
		assert!(panes.iter().all(|pane| pane.pane_id != "w1:p2"));
		assert!(panes.iter().any(|pane| pane.pane_id == "w1:p1"));
	}

	#[test]
	fn bind_failure_after_root_reuse_does_not_close_the_pane() {
		let fx = Fixture::new();
		fx.insert_session_row("sess-steal");
		let db = fx.db.clone();
		{
			let mut state = fx.fake.state.lock().unwrap();
			state.on_list = Some(Arc::new(move || {
				let mut conn = db.lock().unwrap();
				let _ = repo::runtime_mapping::bind_session_pane(
					&mut conn,
					"sess-steal",
					HERDR_NAMESPACE,
					"w1",
					"w1:p1",
				);
			}));
		}
		let err = fx
			.adapter
			.create_session(&Fixture::meta(), &fx.config())
			.unwrap_err();
		assert!(err.to_string().contains("already bound"));
		assert_eq!(fx.fake.tab_create_calls(), 0);
		assert_eq!(fx.fake.pane_close_calls(), 0);
		let panes = fx.fake.state.lock().unwrap().panes["w1"].clone();
		assert!(panes.iter().any(|pane| pane.pane_id == "w1:p1"));
	}

	#[test]
	fn last_pane_close_unbinds_vanished_workspace_and_keeps_checkout() {
		let fx = Fixture::new();
		std::fs::write(fx.cwd.path().join("keep"), b"checkout").unwrap();
		let first = fx
			.adapter
			.create_session(&Fixture::meta(), &fx.config())
			.unwrap();
		let second = fx
			.adapter
			.create_session(&Fixture::meta(), &fx.config())
			.unwrap();
		fx.adapter.close_session(&second.session_id).unwrap();
		assert_eq!(fx.profile_workspace_id().as_deref(), Some("w1"));
		assert!(fx.cwd.path().join("keep").exists());
		fx.adapter.close_session(&first.session_id).unwrap();
		assert!(fx.profile_workspace_id().is_none());
		assert!(fx.cwd.path().join("keep").exists());
		assert!(!fx.fake.calls().iter().any(|m| m.contains("worktree")));
		assert_eq!(fx.sessions.lock().unwrap().len(), 0);
	}

	#[test]
	fn list_omits_sessions_without_pane_mappings() {
		let fx = Fixture::new();
		let created = fx
			.adapter
			.create_session(&Fixture::meta(), &fx.config())
			.unwrap();
		fx.insert_session_row("local-only");
		let listed = fx.adapter.list_project_sessions("p1").unwrap();
		assert!(listed
			.iter()
			.any(|session| session.id == created.session_id));
		assert!(listed.iter().all(|session| session.id != "local-only"));
	}

	#[test]
	fn router_close_unbinds_herdr_owner() {
		let fx = Fixture::new();
		let router = fx.router();
		let created = router
			.create_session(&Fixture::meta(), &fx.config())
			.unwrap();
		assert_eq!(
			router.owner(&created.session_id).unwrap(),
			Some(RuntimeBackend::Herdr)
		);
		router.close_session(&created.session_id).unwrap();
		assert_eq!(router.owner(&created.session_id).unwrap(), None);
		assert_eq!(fx.sessions.lock().unwrap().len(), 0);
	}

	#[test]
	fn stub_without_client_stays_fail_closed() {
		let stub = HerdrStubAdapter::new();
		let selector = RuntimeSelector::default();
		assert_eq!(selector.default_backend(), RuntimeBackend::Local);
		let client = HerdrClient::connect_path(std::path::Path::new(
			"/tmp/2code-ok.sock",
		))
		.unwrap();
		let _ = HerdrJsonTerminals::new(client);
		assert!(stub
			.create_session(
				&PtySessionMeta {
					profile_id: "pr1".into(),
					title: "x".into(),
				},
				&PtyConfig {
					shell: "/bin/sh".into(),
					cwd: "/tmp".into(),
					rows: 24,
					cols: 80,
					startup_commands: Vec::new(),
				}
			)
			.is_err());
	}
}
