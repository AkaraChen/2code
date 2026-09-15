//! Fail-closed Herdr terminal runtime.
//!
//! PTY create/close/write stay unavailable. A later task can open a
//! read-only snapshot/event projection via
//! [`HerdrStubAdapter::open_runtime_sync`]; that path never owns a local
//! PTY, worktree, or terminal session.

use model::error::AppError;
use model::pty::{PtyConfig, PtySessionMeta, PtySessionRecord, RestoreResult};
use model::runtime::{CreateSessionResult, RuntimeBackend};

use crate::runtime_sync::HerdrRuntimeSync;

use super::{HerdrEndpoint, TerminalRuntime};

const UNAVAILABLE: &str = "Herdr runtime is not available";

#[derive(Default)]
pub struct HerdrStubAdapter {
	ops: std::sync::Mutex<Vec<&'static str>>,
}

impl HerdrStubAdapter {
	pub fn new() -> Self {
		Self::default()
	}

	fn fail(&self, op: &'static str) -> AppError {
		if let Ok(mut ops) = self.ops.lock() {
			ops.push(op);
		}
		AppError::PtyError(UNAVAILABLE.to_string())
	}

	pub fn recorded_ops(&self) -> Vec<&'static str> {
		self.ops.lock().map(|ops| ops.clone()).unwrap_or_default()
	}

	/// Read-only `events.subscribe` + `session.snapshot` projection.
	/// Does not create, close, or attach terminals.
	pub fn open_runtime_sync(
		endpoint: &HerdrEndpoint,
	) -> Result<HerdrRuntimeSync, AppError> {
		HerdrRuntimeSync::connect(endpoint)
	}
}

impl TerminalRuntime for HerdrStubAdapter {
	fn selected_backend(&self) -> RuntimeBackend {
		RuntimeBackend::Herdr
	}

	fn create_session(
		&self,
		_meta: &PtySessionMeta,
		_config: &PtyConfig,
	) -> Result<CreateSessionResult, AppError> {
		Err(self.fail("create"))
	}

	fn restore_session(
		&self,
		_old_session_id: &str,
		_meta: &PtySessionMeta,
		_config: &PtyConfig,
	) -> Result<RestoreResult, AppError> {
		Err(self.fail("restore"))
	}

	fn close_session(&self, _session_id: &str) -> Result<(), AppError> {
		Err(self.fail("close"))
	}

	fn list_project_sessions(
		&self,
		_project_id: &str,
	) -> Result<Vec<PtySessionRecord>, AppError> {
		Err(self.fail("list"))
	}

	fn delete_session(&self, _session_id: &str) -> Result<(), AppError> {
		Err(self.fail("delete"))
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
