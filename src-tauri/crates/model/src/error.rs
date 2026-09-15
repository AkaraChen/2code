use serde::Serialize;
use thiserror::Error;

#[derive(Error, Debug)]
pub enum AppError {
	#[error("IO error: {0}")]
	IoError(#[from] std::io::Error),

	#[error("Lock error: failed to acquire lock")]
	LockError,

	#[error("PTY error: {0}")]
	PtyError(String),

	#[error("Database error: {0}")]
	DbError(String),

	#[error("Not found: {0}")]
	NotFound(String),

	#[error("Git error: {0}")]
	GitError(String),

	#[error("Herdr server is absent: {0}")]
	HerdrServerAbsent(String),

	#[error("Herdr server is incompatible: {0}")]
	HerdrServerIncompatible(String),

	#[error("Herdr transport error: {0}")]
	HerdrTransport(String),

	#[error("Herdr request outcome is uncertain: {0}")]
	HerdrUncertainOutcome(String),
}

impl Serialize for AppError {
	fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
	where
		S: serde::Serializer,
	{
		serializer.serialize_str(&self.to_string())
	}
}

impl From<diesel::result::Error> for AppError {
	fn from(error: diesel::result::Error) -> Self {
		match error {
			diesel::result::Error::NotFound => {
				AppError::NotFound("Record".into())
			}
			error => AppError::DbError(error.to_string()),
		}
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	// --- Display output for each variant ---

	#[test]
	fn display_io_error() {
		let err = AppError::IoError(std::io::Error::new(
			std::io::ErrorKind::NotFound,
			"file missing",
		));
		assert_eq!(err.to_string(), "IO error: file missing");
	}

	#[test]
	fn display_lock_error() {
		let err = AppError::LockError;
		assert_eq!(err.to_string(), "Lock error: failed to acquire lock");
	}

	#[test]
	fn display_pty_error() {
		let err = AppError::PtyError("spawn failed".into());
		assert_eq!(err.to_string(), "PTY error: spawn failed");
	}

	#[test]
	fn display_db_error() {
		let err = AppError::DbError("constraint violation".into());
		assert_eq!(err.to_string(), "Database error: constraint violation");
	}

	#[test]
	fn display_not_found() {
		let err = AppError::NotFound("Project: abc".into());
		assert_eq!(err.to_string(), "Not found: Project: abc");
	}

	#[test]
	fn display_git_error() {
		let err = AppError::GitError("branch not found".into());
		assert_eq!(err.to_string(), "Git error: branch not found");
	}

	#[test]
	fn display_herdr_absent_is_distinct_from_incompatible() {
		let absent = AppError::HerdrServerAbsent("/tmp/x.sock".into());
		let incompatible =
			AppError::HerdrServerIncompatible("protocol 1".into());
		assert_eq!(absent.to_string(), "Herdr server is absent: /tmp/x.sock");
		assert_eq!(
			incompatible.to_string(),
			"Herdr server is incompatible: protocol 1"
		);
		assert!(!absent.to_string().contains("incompatible"));
		assert!(!incompatible.to_string().contains("absent"));
	}

	#[test]
	fn display_herdr_uncertain_is_distinct_from_transport() {
		let transport = AppError::HerdrTransport("disconnected".into());
		let uncertain =
			AppError::HerdrUncertainOutcome("workspace.create".into());
		assert_eq!(
			transport.to_string(),
			"Herdr transport error: disconnected"
		);
		assert_eq!(
			uncertain.to_string(),
			"Herdr request outcome is uncertain: workspace.create"
		);
		assert!(!transport.to_string().contains("uncertain"));
		assert!(!uncertain.to_string().contains("transport error"));
	}

	// --- Serialize produces JSON string ---

	#[test]
	fn serialize_to_json_string() {
		let err = AppError::PtyError("test".into());
		let val = serde_json::to_value(&err).unwrap();
		assert!(val.is_string());
		assert_eq!(val.as_str().unwrap(), "PTY error: test");
	}

	#[test]
	fn serialize_lock_error() {
		let err = AppError::LockError;
		let val = serde_json::to_value(&err).unwrap();
		assert_eq!(val.as_str().unwrap(), "Lock error: failed to acquire lock");
	}

	// --- From conversions ---

	#[test]
	fn from_io_error() {
		let io_err = std::io::Error::new(
			std::io::ErrorKind::PermissionDenied,
			"access denied",
		);
		let app_err: AppError = io_err.into();
		match &app_err {
			AppError::IoError(e) => {
				assert_eq!(e.kind(), std::io::ErrorKind::PermissionDenied);
			}
			_ => panic!("expected IoError variant"),
		}
	}

	#[test]
	fn from_io_error_preserves_message() {
		let io_err = std::io::Error::other("custom msg");
		let app_err: AppError = io_err.into();
		assert!(app_err.to_string().contains("custom msg"));
	}

	#[test]
	fn from_diesel_not_found_maps_to_not_found() {
		let app_err: AppError = diesel::result::Error::NotFound.into();
		assert!(matches!(app_err, AppError::NotFound(_)));
	}

	#[test]
	fn debug_format_works() {
		let err = AppError::NotFound("x".into());
		let debug = format!("{:?}", err);
		assert!(debug.contains("NotFound"));
	}
}
