use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;

use futures::Stream;
use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, ChildStdout, Command};
use tokio::sync::{broadcast, oneshot, Mutex};
use tokio_stream::wrappers::{
	errors::BroadcastStreamRecvError, BroadcastStream,
};
use tokio_stream::StreamExt;

use crate::error::{AdapterError, Result};

const DEFAULT_REQUEST_TIMEOUT: Option<Duration> = None; // No timeout by default

#[derive(Debug)]
pub struct AcpClient {
	stdin: Arc<Mutex<ChildStdin>>,
	child: Arc<Mutex<Child>>,
	pending: Arc<Mutex<HashMap<String, oneshot::Sender<Value>>>>,
	notification_tx: broadcast::Sender<Value>,
	shutting_down: Arc<AtomicBool>,
	request_id: AtomicU64,
	request_timeout: Option<Duration>,
}

impl AcpClient {
	/// Spawn a new ACP process with the given command and environment
	pub async fn spawn(
		program: PathBuf,
		args: Vec<String>,
		env: HashMap<String, String>,
	) -> Result<Self> {
		Self::spawn_with_timeout(program, args, env, DEFAULT_REQUEST_TIMEOUT)
			.await
	}

	/// Spawn a new ACP process with custom request timeout
	/// Pass None for request_timeout to wait indefinitely
	pub async fn spawn_with_timeout(
		program: PathBuf,
		args: Vec<String>,
		env: HashMap<String, String>,
		request_timeout: Option<Duration>,
	) -> Result<Self> {
		tracing::info!(
			program = %program.display(),
			args = ?args,
			"spawning ACP process"
		);

		// Spawn process with piped stdin/stdout
		let mut command = Command::new(&program);
		command
			.args(&args)
			.stdin(std::process::Stdio::piped())
			.stdout(std::process::Stdio::piped())
			.stderr(std::process::Stdio::inherit()); // stderr goes to parent

		for (key, value) in env {
			command.env(key, value);
		}

		let mut child = command.spawn()?;
		let pid = child.id().unwrap_or(0);

		// Extract stdin/stdout
		let stdin = child.stdin.take().ok_or(AdapterError::MissingStdin)?;
		let stdout = child.stdout.take().ok_or(AdapterError::MissingStdout)?;

		tracing::info!(pid = pid, "ACP process spawned successfully");

		// Create adapter
		let (notification_tx, _) = broadcast::channel(128);

		let adapter = Self {
			stdin: Arc::new(Mutex::new(stdin)),
			child: Arc::new(Mutex::new(child)),
			pending: Arc::new(Mutex::new(HashMap::new())),
			notification_tx,
			shutting_down: Arc::new(AtomicBool::new(false)),
			request_id: AtomicU64::new(1),
			request_timeout,
		};

		// Spawn stdout reader task
		adapter.spawn_stdout_reader(stdout);

		Ok(adapter)
	}

	/// Send a JSON-RPC request and wait for response
	pub async fn request(&self, method: &str, params: Value) -> Result<Value> {
		if self.shutting_down.load(Ordering::SeqCst) {
			return Err(AdapterError::ShuttingDown);
		}

		let id = self.request_id.fetch_add(1, Ordering::Relaxed);
		let id_value = Value::from(id);

		let payload = json!({
			"jsonrpc": "2.0",
			"id": id_value,
			"method": method,
			"params": params,
		});

		// Create response channel
		let (tx, rx) = oneshot::channel();
		let id_key = id.to_string();

		{
			let mut pending = self.pending.lock().await;
			pending.insert(id_key.clone(), tx);
		}

		// Send request
		if let Err(err) = self.send_to_subprocess(&payload).await {
			// Remove from pending on send failure
			self.pending.lock().await.remove(&id_key);
			return Err(err);
		}

		tracing::debug!(
			method = method,
			id = id,
			"sent JSON-RPC request, waiting for response"
		);

		// Wait for response with optional timeout
		if let Some(timeout) = self.request_timeout {
			// With timeout
			match tokio::time::timeout(timeout, rx).await {
				Ok(Ok(response)) => {
					tracing::debug!(method = method, id = id, "received response");
					Ok(response)
				}
				Ok(Err(_)) => {
					// Channel was dropped (process exited?)
					self.pending.lock().await.remove(&id_key);
					Err(AdapterError::Timeout(timeout))
				}
				Err(_) => {
					// Timeout
					self.pending.lock().await.remove(&id_key);
					tracing::error!(
						method = method,
						id = id,
						timeout = ?timeout,
						"request timed out"
					);
					Err(AdapterError::Timeout(timeout))
				}
			}
		} else {
			// No timeout - wait indefinitely
			tracing::debug!(
				method = method,
				id = id,
				"waiting for response (no timeout)"
			);

			match rx.await {
				Ok(response) => {
					tracing::debug!(method = method, id = id, "received response");
					Ok(response)
				}
				Err(_) => {
					// Channel was dropped (process exited?)
					self.pending.lock().await.remove(&id_key);
					tracing::error!(
						method = method,
						id = id,
						"channel dropped (process may have exited)"
					);
					Err(AdapterError::InvalidMessage(
						"response channel dropped".to_string(),
					))
				}
			}
		}
	}

	/// Send a JSON-RPC notification (fire-and-forget)
	pub async fn notify(&self, method: &str, params: Value) -> Result<()> {
		if self.shutting_down.load(Ordering::SeqCst) {
			return Err(AdapterError::ShuttingDown);
		}

		let payload = json!({
			"jsonrpc": "2.0",
			"method": method,
			"params": params,
		});

		tracing::debug!(method = method, "sending JSON-RPC notification");
		self.send_to_subprocess(&payload).await
	}

	/// Subscribe to notifications from the ACP process
	pub fn notifications(&self) -> impl Stream<Item = Value> {
		BroadcastStream::new(self.notification_tx.subscribe()).filter_map(
			|result: std::result::Result<Value, BroadcastStreamRecvError>| {
				result.ok()
			},
		)
	}

	/// Gracefully shutdown the ACP process
	///
	/// This method is designed to avoid deadlocks by:
	/// 1. Not using exit watcher (no lock competition)
	/// 2. Clearing pending requests first
	/// 3. Then acquiring child lock to kill process
	pub async fn shutdown(&self) {
		// Check if already shutting down
		if self.shutting_down.swap(true, Ordering::SeqCst) {
			tracing::debug!("already shutting down, skipping");
			return;
		}

		tracing::info!("shutting down ACP process");

		// Step 1: Clear all pending requests
		let pending_count = {
			let mut pending = self.pending.lock().await;
			let count = pending.len();
			pending.clear();
			count
		};

		if pending_count > 0 {
			tracing::warn!(
				pending_requests = pending_count,
				"cleared pending requests during shutdown"
			);
		}

		// Step 2: Kill and wait for process
		// Since we don't have exit watcher, there's no lock competition
		let mut child = self.child.lock().await;

		match child.try_wait() {
			Ok(Some(status)) => {
				tracing::info!(
					success = status.success(),
					code = status.code(),
					"process already exited"
				);
			}
			Ok(None) => {
				// Process still running, kill it
				tracing::info!("killing process");
				if let Err(err) = child.kill().await {
					tracing::error!(error = %err, "failed to kill process");
				}

				// Wait for process to exit
				match child.wait().await {
					Ok(status) => {
						tracing::info!(
							success = status.success(),
							code = status.code(),
							"process exited after kill"
						);
					}
					Err(err) => {
						tracing::error!(error = %err, "failed to wait for process");
					}
				}
			}
			Err(err) => {
				tracing::error!(error = %err, "failed to check process status");
				let _ = child.kill().await;
			}
		}
	}

	/// Spawn a background task to read stdout and dispatch messages
	fn spawn_stdout_reader(&self, stdout: ChildStdout) {
		let pending = self.pending.clone();
		let notification_tx = self.notification_tx.clone();

		tokio::spawn(async move {
			let mut reader = BufReader::new(stdout).lines();
			let mut line_count = 0u64;

			while let Ok(Some(line)) = reader.next_line().await {
				line_count += 1;

				// Try to parse as JSON
				let value: Value = match serde_json::from_str(&line) {
					Ok(v) => v,
					Err(err) => {
						tracing::warn!(
							error = %err,
							line = %line,
							"failed to parse stdout line as JSON"
						);
						continue;
					}
				};

				// Check if it's a response (has "id" field) or notification
				if let Some(id_value) = value.get("id") {
					// It's a response
					let id_key =
						id_value.to_string().trim_matches('"').to_string();

					if let Some(tx) = pending.lock().await.remove(&id_key) {
						tracing::debug!(id = %id_key, "matched response to pending request");
						let _ = tx.send(value);
					} else {
						tracing::warn!(id = %id_key, "received response for unknown request");
					}
				} else {
					// It's a notification
					tracing::debug!("received notification from process");
					let _ = notification_tx.send(value);
				}
			}

			tracing::info!(total_lines = line_count, "stdout stream ended");
		});
	}

	/// Write a JSON payload to subprocess stdin
	async fn send_to_subprocess(&self, payload: &Value) -> Result<()> {
		let mut line = serde_json::to_string(payload)?;
		line.push('\n');

		let mut stdin = self.stdin.lock().await;
		stdin
			.write_all(line.as_bytes())
			.await
			.map_err(AdapterError::Write)?;
		stdin.flush().await.map_err(AdapterError::Write)?;

		Ok(())
	}
}
