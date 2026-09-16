//! Terminal runtime boundary: lifecycle, transport, and discovery.
//!
//! Handlers talk to [`RuntimeRouter`]. The router is Herdr-only: GUI
//! startup always attaches Herdr (`ensure_herdr_listener` + JSON
//! clients). Create/list/close use pane identities; write/resize require
//! an attached CLI helper. Restore reattaches Bound panes. There is no
//! Local adapter, env flag, or portable-pty fallback.

mod herdr;

use std::collections::HashMap;
use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use infra::db::DbPool;
use model::error::AppError;
use model::pty::{PtyConfig, PtySessionMeta, PtySessionRecord, RestoreResult};
use model::runtime::{
	CreateSessionResult, RuntimeBackend, RuntimeDiscovery, SessionAgentStatus,
	SessionIdentity, SessionOwnership,
};

pub use herdr::{
	HerdrCliAttach, HerdrJsonTerminals, HerdrStubAdapter, HerdrTerminalClient,
	HerdrWorktreeClient,
};
pub use infra::herdr::process::{
	HerdrClientGuard, HerdrEndpoint, SESSION_NAME,
};

pub type RuntimeHandle = Arc<RuntimeRouter>;

/// Service-layer interface for terminal process ownership and transport.
///
/// Identity arguments are 2code session IDs. Herdr wire types stay in
/// the Herdr adapter module.
pub trait TerminalRuntime: Send + Sync {
	fn selected_backend(&self) -> RuntimeBackend;

	fn discovery(&self) -> RuntimeDiscovery {
		RuntimeDiscovery {
			selected_backend: self.selected_backend(),
		}
	}

	fn create_session(
		&self,
		meta: &PtySessionMeta,
		config: &PtyConfig,
	) -> Result<CreateSessionResult, AppError>;

	fn restore_session(
		&self,
		old_session_id: &str,
		meta: &PtySessionMeta,
		config: &PtyConfig,
	) -> Result<RestoreResult, AppError>;

	fn close_session(&self, session_id: &str) -> Result<(), AppError>;

	fn list_project_sessions(
		&self,
		project_id: &str,
	) -> Result<Vec<PtySessionRecord>, AppError>;

	fn delete_session(&self, session_id: &str) -> Result<(), AppError>;

	fn write(&self, session_id: &str, data: &[u8]) -> Result<(), AppError>;

	fn resize(
		&self,
		session_id: &str,
		rows: u16,
		cols: u16,
	) -> Result<(), AppError>;

	fn history(&self, session_id: &str) -> Result<Vec<u8>, AppError>;

	fn flush(&self, session_id: &str) -> Result<(), AppError>;

	fn clear(&self, session_id: &str) -> Result<(), AppError>;

	fn scroll(
		&self,
		_session_id: &str,
		_direction: model::runtime::TerminalScrollDirection,
		_lines: u16,
		_source: model::runtime::TerminalScrollSource,
	) -> Result<(), AppError> {
		Ok(())
	}

	fn attach_output(
		&self,
		_session_id: &str,
		_stream_id: &str,
	) -> Result<(), AppError> {
		Ok(())
	}

	fn detach_output(
		&self,
		_session_id: &str,
		_stream_id: &str,
	) -> Result<(), AppError> {
		Ok(())
	}

	fn recv_terminal_frame(
		&self,
		_session_id: &str,
		_stream_id: &str,
	) -> Result<model::runtime::HerdrTerminalFrame, AppError> {
		Err(AppError::PtyError("not a Herdr session".into()))
	}

	fn release_attachments(&self) {}
}

/// Process-wide backend selector. Production default is Herdr.
pub struct RuntimeSelector {
	default_backend: RuntimeBackend,
	ownership: Mutex<HashMap<String, RuntimeBackend>>,
}

impl RuntimeSelector {
	pub fn new(default_backend: RuntimeBackend) -> Self {
		Self {
			default_backend,
			ownership: Mutex::new(HashMap::new()),
		}
	}

	pub fn default_backend(&self) -> RuntimeBackend {
		self.default_backend
	}

	pub fn owner(
		&self,
		session_id: &str,
	) -> Result<Option<RuntimeBackend>, AppError> {
		let map = self.ownership.lock().map_err(|_| AppError::LockError)?;
		Ok(map.get(session_id).copied())
	}

	pub fn backend_for(
		&self,
		session_id: &str,
	) -> Result<RuntimeBackend, AppError> {
		Ok(self.owner(session_id)?.unwrap_or(self.default_backend))
	}

	pub fn bind(
		&self,
		session_id: &str,
		backend: RuntimeBackend,
	) -> Result<(), AppError> {
		let mut map = self.ownership.lock().map_err(|_| AppError::LockError)?;
		match map.get(session_id) {
			Some(existing) if *existing != backend => {
				Err(AppError::PtyError(format!(
					"session {session_id} is owned by {existing}; refusing {backend} ownership"
				)))
			}
			Some(_) => Ok(()),
			None => {
				map.insert(session_id.to_string(), backend);
				Ok(())
			}
		}
	}

	pub fn unbind(&self, session_id: &str) -> Result<(), AppError> {
		let mut map = self.ownership.lock().map_err(|_| AppError::LockError)?;
		map.remove(session_id);
		Ok(())
	}
}

impl Default for RuntimeSelector {
	fn default() -> Self {
		Self::new(RuntimeBackend::Herdr)
	}
}

/// Live Herdr session ids are `workspace_id:pane` (`wN:pK`).
pub(crate) fn is_herdr_pane_id(session_id: &str) -> bool {
	let Some((workspace, pane)) = session_id.split_once(':') else {
		return false;
	};
	let Some(workspace_n) = workspace.strip_prefix('w') else {
		return false;
	};
	let Some(pane_n) = pane.strip_prefix('p') else {
		return false;
	};
	!workspace_n.is_empty()
		&& workspace_n.chars().all(|c| c.is_ascii_digit())
		&& !pane_n.is_empty()
		&& pane_n.chars().all(|c| c.is_ascii_digit())
}

/// GUI backend is always Herdr. There is no Local env or flag.
pub fn select_gui_backend() -> RuntimeBackend {
	RuntimeBackend::Herdr
}

/// Inputs for GUI Herdr attach. Missing sidecar/namespace fails closed.
pub struct GuiHerdrConnect<'a> {
	pub db: DbPool,
	pub guard: &'a HerdrClientGuard,
	pub xdg_config_home: PathBuf,
	pub extra_env: &'a [(OsString, OsString)],
	pub sidecar: Option<PathBuf>,
	pub exe_dir: Option<PathBuf>,
	pub binaries_dir: Option<PathBuf>,
}

/// Routes terminal operations to the Herdr adapter.
pub struct RuntimeRouter {
	selector: RuntimeSelector,
	herdr: HerdrStubAdapter,
}

impl RuntimeRouter {
	/// Production constructor: Herdr is the only runtime.
	pub fn new(herdr: HerdrStubAdapter) -> Self {
		Self {
			selector: RuntimeSelector::new(RuntimeBackend::Herdr),
			herdr,
		}
	}

	pub fn owner(
		&self,
		session_id: &str,
	) -> Result<Option<RuntimeBackend>, AppError> {
		self.selector.owner(session_id)
	}

	pub fn ownership_of(
		&self,
		session_id: &str,
	) -> Result<Option<SessionOwnership>, AppError> {
		Ok(self.owner(session_id)?.map(|backend| SessionOwnership {
			session: SessionIdentity::new(session_id),
			backend,
		}))
	}

	pub fn bind_session(
		&self,
		session_id: &str,
		backend: RuntimeBackend,
	) -> Result<(), AppError> {
		self.selector.bind(session_id, backend)
	}

	pub fn unbind_session(&self, session_id: &str) -> Result<(), AppError> {
		self.selector.unbind(session_id)
	}

	/// Drop GUI ownership of a Herdr session without `pane.close`.
	pub fn release_herdr_session(
		&self,
		session_id: &str,
	) -> Result<(), AppError> {
		self.herdr.release_session(session_id);
		let _ = self.selector.unbind(session_id);
		Ok(())
	}

	pub fn backend_for(
		&self,
		session_id: &str,
	) -> Result<RuntimeBackend, AppError> {
		self.route_backend(session_id)
	}

	/// Owner, else a live Herdr `pane_id`, else Herdr.
	fn route_backend(
		&self,
		session_id: &str,
	) -> Result<RuntimeBackend, AppError> {
		if let Some(owner) = self.selector.owner(session_id)? {
			return Ok(owner);
		}
		if is_herdr_pane_id(session_id) {
			return Ok(RuntimeBackend::Herdr);
		}
		Ok(RuntimeBackend::Herdr)
	}

	fn bind_listed_herdr(
		&self,
		sessions: &[PtySessionRecord],
	) -> Result<(), AppError> {
		for session in sessions {
			if self.selector.owner(&session.id)?.is_none() {
				self.selector.bind(&session.id, RuntimeBackend::Herdr)?;
			}
		}
		Ok(())
	}

	pub fn release_attachments(&self) {
		self.herdr.release_attachments();
	}

	/// Herdr profile create. Missing client is fail-closed.
	pub fn herdr_worktrees(
		&self,
	) -> Result<&dyn HerdrWorktreeClient, AppError> {
		self.herdr.worktrees()
	}

	/// Present only when a worktree client was injected. Does not start
	/// Herdr or call `ensure_herdr_listener`.
	pub fn herdr_worktrees_optional(&self) -> Option<&dyn HerdrWorktreeClient> {
		self.herdr.worktrees().ok()
	}

	pub fn session_agent_status(
		&self,
		session_id: &str,
	) -> Result<Option<SessionAgentStatus>, AppError> {
		self.herdr.session_agent_status(session_id)
	}

	/// Forget a project session: release Herdr attachments without
	/// `pane.close` / `worktree.remove`.
	pub fn forget_project_session(
		&self,
		session_id: &str,
	) -> Result<(), AppError> {
		self.release_herdr_session(session_id)
	}

	/// Close a bound Herdr session.
	pub fn teardown_session(&self, session_id: &str) -> Result<(), AppError> {
		self.herdr.close_session(session_id)?;
		let _ = self.selector.unbind(session_id);
		Ok(())
	}

	fn bind_created(&self, session_id: &str) -> Result<(), AppError> {
		if let Err(err) = self.selector.bind(session_id, RuntimeBackend::Herdr)
		{
			let _ = self.herdr.close_session(session_id);
			return Err(err);
		}
		Ok(())
	}
}

/// Resolve the dedicated 2code Herdr listener. Called from GUI startup.
pub fn ensure_herdr_listener(
	guard: &HerdrClientGuard,
	executable: &Path,
	xdg_config_home: std::path::PathBuf,
	extra_env: &[(OsString, OsString)],
) -> Result<HerdrEndpoint, AppError> {
	let namespace = infra::herdr::process::resolve_namespace(xdg_config_home)?;
	guard
		.ensure(&infra::herdr::process::HerdrProcessEnv {
			executable,
			namespace: &namespace,
			extra_env,
			ready_timeout: Duration::from_secs(10),
			cli_timeout: Duration::from_secs(5),
		})
		.map_err(AppError::from)
}

fn resolve_gui_sidecar(
	opts: &GuiHerdrConnect<'_>,
) -> Result<PathBuf, AppError> {
	if let Some(path) = &opts.sidecar {
		return if path.is_file() {
			Ok(path.clone())
		} else {
			Err(AppError::HerdrServerAbsent(format!(
				"Herdr sidecar not found at {}",
				path.display()
			)))
		};
	}
	let triple = infra::herdr::host_triple()
		.map_err(|err| AppError::HerdrServerIncompatible(err.to_string()))?;
	infra::herdr::try_resolve_sidecar(&infra::herdr::ResolveOptions {
		triple,
		exe_dir: opts.exe_dir.as_deref(),
		binaries_dir: opts.binaries_dir.as_deref(),
	})
	.map_err(|err| AppError::HerdrServerIncompatible(err.to_string()))?
	.ok_or_else(|| {
		AppError::HerdrServerAbsent(format!(
			"Herdr sidecar not found for {triple}"
		))
	})
}

/// Resolve the pinned sidecar, ensure the 2code namespace, inject JSON
/// terminal + worktree + CLI attach clients, and start
/// `HerdrRuntimeSync`.
pub fn connect_gui_herdr(
	opts: GuiHerdrConnect<'_>,
) -> Result<HerdrStubAdapter, AppError> {
	let executable = resolve_gui_sidecar(&opts)?;
	infra::herdr::report_version(&executable)
		.map_err(|err| AppError::HerdrServerIncompatible(err.to_string()))?;
	let namespace =
		infra::herdr::process::resolve_namespace(opts.xdg_config_home)?;
	let endpoint = ensure_herdr_listener(
		opts.guard,
		&executable,
		namespace.xdg_config_home.clone(),
		opts.extra_env,
	)?;
	let client = infra::herdr::transport::HerdrClient::connect(&endpoint)
		.map_err(AppError::from)?;
	let json = Arc::new(HerdrJsonTerminals::new(client));
	let db = opts.db.clone();
	let mut adapter = HerdrStubAdapter::with_json_clients(
		opts.db,
		json,
		HerdrCliAttach {
			executable,
			namespace,
			extra_env: opts.extra_env.to_vec(),
		},
	);
	if let Err(err) = adapter.attach_runtime_sync(&endpoint) {
		tracing::warn!(
			target: "herdr",
			"HerdrRuntimeSync failed: {err}"
		);
	}
	adopt_after_gui_herdr_connect(&adapter, &db);
	Ok(adapter)
}

fn adopt_after_gui_herdr_connect(adapter: &HerdrStubAdapter, db: &DbPool) {
	if let Err(err) = crate::project::adopt_existing_checkouts_with(
		adapter.worktrees().ok(),
		db,
	) {
		tracing::warn!(
			target: "herdr",
			"adopt existing checkouts failed: {err}"
		);
	}
}

/// Herdr stays selected even when sidecar/namespace attach fails.
pub fn build_gui_herdr_adapter(opts: GuiHerdrConnect<'_>) -> HerdrStubAdapter {
	match connect_gui_herdr(opts) {
		Ok(adapter) => adapter,
		Err(err) => {
			tracing::error!(
				target: "herdr",
				"Herdr default runtime failed closed: {err}"
			);
			HerdrStubAdapter::fail_closed(err)
		}
	}
}

/// GUI production runtime. Always Herdr; fail-closed if sidecar/namespace
/// is absent.
pub fn build_gui_runtime(
	db: DbPool,
	guard: &HerdrClientGuard,
	xdg_config_home: PathBuf,
) -> RuntimeRouter {
	let db_for_adopt = db.clone();
	let herdr = build_gui_herdr_adapter(GuiHerdrConnect {
		db,
		guard,
		xdg_config_home,
		extra_env: &[],
		sidecar: None,
		exe_dir: None,
		binaries_dir: None,
	});
	let runtime = RuntimeRouter::new(herdr);
	if let Err(err) =
		crate::project::adopt_existing_checkouts(&runtime, &db_for_adopt)
	{
		tracing::warn!(
			target: "herdr",
			"adopt existing checkouts failed: {err}"
		);
	}
	runtime
}

/// GUI exit: drop client helpers only. Does not stop the Herdr server.
pub fn release_herdr_client_helpers(guard: &HerdrClientGuard) {
	guard.release_client_helpers();
}

impl TerminalRuntime for RuntimeRouter {
	fn selected_backend(&self) -> RuntimeBackend {
		RuntimeBackend::Herdr
	}

	fn create_session(
		&self,
		meta: &PtySessionMeta,
		config: &PtyConfig,
	) -> Result<CreateSessionResult, AppError> {
		let created = self.herdr.create_session(meta, config)?;
		self.bind_created(&created.session_id)?;
		Ok(created)
	}

	fn restore_session(
		&self,
		old_session_id: &str,
		meta: &PtySessionMeta,
		config: &PtyConfig,
	) -> Result<RestoreResult, AppError> {
		self.herdr.restore_session(old_session_id, meta, config)
	}

	fn close_session(&self, session_id: &str) -> Result<(), AppError> {
		self.herdr.close_session(session_id)?;
		let _ = self.selector.unbind(session_id);
		Ok(())
	}

	fn list_project_sessions(
		&self,
		project_id: &str,
	) -> Result<Vec<PtySessionRecord>, AppError> {
		let listed = self.herdr.list_project_sessions(project_id)?;
		self.bind_listed_herdr(&listed)?;
		Ok(listed)
	}

	fn delete_session(&self, session_id: &str) -> Result<(), AppError> {
		self.herdr.delete_session(session_id)?;
		let _ = self.selector.unbind(session_id);
		Ok(())
	}

	fn write(&self, session_id: &str, data: &[u8]) -> Result<(), AppError> {
		self.herdr.write(session_id, data)
	}

	fn resize(
		&self,
		session_id: &str,
		rows: u16,
		cols: u16,
	) -> Result<(), AppError> {
		self.herdr.resize(session_id, rows, cols)
	}

	fn history(&self, session_id: &str) -> Result<Vec<u8>, AppError> {
		self.herdr.history(session_id)
	}

	fn flush(&self, session_id: &str) -> Result<(), AppError> {
		self.herdr.flush(session_id)
	}

	fn clear(&self, session_id: &str) -> Result<(), AppError> {
		self.herdr.clear(session_id)
	}

	fn scroll(
		&self,
		session_id: &str,
		direction: model::runtime::TerminalScrollDirection,
		lines: u16,
		source: model::runtime::TerminalScrollSource,
	) -> Result<(), AppError> {
		self.herdr.scroll(session_id, direction, lines, source)
	}

	fn attach_output(
		&self,
		session_id: &str,
		stream_id: &str,
	) -> Result<(), AppError> {
		self.herdr.attach_output(session_id, stream_id)
	}

	fn detach_output(
		&self,
		session_id: &str,
		stream_id: &str,
	) -> Result<(), AppError> {
		self.herdr.detach_output(session_id, stream_id)
	}

	fn recv_terminal_frame(
		&self,
		session_id: &str,
		stream_id: &str,
	) -> Result<model::runtime::HerdrTerminalFrame, AppError> {
		self.herdr.recv_terminal_frame(session_id, stream_id)
	}

	fn release_attachments(&self) {
		RuntimeRouter::release_attachments(self);
	}
}

#[cfg(test)]
mod tests {
	use std::path::{Path, PathBuf};
	use std::sync::Arc;

	use diesel::prelude::*;
	use diesel_migrations::MigrationHarness;
	use infra::db::DbPool;
	use model::pty::{PtyConfig, PtySessionMeta};

	use super::*;

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

	fn insert_project(db: &DbPool, folder: &str) {
		let mut conn = db.lock().unwrap();
		diesel::sql_query(format!(
			"INSERT INTO projects (id, name, folder, created_at) VALUES ('p1', 'Test', '{folder}', datetime('now'))"
		))
		.execute(&mut *conn)
		.unwrap();
	}

	fn test_shell() -> String {
		if cfg!(windows) {
			"powershell.exe -NoLogo -NoProfile -NonInteractive".to_string()
		} else {
			"/bin/sh".to_string()
		}
	}

	fn meta() -> PtySessionMeta {
		PtySessionMeta {
			profile_id: "w1".to_string(),
			title: "test".to_string(),
		}
	}

	fn config(cwd: &Path) -> PtyConfig {
		PtyConfig {
			shell: test_shell(),
			cwd: cwd.to_string_lossy().into_owned(),
			rows: 24,
			cols: 80,
			startup_commands: Vec::new(),
		}
	}

	fn dir_names(path: &Path) -> Vec<String> {
		let mut names: Vec<String> = std::fs::read_dir(path)
			.unwrap()
			.filter_map(|entry| {
				entry
					.ok()
					.map(|e| e.file_name().to_string_lossy().into_owned())
			})
			.collect();
		names.sort();
		names
	}

	fn gui_connect<'a>(
		db: DbPool,
		guard: &'a HerdrClientGuard,
		xdg: PathBuf,
		sidecar: Option<PathBuf>,
	) -> GuiHerdrConnect<'a> {
		let empty = xdg.join("empty-bins");
		std::fs::create_dir_all(&empty).unwrap();
		GuiHerdrConnect {
			db,
			guard,
			xdg_config_home: xdg,
			extra_env: &[],
			sidecar,
			exe_dir: Some(empty.clone()),
			binaries_dir: Some(empty),
		}
	}

	#[test]
	fn selector_defaults_to_herdr() {
		let selector = RuntimeSelector::default();
		assert_eq!(selector.default_backend(), RuntimeBackend::Herdr);
	}

	#[test]
	fn selector_backend_for_unbound_uses_herdr() {
		assert_eq!(
			RuntimeSelector::default().backend_for("unknown").unwrap(),
			RuntimeBackend::Herdr
		);
	}

	#[test]
	fn herdr_pane_id_shape_is_not_a_sqlite_uuid() {
		assert!(is_herdr_pane_id("w1:p1"));
		assert!(is_herdr_pane_id("w12:p10"));
		assert!(!is_herdr_pane_id("pr1"));
		assert!(!is_herdr_pane_id("w1"));
		assert!(!is_herdr_pane_id("w1:t1"));
		assert!(!is_herdr_pane_id("sess-1"));
	}

	#[test]
	fn router_production_constructor_selects_herdr() {
		let cwd = tempfile::tempdir().unwrap();
		let router = RuntimeRouter::new(HerdrStubAdapter::new());
		assert_eq!(router.selected_backend(), RuntimeBackend::Herdr);
		assert_eq!(router.discovery().selected_backend, RuntimeBackend::Herdr);
		let err = router
			.create_session(&meta(), &config(cwd.path()))
			.unwrap_err();
		assert!(
			err.to_string().contains("Herdr runtime is not available"),
			"{err}"
		);
	}

	#[test]
	fn select_gui_backend_is_always_herdr() {
		assert_eq!(select_gui_backend(), RuntimeBackend::Herdr);
	}

	#[test]
	fn missing_sidecar_fails_closed_absent_without_local_pty() {
		let cwd = tempfile::tempdir().unwrap();
		let db = setup_db();
		insert_project(&db, &cwd.path().to_string_lossy());
		let guard = HerdrClientGuard::new();
		let err = match connect_gui_herdr(gui_connect(
			db.clone(),
			&guard,
			cwd.path().join("xdg"),
			Some(cwd.path().join("missing-herdr")),
		)) {
			Ok(_) => panic!("missing sidecar must fail closed"),
			Err(err) => err,
		};
		assert!(matches!(err, AppError::HerdrServerAbsent(_)), "{err}");
		assert!(err.to_string().contains("sidecar not found"), "{err}");

		let router = RuntimeRouter::new(build_gui_herdr_adapter(gui_connect(
			setup_db(),
			&guard,
			cwd.path().join("xdg-2"),
			Some(cwd.path().join("missing-herdr")),
		)));
		assert_eq!(router.selected_backend(), RuntimeBackend::Herdr);
		let created = router.create_session(&meta(), &config(cwd.path()));
		assert!(
			matches!(created, Err(AppError::HerdrServerAbsent(_))),
			"{created:?}"
		);
	}

	#[test]
	fn incompatible_sidecar_fails_closed_without_flipping() {
		let cwd = tempfile::tempdir().unwrap();
		let fake = cwd.path().join("not-herdr");
		std::fs::write(&fake, "#!/bin/sh\necho not-herdr\n").unwrap();
		#[cfg(unix)]
		{
			use std::os::unix::fs::PermissionsExt;
			std::fs::set_permissions(
				&fake,
				std::fs::Permissions::from_mode(0o755),
			)
			.unwrap();
		}
		let db = setup_db();
		let guard = HerdrClientGuard::new();
		let err = match connect_gui_herdr(gui_connect(
			db,
			&guard,
			cwd.path().join("xdg"),
			Some(fake),
		)) {
			Ok(_) => panic!("incompatible sidecar must fail closed"),
			Err(err) => err,
		};
		assert!(matches!(err, AppError::HerdrServerIncompatible(_)), "{err}");
	}

	#[test]
	fn herdr_gui_startup_wires_sidecar_without_local_fallback() {
		let runtime = include_str!("runtime.rs");
		let production = runtime.split("#[cfg(test)]").next().unwrap();
		let connect = production
			.split("pub fn connect_gui_herdr")
			.nth(1)
			.unwrap()
			.split("pub fn build_gui_herdr_adapter")
			.next()
			.unwrap();
		assert!(connect.contains("ensure_herdr_listener"));
		assert!(
			connect.contains("try_resolve_sidecar")
				|| connect.contains("resolve_gui_sidecar")
		);
		assert!(connect.contains("report_version"));
		assert!(connect.contains("HerdrJsonTerminals"));
		assert!(connect.contains("HerdrCliAttach"));
		assert!(connect.contains("resolve_namespace"));
		assert!(!connect.contains("import_leftover_sqlite_profiles"));
		assert!(connect.contains("attach_runtime_sync"));
		assert!(connect.contains("adopt_existing_checkouts"));
		assert!(connect.contains("adopt_after_gui_herdr_connect"));
		let attach = connect.find("attach_runtime_sync").unwrap();
		let adopt = connect.find("adopt_after_gui_herdr_connect").unwrap();
		assert!(
			adopt > attach,
			"connect-time adopt runs after successful GUI Herdr attach"
		);
		let build = production
			.split("pub fn build_gui_runtime")
			.nth(1)
			.unwrap()
			.split("pub fn release_herdr_client_helpers")
			.next()
			.unwrap();
		assert!(build.contains("adopt_existing_checkouts"));
		assert!(!production.contains("TWOCODE_RUNTIME"));
		assert!(!production.contains("--twocode-runtime=local"));
		assert!(!production.contains("LocalAdapter"));
		assert!(!production.contains("mod local"));
		assert!(!production.contains("RuntimeBackend::Local"));
		let bridge = include_str!("../../../src/bridge.rs");
		assert!(bridge.contains("build_gui_runtime"));
		assert!(!bridge.contains("TWOCODE_RUNTIME"));
		assert!(!bridge.contains("LocalAdapter"));
		let lib = include_str!("../../../src/lib.rs");
		assert!(!lib.contains("HerdrRuntimeSync"));
		assert!(!lib.contains("events.subscribe"));
		assert!(!lib.contains("TWOCODE_RUNTIME"));
	}

	#[test]
	fn connect_gui_herdr_adopts_existing_checkouts() {
		let runtime = include_str!("runtime.rs");
		let production = runtime.split("#[cfg(test)]").next().unwrap();
		let connect = production
			.split("pub fn connect_gui_herdr")
			.nth(1)
			.unwrap()
			.split("pub fn build_gui_herdr_adapter")
			.next()
			.unwrap();
		assert!(connect.contains("adopt_after_gui_herdr_connect"));
		assert!(connect.contains("adopt_existing_checkouts"));
		let attach = connect.find("attach_runtime_sync").unwrap();
		let adopt = connect.find("adopt_after_gui_herdr_connect").unwrap();
		assert!(
			adopt > attach,
			"connect-time adopt runs after successful GUI Herdr attach"
		);
		let build = production
			.split("pub fn build_gui_runtime")
			.nth(1)
			.unwrap()
			.split("pub fn release_herdr_client_helpers")
			.next()
			.unwrap();
		assert!(build.contains("adopt_existing_checkouts"));
		assert!(!production.contains("import_leftover_sqlite_profiles"));
		let lib = include_str!("../../../src/lib.rs");
		assert!(!lib.contains("adopt_existing_checkouts"));
		assert!(!lib.contains("HerdrRuntimeSync"));
		assert!(!lib.contains("events.subscribe"));
	}

	#[test]
	fn herdr_stub_create_does_not_spawn_local_pty_or_mutate_worktree() {
		let cwd = tempfile::tempdir().unwrap();
		insert_project(&setup_db(), &cwd.path().to_string_lossy());
		std::fs::write(cwd.path().join("marker"), b"keep").unwrap();
		let _ = std::process::Command::new("git")
			.args(["init"])
			.current_dir(cwd.path())
			.output();
		let worktrees_before = String::from_utf8_lossy(
			&std::process::Command::new("git")
				.args(["worktree", "list", "--porcelain"])
				.current_dir(cwd.path())
				.output()
				.unwrap()
				.stdout,
		)
		.into_owned();
		let marker_before = std::fs::read(cwd.path().join("marker")).unwrap();
		let entries_before = dir_names(cwd.path());
		let router = RuntimeRouter::new(HerdrStubAdapter::new());
		assert_eq!(router.selected_backend(), RuntimeBackend::Herdr);
		let err = router
			.create_session(&meta(), &config(cwd.path()))
			.unwrap_err();
		assert!(err.to_string().contains("Herdr runtime is not available"));
		assert!(router.list_project_sessions("p1").is_err());
		assert_eq!(
			std::fs::read(cwd.path().join("marker")).unwrap(),
			marker_before
		);
		assert_eq!(
			String::from_utf8_lossy(
				&std::process::Command::new("git")
					.args(["worktree", "list", "--porcelain"])
					.current_dir(cwd.path())
					.output()
					.unwrap()
					.stdout
			)
			.into_owned(),
			worktrees_before
		);
		assert_eq!(dir_names(cwd.path()), entries_before);
		assert!(router.herdr.recorded_ops().contains(&"create"));
	}

	#[test]
	fn herdr_write_for_unbound_identity_does_not_spawn_local_pty() {
		let router = RuntimeRouter::new(HerdrStubAdapter::new());
		let err = router.write("sess-foreign", b"x").unwrap_err();
		assert!(err.to_string().contains("Herdr runtime is not available"));
	}

	#[test]
	fn herdr_pane_id_is_not_restored_as_local() {
		let cwd = tempfile::tempdir().unwrap();
		let router = RuntimeRouter::new(HerdrStubAdapter::new());
		assert_eq!(router.backend_for("w1:p1").unwrap(), RuntimeBackend::Herdr);
		assert_eq!(router.owner("w1:p1").unwrap(), None);
		let err = router
			.restore_session("w1:p1", &meta(), &config(cwd.path()))
			.map(|_| ())
			.unwrap_err();
		assert!(
			err.to_string().contains("Herdr runtime is not available"),
			"{err}"
		);
		assert!(router.herdr.recorded_ops().contains(&"restore"));
	}

	#[test]
	fn herdr_errors_stay_distinct() {
		assert_eq!(SESSION_NAME, "2code");
		assert_ne!(SESSION_NAME, "default");
		let guard = HerdrClientGuard::new();
		release_herdr_client_helpers(&guard);
		let absent =
			AppError::from(infra::herdr::process::HerdrProcessError::Absent {
				socket: PathBuf::from("/tmp/2code.sock"),
			});
		let incompatible = AppError::from(
			infra::herdr::process::HerdrProcessError::Incompatible {
				message: "protocol 1".into(),
				socket: PathBuf::from("/tmp/2code.sock"),
			},
		);
		assert!(absent.to_string().contains("absent"));
		assert!(incompatible.to_string().contains("incompatible"));
		assert!(!absent.to_string().contains("incompatible"));
		assert!(!incompatible.to_string().contains("absent"));
	}

	#[test]
	fn gui_exit_drops_herdr_helpers_without_stopping_the_server() {
		let lib = include_str!("../../../src/lib.rs");
		assert!(
			lib.contains("release_herdr_client_helpers"),
			"GUI exit must drop Herdr client helpers"
		);
		assert!(
			!lib.contains("server stop"),
			"GUI exit must not stop the Herdr server"
		);
		assert!(
			!lib.contains("ensure_herdr_listener"),
			"lib.rs setup delegates ensure to the runtime builder"
		);
		assert!(
			!lib.contains("HerdrClient::connect"),
			"lib.rs must not open a Herdr NDJSON client"
		);
		assert!(
			!lib.contains("runtime_sync"),
			"GUI setup must not start Herdr snapshot sync"
		);
		assert!(
			!lib.contains("herdr_runtime_sync"),
			"GUI setup must not construct a Herdr runtime sync"
		);
		assert!(
			!lib.contains("HerdrRuntimeSync"),
			"GUI setup must not start HerdrRuntimeSync"
		);
		assert!(
			!lib.contains("events.subscribe"),
			"GUI setup must not subscribe to Herdr events"
		);
		assert!(
			!lib.contains("adopt_existing_profiles"),
			"launch/adopt stays out of lib.rs setup"
		);
		assert!(
			!lib.contains("adopt_existing_checkouts"),
			"launch/adopt stays out of lib.rs setup"
		);
		assert!(
			!lib.contains("import_leftover_sqlite_profiles"),
			"leftover extra import is gone"
		);
		assert!(
			!lib.contains("runtime_adoption"),
			"GUI setup must not call runtime_adoption from lib.rs"
		);
		assert!(
			!lib.contains("LocalAdapter"),
			"lib.rs must not construct a Local adapter"
		);
	}

	#[test]
	fn production_source_has_no_local_pty_runtime() {
		let runtime = include_str!("runtime.rs");
		let production = runtime.split("#[cfg(test)]").next().unwrap();
		assert!(!production.contains("LocalAdapter"));
		assert!(!production.contains("TWOCODE_RUNTIME"));
		assert!(!production.contains("--twocode-runtime"));
		assert!(!production.contains("native_pty_system"));
		assert!(!production.contains("INSERT INTO pty_sessions"));
		let local_path =
			Path::new(env!("CARGO_MANIFEST_DIR")).join("src/runtime/local.rs");
		assert!(!local_path.exists(), "LocalAdapter module must be deleted");
	}
}
