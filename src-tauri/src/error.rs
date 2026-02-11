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
}

impl Serialize for AppError {
	fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
	where
		S: serde::Serializer,
	{
		serializer.serialize_str(&self.to_string())
	}
}

pub type AppResult<T> = Result<T, AppError>;
