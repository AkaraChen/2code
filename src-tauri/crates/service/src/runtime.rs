//! Terminal runtime boundary: lifecycle, transport, and discovery.
//!
//! Handlers talk to [`RuntimeRouter`]. The Local adapter wraps the current
//! PTY implementation. Herdr create/list/close use pane identities when a
//! client is injected; write/resize/restore stay fail-closed. Herdr is
//! never the default.

mod herdr;
mod local;

use std::collections::HashMap;
use std::ffi::OsString;
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use model::error::AppError;
use model::pty::{PtyConfig, PtySessionMeta, PtySessionRecord, RestoreResult};
use model::runtime::{
	CreateSessionResult, RuntimeBackend, RuntimeDiscovery, SessionIdentity,
	SessionOwnership,
};

pub use herdr::{HerdrJsonTerminals, HerdrStubAdapter, HerdrTerminalClient};
pub use infra::herdr::process::{
	HerdrClientGuard, HerdrEndpoint, SESSION_NAME,
};
pub use local::LocalAdapter;

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
}

/// Process-wide backend selector. Production default is Local.
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
		Self::new(RuntimeBackend::Local)
	}
}

/// Routes terminal operations to exactly one backend per session identity.
pub struct RuntimeRouter {
	selector: RuntimeSelector,
	local: LocalAdapter,
	herdr: HerdrStubAdapter,
}

impl RuntimeRouter {
	/// Production constructor: Local is the default runtime.
	pub fn new(local: LocalAdapter, herdr: HerdrStubAdapter) -> Self {
		Self::with_backend(RuntimeBackend::Local, local, herdr)
	}

	pub fn with_backend(
		default_backend: RuntimeBackend,
		local: LocalAdapter,
		herdr: HerdrStubAdapter,
	) -> Self {
		Self {
			selector: RuntimeSelector::new(default_backend),
			local,
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

	/// Terminate a bound session on its owner. Unbound live Local PTYs
	/// and Herdr-owned Local PTYs are refused (#403).
	pub fn teardown_session(&self, session_id: &str) -> Result<(), AppError> {
		match self.selector.owner(session_id)? {
			Some(RuntimeBackend::Local) => {
				self.local.teardown_session(session_id)?;
			}
			Some(RuntimeBackend::Herdr) => {
				if self.local.has_live_session(session_id) {
					return Err(AppError::PtyError(format!(
						"refusing to kill a Local PTY for Herdr-owned session {session_id}"
					)));
				}
				self.herdr.close_session(session_id)?;
			}
			None => {
				if self.local.has_live_session(session_id) {
					return Err(AppError::PtyError(format!(
						"refusing to kill a Local PTY for unbound session {session_id}"
					)));
				}
			}
		}
		let _ = self.selector.unbind(session_id);
		Ok(())
	}

	fn adapter(&self, backend: RuntimeBackend) -> &dyn TerminalRuntime {
		match backend {
			RuntimeBackend::Local => &self.local,
			RuntimeBackend::Herdr => &self.herdr,
		}
	}

	fn bind_created(
		&self,
		session_id: &str,
		backend: RuntimeBackend,
	) -> Result<(), AppError> {
		if let Err(err) = self.selector.bind(session_id, backend) {
			let _ = self.adapter(backend).close_session(session_id);
			return Err(err);
		}
		Ok(())
	}
}

/// Resolve the dedicated 2code Herdr listener. Never called from the
/// Local default startup path.
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

/// GUI exit: drop client helpers only. Does not stop the Herdr server.
pub fn release_herdr_client_helpers(guard: &HerdrClientGuard) {
	guard.release_client_helpers();
}

impl TerminalRuntime for RuntimeRouter {
	fn selected_backend(&self) -> RuntimeBackend {
		self.selector.default_backend()
	}

	fn create_session(
		&self,
		meta: &PtySessionMeta,
		config: &PtyConfig,
	) -> Result<CreateSessionResult, AppError> {
		let backend = self.selector.default_backend();
		let created = self.adapter(backend).create_session(meta, config)?;
		self.bind_created(&created.session_id, backend)?;
		Ok(created)
	}

	fn restore_session(
		&self,
		old_session_id: &str,
		meta: &PtySessionMeta,
		config: &PtyConfig,
	) -> Result<RestoreResult, AppError> {
		let backend = self.selector.backend_for(old_session_id)?;
		let restored = self.adapter(backend).restore_session(
			old_session_id,
			meta,
			config,
		)?;
		let _ = self.selector.unbind(old_session_id);
		if let Err(err) = self.selector.bind(&restored.new_session_id, backend)
		{
			let _ = self
				.adapter(backend)
				.close_session(&restored.new_session_id);
			return Err(err);
		}
		Ok(restored)
	}

	fn close_session(&self, session_id: &str) -> Result<(), AppError> {
		let backend = self.selector.backend_for(session_id)?;
		self.adapter(backend).close_session(session_id)
	}

	fn list_project_sessions(
		&self,
		project_id: &str,
	) -> Result<Vec<PtySessionRecord>, AppError> {
		let backend = self.selector.default_backend();
		self.adapter(backend).list_project_sessions(project_id)
	}

	fn delete_session(&self, session_id: &str) -> Result<(), AppError> {
		let backend = self.selector.backend_for(session_id)?;
		self.adapter(backend).delete_session(session_id)?;
		let _ = self.selector.unbind(session_id);
		Ok(())
	}

	fn write(&self, session_id: &str, data: &[u8]) -> Result<(), AppError> {
		let backend = self.selector.backend_for(session_id)?;
		self.adapter(backend).write(session_id, data)
	}

	fn resize(
		&self,
		session_id: &str,
		rows: u16,
		cols: u16,
	) -> Result<(), AppError> {
		let backend = self.selector.backend_for(session_id)?;
		self.adapter(backend).resize(session_id, rows, cols)
	}

	fn history(&self, session_id: &str) -> Result<Vec<u8>, AppError> {
		let backend = self.selector.backend_for(session_id)?;
		self.adapter(backend).history(session_id)
	}

	fn flush(&self, session_id: &str) -> Result<(), AppError> {
		let backend = self.selector.backend_for(session_id)?;
		self.adapter(backend).flush(session_id)
	}

	fn clear(&self, session_id: &str) -> Result<(), AppError> {
		let backend = self.selector.backend_for(session_id)?;
		self.adapter(backend).clear(session_id)
	}
}

#[cfg(test)]
mod tests {
	use std::path::{Path, PathBuf};
	use std::sync::Arc;
	use std::time::Duration;

	use diesel::prelude::*;
	use diesel_migrations::MigrationHarness;
	use infra::db::DbPool;
	use infra::pty::{PtyReadThreads, PtySessionMap};
	use model::pty::{PtyConfig, PtySessionMeta};

	use super::*;
	use crate::pty::{create_flush_senders, PtyContext};
	use crate::PtyEventEmitter;

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

	fn insert_project_and_profile(db: &DbPool, folder: &str) {
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
	}

	fn test_shell() -> String {
		if cfg!(windows) {
			"powershell.exe -NoLogo -NoProfile -NonInteractive".to_string()
		} else {
			"/bin/sh".to_string()
		}
	}

	struct Fixture {
		router: RuntimeRouter,
		sessions: PtySessionMap,
		read_threads: PtyReadThreads,
		cwd: tempfile::TempDir,
		_logs: PathBuf,
	}

	impl Fixture {
		fn new(default_backend: RuntimeBackend) -> Self {
			let cwd = tempfile::tempdir().unwrap();
			let folder = cwd.path().to_string_lossy().replace('\'', "");
			let db = setup_db();
			insert_project_and_profile(&db, &folder);
			let sessions = infra::pty::create_session_map();
			let read_threads = infra::pty::create_thread_tracker();
			let logs = cwd.path().join("pty-logs");
			std::fs::create_dir_all(&logs).unwrap();
			let ctx = PtyContext {
				db,
				sessions: sessions.clone(),
				flush_senders: create_flush_senders(),
				read_threads: read_threads.clone(),
				emitter: Arc::new(TestEmitter),
				output_dir: logs.clone(),
			};
			let router = RuntimeRouter::with_backend(
				default_backend,
				LocalAdapter::new(ctx),
				HerdrStubAdapter::new(),
			);
			Self {
				router,
				sessions,
				read_threads,
				cwd,
				_logs: logs,
			}
		}

		fn live_count(&self) -> usize {
			self.sessions.lock().unwrap().len()
		}

		fn meta() -> PtySessionMeta {
			PtySessionMeta {
				profile_id: "pr1".to_string(),
				title: "test".to_string(),
			}
		}

		fn config(&self) -> PtyConfig {
			PtyConfig {
				shell: test_shell(),
				cwd: self.cwd.path().to_string_lossy().into_owned(),
				rows: 24,
				cols: 80,
				startup_commands: Vec::new(),
			}
		}

		fn git_worktree_list(&self) -> String {
			let output = std::process::Command::new("git")
				.args(["worktree", "list", "--porcelain"])
				.current_dir(self.cwd.path())
				.output()
				.expect("git worktree list");
			String::from_utf8_lossy(&output.stdout).into_owned()
		}

		fn init_git_repo(&self) {
			let _ = std::process::Command::new("git")
				.args(["init"])
				.current_dir(self.cwd.path())
				.output();
			std::fs::write(self.cwd.path().join("marker"), b"keep").unwrap();
		}
	}

	impl Drop for Fixture {
		fn drop(&mut self) {
			infra::pty::close_all_sessions(&self.sessions);
			infra::pty::join_all_read_threads(&self.read_threads);
		}
	}

	#[test]
	fn selector_defaults_to_local() {
		let selector = RuntimeSelector::default();
		assert_eq!(selector.default_backend(), RuntimeBackend::Local);
		assert_ne!(selector.default_backend(), RuntimeBackend::Herdr);
	}

	#[test]
	fn selector_rejects_dual_backend_ownership() {
		let selector = RuntimeSelector::default();
		selector.bind("sess-1", RuntimeBackend::Local).unwrap();
		let err = selector.bind("sess-1", RuntimeBackend::Herdr).unwrap_err();
		assert!(err.to_string().contains("owned by local"));
		assert!(err.to_string().contains("herdr"));
		assert_eq!(
			selector.owner("sess-1").unwrap(),
			Some(RuntimeBackend::Local)
		);
	}

	#[test]
	fn selector_backend_for_unbound_uses_default() {
		let herdr = RuntimeSelector::new(RuntimeBackend::Herdr);
		assert_eq!(
			herdr.backend_for("unknown").unwrap(),
			RuntimeBackend::Herdr
		);
		let local = RuntimeSelector::default();
		assert_eq!(
			local.backend_for("unknown").unwrap(),
			RuntimeBackend::Local
		);
	}

	#[test]
	fn router_production_constructor_selects_local() {
		let cwd = tempfile::tempdir().unwrap();
		let router = RuntimeRouter::new(
			LocalAdapter::new(PtyContext {
				db: setup_db(),
				sessions: infra::pty::create_session_map(),
				flush_senders: create_flush_senders(),
				read_threads: infra::pty::create_thread_tracker(),
				emitter: Arc::new(TestEmitter),
				output_dir: cwd.path().to_path_buf(),
			}),
			HerdrStubAdapter::new(),
		);
		assert_eq!(router.selected_backend(), RuntimeBackend::Local);
		assert_eq!(router.discovery().selected_backend, RuntimeBackend::Local);
		assert_ne!(router.selected_backend(), RuntimeBackend::Herdr);
	}

	#[test]
	fn default_router_uses_local() {
		let fx = Fixture::new(RuntimeBackend::Local);
		assert_eq!(fx.router.selected_backend(), RuntimeBackend::Local);
		assert_eq!(
			fx.router.discovery().selected_backend,
			RuntimeBackend::Local
		);
	}

	#[test]
	fn local_create_write_resize_close_behave_as_today() {
		let fx = Fixture::new(RuntimeBackend::Local);
		let created = fx
			.router
			.create_session(&Fixture::meta(), &fx.config())
			.unwrap();
		let id = &created.session_id;
		assert!(!id.is_empty());
		assert_eq!(fx.live_count(), 1);
		assert_eq!(fx.router.owner(id).unwrap(), Some(RuntimeBackend::Local));
		assert_eq!(
			fx.router.ownership_of(id).unwrap().unwrap().backend,
			RuntimeBackend::Local
		);

		fx.router.write(id, b"echo ok\n").unwrap();
		fx.router.resize(id, 30, 100).unwrap();

		let listed = fx.router.list_project_sessions("p1").unwrap();
		let record = listed.iter().find(|s| s.id == *id).unwrap();
		assert_eq!(record.cols, 100);
		assert_eq!(record.rows, 30);

		fx.router.close_session(id).unwrap();
		assert!(!fx.sessions.lock().unwrap().contains_key(id));
	}

	#[test]
	fn herdr_stub_selection_does_not_spawn_local_pty_or_mutate_worktree() {
		let fx = Fixture::new(RuntimeBackend::Herdr);
		fx.init_git_repo();
		let marker_before =
			std::fs::read(fx.cwd.path().join("marker")).unwrap();
		let worktrees_before = fx.git_worktree_list();
		let entries_before = dir_names(fx.cwd.path());

		assert_eq!(fx.router.selected_backend(), RuntimeBackend::Herdr);
		let err = fx
			.router
			.create_session(&Fixture::meta(), &fx.config())
			.unwrap_err();
		assert!(err.to_string().contains("Herdr runtime is not available"));

		assert_eq!(fx.live_count(), 0);
		assert!(fx.router.list_project_sessions("p1").is_err());
		assert_eq!(
			session_row_count(&fx),
			0,
			"Herdr stub must not insert a local session row"
		);
		assert_eq!(
			std::fs::read(fx.cwd.path().join("marker")).unwrap(),
			marker_before
		);
		assert_eq!(fx.git_worktree_list(), worktrees_before);
		assert_eq!(dir_names(fx.cwd.path()), entries_before);
		assert!(fx.router.herdr.recorded_ops().contains(&"create"));
	}

	#[test]
	fn local_session_is_not_handed_to_herdr() {
		let fx = Fixture::new(RuntimeBackend::Local);
		let created = fx
			.router
			.create_session(&Fixture::meta(), &fx.config())
			.unwrap();
		let id = created.session_id;

		let err = fx
			.router
			.selector
			.bind(&id, RuntimeBackend::Herdr)
			.unwrap_err();
		assert!(err.to_string().contains("owned by local"));

		fx.router.write(&id, b"echo still-local\n").unwrap();
		fx.router.resize(&id, 24, 80).unwrap();
		assert!(fx.router.herdr.recorded_ops().is_empty());
		assert_eq!(fx.router.owner(&id).unwrap(), Some(RuntimeBackend::Local));
		assert_eq!(fx.live_count(), 1);
	}

	#[test]
	fn herdr_write_for_unbound_identity_does_not_spawn_local_pty() {
		let fx = Fixture::new(RuntimeBackend::Herdr);
		let err = fx.router.write("sess-foreign", b"x").unwrap_err();
		assert!(err.to_string().contains("Herdr runtime is not available"));
		assert_eq!(fx.live_count(), 0);
		assert!(fx.sessions.lock().unwrap().get("sess-foreign").is_none());
	}

	fn session_row_count(fx: &Fixture) -> usize {
		fx.router.local.list_project_sessions("p1").unwrap().len()
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

	#[test]
	fn restore_and_close_do_not_start_both_backends() {
		let fx = Fixture::new(RuntimeBackend::Local);
		let created = fx
			.router
			.create_session(&Fixture::meta(), &fx.config())
			.unwrap();
		std::thread::sleep(Duration::from_millis(50));
		let restored = fx
			.router
			.restore_session(
				&created.session_id,
				&Fixture::meta(),
				&fx.config(),
			)
			.unwrap();
		assert_ne!(restored.new_session_id, created.session_id);
		assert_eq!(fx.router.owner(&created.session_id).unwrap(), None);
		assert_eq!(
			fx.router.owner(&restored.new_session_id).unwrap(),
			Some(RuntimeBackend::Local)
		);
		assert!(fx.router.herdr.recorded_ops().is_empty());
		fx.router.close_session(&restored.new_session_id).unwrap();
		assert!(fx.router.herdr.recorded_ops().is_empty());
	}

	#[test]
	fn local_startup_does_not_ensure_herdr_and_errors_stay_distinct() {
		let fx = Fixture::new(RuntimeBackend::Local);
		assert_eq!(fx.router.selected_backend(), RuntimeBackend::Local);
		assert_eq!(SESSION_NAME, "2code");
		assert_ne!(SESSION_NAME, "default");
		let guard = HerdrClientGuard::new();
		release_herdr_client_helpers(&guard);
		let created = fx
			.router
			.create_session(&Fixture::meta(), &fx.config())
			.unwrap();
		assert_eq!(
			fx.router.owner(&created.session_id).unwrap(),
			Some(RuntimeBackend::Local)
		);
		assert_eq!(fx.live_count(), 1);
		assert!(fx.router.herdr.recorded_ops().is_empty());

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
			"Local default startup must not start a Herdr server"
		);
		assert!(
			!lib.contains("herdr::transport"),
			"Local default startup must not open a Herdr NDJSON client"
		);
		assert!(
			!lib.contains("HerdrClient::connect"),
			"Local default startup must not connect a Herdr socket client"
		);
		assert!(
			!lib.contains("runtime_sync"),
			"Local default startup must not start Herdr snapshot sync"
		);
		assert!(
			!lib.contains("herdr_runtime_sync"),
			"Local default startup must not construct a Herdr runtime sync"
		);
		assert!(
			!lib.contains("HerdrRuntimeSync"),
			"Local default startup must not start HerdrRuntimeSync"
		);
		assert!(
			!lib.contains("events.subscribe"),
			"Local default startup must not subscribe to Herdr events"
		);
	}

	#[test]
	fn teardown_router_local_session_unbinds_and_kills_pty() {
		let fx = Fixture::new(RuntimeBackend::Local);
		let created = fx
			.router
			.create_session(&Fixture::meta(), &fx.config())
			.unwrap();
		let id = created.session_id;
		fx.router.teardown_session(&id).unwrap();
		assert_eq!(fx.router.owner(&id).unwrap(), None);
		assert_eq!(fx.live_count(), 0);
	}

	#[test]
	fn teardown_refuses_unbound_live_local_pty() {
		let fx = Fixture::new(RuntimeBackend::Local);
		let created = fx
			.router
			.create_session(&Fixture::meta(), &fx.config())
			.unwrap();
		let id = created.session_id;
		fx.router.selector.unbind(&id).unwrap();
		let err = fx.router.teardown_session(&id).unwrap_err();
		assert!(err.to_string().contains("unbound"));
		assert_eq!(fx.live_count(), 1);
	}

	#[test]
	fn teardown_refuses_to_kill_local_pty_for_herdr_owned_id() {
		let fx = Fixture::new(RuntimeBackend::Local);
		let created = fx
			.router
			.create_session(&Fixture::meta(), &fx.config())
			.unwrap();
		let id = created.session_id;
		fx.router.selector.unbind(&id).unwrap();
		fx.router.bind_session(&id, RuntimeBackend::Herdr).unwrap();
		let err = fx.router.teardown_session(&id).unwrap_err();
		assert!(err.to_string().contains("Herdr-owned"));
		assert_eq!(fx.live_count(), 1);
		assert_eq!(fx.router.owner(&id).unwrap(), Some(RuntimeBackend::Herdr));
	}
}
