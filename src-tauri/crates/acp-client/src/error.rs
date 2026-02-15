use thiserror::Error;

#[derive(Debug, Error)]
pub enum AdapterError {
	#[error("failed to spawn process: {0}")]
	Spawn(#[from] std::io::Error),

	#[error("failed to capture stdin")]
	MissingStdin,

	#[error("failed to capture stdout")]
	MissingStdout,

	#[error("failed to write to stdin: {0}")]
	Write(std::io::Error),

	#[error("failed to serialize JSON-RPC message: {0}")]
	Serialize(#[from] serde_json::Error),

	#[error("request timeout after {0:?}")]
	Timeout(std::time::Duration),

	#[error("invalid JSON-RPC message: {0}")]
	InvalidMessage(String),

	#[error("process already shutting down")]
	ShuttingDown,
}

pub type Result<T> = std::result::Result<T, AdapterError>;
