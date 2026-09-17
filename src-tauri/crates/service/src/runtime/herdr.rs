//! Herdr terminal lifecycle and live CLI attach.
//!
//! Create/list/close use live `pane_id` identities (`wN:pK`) from
//! `session.snapshot` or `HerdrRuntimeSync`. They do not write sqlite
//! session or mapping tables. List returns every live pane in the
//! project's open workspaces; leftover sqlite rows are not merged.
//! New Tab returns the created `pane_id`.
//! Write/resize go through an attached CLI control helper.
//! Restore stays fail-closed: reopen lists live panes and attaches them.
//! History/flush/clear stay fail-closed. A missing client keeps the
//! Task 2 stub behavior. `terminal_id` is never persisted.

use std::collections::{HashMap, HashSet};
use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use infra::db::DbPool;
use infra::herdr::process::{HerdrNamespace, HerdrProcessEnv};
use infra::herdr::terminal::{
	BufferLimits, TerminalAttachRequest, TerminalSessionHelper,
};
use infra::herdr::transport::{
	HerdrClient, PaneView, TabCreateResult, WorkspaceCreateRequest,
	WorkspaceCreateResult, WorktreeCreateRequest, WorktreeCreateResult,
	WorktreeListEntry, WorktreeOpenResult, WorktreeRemoveResult,
};
use model::error::AppError;
use model::runtime::{
	CreateSessionResult, HerdrTerminalFrame, RuntimeBackend, SessionAgentStatus,
};
use model::session::{
	RestoreResult, TerminalConfig, TerminalSessionMeta, TerminalSessionRecord,
};
use serde_json::Value;

use crate::runtime_agent::session_agent_from_pane;
use crate::runtime_sync::{
	ApplyOutcome, HerdrRuntimeSync, ProjectedPane, RuntimeProjection,
};

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

	fn workspace_create(
		&self,
		request: WorkspaceCreateRequest<'_>,
	) -> Result<WorkspaceCreateResult, AppError>;

	fn workspace_close(&self, workspace_id: &str) -> Result<(), AppError>;

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

	fn workspace_create(
		&self,
		request: WorkspaceCreateRequest<'_>,
	) -> Result<WorkspaceCreateResult, AppError> {
		self.client
			.workspace_create(request)
			.map_err(AppError::from)
	}

	fn workspace_close(&self, workspace_id: &str) -> Result<(), AppError> {
		self.client
			.workspace_close(workspace_id)
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
	worktrees: Option<Arc<dyn HerdrWorktreeClient>>,
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
			Self::Other(message) => AppError::TerminalError(message.clone()),
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
	runtime_sync: Option<Mutex<HerdrRuntimeSync>>,
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
			lifecycle: Some(HerdrLifecycle {
				db,
				client,
				worktrees: None,
			}),
			worktrees: None,
			cli: None,
			attachments: Mutex::new(HashMap::new()),
			startup_error: None,
			runtime_sync: None,
		}
	}

	pub fn with_terminal_client_and_cli(
		db: DbPool,
		client: Arc<dyn HerdrTerminalClient>,
		cli: HerdrCliAttach,
	) -> Self {
		Self::with_terminal_worktree_and_cli(db, client, None, cli)
	}

	pub fn with_terminal_worktree_and_cli(
		db: DbPool,
		client: Arc<dyn HerdrTerminalClient>,
		worktrees: Option<Arc<dyn HerdrWorktreeClient>>,
		cli: HerdrCliAttach,
	) -> Self {
		Self {
			ops: Mutex::new(Vec::new()),
			lifecycle: Some(HerdrLifecycle {
				db,
				client,
				worktrees: worktrees.clone(),
			}),
			worktrees,
			cli: Some(cli),
			attachments: Mutex::new(HashMap::new()),
			startup_error: None,
			runtime_sync: None,
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
			runtime_sync: None,
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
				worktrees: Some(json.clone()),
			}),
			worktrees: Some(json),
			cli: Some(cli),
			attachments: Mutex::new(HashMap::new()),
			startup_error: None,
			runtime_sync: None,
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
			.unwrap_or_else(|| AppError::TerminalError(UNAVAILABLE.to_string()))
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
	) -> Result<HerdrRuntimeSync, AppError> {
		HerdrRuntimeSync::connect(endpoint)
	}

	pub(crate) fn attach_runtime_sync(
		&mut self,
		endpoint: &super::HerdrEndpoint,
	) -> Result<(), AppError> {
		let sync = Self::open_runtime_sync(endpoint)?;
		self.runtime_sync = Some(Mutex::new(sync));
		Ok(())
	}

	#[allow(dead_code)]
	pub(crate) fn has_runtime_sync(&self) -> bool {
		self.runtime_sync.is_some()
	}

	#[allow(dead_code)]
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

	fn live_projection(&self) -> Result<RuntimeProjection, AppError> {
		if let Some(sync) = &self.runtime_sync {
			let mut sync = sync.lock().map_err(|_| AppError::LockError)?;
			loop {
				match sync.poll(Duration::ZERO) {
					Ok(ApplyOutcome::Ignored) => break,
					Ok(_) => continue,
					Err(err) => return Err(err),
				}
			}
			return Ok(sync.projection().clone());
		}
		let snapshot = self.lifecycle()?.client.session_snapshot()?;
		let mut projection = RuntimeProjection::new();
		projection.apply_snapshot(&snapshot)?;
		Ok(projection)
	}

	fn resolve_pane_id(&self, session_id: &str) -> Result<String, AppError> {
		let projection = self.live_projection()?;
		if projection.pane(session_id).is_some() {
			Ok(session_id.to_string())
		} else {
			Err(AppError::RuntimeMappingMissing(format!(
				"pane {session_id} is missing"
			)))
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
				return Err(AppError::TerminalError(
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

	/// Current projected agent state for a live Herdr pane.
	/// Missing panes fail closed (`None`). sqlite mappings are not
	/// consulted.
	pub fn session_agent_status(
		&self,
		session_id: &str,
	) -> Result<Option<SessionAgentStatus>, AppError> {
		self.record("agent_status");
		if self.lifecycle.is_none() && self.runtime_sync.is_none() {
			return Ok(None);
		}
		let projection = self.live_projection()?;
		Ok(projection
			.pane(session_id)
			.map(|pane| session_agent_from_pane(session_id, pane)))
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

fn require_absolute_cwd(cwd: &str) -> Result<(), AppError> {
	if cwd.is_empty() || !Path::new(cwd).is_absolute() {
		return Err(AppError::TerminalError(
			"cwd must be an absolute path".into(),
		));
	}
	Ok(())
}

fn snapshot_pane_cwd(snapshot: &Value, workspace_id: &str) -> Option<String> {
	let snap = if snapshot.get("type").and_then(Value::as_str)
		== Some("session_snapshot")
	{
		snapshot.get("snapshot").unwrap_or(snapshot)
	} else {
		snapshot
	};
	snap.get("panes")
		.and_then(Value::as_array)
		.into_iter()
		.flatten()
		.find_map(|pane| {
			if pane.get("workspace_id").and_then(Value::as_str)
				== Some(workspace_id)
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

fn snapshot_workspace_ids_for_folder(
	projection: &RuntimeProjection,
	folder: &str,
) -> Vec<String> {
	let mut ids: Vec<String> = projection
		.pane_ids()
		.into_iter()
		.filter_map(|id| {
			let pane = projection.pane(&id)?;
			if pane.cwd.is_empty() {
				return None;
			}
			same_checkout_path(Path::new(&pane.cwd), Path::new(folder))
				.then(|| pane.workspace_id.clone())
		})
		.collect();
	ids.sort();
	ids.dedup();
	ids
}

fn session_record_from_pane(
	projection: &RuntimeProjection,
	pane: &ProjectedPane,
	checkout: &str,
	project_id: &str,
) -> TerminalSessionRecord {
	let title = projection
		.tab(&pane.tab_id)
		.map(|tab| tab.label.as_str())
		.filter(|label| !label.is_empty())
		.unwrap_or(&pane.pane_id)
		.to_string();
	let cwd = if pane.cwd.is_empty() {
		checkout.to_string()
	} else {
		pane.cwd.clone()
	};
	TerminalSessionRecord {
		id: pane.pane_id.clone(),
		project_id: project_id.to_string(),
		profile_id: pane.workspace_id.clone(),
		title,
		shell: "/bin/sh".into(),
		cwd,
		created_at: String::new(),
		closed_at: None,
		cols: 80,
		rows: 24,
	}
}

impl HerdrLifecycle {
	fn with_db<T>(
		&self,
		f: impl FnOnce(&mut diesel::SqliteConnection) -> Result<T, AppError>,
	) -> Result<T, AppError> {
		let mut conn = self.db.lock().map_err(|_| AppError::LockError)?;
		f(&mut conn)
	}

	fn bound_workspace(&self, profile_id: &str) -> Result<String, AppError> {
		let snapshot = self.client.session_snapshot()?;
		let mut projection = RuntimeProjection::new();
		projection.apply_snapshot(&snapshot)?;
		if projection.workspace(profile_id).is_some() {
			return Ok(profile_id.to_string());
		}
		Err(AppError::RuntimeMappingMissing(format!(
			"profile {profile_id} has no Herdr workspace"
		)))
	}

	fn profile_checkout(&self, profile_id: &str) -> Result<String, AppError> {
		let workspace_id = self.bound_workspace(profile_id)?;
		self.live_workspace_checkout(&workspace_id)
	}

	fn live_workspace_checkout(
		&self,
		workspace_id: &str,
	) -> Result<String, AppError> {
		if let Some(worktrees) = &self.worktrees {
			return crate::project::live_workspace_checkout(
				worktrees.as_ref(),
				workspace_id,
			);
		}
		let snapshot = self.client.session_snapshot().map_err(|_| {
			AppError::NotFound(format!("Profile: {workspace_id}"))
		})?;
		snapshot_pane_cwd(&snapshot, workspace_id).ok_or_else(|| {
			AppError::NotFound(format!("Profile: {workspace_id}"))
		})
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
		meta: &TerminalSessionMeta,
		config: &TerminalConfig,
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

	fn create_session(
		&self,
		meta: &TerminalSessionMeta,
		config: &TerminalConfig,
	) -> Result<CreateSessionResult, AppError> {
		require_absolute_cwd(&config.cwd)?;
		let workspace_id = self.bound_workspace(&meta.profile_id)?;
		let listed = self.client.pane_list(&workspace_id)?;
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
				&HashSet::new(),
			)?,
			Err(err) => return Err(err),
		};
		if listed.iter().any(|pane| pane.pane_id == pane_id) {
			return Err(AppError::TerminalError(format!(
				"pane {pane_id} is already live; not replaying"
			)));
		}
		self.send_create_startup(meta, config, &pane_id);
		Ok(CreateSessionResult {
			session_id: pane_id,
		})
	}

	fn close_session(&self, session_id: &str) -> Result<(), AppError> {
		let workspace_id = self
			.client
			.pane_get(session_id)?
			.map(|pane| pane.workspace_id)
			.unwrap_or_else(|| {
				session_id
					.split_once(':')
					.map(|(workspace, _)| workspace.to_string())
					.unwrap_or_default()
			});
		match self.client.pane_close(session_id) {
			Ok(()) => Ok(()),
			Err(AppError::HerdrUncertainOutcome(_)) => {
				if pane_is_absent(
					self.client.as_ref(),
					&workspace_id,
					session_id,
				)? {
					Ok(())
				} else {
					Err(AppError::HerdrUncertainOutcome(format!(
						"pane.close {session_id} is uncertain; not replaying"
					)))
				}
			}
			Err(err) => Err(err),
		}
	}

	fn list_project_sessions(
		&self,
		project_id: &str,
		projection: &RuntimeProjection,
	) -> Result<Vec<TerminalSessionRecord>, AppError> {
		let folder = self.with_db(|conn| {
			repo::project::find_by_id(conn, project_id).map(|p| p.folder)
		})?;
		let workspace_ids = if let Some(worktrees) = &self.worktrees {
			crate::project::live_open_workspace_ids(
				worktrees.as_ref(),
				&folder,
			)?
		} else {
			snapshot_workspace_ids_for_folder(projection, &folder)
		};
		let mut listed = Vec::new();
		for workspace_id in workspace_ids {
			if projection.workspace(&workspace_id).is_none() {
				continue;
			}
			let checkout = self
				.live_workspace_checkout(&workspace_id)
				.unwrap_or_default();
			for pane in projection.panes_in_workspace(&workspace_id) {
				listed.push(session_record_from_pane(
					projection, &pane, &checkout, project_id,
				));
			}
		}
		Ok(listed)
	}

	fn delete_session(&self, _session_id: &str) -> Result<(), AppError> {
		Ok(())
	}
}

impl TerminalRuntime for HerdrStubAdapter {
	fn selected_backend(&self) -> RuntimeBackend {
		RuntimeBackend::Herdr
	}

	fn create_session(
		&self,
		meta: &TerminalSessionMeta,
		config: &TerminalConfig,
	) -> Result<CreateSessionResult, AppError> {
		self.record("create");
		self.lifecycle()?.create_session(meta, config)
	}

	fn restore_session(
		&self,
		_old_session_id: &str,
		_meta: &TerminalSessionMeta,
		_config: &TerminalConfig,
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
	) -> Result<Vec<TerminalSessionRecord>, AppError> {
		self.record("list");
		let projection = self.live_projection()?;
		self.lifecycle()?
			.list_project_sessions(project_id, &projection)
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
	use diesel::QueryableByName;
	use diesel_migrations::MigrationHarness;
	use serde_json::json;

	use super::*;
	use crate::runtime::{HerdrCliAttach, RuntimeRouter, RuntimeSelector};
	use model::runtime::RuntimeBackend;

	#[derive(QueryableByName)]
	struct SqliteCountRow {
		#[diesel(sql_type = diesel::sql_types::Integer)]
		count: i32,
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
		listed_worktrees: Vec<WorktreeListEntry>,
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
					listed_worktrees: Vec::new(),
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

		fn set_worktree(
			&self,
			workspace_id: &str,
			path: &Path,
			is_linked_worktree: bool,
		) {
			let mut state = self.state.lock().unwrap();
			let entry = WorktreeListEntry {
				path: path.to_string_lossy().into_owned(),
				branch: Some(if is_linked_worktree {
					"feat/x".into()
				} else {
					"main".into()
				}),
				workspace_id: Some(workspace_id.to_string()),
				is_linked_worktree,
			};
			if let Some(existing) =
				state.listed_worktrees.iter_mut().find(|listed| {
					listed.workspace_id.as_deref() == Some(workspace_id)
				}) {
				*existing = entry;
			} else {
				state.listed_worktrees.push(entry);
			}
		}

		fn snapshot_json(&self) -> Result<Value, AppError> {
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
				let cwd = state
					.listed_worktrees
					.iter()
					.find(|entry| {
						entry.workspace_id.as_deref() == Some(workspace_id)
					})
					.map(|entry| entry.path.clone())
					.unwrap_or_default();
				for pane in listed {
					tabs.push(json!({
						"tab_id": pane.tab_id,
						"workspace_id": pane.workspace_id,
						"label": ""
					}));
					let mut pane_json = json!({
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
					});
					if !cwd.is_empty() {
						pane_json
							.as_object_mut()
							.expect("pane object")
							.insert("cwd".into(), json!(cwd));
					}
					panes.push(pane_json);
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
						AppError::TerminalError("no pane to reuse".into())
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
			self.snapshot_json()
		}
	}

	impl HerdrWorktreeClient for FakeTerminals {
		fn worktree_create(
			&self,
			_request: WorktreeCreateRequest<'_>,
		) -> Result<WorktreeCreateResult, AppError> {
			Err(AppError::TerminalError(
				"fake terminals do not create worktrees".into(),
			))
		}

		fn worktree_list(
			&self,
			cwd: Option<&Path>,
			workspace_id: Option<&str>,
		) -> Result<Vec<WorktreeListEntry>, AppError> {
			let mut state = self.state.lock().unwrap();
			state.methods.push("worktree.list".into());
			let listed = state.listed_worktrees.clone();
			if let Some(workspace_id) = workspace_id {
				return Ok(listed
					.into_iter()
					.filter(|entry| {
						entry.workspace_id.as_deref() == Some(workspace_id)
					})
					.collect());
			}
			let Some(cwd) = cwd else {
				return Ok(listed);
			};
			let cwd = cwd.to_string_lossy();
			if listed.iter().any(|entry| {
				entry.path == cwd
					|| Path::new(&entry.path)
						.canonicalize()
						.ok()
						.zip(Path::new(cwd.as_ref()).canonicalize().ok())
						.is_some_and(|(left, right)| left == right)
			}) {
				return Ok(listed);
			}
			Ok(Vec::new())
		}

		fn worktree_open(
			&self,
			_cwd: &Path,
			_path: &Path,
		) -> Result<WorktreeOpenResult, AppError> {
			Err(AppError::TerminalError(
				"fake terminals do not open worktrees".into(),
			))
		}

		fn worktree_remove(
			&self,
			_workspace_id: &str,
			_force: bool,
		) -> Result<WorktreeRemoveResult, AppError> {
			Err(AppError::TerminalError(
				"fake terminals do not remove worktrees".into(),
			))
		}

		fn workspace_create(
			&self,
			_request: WorkspaceCreateRequest<'_>,
		) -> Result<WorkspaceCreateResult, AppError> {
			Err(AppError::TerminalError(
				"fake terminals do not create workspaces".into(),
			))
		}

		fn workspace_close(&self, _workspace_id: &str) -> Result<(), AppError> {
			Err(AppError::TerminalError(
				"fake terminals do not close workspaces".into(),
			))
		}

		fn session_snapshot(&self) -> Result<Value, AppError> {
			self.snapshot_json()
		}
	}

	struct Fixture {
		db: DbPool,
		fake: Arc<FakeTerminals>,
		adapter: HerdrStubAdapter,
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
			fake.set_worktree("w1", cwd.path(), false);
			let adapter = HerdrStubAdapter::with_terminal_worktree_and_cli(
				db.clone(),
				fake.clone(),
				Some(fake.clone()),
				HerdrCliAttach {
					executable: fake_cli.clone(),
					namespace: namespace.clone(),
					extra_env: extra_env.clone(),
				},
			);
			Self {
				db,
				fake,
				adapter,
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
			RuntimeRouter::new(
				HerdrStubAdapter::with_terminal_worktree_and_cli(
					self.db.clone(),
					self.fake.clone(),
					Some(self.fake.clone()),
					self.cli_attach(),
				),
			)
		}

		fn meta() -> TerminalSessionMeta {
			TerminalSessionMeta {
				profile_id: "w1".to_string(),
				title: "shell".to_string(),
			}
		}

		fn config(&self) -> TerminalConfig {
			TerminalConfig {
				shell: "/bin/sh".into(),
				cwd: self.cwd.path().to_string_lossy().into_owned(),
				rows: 24,
				cols: 80,
				startup_commands: Vec::new(),
			}
		}

		fn sqlite_session_ids(&self) -> Vec<String> {
			let mut conn = self.db.lock().unwrap();
			let row: SqliteCountRow = diesel::sql_query(
				"SELECT COUNT(*) AS count FROM sqlite_master \
				 WHERE type = 'table' AND name = 'pty_sessions'",
			)
			.get_result(&mut *conn)
			.unwrap();
			assert_eq!(row.count, 0, "pty_sessions must be dropped");
			Vec::new()
		}
	}

	#[test]
	fn list_includes_every_live_pane_without_create() {
		let fx = Fixture::new();
		let listed = fx.adapter.list_project_sessions("p1").unwrap();
		assert_eq!(listed.len(), 1);
		assert_eq!(listed[0].id, "w1:p1");
		assert_eq!(listed[0].profile_id, "w1");
		assert_eq!(listed[0].cwd, fx.cwd.path().to_string_lossy());
		assert_eq!(fx.fake.tab_create_calls(), 0);
		assert!(fx.sqlite_session_ids().is_empty());
	}

	#[test]
	fn create_session_accepts_live_workspace_id() {
		let fx = Fixture::new();
		let created = fx
			.adapter
			.create_session(
				&TerminalSessionMeta {
					profile_id: "w1".to_string(),
					title: "shell".to_string(),
				},
				&fx.config(),
			)
			.unwrap();
		assert_eq!(created.session_id, "w1:p2");
		assert!(fx.sqlite_session_ids().is_empty());
		let listed = fx.adapter.list_project_sessions("p1").unwrap();
		assert!(listed.iter().any(|session| session.id == "w1:p1"));
		assert!(listed.iter().any(|session| session.id == "w1:p2"));
		assert_eq!(
			listed
				.iter()
				.find(|session| session.id == "w1:p2")
				.unwrap()
				.profile_id,
			"w1"
		);
	}

	#[test]
	fn create_session_uses_live_checkout_not_sqlite_path() {
		let fx = Fixture::new();
		let created = fx
			.adapter
			.create_session(
				&TerminalSessionMeta {
					profile_id: "w1".to_string(),
					title: "shell".to_string(),
				},
				&fx.config(),
			)
			.unwrap();
		assert_eq!(created.session_id, "w1:p2");
		assert_eq!(fx.fake.tab_create_calls(), 1);
		assert!(fx.fake.calls().iter().any(|m| m == "worktree.list"));
		assert!(fx.sqlite_session_ids().is_empty());
	}

	#[test]
	fn create_session_unmapped_linked_returns_pane_id_not_sqlite_fk() {
		let fx = Fixture::new();
		let linked = fx.cwd.path().join("linked");
		std::fs::create_dir_all(&linked).unwrap();
		fx.fake.push_pane(PaneView {
			pane_id: "w2:p1".into(),
			tab_id: "w2:t1".into(),
			workspace_id: "w2".into(),
		});
		fx.fake.set_worktree("w2", &linked, true);
		let created = fx
			.adapter
			.create_session(
				&TerminalSessionMeta {
					profile_id: "w2".to_string(),
					title: "shell".to_string(),
				},
				&TerminalConfig {
					shell: "/bin/sh".into(),
					cwd: linked.to_string_lossy().into_owned(),
					rows: 24,
					cols: 80,
					startup_commands: Vec::new(),
				},
			)
			.unwrap();
		assert_eq!(created.session_id, "w2:p2");
		assert!(fx.sqlite_session_ids().is_empty());
		let listed = fx.adapter.list_project_sessions("p1").unwrap();
		assert!(listed.iter().any(|session| session.id == "w2:p1"));
		assert!(listed.iter().any(|session| session.id == "w2:p2"));
		assert!(listed.iter().any(|session| session.profile_id == "w2"));
		assert!(
			fx.sqlite_session_ids().is_empty()
				|| !fx.sqlite_session_ids().contains(&created.session_id)
		);
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
		assert_eq!(first.session_id, "w1:p2");
		assert_eq!(second.session_id, "w1:p3");
		assert_eq!(fx.fake.tab_create_calls(), 2);
		let expected_cwd = fx.cwd.path().to_string_lossy().into_owned();
		assert_eq!(
			fx.fake.last_tab_create_cwd().as_deref(),
			Some(expected_cwd.as_str())
		);
		assert!(!fx.fake.calls().iter().any(|m| m == "pane.split"));
		assert!(fx.fake.send_input_calls().is_empty());
		assert_ne!(first.session_id, "term_live");
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
		assert_eq!(created.session_id, "w1:p2");
		assert_eq!(fx.fake.tab_create_calls(), 1);
		assert_eq!(
			fx.fake.last_tab_create_cwd().as_deref(),
			Some(config.cwd.as_str())
		);
		assert!(!fx.fake.calls().iter().any(|m| m == "pane.split"));
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
		assert_eq!(created.session_id, "w1:p2");
		assert_eq!(
			fx.fake.send_input_calls(),
			vec![("w1:p2".into(), "echo init\necho start\n".into())]
		);
		assert_eq!(fx.fake.tab_create_calls(), 1);

		let listed = fx.adapter.list_project_sessions("p1").unwrap();
		assert_eq!(listed.len(), 2);
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
	fn create_sends_startup_after_tab_create() {
		let fx = Fixture::new();
		let mut config = fx.config();
		config.startup_commands = vec!["bun dev".into()];
		let created = fx
			.adapter
			.create_session(&Fixture::meta(), &config)
			.unwrap();
		assert_eq!(created.session_id, "w1:p2");
		assert_eq!(fx.fake.tab_create_calls(), 1);
		assert_eq!(
			fx.fake.send_input_calls(),
			vec![("w1:p2".into(), "bun dev\n".into())]
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
		assert_eq!(created.session_id, "w1:p2");
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
			pane_id: "w1:p3".into(),
			tab_id: "w1:t3".into(),
			workspace_id: "w1".into(),
		});
		let creates_before = fx.fake.tab_create_calls();
		let listed = fx.adapter.list_project_sessions("p1").unwrap();
		assert_eq!(listed.len(), 3);
		assert!(listed
			.iter()
			.any(|session| session.id == created.session_id));
		assert!(listed.iter().any(|session| session.id == "w1:p3"));
		assert_eq!(fx.fake.send_input_calls().len(), 1);
		assert_eq!(fx.fake.tab_create_calls(), creates_before);
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
		assert_eq!(created.session_id, "w1:p2");
		assert_eq!(fx.fake.send_input_calls().len(), 1);
		assert_eq!(fx.fake.pane_close_calls(), 0);
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
		assert!(!fx.sqlite_session_ids().contains(&created.session_id));
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
		assert_eq!(extra.session_id, "w1:p3");
		assert_eq!(fx.fake.tab_create_calls(), 2);
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
		assert_eq!(fx.fake.tab_create_calls(), 2);
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
		let listed = fx.adapter.list_project_sessions("p1").unwrap();
		assert!(listed
			.iter()
			.any(|session| session.id == created.session_id));
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
		assert!(router.write(&created.session_id, b"x").is_err());
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
		router.write(&created.session_id, b"x\n").unwrap();
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
			.split("fn list_project_sessions")
			.next()
			.unwrap();
		assert!(!close_session.contains("worktree.remove"));
		assert!(!close_session.contains("worktree_remove"));
		assert!(!create_session.contains("insert_session"));
		assert!(!create_session.contains("bind_session_pane"));
		assert!(!close_session.contains("unbind_session_pane"));
		assert!(!close_session.contains("mark_closed"));
		assert!(
			src.contains("worktree.remove") || src.contains("worktree_remove")
		);
		assert!(!create_session.contains("workspace.create"));
		assert!(!close_session.contains("workspace.close"));
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
		assert!(
			src.contains("workspace_create")
				|| src.contains("workspace.create")
		);
		assert!(
			src.contains("workspace_close") || src.contains("workspace.close")
		);
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
		assert!(!list_sessions.contains("insert_session"));
		assert!(!list_sessions.contains("list_by_project"));
		assert!(!list_sessions.contains("bind_session_pane"));
		assert!(!src.contains("leftover_sqlite_id"));
		assert!(!src.contains("bind_session_pane"));
		assert!(!src.contains("unbind_session_pane"));
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
		assert!(!src.contains("bind_profile_workspace"));
		assert!(!src.contains("unbind_profile_workspace"));
		assert!(!src.contains("replace_profile_workspace"));
		assert!(!src.contains("find_profile_mapping"));
		assert!(!src.contains("find_profile_by_workspace"));
	}

	#[test]
	fn gui_detach_is_not_pane_close() {
		let handler = include_str!("../../../../src/handler/terminal.rs");
		let detach = handler
			.split("pub fn detach_terminal_output")
			.nth(1)
			.unwrap()
			.split("pub fn flush_terminal_output")
			.next()
			.unwrap();
		assert!(!detach.contains("close_session"));
		assert!(!detach.contains("pane.close"));
		assert!(detach.contains("detach_output"));
		let close = handler
			.split("pub fn close_terminal_session")
			.nth(1)
			.unwrap()
			.split("pub async fn list_project_sessions")
			.next()
			.unwrap();
		assert!(close.contains("close_session"));
		assert!(handler.contains("stream_herdr_output"));
		assert!(handler.contains("HerdrTerminalFrame"));
		assert!(handler.contains("get_session_backend"));
		assert!(handler.contains("get_session_agent_status"));
		assert!(handler.contains("stream_session_agent_status"));
		assert!(handler.contains("scroll_terminal"));
		assert!(!handler.contains("stream_pty_output"));
		assert!(!handler.contains("get_pty_session_history"));
		assert!(!handler.contains("restore_pty_session"));
		assert!(!handler.contains("delete_pty_session_record"));
		assert!(!handler.contains("pane.send_text"));
		assert!(!handler.contains("pane.report_agent"));
		assert!(!handler.contains("agent.start"));
		let lib = include_str!("../../../../src/lib.rs");
		assert!(lib.contains("stream_herdr_output"));
		assert!(lib.contains("get_session_backend"));
		assert!(lib.contains("get_session_agent_status"));
		assert!(lib.contains("stream_session_agent_status"));
		assert!(lib.contains("scroll_terminal"));
		assert!(lib.contains("release_attachments"));
		assert!(!lib.contains("server.stop"));
		assert!(!lib.contains("ensure_herdr_listener"));
		assert!(!lib.contains("HerdrRuntimeSync"));
	}

	#[test]
	fn session_backend_ipc_is_herdr_only() {
		let handler = include_str!("../../../../src/handler/terminal.rs");
		let cmd = handler
			.split("pub fn get_session_backend")
			.nth(1)
			.unwrap()
			.split("pub fn get_session_agent_status")
			.next()
			.unwrap();
		assert!(cmd.contains("RuntimeBackend::Herdr"));
		assert!(!cmd.contains("backend_for"));
		assert!(!cmd.contains("selected_backend"));
		assert!(!cmd.contains("discovery"));
		assert!(!cmd.contains("RuntimeRouter::new"));
		let agent = handler
			.split("pub fn get_session_agent_status")
			.nth(1)
			.unwrap()
			.split("pub async fn stream_session_agent_status")
			.next()
			.unwrap();
		assert!(agent.contains("session_agent_status"));
		assert!(!agent.contains("selected_backend"));
		assert!(!agent.contains("discovery"));
		let stream = handler
			.split("pub async fn stream_session_agent_status")
			.nth(1)
			.unwrap()
			.split("pub fn attach_terminal_output")
			.next()
			.unwrap();
		assert!(stream.contains("pump_session_agent_status"));
		assert!(!stream.contains("selected_backend"));
		assert!(!stream.contains("discovery"));
	}

	#[test]
	fn live_workspace_id_is_enough_for_create() {
		let fx = Fixture::new();
		let created = fx
			.adapter
			.create_session(&Fixture::meta(), &fx.config())
			.unwrap();
		assert_eq!(created.session_id, "w1:p2");
		assert_eq!(fx.fake.tab_create_calls(), 1);
		assert!(fx.sqlite_session_ids().is_empty());
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
		assert!(err.to_string().contains("already live"), "{err}");
		assert_eq!(fx.fake.tab_create_calls(), 2);
		assert_eq!(fx.fake.pane_close_calls(), 0);
		assert_eq!(first.session_id, "w1:p2");
		assert!(fx.fake.state.lock().unwrap().panes["w1"].len() >= 2);
	}

	#[test]
	fn create_does_not_write_sqlite_session_or_mapping_rows() {
		let fx = Fixture::new();
		let created = fx
			.adapter
			.create_session(&Fixture::meta(), &fx.config())
			.unwrap();
		assert_eq!(created.session_id, "w1:p2");
		let ids = fx.sqlite_session_ids();
		assert!(ids.is_empty());
		assert!(!ids.contains(&created.session_id));
	}

	#[test]
	fn leftover_sqlite_mapping_does_not_block_or_close_live_root() {
		let fx = Fixture::new();
		let created = fx
			.adapter
			.create_session(&Fixture::meta(), &fx.config())
			.unwrap();
		assert_eq!(created.session_id, "w1:p2");
		assert_eq!(fx.fake.pane_close_calls(), 0);
		let panes = fx.fake.state.lock().unwrap().panes["w1"].clone();
		assert!(panes.iter().any(|pane| pane.pane_id == "w1:p1"));
		assert!(panes.iter().any(|pane| pane.pane_id == "w1:p2"));
	}

	#[test]
	fn last_pane_close_does_not_unbind_leftover_profile_mapping() {
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
		assert!(fx.cwd.path().join("keep").exists());
		fx.adapter.close_session(&first.session_id).unwrap();
		fx.adapter.close_session("w1:p1").unwrap();
		assert!(fx.cwd.path().join("keep").exists());
		assert!(fx.cwd.path().join("keep").exists());
		assert!(!fx.fake.calls().iter().any(|m| {
			m.contains("worktree.remove")
				|| m.contains("worktree.create")
				|| m.contains("worktree.open")
		}));
		assert!(fx.sqlite_session_ids().is_empty());
	}

	#[test]
	fn list_omits_leftover_sqlite_pty_sessions() {
		let fx = Fixture::new();
		let created = fx
			.adapter
			.create_session(&Fixture::meta(), &fx.config())
			.unwrap();
		let listed = fx.adapter.list_project_sessions("p1").unwrap();
		assert!(listed.iter().any(|session| session.id == "w1:p1"));
		assert!(listed
			.iter()
			.any(|session| session.id == created.session_id));
		assert!(listed.iter().all(|session| session.id != "local-only"));
	}

	#[test]
	fn list_reattaches_live_pane_without_restore_or_tab_create() {
		let fx = Fixture::new();
		let listed = fx.adapter.list_project_sessions("p1").unwrap();
		assert_eq!(listed.len(), 1);
		assert_eq!(listed[0].id, "w1:p1");
		assert_eq!(listed[0].profile_id, "w1");
		assert_eq!(fx.fake.tab_create_calls(), 0);
		assert!(!fx.fake.calls().iter().any(|m| m == "tab.create"));
		assert!(!fx.fake.calls().iter().any(|m| m.contains("pane.read")));
		assert!(!fx.fake.calls().iter().any(|m| m.contains("pane.send")));
		assert!(!fx.fake.calls().iter().any(|m| m == "pane.split"));
		assert!(fx
			.adapter
			.restore_session("w1:p1", &Fixture::meta(), &fx.config())
			.is_err());
		assert!(fx.sqlite_session_ids().is_empty());
	}

	#[test]
	fn list_flattens_split_and_extra_tab_panes() {
		let fx = Fixture::new();
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
		assert!(listed.iter().any(|session| session.id == "w1:p1"));
		let extra =
			listed.iter().find(|session| session.id == "w1:p2").unwrap();
		assert_eq!(extra.id, "w1:p2");
		assert_eq!(extra.profile_id, "w1");
		assert_eq!(extra.cwd, fx.cwd.path().to_string_lossy());
		let again = fx.adapter.list_project_sessions("p1").unwrap();
		assert_eq!(again.len(), 2);
		assert_eq!(fx.fake.tab_create_calls(), creates_before);
	}

	#[test]
	fn herdr_reopen_lists_bound_panes_without_local_pty() {
		let fx = Fixture::new();
		let created = fx
			.router()
			.create_session(&Fixture::meta(), &fx.config())
			.unwrap();
		let creates_before = fx.fake.tab_create_calls();
		let router = fx.router();
		assert_eq!(router.selected_backend(), RuntimeBackend::Herdr);
		assert_eq!(
			router.backend_for(&created.session_id).unwrap(),
			RuntimeBackend::Herdr
		);
		let listed = router.list_project_sessions("p1").unwrap();
		assert!(listed
			.iter()
			.any(|session| session.id == created.session_id));
		assert!(listed.iter().any(|session| session.id == "w1:p1"));
		assert_eq!(
			router.owner(&created.session_id).unwrap(),
			Some(RuntimeBackend::Herdr)
		);
		assert_eq!(fx.fake.tab_create_calls(), creates_before);
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
		fx.fake.set_pane_agent(
			&created.session_id,
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
		fx.fake.pane_close(&created.session_id).unwrap();
		assert!(fx
			.adapter
			.session_agent_status(&created.session_id)
			.unwrap()
			.is_none());
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
		assert!(!with_json.has_runtime_sync());
		assert!(!stub.has_runtime_sync());
		let absent = AppError::HerdrServerAbsent("/tmp/missing.sock".into());
		let closed = HerdrStubAdapter::fail_closed(absent);
		assert!(matches!(
			closed
				.create_session(
					&TerminalSessionMeta {
						profile_id: "w1".into(),
						title: "x".into(),
					},
					&TerminalConfig {
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
				&TerminalSessionMeta {
					profile_id: "w1".into(),
					title: "x".into(),
				},
				&TerminalConfig {
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
