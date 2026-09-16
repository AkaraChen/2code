//! Herdr terminal lifecycle and live CLI attach.
//!
//! Create/list/close use pane identities when a client is injected.
//! Create binds `cwd` on `tab.create` and may inject `init_script` plus
//! `startup_commands` once via `pane.send_input`. List/restore/close never
//! replay that input. Write/resize go through an attached CLI control
//! helper.
//! Restore stays fail-closed: reopen lists Bound panes from the
//! namespace snapshot and attaches them. History/flush/clear stay
//! fail-closed. A missing
//! client keeps the Task 2 stub behavior. Identities are `pane_id` in
//! namespace `2code`. `terminal_id` is never persisted.

use std::collections::{HashMap, HashSet};
use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use infra::db::DbPool;
use infra::herdr::process::{HerdrNamespace, HerdrProcessEnv};
use infra::herdr::terminal::{
	BufferLimits, TerminalAttachRequest, TerminalSessionHelper,
};
use infra::herdr::transport::{
	HerdrClient, PaneView, TabCreateResult, WorktreeCreateRequest,
	WorktreeCreateResult, WorktreeListEntry, WorktreeOpenResult,
	WorktreeRemoveResult,
};
use model::error::AppError;
use model::pty::{
	NewPtySessionRecord, PtyConfig, PtySessionMeta, PtySessionRecord,
	RestoreResult,
};
use model::runtime::{
	CreateSessionResult, HerdrTerminalFrame, RuntimeBackend,
	RuntimeIdentityState, SessionAgentStatus, HERDR_NAMESPACE,
};
use serde_json::Value;
use uuid::Uuid;

use crate::runtime_agent::mapped_agent_for_session;
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
		cwd: &Path,
	) -> Result<TabCreateResult, AppError>;

	fn pane_list(&self, workspace_id: &str) -> Result<Vec<PaneView>, AppError>;

	fn pane_get(&self, pane_id: &str) -> Result<Option<PaneView>, AppError>;

	fn pane_close(&self, pane_id: &str) -> Result<(), AppError>;

	fn pane_send_input(
		&self,
		pane_id: &str,
		text: &str,
	) -> Result<(), AppError>;

	fn session_snapshot(&self) -> Result<Value, AppError>;
}

/// JSON worktree create/list/open/remove used by Herdr profile lifecycle.
/// Implementors must not auto-replay `worktree.create` or `worktree.remove`.
pub trait HerdrWorktreeClient: Send + Sync {
	fn worktree_create(
		&self,
		request: WorktreeCreateRequest<'_>,
	) -> Result<WorktreeCreateResult, AppError>;

	fn worktree_list(
		&self,
		cwd: Option<&Path>,
		workspace_id: Option<&str>,
	) -> Result<Vec<WorktreeListEntry>, AppError>;

	fn worktree_open(
		&self,
		cwd: &Path,
		path: &Path,
	) -> Result<WorktreeOpenResult, AppError>;

	fn worktree_remove(
		&self,
		workspace_id: &str,
		force: bool,
	) -> Result<WorktreeRemoveResult, AppError>;

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
		cwd: &Path,
	) -> Result<TabCreateResult, AppError> {
		self.client
			.tab_create(workspace_id, label, cwd)
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

	fn pane_send_input(
		&self,
		pane_id: &str,
		text: &str,
	) -> Result<(), AppError> {
		self.client
			.pane_send_input(pane_id, text)
			.map_err(AppError::from)
	}

	fn session_snapshot(&self) -> Result<Value, AppError> {
		self.client
			.session_snapshot()
			.map(|success| success.result)
			.map_err(AppError::from)
	}
}

impl HerdrWorktreeClient for HerdrJsonTerminals {
	fn worktree_create(
		&self,
		request: WorktreeCreateRequest<'_>,
	) -> Result<WorktreeCreateResult, AppError> {
		self.client.worktree_create(request).map_err(AppError::from)
	}

	fn worktree_list(
		&self,
		cwd: Option<&Path>,
		workspace_id: Option<&str>,
	) -> Result<Vec<WorktreeListEntry>, AppError> {
		self.client
			.worktree_list(cwd, workspace_id)
			.map_err(AppError::from)
	}

	fn worktree_open(
		&self,
		cwd: &Path,
		path: &Path,
	) -> Result<WorktreeOpenResult, AppError> {
		self.client.worktree_open(cwd, path).map_err(AppError::from)
	}

	fn worktree_remove(
		&self,
		workspace_id: &str,
		force: bool,
	) -> Result<WorktreeRemoveResult, AppError> {
		self.client
			.worktree_remove(workspace_id, force)
			.map_err(AppError::from)
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

/// Sidecar + 2code namespace used to spawn one CLI helper per session.
pub struct HerdrCliAttach {
	pub executable: PathBuf,
	pub namespace: HerdrNamespace,
	pub extra_env: Vec<(OsString, OsString)>,
}

struct HerdrAttachment {
	stream_id: String,
	helper: Arc<TerminalSessionHelper>,
}

#[derive(Clone, Debug)]
enum HerdrStartupFailure {
	Absent(String),
	Incompatible(String),
	Other(String),
}

impl HerdrStartupFailure {
	fn from_app(err: &AppError) -> Self {
		match err {
			AppError::HerdrServerAbsent(message) => {
				Self::Absent(message.clone())
			}
			AppError::HerdrServerIncompatible(message) => {
				Self::Incompatible(message.clone())
			}
			other => Self::Other(other.to_string()),
		}
	}

	fn to_app(&self) -> AppError {
		match self {
			Self::Absent(message) => {
				AppError::HerdrServerAbsent(message.clone())
			}
			Self::Incompatible(message) => {
				AppError::HerdrServerIncompatible(message.clone())
			}
			Self::Other(message) => AppError::PtyError(message.clone()),
		}
	}
}

/// Herdr adapter. Without a client, lifecycle stays fail-closed.
#[derive(Default)]
pub struct HerdrStubAdapter {
	ops: Mutex<Vec<&'static str>>,
	lifecycle: Option<HerdrLifecycle>,
	worktrees: Option<Arc<dyn HerdrWorktreeClient>>,
	cli: Option<HerdrCliAttach>,
	attachments: Mutex<HashMap<String, HerdrAttachment>>,
	startup_error: Option<HerdrStartupFailure>,
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
			worktrees: None,
			cli: None,
			attachments: Mutex::new(HashMap::new()),
			startup_error: None,
		}
	}

	pub fn with_terminal_client_and_cli(
		db: DbPool,
		client: Arc<dyn HerdrTerminalClient>,
		cli: HerdrCliAttach,
	) -> Self {
		Self {
			ops: Mutex::new(Vec::new()),
			lifecycle: Some(HerdrLifecycle { db, client }),
			worktrees: None,
			cli: Some(cli),
			attachments: Mutex::new(HashMap::new()),
			startup_error: None,
		}
	}

	pub fn with_worktree_client(client: Arc<dyn HerdrWorktreeClient>) -> Self {
		Self {
			ops: Mutex::new(Vec::new()),
			lifecycle: None,
			worktrees: Some(client),
			cli: None,
			attachments: Mutex::new(HashMap::new()),
			startup_error: None,
		}
	}

	pub fn with_json_clients(
		db: DbPool,
		json: Arc<HerdrJsonTerminals>,
		cli: HerdrCliAttach,
	) -> Self {
		Self {
			ops: Mutex::new(Vec::new()),
			lifecycle: Some(HerdrLifecycle {
				db,
				client: json.clone(),
			}),
			worktrees: Some(json),
			cli: Some(cli),
			attachments: Mutex::new(HashMap::new()),
			startup_error: None,
		}
	}

	/// Keep Herdr selected. Ops return the startup error instead of Local.
	pub fn fail_closed(error: AppError) -> Self {
		Self {
			startup_error: Some(HerdrStartupFailure::from_app(&error)),
			..Self::default()
		}
	}

	fn unavailable(&self) -> AppError {
		self.startup_error
			.as_ref()
			.map(HerdrStartupFailure::to_app)
			.unwrap_or_else(|| AppError::PtyError(UNAVAILABLE.to_string()))
	}

	fn fail(&self, op: &'static str) -> AppError {
		self.record(op);
		self.unavailable()
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

	pub(crate) fn has_terminal_client(&self) -> bool {
		self.lifecycle.is_some()
	}

	pub(crate) fn worktrees(
		&self,
	) -> Result<&dyn HerdrWorktreeClient, AppError> {
		self.worktrees.as_deref().ok_or_else(|| self.unavailable())
	}

	fn lifecycle(&self) -> Result<&HerdrLifecycle, AppError> {
		self.lifecycle.as_ref().ok_or_else(|| self.unavailable())
	}

	fn resolve_pane_id(&self, session_id: &str) -> Result<String, AppError> {
		let lifecycle = self.lifecycle()?;
		let mapping = lifecycle.with_db(|conn| {
			match repo::runtime_mapping::find_session_mapping(conn, session_id)
			{
				Ok(mapping) => Ok(mapping),
				Err(AppError::NotFound(_)) => {
					Err(AppError::RuntimeMappingMissing(format!(
						"session {session_id} has no Herdr pane"
					)))
				}
				Err(err) => Err(err),
			}
		})?;
		let snapshot = lifecycle.client.session_snapshot()?;
		let mut projection = RuntimeProjection::new();
		projection.apply_snapshot(&snapshot)?;
		match pane_identity_state(&mapping, &projection) {
			RuntimeIdentityState::Bound => Ok(mapping.pane_id),
			RuntimeIdentityState::Missing => {
				Err(AppError::RuntimeMappingMissing(format!(
					"pane {} is missing",
					mapping.pane_id
				)))
			}
			RuntimeIdentityState::Replaced => {
				Err(AppError::RuntimeMappingReplaced(format!(
					"pane {}",
					mapping.pane_id
				)))
			}
		}
	}

	fn take_attachment(&self, session_id: &str) -> Option<HerdrAttachment> {
		self.attachments
			.lock()
			.ok()
			.and_then(|mut map| map.remove(session_id))
	}

	pub fn release_session(&self, session_id: &str) {
		drop(self.take_attachment(session_id));
	}

	pub fn attach_output(
		&self,
		session_id: &str,
		stream_id: &str,
	) -> Result<(), AppError> {
		self.record("attach");
		let pane_id = self.resolve_pane_id(session_id)?;
		let cli = self.cli.as_ref().ok_or_else(|| self.unavailable())?;
		if let Some(previous) = self.take_attachment(session_id) {
			drop(previous);
		}
		let env = HerdrProcessEnv {
			executable: &cli.executable,
			namespace: &cli.namespace,
			extra_env: &cli.extra_env,
			ready_timeout: std::time::Duration::from_secs(10),
			cli_timeout: std::time::Duration::from_secs(5),
		};
		let helper =
			TerminalSessionHelper::attach_control(TerminalAttachRequest {
				env: &env,
				pane_id: &pane_id,
				mode: infra::herdr::terminal::TerminalSessionMode::Control,
				cols: None,
				rows: None,
				takeover: false,
				limits: BufferLimits::default(),
			})?;
		let mut map =
			self.attachments.lock().map_err(|_| AppError::LockError)?;
		if let Some(replaced) = map.insert(
			session_id.to_string(),
			HerdrAttachment {
				stream_id: stream_id.to_string(),
				helper: Arc::new(helper),
			},
		) {
			drop(replaced);
		}
		Ok(())
	}

	pub fn detach_output(
		&self,
		session_id: &str,
		stream_id: &str,
	) -> Result<(), AppError> {
		self.record("detach");
		let mut map =
			self.attachments.lock().map_err(|_| AppError::LockError)?;
		let matches = map
			.get(session_id)
			.is_some_and(|attached| attached.stream_id == stream_id);
		if matches {
			drop(map.remove(session_id));
		}
		Ok(())
	}

	pub fn recv_terminal_frame(
		&self,
		session_id: &str,
		stream_id: &str,
	) -> Result<HerdrTerminalFrame, AppError> {
		let helper = {
			let map =
				self.attachments.lock().map_err(|_| AppError::LockError)?;
			let attached = map.get(session_id).ok_or_else(|| {
				AppError::from(
					infra::herdr::terminal::HerdrTerminalError::NotAttached,
				)
			})?;
			if attached.stream_id != stream_id {
				return Err(AppError::PtyError(
					"stale Herdr attach stream_id".into(),
				));
			}
			Arc::clone(&attached.helper)
		};
		helper
			.recv_frame_blocking()
			.map(HerdrTerminalFrame::from)
			.map_err(AppError::from)
	}

	pub fn release_attachments(&self) {
		if let Ok(mut map) = self.attachments.lock() {
			map.clear();
		}
	}

	/// Current projected agent state for a mapped Herdr session.
	/// Missing/replaced panes fail closed (`None`).
	pub fn session_agent_status(
		&self,
		session_id: &str,
	) -> Result<Option<SessionAgentStatus>, AppError> {
		self.record("agent_status");
		let lifecycle = match self.lifecycle() {
			Ok(lifecycle) => lifecycle,
			Err(_) => return Ok(None),
		};
		let snapshot = lifecycle.client.session_snapshot()?;
		let mut projection = RuntimeProjection::new();
		projection.apply_snapshot(&snapshot)?;
		lifecycle.with_db(|conn| {
			mapped_agent_for_session(conn, &projection, session_id)
		})
	}

	fn helper_for(
		&self,
		session_id: &str,
	) -> Result<Arc<TerminalSessionHelper>, AppError> {
		let map = self.attachments.lock().map_err(|_| AppError::LockError)?;
		map.get(session_id)
			.map(|attached| Arc::clone(&attached.helper))
			.ok_or_else(|| {
				AppError::from(
					infra::herdr::terminal::HerdrTerminalError::NotAttached,
				)
			})
	}
}

/// Adopted workspace root is `{workspace_id}:p1`. Splits are not reused
/// for extra 2code terminals; those use `tab.create`. Template
/// subdirectory cwds also skip this reuse so Herdr starts in that path.
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

fn require_absolute_cwd(cwd: &str) -> Result<(), AppError> {
	if cwd.is_empty() || !Path::new(cwd).is_absolute() {
		return Err(AppError::PtyError("cwd must be an absolute path".into()));
	}
	Ok(())
}

fn same_checkout_path(left: &Path, right: &Path) -> bool {
	if left == right {
		return true;
	}
	match (left.canonicalize(), right.canonicalize()) {
		(Ok(a), Ok(b)) => a == b,
		_ => false,
	}
}

fn startup_input_text(
	init_script: &[String],
	startup_commands: &[String],
) -> Option<String> {
	let commands: Vec<&str> = init_script
		.iter()
		.chain(startup_commands.iter())
		.map(String::as_str)
		.filter(|command| !command.is_empty())
		.collect();
	if commands.is_empty() {
		return None;
	}
	let mut text = commands.join("\n");
	text.push('\n');
	Some(text)
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
				Ok(mapping) => Ok(Some(mapping)),
				Err(AppError::NotFound(_)) => {
					match repo::runtime_mapping::find_profile_by_workspace(
						conn,
						HERDR_NAMESPACE,
						profile_id,
					) {
						Ok(mapping) => Ok(Some(mapping)),
						Err(AppError::NotFound(_)) => Ok(None),
						Err(err) => Err(err),
					}
				}
				Err(err) => Err(err),
			}
		})?;
		let snapshot = self.client.session_snapshot()?;
		let mut projection = RuntimeProjection::new();
		projection.apply_snapshot(&snapshot)?;
		if let Some(mapping) = mapping {
			return match workspace_identity_state(&mapping, &projection) {
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
			};
		}
		if projection.workspace(profile_id).is_some() {
			return Ok(profile_id.to_string());
		}
		Err(AppError::RuntimeMappingMissing(format!(
			"profile {profile_id} has no Herdr workspace"
		)))
	}

	fn profile_checkout(&self, profile_id: &str) -> Result<String, AppError> {
		if let Ok(path) = self.live_checkout(profile_id) {
			if !path.is_empty() {
				return Ok(path);
			}
		}
		match self.with_db(|conn| {
			if let Ok(profile) = repo::profile::find_by_id(conn, profile_id) {
				return Ok(profile.worktree_path);
			}
			match repo::runtime_mapping::find_profile_by_workspace(
				conn,
				HERDR_NAMESPACE,
				profile_id,
			) {
				Ok(mapping) => {
					Ok(repo::profile::find_by_id(conn, &mapping.profile_id)?
						.worktree_path)
				}
				Err(AppError::NotFound(_)) => {
					Err(AppError::NotFound(format!("Profile: {profile_id}")))
				}
				Err(err) => Err(err),
			}
		}) {
			Ok(path) => Ok(path),
			Err(AppError::NotFound(_)) => Ok(String::new()),
			Err(err) => Err(err),
		}
	}

	fn live_checkout(&self, profile_id: &str) -> Result<String, AppError> {
		let workspace_id = self.bound_workspace(profile_id)?;
		let snapshot = self.client.session_snapshot()?;
		let snap = if snapshot.get("type").and_then(Value::as_str)
			== Some("session_snapshot")
		{
			snapshot.get("snapshot").unwrap_or(&snapshot)
		} else {
			&snapshot
		};
		let panes = snap
			.get("panes")
			.and_then(Value::as_array)
			.map(Vec::as_slice)
			.unwrap_or(&[]);
		Ok(panes
			.iter()
			.find_map(|pane| {
				if pane.get("workspace_id").and_then(Value::as_str)
					== Some(workspace_id.as_str())
				{
					pane.get("cwd")
						.and_then(Value::as_str)
						.filter(|cwd| !cwd.is_empty())
						.or_else(|| {
							pane.get("foreground_cwd")
								.and_then(Value::as_str)
								.filter(|cwd| !cwd.is_empty())
						})
						.map(str::to_string)
				} else {
					None
				}
			})
			.unwrap_or_default())
	}

	fn project_init_script(&self, profile_id: &str) -> Vec<String> {
		let folder = self
			.profile_checkout(profile_id)
			.ok()
			.filter(|path| !path.is_empty());
		let Some(folder) = folder else {
			return Vec::new();
		};
		infra::config::load_project_config(&folder)
			.map(|config| config.init_script)
			.unwrap_or_default()
	}

	fn send_create_startup(
		&self,
		meta: &PtySessionMeta,
		config: &PtyConfig,
		pane_id: &str,
	) {
		let init_script = self.project_init_script(&meta.profile_id);
		let Some(text) =
			startup_input_text(&init_script, &config.startup_commands)
		else {
			return;
		};
		if let Err(err) = self.client.pane_send_input(pane_id, &text) {
			tracing::warn!(
				target: "herdr",
				pane_id,
				"failed to inject startup commands: {err}"
			);
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
		let sqlite_profile_id = self.sqlite_profile_id_for_session(
			&meta.profile_id,
			workspace_id,
			&config.cwd,
		)?;
		self.with_db(|conn| {
			repo::pty::insert_session(
				conn,
				&NewPtySessionRecord {
					id: &session_id,
					profile_id: &sqlite_profile_id,
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

	fn sqlite_profile_id_for_session(
		&self,
		profile_id: &str,
		workspace_id: &str,
		cwd: &str,
	) -> Result<String, AppError> {
		self.with_db(|conn| {
			if let Ok(mapping) =
				repo::runtime_mapping::find_profile_by_workspace(
					conn,
					HERDR_NAMESPACE,
					workspace_id,
				) {
				return Ok(mapping.profile_id);
			}
			if repo::profile::find_by_id(conn, profile_id).is_ok() {
				return Ok(profile_id.to_string());
			}
			for project in repo::project::list_all(conn)? {
				let same = project.folder == cwd
					|| Path::new(&project.folder)
						.canonicalize()
						.ok()
						.zip(Path::new(cwd).canonicalize().ok())
						.is_some_and(|(left, right)| left == right);
				if !same {
					continue;
				}
				if let Some(profile) =
					repo::profile::list_by_project(conn, &project.id)?
						.into_iter()
						.find(|profile| profile.is_default)
				{
					return Ok(profile.id);
				}
			}
			Err(AppError::NotFound(format!(
				"Profile for workspace {workspace_id}"
			)))
		})
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
			Ok(created) => {
				self.send_create_startup(meta, config, pane_id);
				Ok(created)
			}
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
		require_absolute_cwd(&config.cwd)?;
		let workspace_id = self.bound_workspace(&meta.profile_id)?;
		let bound = self.bound_pane_ids(&workspace_id)?;
		let listed = self.client.pane_list(&workspace_id)?;
		let checkout = self.profile_checkout(&meta.profile_id)?;
		if same_checkout_path(Path::new(&config.cwd), Path::new(&checkout)) {
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
		}
		let pane_id = match self.client.tab_create(
			&workspace_id,
			&meta.title,
			Path::new(&config.cwd),
		) {
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
		let snapshot = self.client.session_snapshot()?;
		let mut projection = RuntimeProjection::new();
		projection.apply_snapshot(&snapshot)?;
		let catalog = self.with_db(|conn| {
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
			let profiles = repo::profile::list_by_project(conn, project_id)?;
			let mut workspaces = Vec::new();
			for profile in profiles {
				if let Ok(mapping) = repo::runtime_mapping::find_profile_mapping(
					conn,
					&profile.id,
				) {
					workspaces.push((profile, mapping));
				}
			}
			Ok((mapped, workspaces))
		})?;
		let (mapped_sessions, profile_workspaces) = catalog;
		let mut listed = Vec::new();
		let mut bound_panes = HashSet::new();
		let mut workspace_ids = HashSet::new();
		for (mut session, mapping) in mapped_sessions {
			if pane_identity_state(&mapping, &projection)
				== RuntimeIdentityState::Bound
			{
				bound_panes.insert(mapping.pane_id);
				workspace_ids.insert(mapping.workspace_id.clone());
				session.profile_id = mapping.workspace_id;
				listed.push(session);
			}
		}
		for (_profile, mapping) in profile_workspaces {
			if workspace_identity_state(&mapping, &projection)
				== RuntimeIdentityState::Bound
			{
				workspace_ids.insert(mapping.workspace_id);
			}
		}
		for workspace_id in workspace_ids {
			if projection.workspace(&workspace_id).is_none() {
				continue;
			}
			let checkout =
				self.profile_checkout(&workspace_id).unwrap_or_default();
			for pane in projection.panes_in_workspace(&workspace_id) {
				if !bound_panes.insert(pane.pane_id.clone()) {
					continue;
				}
				let title = projection
					.tab(&pane.tab_id)
					.map(|tab| tab.label.as_str())
					.filter(|label| !label.is_empty())
					.unwrap_or(&pane.pane_id)
					.to_string();
				let created = self.persist_session(
					&PtySessionMeta {
						profile_id: workspace_id.clone(),
						title,
					},
					&PtyConfig {
						shell: "/bin/sh".into(),
						cwd: checkout.clone(),
						rows: 24,
						cols: 80,
						startup_commands: Vec::new(),
					},
					&workspace_id,
					&pane.pane_id,
				)?;
				let mut record = self.with_db(|conn| {
					repo::pty::find_by_id(conn, &created.session_id)
				})?;
				record.profile_id = workspace_id.clone();
				listed.push(record);
			}
		}
		Ok(listed)
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
		drop(self.take_attachment(session_id));
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

	fn write(&self, session_id: &str, data: &[u8]) -> Result<(), AppError> {
		self.record("write");
		if self.cli.is_none() {
			return Err(self.unavailable());
		}
		self.helper_for(session_id)?
			.write_input(data)
			.map_err(AppError::from)
	}

	fn resize(
		&self,
		session_id: &str,
		rows: u16,
		cols: u16,
	) -> Result<(), AppError> {
		self.record("resize");
		if self.cli.is_none() {
			return Err(self.unavailable());
		}
		self.helper_for(session_id)?
			.resize(cols, rows)
			.map_err(AppError::from)
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

	fn scroll(
		&self,
		session_id: &str,
		direction: model::runtime::TerminalScrollDirection,
		lines: u16,
		source: model::runtime::TerminalScrollSource,
	) -> Result<(), AppError> {
		self.record("scroll");
		if self.cli.is_none() {
			return Err(self.unavailable());
		}
		self.helper_for(session_id)?
			.scroll(direction, lines, source)
			.map_err(AppError::from)
	}

	fn attach_output(
		&self,
		session_id: &str,
		stream_id: &str,
	) -> Result<(), AppError> {
		HerdrStubAdapter::attach_output(self, session_id, stream_id)
	}

	fn detach_output(
		&self,
		session_id: &str,
		stream_id: &str,
	) -> Result<(), AppError> {
		HerdrStubAdapter::detach_output(self, session_id, stream_id)
	}

	fn recv_terminal_frame(
		&self,
		session_id: &str,
		stream_id: &str,
	) -> Result<HerdrTerminalFrame, AppError> {
		HerdrStubAdapter::recv_terminal_frame(self, session_id, stream_id)
	}

	fn release_attachments(&self) {
		HerdrStubAdapter::release_attachments(self);
	}
}

#[cfg(test)]
mod tests {
	use std::collections::HashMap;
	use std::ffi::OsString;
	use std::path::PathBuf;
	use std::sync::{Arc, Mutex};

	use diesel::prelude::*;
	use diesel_migrations::MigrationHarness;
	use infra::pty::{PtyReadThreads, PtySessionMap};
	use serde_json::json;

	use super::*;
	use crate::pty::{create_flush_senders, PtyContext};
	use crate::runtime::{
		HerdrCliAttach, LocalAdapter, RuntimeRouter, RuntimeSelector,
	};
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
		pane_agent_status: HashMap<String, String>,
		pane_agent: HashMap<String, (Option<String>, Option<String>)>,
		tab_create_calls: usize,
		pane_close_calls: usize,
		send_input_calls: Vec<(String, String)>,
		methods: Vec<String>,
		create_error: Option<AppError>,
		close_error: Option<AppError>,
		send_input_error: Option<AppError>,
		create_lands: bool,
		close_lands: bool,
		already_open_create: bool,
		next_extra: u32,
		last_tab_create_cwd: Option<String>,
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
					pane_agent_status: HashMap::new(),
					pane_agent: HashMap::new(),
					tab_create_calls: 0,
					pane_close_calls: 0,
					send_input_calls: Vec::new(),
					methods: Vec::new(),
					create_error: None,
					close_error: None,
					send_input_error: None,
					create_lands: false,
					close_lands: false,
					already_open_create: false,
					next_extra: 2,
					last_tab_create_cwd: None,
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

		fn last_tab_create_cwd(&self) -> Option<String> {
			self.state.lock().unwrap().last_tab_create_cwd.clone()
		}

		fn send_input_calls(&self) -> Vec<(String, String)> {
			self.state.lock().unwrap().send_input_calls.clone()
		}

		fn pane_close_calls(&self) -> usize {
			self.state.lock().unwrap().pane_close_calls
		}

		fn push_pane(&self, pane: PaneView) {
			let mut state = self.state.lock().unwrap();
			state
				.panes
				.entry(pane.workspace_id.clone())
				.or_default()
				.push(pane);
		}

		fn set_pane_agent(
			&self,
			pane_id: &str,
			status: &str,
			agent: Option<&str>,
			display_agent: Option<&str>,
		) {
			let mut state = self.state.lock().unwrap();
			state
				.pane_agent_status
				.insert(pane_id.to_string(), status.to_string());
			state.pane_agent.insert(
				pane_id.to_string(),
				(agent.map(str::to_string), display_agent.map(str::to_string)),
			);
		}
	}

	impl HerdrTerminalClient for FakeTerminals {
		fn tab_create(
			&self,
			workspace_id: &str,
			_label: &str,
			cwd: &Path,
		) -> Result<TabCreateResult, AppError> {
			let mut state = self.state.lock().unwrap();
			state.methods.push("tab.create".into());
			state.tab_create_calls += 1;
			state.last_tab_create_cwd =
				Some(cwd.to_string_lossy().into_owned());
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

		fn pane_send_input(
			&self,
			pane_id: &str,
			text: &str,
		) -> Result<(), AppError> {
			let mut state = self.state.lock().unwrap();
			state.methods.push("pane.send_input".into());
			state
				.send_input_calls
				.push((pane_id.to_string(), text.to_string()));
			if let Some(err) = state.send_input_error.take() {
				return Err(err);
			}
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
						"revision": 1,
						"agent_status": state
							.pane_agent_status
							.get(&pane.pane_id)
							.cloned()
							.unwrap_or_else(|| "unknown".into()),
						"agent": state
							.pane_agent
							.get(&pane.pane_id)
							.and_then(|(agent, _)| agent.clone()),
						"display_agent": state
							.pane_agent
							.get(&pane.pane_id)
							.and_then(|(_, display)| display.clone())
					}));
				}
			}
			let mut agents = Vec::new();
			for (pane_id, status) in &state.pane_agent_status {
				if status == "unknown" {
					continue;
				}
				let (agent, display_agent) = state
					.pane_agent
					.get(pane_id)
					.cloned()
					.unwrap_or((None, None));
				agents.push(json!({
					"pane_id": pane_id,
					"tab_id": "",
					"workspace_id": "",
					"terminal_id": "term_live",
					"focused": false,
					"revision": 1,
					"agent_status": status,
					"agent": agent,
					"display_agent": display_agent
				}));
			}
			Ok(json!({
				"type": "session_snapshot",
				"snapshot": {
					"workspaces": workspaces,
					"tabs": tabs,
					"panes": panes,
					"agents": agents
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
		fake_cli: PathBuf,
		namespace: infra::herdr::process::HerdrNamespace,
	}

	fn write_fake_cli(fake_dir: &std::path::Path) -> PathBuf {
		let path = fake_dir.join("herdr");
		std::fs::write(
			&path,
			r#"#!/usr/bin/env python3
import os, sys, time, threading
from pathlib import Path
fake = Path(os.environ["HERDR_FAKE_DIR"])
fake.mkdir(parents=True, exist_ok=True)
(fake / "args.log").open("a").write(" ".join(sys.argv[1:]) + "\n")
(fake / "env.log").open("a").write(
    "HERDR_SESSION=%s HERDR_SOCKET_PATH=%s\n"
    % (os.environ.get("HERDR_SESSION", ""), os.environ.get("HERDR_SOCKET_PATH", ""))
)
def pump():
    with (fake / "stdin.log").open("ab") as out:
        while True:
            try:
                chunk = os.read(0, 4096)
            except OSError:
                break
            if not chunk:
                break
            out.write(chunk)
            out.flush()
threading.Thread(target=pump, daemon=True).start()
frames = fake / "frames.ndjson"
if frames.exists():
    sys.stdout.buffer.write(frames.read_bytes())
    sys.stdout.buffer.flush()
else:
    sys.stdout.write('{"type":"terminal.frame","seq":1,"encoding":"ansi","width":80,"height":24,"full":true,"bytes":"YQ=="}\n')
    sys.stdout.flush()
time.sleep(30)
"#,
		)
		.unwrap();
		#[cfg(unix)]
		{
			use std::os::unix::fs::PermissionsExt;
			std::fs::set_permissions(
				&path,
				std::fs::Permissions::from_mode(0o755),
			)
			.unwrap();
		}
		path
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
			let fake_dir = cwd.path().join("fake-cli");
			std::fs::create_dir_all(&fake_dir).unwrap();
			let fake_cli = write_fake_cli(&fake_dir);
			let xdg = cwd.path().join("xdg-config");
			std::fs::create_dir_all(xdg.join("herdr")).unwrap();
			let namespace =
				infra::herdr::process::resolve_namespace(xdg).unwrap();
			let extra_env = vec![
				(
					OsString::from("HOME"),
					cwd.path().join("home").into_os_string(),
				),
				(OsString::from("HERDR_FAKE_DIR"), fake_dir.into_os_string()),
			];
			let fake = Arc::new(FakeTerminals::with_root("w1"));
			let adapter = HerdrStubAdapter::with_terminal_client_and_cli(
				db.clone(),
				fake.clone(),
				HerdrCliAttach {
					executable: fake_cli.clone(),
					namespace: namespace.clone(),
					extra_env: extra_env.clone(),
				},
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
				fake_cli,
				namespace,
			}
		}

		fn cli_attach(&self) -> HerdrCliAttach {
			HerdrCliAttach {
				executable: self.fake_cli.clone(),
				namespace: self.namespace.clone(),
				extra_env: vec![
					(
						OsString::from("HOME"),
						self.cwd.path().join("home").into_os_string(),
					),
					(
						OsString::from("HERDR_FAKE_DIR"),
						self.cwd.path().join("fake-cli").into_os_string(),
					),
				],
			}
		}

		fn args_log(&self) -> String {
			std::fs::read_to_string(self.cwd.path().join("fake-cli/args.log"))
				.unwrap_or_default()
		}

		fn stdin_log(&self) -> String {
			std::fs::read_to_string(self.cwd.path().join("fake-cli/stdin.log"))
				.unwrap_or_default()
		}

		fn router(&self) -> RuntimeRouter {
			self.router_with_default(RuntimeBackend::Herdr)
		}

		fn local_default_router(&self) -> RuntimeRouter {
			self.router_with_default(RuntimeBackend::Local)
		}

		fn router_with_default(
			&self,
			default_backend: RuntimeBackend,
		) -> RuntimeRouter {
			let logs = self.cwd.path().join("pty-logs");
			std::fs::create_dir_all(&logs).unwrap();
			RuntimeRouter::with_backend(
				default_backend,
				LocalAdapter::new(PtyContext {
					db: self.db.clone(),
					sessions: self.sessions.clone(),
					flush_senders: create_flush_senders(),
					read_threads: self.read_threads.clone(),
					emitter: Arc::new(TestEmitter),
					output_dir: logs,
				}),
				HerdrStubAdapter::with_terminal_client_and_cli(
					self.db.clone(),
					self.fake.clone(),
					self.cli_attach(),
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
	fn create_session_accepts_live_workspace_id() {
		let fx = Fixture::new();
		let created = fx
			.adapter
			.create_session(
				&PtySessionMeta {
					profile_id: "w1".to_string(),
					title: "shell".to_string(),
				},
				&fx.config(),
			)
			.unwrap();
		assert_eq!(fx.mapping(&created.session_id), "w1:p1");
		let row = {
			let mut conn = fx.db.lock().unwrap();
			repo::pty::find_by_id(&mut conn, &created.session_id).unwrap()
		};
		assert_eq!(row.profile_id, "pr1");
		let listed = fx.adapter.list_project_sessions("p1").unwrap();
		assert_eq!(listed[0].profile_id, "w1");
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
		assert!(fx.fake.send_input_calls().is_empty());
		let row = {
			let mut conn = fx.db.lock().unwrap();
			repo::pty::find_by_id(&mut conn, &created.session_id).unwrap()
		};
		assert_eq!(row.shell, "/bin/sh");
		assert_eq!(row.cwd, fx.config().cwd);
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
		let expected_cwd = fx.cwd.path().to_string_lossy().into_owned();
		assert_eq!(
			fx.fake.last_tab_create_cwd().as_deref(),
			Some(expected_cwd.as_str())
		);
		assert!(!fx.fake.calls().iter().any(|m| m == "pane.split"));
		assert!(fx.fake.send_input_calls().is_empty());
		assert_eq!(fx.sessions.lock().unwrap().len(), 0);
	}

	#[test]
	fn subdirectory_cwd_skips_root_reuse_and_tab_creates() {
		let fx = Fixture::new();
		let sub = fx.cwd.path().join("pkg");
		std::fs::create_dir_all(&sub).unwrap();
		let mut config = fx.config();
		config.cwd = sub.to_string_lossy().into_owned();
		let created = fx
			.adapter
			.create_session(&Fixture::meta(), &config)
			.unwrap();
		assert_eq!(fx.mapping(&created.session_id), "w1:p2");
		assert_eq!(fx.fake.tab_create_calls(), 1);
		assert_eq!(
			fx.fake.last_tab_create_cwd().as_deref(),
			Some(config.cwd.as_str())
		);
		assert!(!fx.fake.calls().iter().any(|m| m == "pane.split"));
		assert_eq!(fx.sessions.lock().unwrap().len(), 0);
	}

	#[test]
	fn empty_or_relative_cwd_fails_closed_without_tab_create() {
		let fx = Fixture::new();
		let mut empty = fx.config();
		empty.cwd.clear();
		let err = fx
			.adapter
			.create_session(&Fixture::meta(), &empty)
			.unwrap_err();
		assert!(err.to_string().contains("absolute"), "{err}");
		assert_eq!(fx.fake.tab_create_calls(), 0);
		assert!(!fx.fake.calls().contains(&"pane.list".to_string()));

		let mut relative = fx.config();
		relative.cwd = "pkg".into();
		let err = fx
			.adapter
			.create_session(&Fixture::meta(), &relative)
			.unwrap_err();
		assert!(err.to_string().contains("absolute"), "{err}");
		assert_eq!(fx.fake.tab_create_calls(), 0);
		assert_eq!(fx.sessions.lock().unwrap().len(), 0);
		assert!(fx.fake.send_input_calls().is_empty());
	}

	#[test]
	fn startup_commands_send_input_once_with_trailing_newline() {
		let fx = Fixture::new();
		std::fs::write(
			fx.cwd.path().join("2code.json"),
			r#"{"init_script":["echo init"]}"#,
		)
		.unwrap();
		let mut config = fx.config();
		config.startup_commands = vec!["echo start".into()];
		let created = fx
			.adapter
			.create_session(&Fixture::meta(), &config)
			.unwrap();
		assert_eq!(fx.mapping(&created.session_id), "w1:p1");
		assert_eq!(
			fx.fake.send_input_calls(),
			vec![("w1:p1".into(), "echo init\necho start\n".into())]
		);
		assert_eq!(fx.fake.tab_create_calls(), 0);

		let listed = fx.adapter.list_project_sessions("p1").unwrap();
		assert_eq!(listed.len(), 1);
		assert_eq!(fx.fake.send_input_calls().len(), 1);
		assert!(fx
			.adapter
			.restore_session(&created.session_id, &Fixture::meta(), &config)
			.is_err());
		assert_eq!(fx.fake.send_input_calls().len(), 1);
		fx.adapter.close_session(&created.session_id).unwrap();
		assert_eq!(fx.fake.send_input_calls().len(), 1);
	}

	#[test]
	fn root_reuse_with_startup_still_sends_once() {
		let fx = Fixture::new();
		let mut config = fx.config();
		config.startup_commands = vec!["bun dev".into()];
		let created = fx
			.adapter
			.create_session(&Fixture::meta(), &config)
			.unwrap();
		assert_eq!(fx.mapping(&created.session_id), "w1:p1");
		assert_eq!(fx.fake.tab_create_calls(), 0);
		assert_eq!(
			fx.fake.send_input_calls(),
			vec![("w1:p1".into(), "bun dev\n".into())]
		);
	}

	#[test]
	fn subdirectory_startup_sends_after_tab_create() {
		let fx = Fixture::new();
		let sub = fx.cwd.path().join("pkg");
		std::fs::create_dir_all(&sub).unwrap();
		let mut config = fx.config();
		config.cwd = sub.to_string_lossy().into_owned();
		config.startup_commands = vec!["npm test".into()];
		let created = fx
			.adapter
			.create_session(&Fixture::meta(), &config)
			.unwrap();
		assert_eq!(fx.mapping(&created.session_id), "w1:p2");
		assert_eq!(fx.fake.tab_create_calls(), 1);
		assert_eq!(
			fx.fake.send_input_calls(),
			vec![("w1:p2".into(), "npm test\n".into())]
		);
	}

	#[test]
	fn list_flatten_does_not_send_input() {
		let fx = Fixture::new();
		let mut config = fx.config();
		config.startup_commands = vec!["echo once".into()];
		let created = fx
			.adapter
			.create_session(&Fixture::meta(), &config)
			.unwrap();
		assert_eq!(fx.fake.send_input_calls().len(), 1);
		fx.fake.push_pane(PaneView {
			pane_id: "w1:p2".into(),
			tab_id: "w1:t1".into(),
			workspace_id: "w1".into(),
		});
		let listed = fx.adapter.list_project_sessions("p1").unwrap();
		assert_eq!(listed.len(), 2);
		assert!(listed
			.iter()
			.any(|session| session.id == created.session_id));
		assert_eq!(fx.fake.send_input_calls().len(), 1);
		assert!(!fx.fake.calls().iter().any(|m| m == "tab.create"));
	}

	#[test]
	fn uncertain_send_input_is_not_replayed_and_keeps_the_session() {
		let fx = Fixture::new();
		{
			let mut state = fx.fake.state.lock().unwrap();
			state.send_input_error = Some(AppError::HerdrUncertainOutcome(
				"pane.send_input dropped".into(),
			));
		}
		let mut config = fx.config();
		config.startup_commands = vec!["echo hi".into()];
		let created = fx
			.adapter
			.create_session(&Fixture::meta(), &config)
			.unwrap();
		assert_eq!(fx.mapping(&created.session_id), "w1:p1");
		assert_eq!(fx.fake.send_input_calls().len(), 1);
		assert_eq!(fx.fake.pane_close_calls(), 0);
		assert_eq!(fx.sessions.lock().unwrap().len(), 0);
	}

	#[test]
	fn startup_input_text_joins_init_then_commands() {
		assert_eq!(startup_input_text(&[], &[]), None);
		assert_eq!(
			startup_input_text(&[String::new()], &[String::new()]),
			None
		);
		assert_eq!(
			startup_input_text(
				&["echo init".into()],
				&["echo a".into(), "echo b".into()]
			)
			.as_deref(),
			Some("echo init\necho a\necho b\n")
		);
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
		assert!(fx.adapter.flush(&created.session_id).is_err());
		assert!(fx.adapter.clear(&created.session_id).is_err());
		assert!(fx
			.adapter
			.scroll(
				&created.session_id,
				model::runtime::TerminalScrollDirection::Up,
				1,
				model::runtime::TerminalScrollSource::Wheel,
			)
			.is_err());
		assert!(!fx.fake.calls().iter().any(|m| m.contains("send")));
		assert_eq!(fx.sessions.lock().unwrap().len(), 0);
	}

	#[cfg(unix)]
	#[test]
	fn attach_write_resize_release_does_not_pane_close() {
		let fx = Fixture::new();
		let created = fx
			.adapter
			.create_session(&Fixture::meta(), &fx.config())
			.unwrap();
		fx.adapter
			.attach_output(&created.session_id, "stream-a")
			.unwrap();
		assert_eq!(fx.sessions.lock().unwrap().len(), 0);
		let frame = fx
			.adapter
			.recv_terminal_frame(&created.session_id, "stream-a")
			.unwrap();
		assert!(frame.full);
		assert_eq!(frame.bytes, b"a");
		fx.adapter.write(&created.session_id, b"echo hi\n").unwrap();
		fx.adapter.resize(&created.session_id, 24, 90).unwrap();
		fx.adapter
			.scroll(
				&created.session_id,
				model::runtime::TerminalScrollDirection::Up,
				2,
				model::runtime::TerminalScrollSource::Wheel,
			)
			.unwrap();
		std::thread::sleep(std::time::Duration::from_millis(120));
		fx.adapter
			.detach_output(&created.session_id, "stream-a")
			.unwrap();
		std::thread::sleep(std::time::Duration::from_millis(160));
		let args = fx.args_log();
		assert!(args.contains("terminal session control"), "{args}");
		assert!(args.contains("--session 2code"), "{args}");
		assert!(!args.contains("--takeover"), "{args}");
		assert!(!args.contains("observe"), "{args}");
		let stdin = fx.stdin_log();
		assert!(stdin.contains("terminal.input"), "{stdin}");
		assert!(stdin.contains("terminal.resize"), "{stdin}");
		assert!(stdin.contains("terminal.scroll"), "{stdin}");
		assert!(stdin.contains("\"lines\":2"), "{stdin}");
		assert!(stdin.contains("terminal.release"), "{stdin}");
		assert!(!stdin.contains("pane.close"), "{stdin}");
		assert!(!stdin.contains("pane.read"), "{stdin}");
		assert_eq!(fx.fake.pane_close_calls(), 0);
		assert!(fx.adapter.history(&created.session_id).is_err());
		assert!(fx.adapter.flush(&created.session_id).is_err());
		assert!(fx.adapter.clear(&created.session_id).is_err());
	}

	#[cfg(unix)]
	#[test]
	fn close_after_attach_still_terminates_the_pane() {
		let fx = Fixture::new();
		let created = fx
			.adapter
			.create_session(&Fixture::meta(), &fx.config())
			.unwrap();
		fx.adapter
			.attach_output(&created.session_id, "stream-a")
			.unwrap();
		fx.adapter.close_session(&created.session_id).unwrap();
		assert_eq!(fx.fake.pane_close_calls(), 1);
		assert_eq!(fx.sessions.lock().unwrap().len(), 0);
	}

	#[cfg(unix)]
	#[test]
	fn stale_stream_id_does_not_release_newer_helper() {
		let fx = Fixture::new();
		let created = fx
			.adapter
			.create_session(&Fixture::meta(), &fx.config())
			.unwrap();
		fx.adapter
			.attach_output(&created.session_id, "old")
			.unwrap();
		fx.adapter
			.attach_output(&created.session_id, "new")
			.unwrap();
		fx.adapter
			.detach_output(&created.session_id, "old")
			.unwrap();
		fx.adapter.write(&created.session_id, b"still\n").unwrap();
		fx.adapter
			.detach_output(&created.session_id, "new")
			.unwrap();
	}

	#[cfg(unix)]
	#[test]
	fn missing_mapping_or_pane_fails_closed() {
		let fx = Fixture::new();
		let err = fx.adapter.attach_output("missing-sess", "s1").unwrap_err();
		assert!(err.to_string().contains("missing"), "{err}");
		let created = fx
			.adapter
			.create_session(&Fixture::meta(), &fx.config())
			.unwrap();
		{
			let mut state = fx.fake.state.lock().unwrap();
			state.panes.clear();
		}
		let err = fx
			.adapter
			.attach_output(&created.session_id, "s1")
			.unwrap_err();
		assert!(err.to_string().contains("missing"), "{err}");
		assert!(fx.args_log().is_empty());
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

	#[cfg(unix)]
	#[test]
	fn router_herdr_attach_does_not_spawn_local_pty() {
		let fx = Fixture::new();
		let router = fx.router();
		let created = router
			.create_session(&Fixture::meta(), &fx.config())
			.unwrap();
		router.attach_output(&created.session_id, "s1").unwrap();
		assert_eq!(fx.sessions.lock().unwrap().len(), 0);
		router.write(&created.session_id, b"x\n").unwrap();
		assert_eq!(fx.sessions.lock().unwrap().len(), 0);
		router.detach_output(&created.session_id, "s1").unwrap();
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
		let create_session = src
			.split("fn create_session")
			.nth(1)
			.unwrap()
			.split("fn close_session")
			.next()
			.unwrap();
		assert!(!create_session.contains("worktree.create"));
		assert!(!create_session.contains("worktree.open"));
		assert!(!create_session.contains("workspace.create"));
		assert!(!create_session.contains("worktree.remove"));
		assert!(!create_session.contains("worktree_remove"));
		let close_session = src
			.split("fn close_session")
			.nth(1)
			.unwrap()
			.split("fn finish_close")
			.next()
			.unwrap();
		assert!(!close_session.contains("worktree.remove"));
		assert!(!close_session.contains("worktree_remove"));
		assert!(
			src.contains("worktree.remove") || src.contains("worktree_remove")
		);
		assert!(!src.contains("workspace.create"));
		assert!(!src.contains("pane.split"));
		assert!(!src.contains("server.stop"));
		assert!(!src.contains("herdr-client.sock"));
		assert!(!src.contains("pane.send_text"));
		assert!(
			src.contains("pane.send_input") || src.contains("pane_send_input")
		);
		assert!(!src.contains("pane.send_keys"));
		assert!(!src.contains("pane.split"));
		assert!(!src.contains("pane.read"));
		assert!(!src.contains("--takeover"));
		assert!(!src.contains("pane.report_agent"));
		assert!(!src.contains("agent.start"));
		assert!(!src.contains("agent.prompt"));
		assert!(src.contains("attach_control"));
		assert!(
			src.contains("worktree.create") || src.contains("worktree_create")
		);
		assert!(src.contains("HerdrWorktreeClient"));
		let list_sessions = src
			.split("fn list_project_sessions")
			.nth(1)
			.unwrap()
			.split("fn delete_session")
			.next()
			.unwrap();
		assert!(!list_sessions.contains("pane.send_input"));
		assert!(!list_sessions.contains("pane_send_input"));
		assert!(!list_sessions.contains("send_create_startup"));
		assert!(!close_session.contains("pane.send_input"));
		assert!(!close_session.contains("pane_send_input"));
		let restore = src
			.split("fn restore_session")
			.nth(1)
			.unwrap()
			.split("fn close_session")
			.next()
			.unwrap();
		assert!(!restore.contains("pane.send_input"));
		assert!(!restore.contains("pane_send_input"));
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
		assert!(detach.contains("detach_output"));
		let close = pty
			.split("pub fn close_pty_session")
			.nth(1)
			.unwrap()
			.split("pub async fn list_project_sessions")
			.next()
			.unwrap();
		assert!(close.contains("close_session"));
		assert!(pty.contains("stream_herdr_output"));
		assert!(pty.contains("HerdrTerminalFrame"));
		assert!(pty.contains("get_session_backend"));
		assert!(pty.contains("get_session_agent_status"));
		assert!(pty.contains("stream_session_agent_status"));
		assert!(pty.contains("scroll_pty"));
		assert!(!pty.contains("pane.send_text"));
		assert!(!pty.contains("pane.report_agent"));
		assert!(!pty.contains("agent.start"));
		let lib = include_str!("../../../../src/lib.rs");
		assert!(lib.contains("stream_herdr_output"));
		assert!(lib.contains("get_session_backend"));
		assert!(lib.contains("get_session_agent_status"));
		assert!(lib.contains("stream_session_agent_status"));
		assert!(lib.contains("scroll_pty"));
		assert!(lib.contains("release_attachments"));
		assert!(!lib.contains("server.stop"));
		assert!(!lib.contains("ensure_herdr_listener"));
		assert!(!lib.contains("HerdrRuntimeSync"));
	}

	#[test]
	fn session_backend_ipc_uses_backend_for_not_discovery() {
		let pty = include_str!("../../../../src/handler/pty.rs");
		let cmd = pty
			.split("pub fn get_session_backend")
			.nth(1)
			.unwrap()
			.split("pub fn get_session_agent_status")
			.next()
			.unwrap();
		assert!(cmd.contains("backend_for"));
		assert!(!cmd.contains("selected_backend"));
		assert!(!cmd.contains("discovery"));
		assert!(!cmd.contains("RuntimeRouter::new"));
		let agent = pty
			.split("pub fn get_session_agent_status")
			.nth(1)
			.unwrap()
			.split("pub async fn stream_session_agent_status")
			.next()
			.unwrap();
		assert!(agent.contains("session_agent_status"));
		assert!(!agent.contains("selected_backend"));
		assert!(!agent.contains("discovery"));
		let stream = pty
			.split("pub async fn stream_session_agent_status")
			.nth(1)
			.unwrap()
			.split("pub fn attach_pty_output")
			.next()
			.unwrap();
		assert!(stream.contains("backend_for"));
		assert!(stream.contains("RuntimeBackend::Herdr"));
		assert!(stream.contains("pump_session_agent_status"));
		assert!(!stream.contains("selected_backend"));
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
	fn list_reattaches_bound_pane_without_restore_or_tab_create() {
		let fx = Fixture::new();
		let created = fx
			.adapter
			.create_session(&Fixture::meta(), &fx.config())
			.unwrap();
		assert_eq!(fx.mapping(&created.session_id), "w1:p1");
		let creates_before = fx.fake.tab_create_calls();
		let listed = fx.adapter.list_project_sessions("p1").unwrap();
		assert_eq!(listed.len(), 1);
		assert_eq!(listed[0].id, created.session_id);
		assert_eq!(fx.mapping(&created.session_id), "w1:p1");
		assert_eq!(fx.fake.tab_create_calls(), creates_before);
		assert!(!fx.fake.calls().iter().any(|m| m == "tab.create"));
		assert!(!fx.fake.calls().iter().any(|m| m.contains("pane.read")));
		assert!(!fx.fake.calls().iter().any(|m| m.contains("pane.send")));
		assert!(!fx.fake.calls().iter().any(|m| m == "pane.split"));
		assert!(fx
			.adapter
			.restore_session(
				&created.session_id,
				&Fixture::meta(),
				&fx.config()
			)
			.is_err());
		assert_eq!(fx.sessions.lock().unwrap().len(), 0);
	}

	#[test]
	fn list_flattens_unmapped_panes_in_bound_workspaces() {
		let fx = Fixture::new();
		let root = fx
			.adapter
			.create_session(&Fixture::meta(), &fx.config())
			.unwrap();
		fx.fake.push_pane(PaneView {
			pane_id: "w1:p2".into(),
			tab_id: "w1:t1".into(),
			workspace_id: "w1".into(),
		});
		let creates_before = fx.fake.tab_create_calls();
		let listed = fx.adapter.list_project_sessions("p1").unwrap();
		assert_eq!(fx.fake.tab_create_calls(), creates_before);
		assert!(!fx.fake.calls().iter().any(|m| m == "tab.create"));
		assert!(!fx.fake.calls().iter().any(|m| m == "pane.split"));
		assert_eq!(listed.len(), 2);
		assert!(listed.iter().any(|session| session.id == root.session_id));
		let extra = listed
			.iter()
			.find(|session| session.id != root.session_id)
			.unwrap();
		assert_eq!(fx.mapping(&extra.id), "w1:p2");
		assert_eq!(extra.profile_id, "w1");
		assert_eq!(extra.cwd, fx.cwd.path().to_string_lossy());
		let again = fx.adapter.list_project_sessions("p1").unwrap();
		assert_eq!(again.len(), 2);
		assert_eq!(fx.fake.tab_create_calls(), creates_before);
	}

	#[test]
	fn local_default_reopen_lists_bound_herdr_without_local_pty() {
		let fx = Fixture::new();
		let created = fx
			.router()
			.create_session(&Fixture::meta(), &fx.config())
			.unwrap();
		let router = fx.local_default_router();
		assert_eq!(router.selected_backend(), RuntimeBackend::Local);
		assert_eq!(
			router.backend_for(&created.session_id).unwrap(),
			RuntimeBackend::Herdr
		);
		let listed = router.list_project_sessions("p1").unwrap();
		assert!(listed
			.iter()
			.any(|session| session.id == created.session_id));
		assert_eq!(
			router.owner(&created.session_id).unwrap(),
			Some(RuntimeBackend::Herdr)
		);
		assert!(router
			.restore_session(
				&created.session_id,
				&Fixture::meta(),
				&fx.config()
			)
			.is_err());
		assert_eq!(fx.sessions.lock().unwrap().len(), 0);
		assert!(!fx.fake.calls().iter().any(|m| m == "tab.create"));
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
	fn herdr_session_hydrates_unknown_agent_status() {
		let fx = Fixture::new();
		let created = fx
			.adapter
			.create_session(&Fixture::meta(), &fx.config())
			.unwrap();
		let dto = fx
			.adapter
			.session_agent_status(&created.session_id)
			.unwrap()
			.expect("mapped unknown");
		assert_eq!(dto.session_id, created.session_id);
		assert_eq!(dto.status, "unknown");
		assert_eq!(dto.agent_name, None);
	}

	#[test]
	fn herdr_session_hydrates_working_identity_from_snapshot() {
		let fx = Fixture::new();
		let created = fx
			.adapter
			.create_session(&Fixture::meta(), &fx.config())
			.unwrap();
		let pane_id = fx.mapping(&created.session_id);
		fx.fake.set_pane_agent(
			&pane_id,
			"working",
			Some("claude"),
			Some("Claude Code"),
		);
		let dto = fx
			.adapter
			.session_agent_status(&created.session_id)
			.unwrap()
			.expect("mapped working");
		assert_eq!(dto.status, "working");
		assert_eq!(dto.agent_name.as_deref(), Some("Claude Code"));
	}

	#[test]
	fn missing_pane_agent_status_fails_closed() {
		let fx = Fixture::new();
		let created = fx
			.adapter
			.create_session(&Fixture::meta(), &fx.config())
			.unwrap();
		let pane_id = fx.mapping(&created.session_id);
		fx.fake.pane_close(&pane_id).unwrap();
		assert!(fx
			.adapter
			.session_agent_status(&created.session_id)
			.unwrap()
			.is_none());
	}

	#[test]
	fn router_local_owned_id_never_reads_herdr_agent_status() {
		let fx = Fixture::new();
		let router = fx.local_default_router();
		let created = router
			.create_session(&Fixture::meta(), &fx.config())
			.unwrap();
		assert_eq!(
			router.owner(&created.session_id).unwrap(),
			Some(RuntimeBackend::Local)
		);
		assert!(router
			.session_agent_status(&created.session_id)
			.unwrap()
			.is_none());
		assert!(!fx.fake.calls().iter().any(|m| m == "session.snapshot"));
	}

	#[test]
	fn router_herdr_owned_id_hydrates_agent_status() {
		let fx = Fixture::new();
		let router = fx.router();
		let created = router
			.create_session(&Fixture::meta(), &fx.config())
			.unwrap();
		let dto = router
			.session_agent_status(&created.session_id)
			.unwrap()
			.expect("herdr agent");
		assert_eq!(dto.session_id, created.session_id);
		assert_eq!(dto.status, "unknown");
	}

	#[test]
	fn stub_without_client_stays_fail_closed() {
		let stub = HerdrStubAdapter::new();
		let selector = RuntimeSelector::default();
		assert_eq!(selector.default_backend(), RuntimeBackend::Herdr);
		let client = HerdrClient::connect_path(std::path::Path::new(
			"/tmp/2code-ok.sock",
		))
		.unwrap();
		let json = Arc::new(HerdrJsonTerminals::new(client));
		let xdg = tempfile::tempdir().unwrap();
		std::fs::create_dir_all(xdg.path().join("herdr")).unwrap();
		let namespace =
			infra::herdr::process::resolve_namespace(xdg.path().to_path_buf())
				.unwrap();
		let with_json = HerdrStubAdapter::with_json_clients(
			setup_db(),
			json,
			HerdrCliAttach {
				executable: PathBuf::from("herdr"),
				namespace,
				extra_env: Vec::new(),
			},
		);
		assert!(with_json.worktrees().is_ok());
		assert!(with_json.has_terminal_client());
		let absent = AppError::HerdrServerAbsent("/tmp/missing.sock".into());
		let closed = HerdrStubAdapter::fail_closed(absent);
		assert!(matches!(
			closed
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
					},
				)
				.unwrap_err(),
			AppError::HerdrServerAbsent(_)
		));
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
