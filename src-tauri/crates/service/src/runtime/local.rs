//! Local terminal runtime wrapping the existing PTY service and infra.
//!
//! Does not rewrite spawning, pty_log persistence, restore/history replay,
//! or shell-init behavior.

use model::error::AppError;
use model::pty::{PtyConfig, PtySessionMeta, PtySessionRecord, RestoreResult};
use model::runtime::{CreateSessionResult, RuntimeBackend};
use model::runtime_mapping::SessionRuntimeMapping;

use crate::pty::PtyContext;

use super::TerminalRuntime;

pub struct LocalAdapter {
	ctx: PtyContext,
}

impl LocalAdapter {
	pub fn new(ctx: PtyContext) -> Self {
		Self { ctx }
	}

	pub(crate) fn has_live_session(&self, session_id: &str) -> bool {
		self.ctx
			.sessions
			.lock()
			.map(|sessions| sessions.contains_key(session_id))
			.unwrap_or(false)
	}

	pub(crate) fn herdr_mapping(
		&self,
		session_id: &str,
	) -> Result<Option<SessionRuntimeMapping>, AppError> {
		let conn = &mut *self.ctx.db.lock().map_err(|_| AppError::LockError)?;
		match repo::runtime_mapping::find_session_mapping(conn, session_id) {
			Ok(mapping) => Ok(Some(mapping)),
			Err(AppError::NotFound(_)) => Ok(None),
			Err(err) => Err(err),
		}
	}

	pub(crate) fn teardown_session(
		&self,
		session_id: &str,
	) -> Result<(), AppError> {
		crate::pty::close_session_full(
			&self.ctx.sessions,
			&self.ctx.flush_senders,
			&self.ctx.output_dir,
			session_id,
		)?;
		if let Ok(mut conn) = self.ctx.db.lock() {
			repo::pty::mark_closed(&mut conn, session_id);
		}
		Ok(())
	}
}

impl TerminalRuntime for LocalAdapter {
	fn selected_backend(&self) -> RuntimeBackend {
		RuntimeBackend::Local
	}

	fn create_session(
		&self,
		meta: &PtySessionMeta,
		config: &PtyConfig,
	) -> Result<CreateSessionResult, AppError> {
		let session_id = crate::pty::create_session(&self.ctx, meta, config)?;
		Ok(CreateSessionResult { session_id })
	}

	fn restore_session(
		&self,
		old_session_id: &str,
		meta: &PtySessionMeta,
		config: &PtyConfig,
	) -> Result<RestoreResult, AppError> {
		crate::pty::restore_session(&self.ctx, old_session_id, meta, config)
	}

	fn close_session(&self, session_id: &str) -> Result<(), AppError> {
		crate::pty::close_session(&self.ctx.db, &self.ctx.sessions, session_id)
	}

	fn list_project_sessions(
		&self,
		project_id: &str,
	) -> Result<Vec<PtySessionRecord>, AppError> {
		let conn = &mut *self.ctx.db.lock().map_err(|_| AppError::LockError)?;
		crate::pty::list_project_sessions(conn, project_id)
	}

	fn delete_session(&self, session_id: &str) -> Result<(), AppError> {
		let conn = &mut *self.ctx.db.lock().map_err(|_| AppError::LockError)?;
		crate::pty::delete_session(conn, &self.ctx.output_dir, session_id)
	}

	fn write(&self, session_id: &str, data: &[u8]) -> Result<(), AppError> {
		infra::pty::write_to_pty(&self.ctx.sessions, session_id, data)
	}

	fn resize(
		&self,
		session_id: &str,
		rows: u16,
		cols: u16,
	) -> Result<(), AppError> {
		infra::pty::resize_pty(&self.ctx.sessions, session_id, rows, cols)?;
		let conn = &mut *self.ctx.db.lock().map_err(|_| AppError::LockError)?;
		repo::pty::update_dimensions(conn, session_id, cols, rows);
		Ok(())
	}

	fn history(&self, session_id: &str) -> Result<Vec<u8>, AppError> {
		Ok(crate::pty::get_history(&self.ctx.output_dir, session_id))
	}

	fn flush(&self, session_id: &str) -> Result<(), AppError> {
		crate::pty::flush_output(&self.ctx.flush_senders, session_id)
	}

	fn clear(&self, session_id: &str) -> Result<(), AppError> {
		crate::pty::clear_output(
			&self.ctx.output_dir,
			&self.ctx.flush_senders,
			session_id,
		)
	}
}
