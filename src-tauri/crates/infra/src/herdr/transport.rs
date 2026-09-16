//! Typed NDJSON control client for Herdr's JSON API.
//!
//! Connects to the Task 4 `2code` endpoint over a Unix socket (Linux
//! verified). Windows named-pipe paths follow Herdr's documented
//! convention and are not live-verified ([#399](https://github.com/AkaraChen/2code/issues/399)).
//! macOS uses the same Unix client at compile time and is not claimed
//! as executed ([#401](https://github.com/AkaraChen/2code/issues/401)).
//!
//! Herdr v0.9.0 closes the JSON request socket after one RPC response
//! (Linux verified). Each [`HerdrClient::request`] opens a new
//! connection. [`HerdrSubscription`] keeps its connection open.
//! Concurrent requests use concurrent connections; this client never
//! auto-replays a mutation after disconnect.
//!
//! This module does not attach terminals, own worktrees, project
//! snapshots, or send `server.stop`.

use std::collections::VecDeque;
use std::fmt;
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use model::error::AppError;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::process::HerdrEndpoint;

/// Default cap for one NDJSON line (request or response).
pub const MAX_MESSAGE_BYTES: usize = 8 * 1024 * 1024;

const DEFAULT_REQUEST_TIMEOUT: Duration = Duration::from_secs(30);
const DEFAULT_READ_POLL: Duration = Duration::from_millis(200);

/// Options for one control connection.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct HerdrClientOptions {
	pub max_message_bytes: usize,
	pub read_poll: Duration,
	pub request_timeout: Option<Duration>,
}

impl Default for HerdrClientOptions {
	fn default() -> Self {
		Self {
			max_message_bytes: MAX_MESSAGE_BYTES,
			read_poll: DEFAULT_READ_POLL,
			request_timeout: Some(DEFAULT_REQUEST_TIMEOUT),
		}
	}
}

/// Success envelope: response `id` matches the request.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct HerdrSuccess {
	pub id: String,
	pub result: Value,
}

/// JSON `worktree.open` identity. `pane_id` / `terminal_id` are not
/// persisted here; adoption binds `workspace_id` only.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct WorktreeOpenResult {
	pub workspace_id: String,
	pub already_open: bool,
}

/// JSON `worktree.create` identity. Checkout path is the path Herdr
/// created. `terminal_id` / `tab_id` / pane ids are not returned.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct WorktreeCreateResult {
	pub workspace_id: String,
	pub path: String,
}

/// One `worktree.list` entry. `workspace_id` is Herdr's open workspace
/// when present; never a display name.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct WorktreeListEntry {
	pub path: String,
	pub branch: Option<String>,
	pub workspace_id: Option<String>,
	pub is_linked_worktree: bool,
}

/// JSON `worktree.create` params. At most one of `cwd` or `workspace_id`.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct WorktreeCreateRequest<'a> {
	pub branch: &'a str,
	pub path: Option<&'a Path>,
	pub cwd: Option<&'a Path>,
	pub workspace_id: Option<&'a str>,
	pub label: Option<&'a str>,
}

/// JSON `worktree.remove` identity. Herdr does not delete the git branch.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct WorktreeRemoveResult {
	pub workspace_id: String,
	pub path: String,
	pub forced: bool,
}

/// JSON `workspace.create --cwd` params. Used for non-git folder
/// profiles. Paths must be absolute.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct WorkspaceCreateRequest<'a> {
	pub cwd: &'a Path,
	pub label: Option<&'a str>,
}

/// JSON `workspace.create` identity. Non-git responses omit `worktree`.
/// `terminal_id` / `tab_id` / pane ids are not returned.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct WorkspaceCreateResult {
	pub workspace_id: String,
}

/// JSON `tab.create` identity. `terminal_id` is live-only and is not
/// returned here so callers cannot persist it.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TabCreateResult {
	pub workspace_id: String,
	pub tab_id: String,
	pub pane_id: String,
}

/// JSON `pane.list` / `pane.get` identity. `terminal_id` is omitted.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PaneView {
	pub pane_id: String,
	pub tab_id: String,
	pub workspace_id: String,
}

/// Structured RPC error from Herdr (`error.code` / `error.message`).
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct HerdrRpcError {
	pub id: String,
	pub code: String,
	pub message: String,
}

/// `events.subscribe` acknowledgement (`result.type = subscription_started`).
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SubscriptionStarted {
	pub id: String,
}

/// Later subscribe stream line (`{event, data}`).
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SubscriptionEvent {
	pub event: String,
	pub data: Value,
}

/// Transport, framing, correlation, and uncertain-outcome errors.
#[derive(Debug)]
pub enum HerdrTransportError {
	Io(io::Error),
	MessageTooLarge { size: usize, limit: usize },
	InvalidJson(String),
	UnexpectedMessage(String),
	Cancelled { id: String, method: String },
	Disconnected { id: String, method: String },
	UncertainOutcome { id: String, method: String },
	Timeout { id: String, method: String },
	Rpc(HerdrRpcError),
	Refused { reason: String },
	UnknownPipeLayout { path: String, reason: String },
}

impl HerdrTransportError {
	pub fn is_uncertain(&self) -> bool {
		matches!(self, Self::UncertainOutcome { .. })
	}
}

impl fmt::Display for HerdrTransportError {
	fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
		match self {
			Self::Io(err) => write!(f, "Herdr transport I/O: {err}"),
			Self::MessageTooLarge { size, limit } => {
				write!(f, "Herdr message too large ({size} > {limit})")
			}
			Self::InvalidJson(err) => write!(f, "Herdr JSON: {err}"),
			Self::UnexpectedMessage(msg) => {
				write!(f, "unexpected Herdr message: {msg}")
			}
			Self::Cancelled { id, method } => {
				write!(f, "Herdr request {method} ({id}) cancelled")
			}
			Self::Disconnected { id, method } => {
				write!(f, "Herdr disconnected during {method} ({id})")
			}
			Self::UncertainOutcome { id, method } => {
				write!(f, "uncertain outcome for {method} ({id})")
			}
			Self::Timeout { id, method } => {
				write!(f, "Herdr request {method} ({id}) timed out")
			}
			Self::Rpc(err) => write!(
				f,
				"Herdr RPC {} ({}): {}",
				err.code, err.id, err.message
			),
			Self::Refused { reason } => {
				write!(f, "Herdr request refused: {reason}")
			}
			Self::UnknownPipeLayout { path, reason } => {
				write!(f, "unknown Herdr pipe layout for {path}: {reason}")
			}
		}
	}
}

impl std::error::Error for HerdrTransportError {}

impl From<io::Error> for HerdrTransportError {
	fn from(err: io::Error) -> Self {
		Self::Io(err)
	}
}

impl From<HerdrTransportError> for AppError {
	fn from(err: HerdrTransportError) -> Self {
		if err.is_uncertain() {
			AppError::HerdrUncertainOutcome(err.to_string())
		} else {
			AppError::HerdrTransport(err.to_string())
		}
	}
}

fn parse_worktree_open_result(
	result: &Value,
) -> Result<WorktreeOpenResult, HerdrTransportError> {
	let kind = result.get("type").and_then(Value::as_str).unwrap_or("");
	if kind != "worktree_opened" {
		return Err(HerdrTransportError::UnexpectedMessage(format!(
			"expected worktree_opened, got {kind}"
		)));
	}
	let workspace_id = result
		.get("workspace")
		.and_then(|workspace| workspace.get("workspace_id"))
		.and_then(Value::as_str)
		.unwrap_or("");
	if workspace_id.is_empty() {
		return Err(HerdrTransportError::UnexpectedMessage(
			"worktree.open result missing workspace_id".into(),
		));
	}
	let already_open = result
		.get("already_open")
		.and_then(Value::as_bool)
		.ok_or_else(|| {
			HerdrTransportError::UnexpectedMessage(
				"worktree.open result missing already_open".into(),
			)
		})?;
	Ok(WorktreeOpenResult {
		workspace_id: workspace_id.to_string(),
		already_open,
	})
}

fn parse_worktree_create_result(
	result: &Value,
) -> Result<WorktreeCreateResult, HerdrTransportError> {
	let kind = result.get("type").and_then(Value::as_str).unwrap_or("");
	if kind != "worktree_created" {
		return Err(HerdrTransportError::UnexpectedMessage(format!(
			"expected worktree_created, got {kind}"
		)));
	}
	let workspace_id = result
		.get("workspace")
		.and_then(|workspace| workspace.get("workspace_id"))
		.and_then(Value::as_str)
		.unwrap_or("");
	if workspace_id.is_empty() {
		return Err(HerdrTransportError::UnexpectedMessage(
			"worktree.create result missing workspace_id".into(),
		));
	}
	let path = result
		.get("worktree")
		.and_then(|worktree| worktree.get("path"))
		.and_then(Value::as_str)
		.unwrap_or("");
	if path.is_empty() {
		return Err(HerdrTransportError::UnexpectedMessage(
			"worktree.create result missing worktree.path".into(),
		));
	}
	Ok(WorktreeCreateResult {
		workspace_id: workspace_id.to_string(),
		path: path.to_string(),
	})
}

fn parse_workspace_create_result(
	result: &Value,
) -> Result<WorkspaceCreateResult, HerdrTransportError> {
	let kind = result.get("type").and_then(Value::as_str).unwrap_or("");
	if kind != "workspace_created" {
		return Err(HerdrTransportError::UnexpectedMessage(format!(
			"expected workspace_created, got {kind}"
		)));
	}
	let workspace_id = result
		.get("workspace")
		.and_then(|workspace| workspace.get("workspace_id"))
		.and_then(Value::as_str)
		.unwrap_or("");
	if workspace_id.is_empty() {
		return Err(HerdrTransportError::UnexpectedMessage(
			"workspace.create result missing workspace_id".into(),
		));
	}
	Ok(WorkspaceCreateResult {
		workspace_id: workspace_id.to_string(),
	})
}

fn parse_workspace_close_result(
	result: &Value,
) -> Result<(), HerdrTransportError> {
	let kind = result.get("type").and_then(Value::as_str).unwrap_or("");
	if kind != "workspace_closed" {
		return Err(HerdrTransportError::UnexpectedMessage(format!(
			"expected workspace_closed, got {kind}"
		)));
	}
	Ok(())
}

fn parse_worktree_list_result(
	result: &Value,
) -> Result<Vec<WorktreeListEntry>, HerdrTransportError> {
	let kind = result.get("type").and_then(Value::as_str).unwrap_or("");
	if kind != "worktree_list" {
		return Err(HerdrTransportError::UnexpectedMessage(format!(
			"expected worktree_list, got {kind}"
		)));
	}
	let worktrees = result
		.get("worktrees")
		.and_then(Value::as_array)
		.ok_or_else(|| {
			HerdrTransportError::UnexpectedMessage(
				"worktree.list result missing worktrees".into(),
			)
		})?;
	worktrees
		.iter()
		.map(|entry| {
			let path = json_id(entry, "path").ok_or_else(|| {
				HerdrTransportError::UnexpectedMessage(
					"worktree.list entry missing path".into(),
				)
			})?;
			Ok(WorktreeListEntry {
				path: path.to_string(),
				branch: json_id(entry, "branch").map(str::to_string),
				workspace_id: json_id(entry, "open_workspace_id")
					.map(str::to_string),
				is_linked_worktree: entry
					.get("is_linked_worktree")
					.and_then(Value::as_bool)
					.unwrap_or(false),
			})
		})
		.collect()
}

fn require_absolute(
	path: &Path,
	what: &str,
) -> Result<(), HerdrTransportError> {
	if path.is_absolute() {
		Ok(())
	} else {
		Err(HerdrTransportError::Refused {
			reason: format!("{what} must be absolute"),
		})
	}
}

fn require_cwd_xor_workspace(
	cwd: Option<&Path>,
	workspace_id: Option<&str>,
) -> Result<(), HerdrTransportError> {
	let has_cwd = cwd.is_some();
	let has_workspace = workspace_id.is_some_and(|id| !id.is_empty());
	if has_cwd == has_workspace {
		return Err(HerdrTransportError::Refused {
			reason: "exactly one of cwd or workspace_id is required".into(),
		});
	}
	if let Some(cwd) = cwd {
		require_absolute(cwd, "cwd")?;
	}
	Ok(())
}

fn json_id<'a>(value: &'a Value, key: &str) -> Option<&'a str> {
	value
		.get(key)
		.and_then(Value::as_str)
		.filter(|id| !id.is_empty())
}

fn nested_object<'a>(value: &'a Value, key: &str) -> Option<&'a Value> {
	value.get(key).filter(|item| item.is_object())
}

fn parse_pane_view(value: &Value) -> Result<PaneView, HerdrTransportError> {
	let pane = nested_object(value, "pane").unwrap_or(value);
	let pane_id = json_id(pane, "pane_id").ok_or_else(|| {
		HerdrTransportError::UnexpectedMessage(
			"pane result missing pane_id".into(),
		)
	})?;
	let tab_id = json_id(pane, "tab_id").unwrap_or("");
	let workspace_id = json_id(pane, "workspace_id").unwrap_or("");
	Ok(PaneView {
		pane_id: pane_id.to_string(),
		tab_id: tab_id.to_string(),
		workspace_id: workspace_id.to_string(),
	})
}

fn parse_tab_create_result(
	result: &Value,
) -> Result<TabCreateResult, HerdrTransportError> {
	let kind = result.get("type").and_then(Value::as_str).unwrap_or("");
	if kind != "tab_created" {
		return Err(HerdrTransportError::UnexpectedMessage(format!(
			"expected tab_created, got {kind}"
		)));
	}
	let tab = nested_object(result, "tab").ok_or_else(|| {
		HerdrTransportError::UnexpectedMessage(
			"tab.create result missing tab".into(),
		)
	})?;
	let root_pane = nested_object(result, "root_pane").ok_or_else(|| {
		HerdrTransportError::UnexpectedMessage(
			"tab.create result missing root_pane".into(),
		)
	})?;
	let pane_id = json_id(root_pane, "pane_id").ok_or_else(|| {
		HerdrTransportError::UnexpectedMessage(
			"tab.create result missing root_pane.pane_id".into(),
		)
	})?;
	let tab_id = json_id(tab, "tab_id").ok_or_else(|| {
		HerdrTransportError::UnexpectedMessage(
			"tab.create result missing tab_id".into(),
		)
	})?;
	let workspace_id = json_id(tab, "workspace_id")
		.or_else(|| json_id(root_pane, "workspace_id"))
		.ok_or_else(|| {
			HerdrTransportError::UnexpectedMessage(
				"tab.create result missing workspace_id".into(),
			)
		})?;
	Ok(TabCreateResult {
		workspace_id: workspace_id.to_string(),
		tab_id: tab_id.to_string(),
		pane_id: pane_id.to_string(),
	})
}

fn parse_pane_list_result(
	result: &Value,
) -> Result<Vec<PaneView>, HerdrTransportError> {
	let panes =
		result
			.get("panes")
			.and_then(Value::as_array)
			.ok_or_else(|| {
				HerdrTransportError::UnexpectedMessage(
					"pane.list result missing panes".into(),
				)
			})?;
	panes.iter().map(parse_pane_view).collect()
}

fn is_pane_not_found(err: &HerdrTransportError) -> bool {
	match err {
		HerdrTransportError::Rpc(rpc) => {
			rpc.code == "pane_not_found" || rpc.code.contains("pane_not_found")
		}
		_ => false,
	}
}

fn is_worktree_absent(err: &HerdrTransportError) -> bool {
	match err {
		HerdrTransportError::Rpc(rpc) => {
			rpc.code == "workspace_not_found"
				|| rpc.code == "worktree_not_found"
				|| rpc.code.contains("workspace_not_found")
				|| rpc.code.contains("worktree_not_found")
		}
		_ => false,
	}
}

fn parse_worktree_remove_result(
	result: &Value,
) -> Result<WorktreeRemoveResult, HerdrTransportError> {
	let kind = result.get("type").and_then(Value::as_str).unwrap_or("");
	if kind != "worktree_removed" {
		return Err(HerdrTransportError::UnexpectedMessage(format!(
			"expected worktree_removed, got {kind}"
		)));
	}
	let workspace_id = result
		.get("workspace_id")
		.and_then(Value::as_str)
		.unwrap_or("");
	if workspace_id.is_empty() {
		return Err(HerdrTransportError::UnexpectedMessage(
			"worktree.remove result missing workspace_id".into(),
		));
	}
	let path = result.get("path").and_then(Value::as_str).unwrap_or("");
	if path.is_empty() {
		return Err(HerdrTransportError::UnexpectedMessage(
			"worktree.remove result missing path".into(),
		));
	}
	let forced =
		result
			.get("forced")
			.and_then(Value::as_bool)
			.ok_or_else(|| {
				HerdrTransportError::UnexpectedMessage(
					"worktree.remove result missing forced".into(),
				)
			})?;
	Ok(WorktreeRemoveResult {
		workspace_id: workspace_id.to_string(),
		path: path.to_string(),
		forced,
	})
}

/// Methods whose in-flight disconnect must not be auto-replayed.
pub fn outcome_uncertain(method: &str) -> bool {
	method == "server.stop"
		|| method.starts_with("workspace.")
		|| method.starts_with("worktree.")
		|| method.starts_with("tab.")
		|| method.starts_with("pane.")
}

/// Documented Windows mapping of Task 4's endpoint / `HERDR_SOCKET_PATH`.
///
/// Herdr v0.9.0 `ipc.rs` binds a namespaced pipe and writes a PID:nonce
/// marker at the filesystem path. Bundled agent-state helpers connect to
/// `\\.\pipe\{identity}`. Live named-pipe I/O is unverified (#399).
pub fn windows_named_pipe_path(
	endpoint: &Path,
) -> Result<String, HerdrTransportError> {
	let raw = endpoint.to_string_lossy();
	if raw.is_empty() {
		return Err(HerdrTransportError::UnknownPipeLayout {
			path: raw.into_owned(),
			reason: "empty path".into(),
		});
	}
	if raw.contains('\0') {
		return Err(HerdrTransportError::UnknownPipeLayout {
			path: raw.into_owned(),
			reason: "NUL in path".into(),
		});
	}
	if let Some(rest) = strip_pipe_prefix(&raw) {
		if rest.is_empty() {
			return Err(HerdrTransportError::UnknownPipeLayout {
				path: raw.into_owned(),
				reason: "empty pipe name".into(),
			});
		}
		return Ok(raw.into_owned());
	}
	if raw.starts_with(r"\\") || raw.starts_with("//") {
		return Err(HerdrTransportError::UnknownPipeLayout {
			path: raw.into_owned(),
			reason: "UNC path is not a Herdr named pipe".into(),
		});
	}
	Ok(format!(r"\\.\pipe\{raw}"))
}

fn strip_pipe_prefix(raw: &str) -> Option<&str> {
	const PREFIXES: &[&str] = &[r"\\.\pipe\", r"\\?\pipe\", "//./pipe/"];
	PREFIXES
		.iter()
		.find(|prefix| raw.starts_with(*prefix))
		.map(|prefix| &raw[prefix.len()..])
}

pub fn endpoint_not_allowed(path: &Path) -> Result<(), HerdrTransportError> {
	if is_default_session_socket(path) {
		return Err(HerdrTransportError::Refused {
			reason: "refusing the user default Herdr session".into(),
		});
	}
	let name = path
		.file_name()
		.and_then(|name| name.to_str())
		.unwrap_or("");
	if name == "herdr-client.sock" || name.ends_with("-client.sock") {
		return Err(HerdrTransportError::Refused {
			reason: "refusing herdr-client.sock (Task 10 binary frames)".into(),
		});
	}
	Ok(())
}

fn is_default_session_socket(path: &Path) -> bool {
	path.file_name().is_some_and(|name| name == "herdr.sock")
		&& path
			.parent()
			.and_then(|parent| parent.file_name())
			.is_some_and(|name| name == "herdr")
}

#[derive(Serialize)]
struct WireRequest<'a> {
	id: &'a str,
	method: &'a str,
	params: &'a Value,
}

#[derive(Deserialize)]
struct WireLine {
	#[serde(default)]
	id: Option<String>,
	#[serde(default)]
	result: Option<Value>,
	#[serde(default)]
	error: Option<WireErrorBody>,
	#[serde(default)]
	event: Option<String>,
	#[serde(default)]
	data: Option<Value>,
}

#[derive(Deserialize)]
struct WireErrorBody {
	code: String,
	message: String,
}

struct NdjsonFramer {
	buf: Vec<u8>,
	max: usize,
}

impl NdjsonFramer {
	fn new(max: usize) -> Self {
		Self {
			buf: Vec::new(),
			max,
		}
	}

	fn push(
		&mut self,
		data: &[u8],
	) -> Result<Vec<Vec<u8>>, HerdrTransportError> {
		self.buf.extend_from_slice(data);
		let mut lines = Vec::new();
		loop {
			let Some(end) = self.buf.iter().position(|&byte| byte == b'\n')
			else {
				if self.buf.len() > self.max {
					return Err(HerdrTransportError::MessageTooLarge {
						size: self.buf.len(),
						limit: self.max,
					});
				}
				break;
			};
			if end > self.max {
				return Err(HerdrTransportError::MessageTooLarge {
					size: end,
					limit: self.max,
				});
			}
			let mut line: Vec<u8> = self.buf.drain(..=end).collect();
			line.pop();
			if line.last() == Some(&b'\r') {
				line.pop();
			}
			if !line.is_empty() {
				lines.push(line);
			}
		}
		Ok(lines)
	}
}

/// NDJSON request client for one Task 4 endpoint. Each RPC uses a new
/// connection because Herdr closes the socket after one response.
#[derive(Clone)]
pub struct HerdrClient {
	path: PathBuf,
	options: HerdrClientOptions,
	ids: Arc<AtomicU64>,
}

impl fmt::Debug for HerdrClient {
	fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
		f.debug_struct("HerdrClient")
			.field("path", &self.path)
			.field("options", &self.options)
			.finish_non_exhaustive()
	}
}

/// In-flight request. Drop cancels the wait without retrying.
pub struct InflightRequest {
	id: String,
	method: String,
	rx: mpsc::Receiver<Result<HerdrSuccess, HerdrTransportError>>,
	cancelled: Arc<AtomicBool>,
	shutdown: Mutex<Option<Box<dyn FnOnce() + Send>>>,
	finished: bool,
}

impl HerdrClient {
	pub fn connect(
		endpoint: &HerdrEndpoint,
	) -> Result<Self, HerdrTransportError> {
		Self::connect_path(&endpoint.socket_path)
	}

	pub fn connect_path(path: &Path) -> Result<Self, HerdrTransportError> {
		Self::connect_with(path, HerdrClientOptions::default())
	}

	pub fn connect_with(
		path: &Path,
		options: HerdrClientOptions,
	) -> Result<Self, HerdrTransportError> {
		endpoint_not_allowed(path)?;
		Ok(Self {
			path: path.to_path_buf(),
			options,
			ids: Arc::new(AtomicU64::new(1)),
		})
	}

	pub fn ping(&self) -> Result<HerdrSuccess, HerdrTransportError> {
		self.request(
			self.next_id("ping"),
			"ping",
			Value::Object(Default::default()),
		)
	}

	pub fn session_snapshot(
		&self,
	) -> Result<HerdrSuccess, HerdrTransportError> {
		self.request(
			self.next_id("snap"),
			"session.snapshot",
			Value::Object(Default::default()),
		)
	}

	/// Adopt an existing checkout. Paths must be absolute. Never
	/// `worktree.create` and never auto-replays an uncertain outcome.
	pub fn worktree_open(
		&self,
		cwd: &Path,
		path: &Path,
	) -> Result<WorktreeOpenResult, HerdrTransportError> {
		if !cwd.is_absolute() || !path.is_absolute() {
			return Err(HerdrTransportError::Refused {
				reason: "worktree.open cwd and path must be absolute".into(),
			});
		}
		let params = serde_json::json!({
			"cwd": cwd.to_string_lossy(),
			"path": path.to_string_lossy(),
			"trust_repository": true,
			"focus": false,
		});
		let success =
			self.request(self.next_id("wtopen"), "worktree.open", params)?;
		parse_worktree_open_result(&success.result)
	}

	/// Create a linked git worktree and Herdr workspace. Paths must be
	/// absolute. At most one of `cwd` or `workspace_id`. Never auto-replays
	/// an uncertain outcome and never calls `worktree.remove`.
	pub fn worktree_create(
		&self,
		request: WorktreeCreateRequest<'_>,
	) -> Result<WorktreeCreateResult, HerdrTransportError> {
		if request.branch.trim().is_empty() {
			return Err(HerdrTransportError::Refused {
				reason: "worktree.create branch is required".into(),
			});
		}
		require_cwd_xor_workspace(request.cwd, request.workspace_id)?;
		if let Some(path) = request.path {
			require_absolute(path, "worktree.create path")?;
		}
		let mut params = serde_json::Map::new();
		params
			.insert("branch".into(), Value::String(request.branch.to_string()));
		params.insert("trust_repository".into(), Value::Bool(true));
		params.insert("focus".into(), Value::Bool(false));
		if let Some(cwd) = request.cwd {
			params.insert(
				"cwd".into(),
				Value::String(cwd.to_string_lossy().into_owned()),
			);
		}
		if let Some(workspace_id) = request.workspace_id {
			params.insert(
				"workspace_id".into(),
				Value::String(workspace_id.to_string()),
			);
		}
		if let Some(path) = request.path {
			params.insert(
				"path".into(),
				Value::String(path.to_string_lossy().into_owned()),
			);
		}
		if let Some(label) = request.label.filter(|label| !label.is_empty()) {
			params.insert("label".into(), Value::String(label.to_string()));
		}
		let success = self.request(
			self.next_id("wtcr"),
			"worktree.create",
			Value::Object(params),
		)?;
		parse_worktree_create_result(&success.result)
	}

	/// List git worktrees for a repo. At most one of `cwd` or
	/// `workspace_id`. Never auto-replays an uncertain outcome.
	pub fn worktree_list(
		&self,
		cwd: Option<&Path>,
		workspace_id: Option<&str>,
	) -> Result<Vec<WorktreeListEntry>, HerdrTransportError> {
		require_cwd_xor_workspace(cwd, workspace_id)?;
		let mut params = serde_json::Map::new();
		params.insert("trust_repository".into(), Value::Bool(true));
		if let Some(cwd) = cwd {
			params.insert(
				"cwd".into(),
				Value::String(cwd.to_string_lossy().into_owned()),
			);
		}
		if let Some(workspace_id) = workspace_id {
			params.insert(
				"workspace_id".into(),
				Value::String(workspace_id.to_string()),
			);
		}
		let success = self.request(
			self.next_id("wtlst"),
			"worktree.list",
			Value::Object(params),
		)?;
		parse_worktree_list_result(&success.result)
	}

	/// Remove a linked git worktree by `workspace_id`. Never removes a
	/// path/cwd, never deletes the git branch, and never auto-replays an
	/// uncertain outcome. `workspace_not_found` / `worktree_not_found` are
	/// success so retries stay idempotent.
	pub fn worktree_remove(
		&self,
		workspace_id: &str,
		force: bool,
	) -> Result<WorktreeRemoveResult, HerdrTransportError> {
		if workspace_id.is_empty() {
			return Err(HerdrTransportError::Refused {
				reason: "worktree.remove workspace_id is required".into(),
			});
		}
		let params = serde_json::json!({
			"workspace_id": workspace_id,
			"force": force,
			"trust_repository": true,
		});
		match self.request(self.next_id("wtrm"), "worktree.remove", params) {
			Ok(success) => parse_worktree_remove_result(&success.result),
			Err(err) if is_worktree_absent(&err) => Ok(WorktreeRemoveResult {
				workspace_id: workspace_id.to_string(),
				path: String::new(),
				forced: force,
			}),
			Err(err) => Err(err),
		}
	}

	/// Open a folder workspace (`workspace.create --cwd`). `cwd` must be
	/// absolute. Never `worktree.create` and never auto-replays an
	/// uncertain outcome.
	pub fn workspace_create(
		&self,
		request: WorkspaceCreateRequest<'_>,
	) -> Result<WorkspaceCreateResult, HerdrTransportError> {
		require_absolute(request.cwd, "workspace.create cwd")?;
		let mut params = serde_json::Map::new();
		params.insert(
			"cwd".into(),
			Value::String(request.cwd.to_string_lossy().into_owned()),
		);
		params.insert("focus".into(), Value::Bool(false));
		if let Some(label) = request.label.filter(|label| !label.is_empty()) {
			params.insert("label".into(), Value::String(label.to_string()));
		}
		let success = self.request(
			self.next_id("wscr"),
			"workspace.create",
			Value::Object(params),
		)?;
		parse_workspace_create_result(&success.result)
	}

	/// Close one Herdr workspace by `workspace_id`. Never closes a
	/// workspace group, never `worktree.remove`, and never auto-replays an
	/// uncertain outcome. `workspace_not_found` is success so retries stay
	/// idempotent.
	pub fn workspace_close(
		&self,
		workspace_id: &str,
	) -> Result<(), HerdrTransportError> {
		if workspace_id.is_empty() {
			return Err(HerdrTransportError::Refused {
				reason: "workspace.close workspace_id is required".into(),
			});
		}
		let params = serde_json::json!({
			"workspace_id": workspace_id,
		});
		match self.request(self.next_id("wscl"), "workspace.close", params) {
			Ok(success) => parse_workspace_close_result(&success.result),
			Err(err) if is_worktree_absent(&err) => Ok(()),
			Err(err) => Err(err),
		}
	}

	/// Create an extra tab in an existing workspace. `cwd` must be
	/// absolute. Does not auto-replay an uncertain outcome.
	pub fn tab_create(
		&self,
		workspace_id: &str,
		label: &str,
		cwd: &Path,
	) -> Result<TabCreateResult, HerdrTransportError> {
		if workspace_id.is_empty() {
			return Err(HerdrTransportError::Refused {
				reason: "tab.create workspace_id is required".into(),
			});
		}
		require_absolute(cwd, "cwd")?;
		let params = serde_json::json!({
			"workspace_id": workspace_id,
			"label": label,
			"cwd": cwd.to_string_lossy(),
			"focus": false,
		});
		let success =
			self.request(self.next_id("tabcr"), "tab.create", params)?;
		parse_tab_create_result(&success.result)
	}

	/// List panes in a workspace by `pane_id`. `terminal_id` is ignored.
	pub fn pane_list(
		&self,
		workspace_id: &str,
	) -> Result<Vec<PaneView>, HerdrTransportError> {
		if workspace_id.is_empty() {
			return Err(HerdrTransportError::Refused {
				reason: "pane.list workspace_id is required".into(),
			});
		}
		let params = serde_json::json!({ "workspace_id": workspace_id });
		let success =
			self.request(self.next_id("pnlst"), "pane.list", params)?;
		parse_pane_list_result(&success.result)
	}

	/// Fetch one pane. `pane_not_found` is `Ok(None)`, not a retry.
	pub fn pane_get(
		&self,
		pane_id: &str,
	) -> Result<Option<PaneView>, HerdrTransportError> {
		if pane_id.is_empty() {
			return Err(HerdrTransportError::Refused {
				reason: "pane.get pane_id is required".into(),
			});
		}
		let params = serde_json::json!({ "pane_id": pane_id });
		match self.request(self.next_id("pnget"), "pane.get", params) {
			Ok(success) => parse_pane_view(&success.result).map(Some),
			Err(err) if is_pane_not_found(&err) => Ok(None),
			Err(err) => Err(err),
		}
	}

	/// Terminate a pane. GUI attach/release is not this method. Does not
	/// auto-replay an uncertain outcome. `pane_not_found` is success.
	pub fn pane_close(&self, pane_id: &str) -> Result<(), HerdrTransportError> {
		if pane_id.is_empty() {
			return Err(HerdrTransportError::Refused {
				reason: "pane.close pane_id is required".into(),
			});
		}
		let params = serde_json::json!({ "pane_id": pane_id });
		match self.request(self.next_id("pncls"), "pane.close", params) {
			Ok(_) => Ok(()),
			Err(err) if is_pane_not_found(&err) => Ok(()),
			Err(err) => Err(err),
		}
	}

	/// Submit text to a pane once. `text` must end in a newline so Herdr
	/// treats it as Enter. Does not auto-replay an uncertain outcome.
	/// This is the Task 17 workaround for missing create-time argv.
	pub fn pane_send_input(
		&self,
		pane_id: &str,
		text: &str,
	) -> Result<(), HerdrTransportError> {
		if pane_id.is_empty() {
			return Err(HerdrTransportError::Refused {
				reason: "pane.send_input pane_id is required".into(),
			});
		}
		if text.is_empty() || !text.ends_with('\n') {
			return Err(HerdrTransportError::Refused {
				reason: "pane.send_input text must end in a newline".into(),
			});
		}
		let params = serde_json::json!({
			"pane_id": pane_id,
			"text": text,
		});
		self.request(self.next_id("pnsnd"), "pane.send_input", params)?;
		Ok(())
	}

	pub fn next_id(&self, prefix: &str) -> String {
		format!("{prefix}-{}", self.ids.fetch_add(1, Ordering::Relaxed))
	}

	pub fn request(
		&self,
		id: impl Into<String>,
		method: &str,
		params: Value,
	) -> Result<HerdrSuccess, HerdrTransportError> {
		let inflight = self.start_request(id, method, params)?;
		inflight.wait_timeout(self.options.request_timeout)
	}

	pub fn start_request(
		&self,
		id: impl Into<String>,
		method: &str,
		params: Value,
	) -> Result<InflightRequest, HerdrTransportError> {
		let id = id.into();
		if method == "server.stop" {
			return Err(HerdrTransportError::Refused {
				reason: "server.stop is not allowed from this client".into(),
			});
		}
		if method == "events.subscribe" {
			return Err(HerdrTransportError::Refused {
				reason: "use HerdrSubscription for events.subscribe".into(),
			});
		}
		if id.is_empty() || method.is_empty() {
			return Err(HerdrTransportError::Refused {
				reason: "request id and method are required".into(),
			});
		}
		let payload = encode_request(
			&id,
			method,
			&params,
			self.options.max_message_bytes,
		)?;
		let mut stream =
			open_request_stream(&self.path, self.options.read_poll)?;
		if let Err(err) =
			stream.write_all(&payload).and_then(|_| stream.flush())
		{
			return Err(fail_after_send(&id, method, err.into()));
		}
		let mut reader = stream.try_clone()?;
		let shutdown_stream = stream.try_clone()?;
		drop(stream);
		let (tx, rx) = mpsc::sync_channel(1);
		let cancelled = Arc::new(AtomicBool::new(false));
		let cancel_flag = Arc::clone(&cancelled);
		let expected_id = id.clone();
		let expected_method = method.to_string();
		let max = self.options.max_message_bytes;
		thread::Builder::new()
			.name("herdr-rpc".into())
			.spawn(move || {
				let result = read_one_response(
					&mut reader,
					&expected_id,
					&expected_method,
					max,
					&cancel_flag,
				);
				let _ = tx.send(result);
			})
			.map_err(HerdrTransportError::from)?;
		Ok(InflightRequest {
			id,
			method: method.to_string(),
			rx,
			cancelled,
			shutdown: Mutex::new(Some(Box::new(move || {
				shutdown_stream.shutdown();
			}))),
			finished: false,
		})
	}
}

impl InflightRequest {
	pub fn id(&self) -> &str {
		&self.id
	}

	pub fn method(&self) -> &str {
		&self.method
	}

	pub fn cancel(&self) {
		self.cancelled.store(true, Ordering::SeqCst);
		if let Ok(mut slot) = self.shutdown.lock() {
			if let Some(shutdown) = slot.take() {
				shutdown();
			}
		}
	}

	pub fn wait(self) -> Result<HerdrSuccess, HerdrTransportError> {
		self.wait_timeout(None)
	}

	pub fn wait_timeout(
		mut self,
		timeout: Option<Duration>,
	) -> Result<HerdrSuccess, HerdrTransportError> {
		let result = match timeout {
			None => match self.rx.recv() {
				Ok(result) => result,
				Err(_) => Err(self.closed_error()),
			},
			Some(duration) => match self.rx.recv_timeout(duration) {
				Ok(result) => result,
				Err(RecvTimeoutError::Timeout) => {
					self.cancel();
					Err(self.timeout_error())
				}
				Err(RecvTimeoutError::Disconnected) => Err(self.closed_error()),
			},
		};
		self.finished = true;
		result
	}

	fn closed_error(&self) -> HerdrTransportError {
		if self.cancelled.load(Ordering::SeqCst) {
			HerdrTransportError::Cancelled {
				id: self.id.clone(),
				method: self.method.clone(),
			}
		} else {
			fail_closed(&self.id, &self.method)
		}
	}

	fn timeout_error(&self) -> HerdrTransportError {
		if outcome_uncertain(&self.method) {
			HerdrTransportError::UncertainOutcome {
				id: self.id.clone(),
				method: self.method.clone(),
			}
		} else {
			HerdrTransportError::Timeout {
				id: self.id.clone(),
				method: self.method.clone(),
			}
		}
	}
}

impl Drop for InflightRequest {
	fn drop(&mut self) {
		if !self.finished {
			self.cancel();
		}
	}
}

/// Dedicated subscribe connection. Not multiplexed with request ids.
pub struct HerdrSubscription {
	reader: Box<dyn Read + Send>,
	framer: NdjsonFramer,
	leftover: VecDeque<Vec<u8>>,
	_writer: Box<dyn Write + Send>,
	pub ack: SubscriptionStarted,
}

impl HerdrSubscription {
	pub fn connect(
		path: &Path,
		id: &str,
		params: Value,
	) -> Result<Self, HerdrTransportError> {
		Self::connect_with(path, id, params, HerdrClientOptions::default())
	}

	pub fn connect_with(
		path: &Path,
		id: &str,
		params: Value,
		options: HerdrClientOptions,
	) -> Result<Self, HerdrTransportError> {
		endpoint_not_allowed(path)?;
		let stream = open_request_stream(path, options.read_poll)?;
		let writer = stream.try_clone()?;
		Self::from_split(stream, writer, id, params, options)
	}

	fn from_split(
		mut reader: impl Read + Send + 'static,
		mut writer: impl Write + Send + 'static,
		id: &str,
		params: Value,
		options: HerdrClientOptions,
	) -> Result<Self, HerdrTransportError> {
		let payload = encode_request(
			id,
			"events.subscribe",
			&params,
			options.max_message_bytes,
		)?;
		writer.write_all(&payload)?;
		writer.flush()?;
		let mut framer = NdjsonFramer::new(options.max_message_bytes);
		let mut leftover = VecDeque::new();
		let ack = wait_subscription_ack(
			&mut reader,
			&mut framer,
			&mut leftover,
			id,
			options.request_timeout,
		)?;
		Ok(Self {
			reader: Box::new(reader),
			framer,
			leftover,
			_writer: Box::new(writer),
			ack,
		})
	}

	/// One non-blocking poll. `Ok(None)` means the read timeout elapsed
	/// with no event, so a sync loop can check shutdown or take a snapshot.
	pub fn poll_event(
		&mut self,
	) -> Result<Option<SubscriptionEvent>, HerdrTransportError> {
		loop {
			match read_line(
				&mut self.reader,
				&mut self.framer,
				&mut self.leftover,
			) {
				Ok(None) => {
					return Err(HerdrTransportError::Disconnected {
						id: self.ack.id.clone(),
						method: "events.subscribe".into(),
					});
				}
				Ok(Some(line)) => {
					if let Some(event) = decode_event(&line)? {
						return Ok(Some(event));
					}
				}
				Err(err) if is_io_timeout(&err) => return Ok(None),
				Err(err) => return Err(err),
			}
		}
	}

	pub fn next_event(
		&mut self,
	) -> Result<SubscriptionEvent, HerdrTransportError> {
		loop {
			if let Some(event) = self.poll_event()? {
				return Ok(event);
			}
		}
	}
}

struct RequestStream {
	#[cfg(unix)]
	inner: std::os::unix::net::UnixStream,
	#[cfg(windows)]
	inner: std::fs::File,
}

impl RequestStream {
	fn try_clone(&self) -> io::Result<Self> {
		Ok(Self {
			inner: self.inner.try_clone()?,
		})
	}

	fn shutdown(&self) {
		#[cfg(unix)]
		{
			let _ = self.inner.shutdown(std::net::Shutdown::Both);
		}
		#[cfg(windows)]
		{
			let _ = self;
		}
	}
}

impl Read for RequestStream {
	fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
		self.inner.read(buf)
	}
}

impl Write for RequestStream {
	fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
		self.inner.write(buf)
	}

	fn flush(&mut self) -> io::Result<()> {
		self.inner.flush()
	}
}

fn open_request_stream(
	path: &Path,
	poll: Duration,
) -> Result<RequestStream, HerdrTransportError> {
	#[cfg(unix)]
	{
		use std::os::unix::net::UnixStream;
		let stream = UnixStream::connect(path)?;
		stream.set_read_timeout(Some(poll))?;
		stream.set_write_timeout(Some(poll))?;
		Ok(RequestStream { inner: stream })
	}
	#[cfg(windows)]
	{
		let _ = poll;
		let pipe = windows_named_pipe_path(path)?;
		Ok(RequestStream {
			inner: open_named_pipe(&pipe)?,
		})
	}
	#[cfg(not(any(unix, windows)))]
	{
		let _ = (path, poll);
		Err(HerdrTransportError::Refused {
			reason: "Herdr JSON transport is Unix or Windows only".into(),
		})
	}
}

#[cfg(windows)]
fn open_named_pipe(path: &str) -> Result<std::fs::File, HerdrTransportError> {
	use std::fs::OpenOptions;
	use std::time::Instant;

	let deadline = Instant::now() + Duration::from_secs(1);
	loop {
		match OpenOptions::new().read(true).write(true).open(path) {
			Ok(file) => return Ok(file),
			Err(err)
				if err.raw_os_error() == Some(231)
					&& Instant::now() < deadline =>
			{
				thread::sleep(Duration::from_millis(50));
			}
			Err(err) => return Err(err.into()),
		}
	}
}

fn encode_request(
	id: &str,
	method: &str,
	params: &Value,
	limit: usize,
) -> Result<Vec<u8>, HerdrTransportError> {
	let mut payload =
		serde_json::to_vec(&WireRequest { id, method, params })
			.map_err(|err| HerdrTransportError::InvalidJson(err.to_string()))?;
	if payload.len() > limit {
		return Err(HerdrTransportError::MessageTooLarge {
			size: payload.len(),
			limit,
		});
	}
	payload.push(b'\n');
	Ok(payload)
}

fn read_one_response(
	reader: &mut dyn Read,
	id: &str,
	method: &str,
	max: usize,
	cancel: &AtomicBool,
) -> Result<HerdrSuccess, HerdrTransportError> {
	let mut framer = NdjsonFramer::new(max);
	let mut leftover = VecDeque::new();
	loop {
		if cancel.load(Ordering::SeqCst) {
			return Err(HerdrTransportError::Cancelled {
				id: id.to_string(),
				method: method.to_string(),
			});
		}
		match read_line(reader, &mut framer, &mut leftover) {
			Ok(None) => {
				return Err(map_read_failure(
					id,
					method,
					fail_closed(id, method),
					cancel,
				));
			}
			Ok(Some(line)) => match decode_response(&line) {
				Ok(Decoded::Success(success)) if success.id == id => {
					return Ok(success);
				}
				Ok(Decoded::Success(success)) => {
					return Err(HerdrTransportError::UnexpectedMessage(
						format!(
							"response id {} did not match {id}",
							success.id
						),
					));
				}
				Ok(Decoded::Rpc(err)) => {
					return Err(HerdrTransportError::Rpc(err));
				}
				Ok(Decoded::Event(_)) => {}
				Err(err) => {
					return Err(map_read_failure(id, method, err, cancel));
				}
			},
			Err(err) if is_io_timeout(&err) => continue,
			Err(err) => return Err(map_read_failure(id, method, err, cancel)),
		}
	}
}

fn is_io_timeout(err: &HerdrTransportError) -> bool {
	matches!(err, HerdrTransportError::Io(io_err) if is_timeout(io_err))
}

fn is_timeout(err: &io::Error) -> bool {
	err.kind() == io::ErrorKind::TimedOut
		|| err.kind() == io::ErrorKind::WouldBlock
		|| err.kind() == io::ErrorKind::Interrupted
}

fn map_read_failure(
	id: &str,
	method: &str,
	err: HerdrTransportError,
	cancel: &AtomicBool,
) -> HerdrTransportError {
	if cancel.load(Ordering::SeqCst) {
		return HerdrTransportError::Cancelled {
			id: id.to_string(),
			method: method.to_string(),
		};
	}
	match err {
		HerdrTransportError::MessageTooLarge { size, limit } => {
			HerdrTransportError::MessageTooLarge { size, limit }
		}
		HerdrTransportError::InvalidJson(msg) => {
			HerdrTransportError::InvalidJson(msg)
		}
		HerdrTransportError::Rpc(rpc) => HerdrTransportError::Rpc(rpc),
		other => {
			if outcome_uncertain(method) {
				HerdrTransportError::UncertainOutcome {
					id: id.to_string(),
					method: method.to_string(),
				}
			} else if matches!(other, HerdrTransportError::Io(_)) {
				fail_closed(id, method)
			} else {
				other
			}
		}
	}
}

enum Decoded {
	Success(HerdrSuccess),
	Rpc(HerdrRpcError),
	Event(SubscriptionEvent),
}

fn decode_response(line: &[u8]) -> Result<Decoded, HerdrTransportError> {
	let text = std::str::from_utf8(line)
		.map_err(|err| HerdrTransportError::InvalidJson(err.to_string()))?;
	let parsed: WireLine = serde_json::from_str(text).map_err(|err| {
		HerdrTransportError::InvalidJson(format!("{err}: {text}"))
	})?;
	if let Some(event) = parsed.event {
		return Ok(Decoded::Event(SubscriptionEvent {
			event,
			data: parsed.data.unwrap_or(Value::Null),
		}));
	}
	let id = parsed.id.ok_or_else(|| {
		HerdrTransportError::UnexpectedMessage(text.to_string())
	})?;
	match (parsed.result, parsed.error) {
		(Some(result), None) => {
			Ok(Decoded::Success(HerdrSuccess { id, result }))
		}
		(None, Some(error)) => Ok(Decoded::Rpc(HerdrRpcError {
			id,
			code: error.code,
			message: error.message,
		})),
		_ => Err(HerdrTransportError::UnexpectedMessage(text.to_string())),
	}
}

fn decode_event(
	line: &[u8],
) -> Result<Option<SubscriptionEvent>, HerdrTransportError> {
	match decode_response(line)? {
		Decoded::Event(event) => Ok(Some(event)),
		Decoded::Success(success) => {
			Err(HerdrTransportError::UnexpectedMessage(format!(
				"unexpected success {}",
				success.id
			)))
		}
		Decoded::Rpc(err) => Err(HerdrTransportError::Rpc(err)),
	}
}

fn wait_subscription_ack(
	reader: &mut dyn Read,
	framer: &mut NdjsonFramer,
	leftover: &mut VecDeque<Vec<u8>>,
	id: &str,
	timeout: Option<Duration>,
) -> Result<SubscriptionStarted, HerdrTransportError> {
	let deadline = timeout.map(|duration| Instant::now() + duration);
	loop {
		if deadline.is_some_and(|end| Instant::now() >= end) {
			return Err(HerdrTransportError::Timeout {
				id: id.to_string(),
				method: "events.subscribe".into(),
			});
		}
		match read_line(reader, framer, leftover) {
			Ok(None) => {
				return Err(HerdrTransportError::Disconnected {
					id: id.to_string(),
					method: "events.subscribe".into(),
				});
			}
			Ok(Some(line)) => match decode_response(&line)? {
				Decoded::Success(success) if success.id == id => {
					let kind =
						success.result.get("type").and_then(Value::as_str);
					if kind != Some("subscription_started") {
						return Err(HerdrTransportError::UnexpectedMessage(
							success.result.to_string(),
						));
					}
					return Ok(SubscriptionStarted { id: success.id });
				}
				Decoded::Rpc(err) => return Err(HerdrTransportError::Rpc(err)),
				Decoded::Event(_) | Decoded::Success(_) => {}
			},
			Err(err) if is_io_timeout(&err) => continue,
			Err(err) => return Err(err),
		}
	}
}

fn read_line(
	reader: &mut dyn Read,
	framer: &mut NdjsonFramer,
	leftover: &mut VecDeque<Vec<u8>>,
) -> Result<Option<Vec<u8>>, HerdrTransportError> {
	if let Some(line) = leftover.pop_front() {
		return Ok(Some(line));
	}
	let mut buf = [0_u8; 4096];
	loop {
		match reader.read(&mut buf) {
			Ok(0) => return Ok(None),
			Ok(n) => {
				let mut lines = framer.push(&buf[..n])?;
				if lines.is_empty() {
					continue;
				}
				let first = lines.remove(0);
				leftover.extend(lines);
				return Ok(Some(first));
			}
			Err(err) if is_timeout(&err) => {
				return Err(err.into());
			}
			Err(err) => return Err(err.into()),
		}
	}
}

fn fail_closed(id: &str, method: &str) -> HerdrTransportError {
	if outcome_uncertain(method) {
		HerdrTransportError::UncertainOutcome {
			id: id.to_string(),
			method: method.to_string(),
		}
	} else {
		HerdrTransportError::Disconnected {
			id: id.to_string(),
			method: method.to_string(),
		}
	}
}

fn fail_after_send(
	id: &str,
	method: &str,
	err: HerdrTransportError,
) -> HerdrTransportError {
	if outcome_uncertain(method) {
		HerdrTransportError::UncertainOutcome {
			id: id.to_string(),
			method: method.to_string(),
		}
	} else {
		err
	}
}

#[cfg(test)]
mod tests {
	use super::*;
	use std::path::{Path, PathBuf};

	#[test]
	fn framer_reassembles_split_lines_and_rejects_oversize() {
		let mut framer = NdjsonFramer::new(32);
		assert!(framer.push(b"{\"id\":").unwrap().is_empty());
		let lines = framer.push(b"\"a\"}\n{\"id\":\"b\"}\n").unwrap();
		assert_eq!(lines.len(), 2);
		assert_eq!(lines[0], br#"{"id":"a"}"#);
		let err = framer.push(&[b'x'; 40]).unwrap_err();
		assert!(matches!(
			err,
			HerdrTransportError::MessageTooLarge { limit: 32, .. }
		));
	}

	#[test]
	fn windows_pipe_mapping_follows_documented_convention() {
		let prefixed =
			windows_named_pipe_path(Path::new(r"\\.\pipe\herdr.sock")).unwrap();
		assert_eq!(prefixed, r"\\.\pipe\herdr.sock");
		let from_marker = windows_named_pipe_path(Path::new(
			r"C:\Users\me\herdr\sessions\2code\herdr.sock",
		))
		.unwrap();
		assert_eq!(
			from_marker,
			r"\\.\pipe\C:\Users\me\herdr\sessions\2code\herdr.sock"
		);
		let unix_identity =
			windows_named_pipe_path(Path::new("/tmp/2code-herdr.sock"))
				.unwrap();
		assert_eq!(unix_identity, r"\\.\pipe\/tmp/2code-herdr.sock");
		let nt =
			windows_named_pipe_path(Path::new(r"\\?\pipe\herdr.sock")).unwrap();
		assert_eq!(nt, r"\\?\pipe\herdr.sock");
		let slash =
			windows_named_pipe_path(Path::new("//./pipe/herdr.sock")).unwrap();
		assert_eq!(slash, "//./pipe/herdr.sock");
		let unknown =
			windows_named_pipe_path(Path::new(r"\\server\share\herdr.sock"))
				.unwrap_err();
		assert!(matches!(
			unknown,
			HerdrTransportError::UnknownPipeLayout { .. }
		));
		assert!(windows_named_pipe_path(Path::new("")).is_err());
	}

	#[test]
	fn default_session_and_client_socket_are_refused() {
		let default = PathBuf::from("/home/me/.config/herdr/herdr.sock");
		let err = endpoint_not_allowed(&default).unwrap_err();
		assert!(err.to_string().contains("default Herdr session"));
		let client = PathBuf::from("/tmp/2c1-client.sock");
		let err = endpoint_not_allowed(&client).unwrap_err();
		assert!(err.to_string().contains("herdr-client.sock"));
		let ok = PathBuf::from("/tmp/2code-herdr-abcd.sock");
		endpoint_not_allowed(&ok).unwrap();
	}

	#[test]
	fn mutation_disconnect_is_uncertain_and_distinct() {
		assert!(outcome_uncertain("workspace.create"));
		assert!(outcome_uncertain("worktree.create"));
		assert!(outcome_uncertain("worktree.list"));
		assert!(outcome_uncertain("worktree.open"));
		assert!(outcome_uncertain("worktree.remove"));
		assert!(outcome_uncertain("tab.close"));
		assert!(outcome_uncertain("pane.send_input"));
		assert!(outcome_uncertain("server.stop"));
		assert!(!outcome_uncertain("ping"));
		assert!(!outcome_uncertain("session.snapshot"));
		let uncertain = HerdrTransportError::UncertainOutcome {
			id: "m1".into(),
			method: "workspace.create".into(),
		};
		let disconnected = HerdrTransportError::Disconnected {
			id: "p1".into(),
			method: "ping".into(),
		};
		assert!(uncertain.is_uncertain());
		assert!(!disconnected.is_uncertain());
		let app = AppError::from(uncertain);
		assert!(app.to_string().contains("uncertain"));
		assert!(!AppError::from(disconnected)
			.to_string()
			.contains("uncertain"));
	}

	#[test]
	fn worktree_open_parses_workspace_id_and_refuses_relative_paths() {
		let opened = parse_worktree_open_result(&serde_json::json!({
			"type": "worktree_opened",
			"already_open": true,
			"workspace": { "workspace_id": "w1", "label": "Renamed" },
			"root_pane": { "pane_id": "w1:p1", "terminal_id": "term_x" }
		}))
		.unwrap();
		assert_eq!(opened.workspace_id, "w1");
		assert!(opened.already_open);
		assert!(parse_worktree_open_result(&serde_json::json!({
			"type": "worktree_created",
			"workspace": { "workspace_id": "w2" },
			"already_open": false
		}))
		.is_err());
		assert!(parse_worktree_open_result(&serde_json::json!({
			"type": "worktree_opened",
			"already_open": false,
			"workspace": { "label": "App" }
		}))
		.is_err());
		let src = include_str!("transport.rs");
		let helper = src
			.split("pub fn worktree_open")
			.nth(1)
			.unwrap()
			.split("/// Create a linked git worktree")
			.next()
			.unwrap();
		assert!(helper.contains("worktree.open"));
		assert!(!helper.contains("worktree.create"));
		assert!(!helper.contains("worktree.remove"));
		assert!(!helper.contains("workspace.create"));
		assert!(!helper.contains("git worktree"));

		let client =
			HerdrClient::connect_path(Path::new("/tmp/ok.sock")).unwrap();
		let relative = client
			.worktree_open(Path::new("repo"), Path::new("repo"))
			.unwrap_err();
		assert!(matches!(relative, HerdrTransportError::Refused { .. }));
		assert!(relative.to_string().contains("absolute"));
	}

	#[test]
	fn worktree_create_parses_workspace_id_and_checkout_path() {
		let created = parse_worktree_create_result(&serde_json::json!({
			"type": "worktree_created",
			"workspace": { "workspace_id": "w2", "label": "wt" },
			"tab": { "tab_id": "w2:t1" },
			"root_pane": { "pane_id": "w2:p1", "terminal_id": "term_x" },
			"worktree": { "path": "/repo/wt", "branch": "feat/x" }
		}))
		.unwrap();
		assert_eq!(created.workspace_id, "w2");
		assert_eq!(created.path, "/repo/wt");
		assert!(parse_worktree_create_result(&serde_json::json!({
			"type": "worktree_opened",
			"workspace": { "workspace_id": "w2" },
			"worktree": { "path": "/repo/wt" }
		}))
		.is_err());
		assert!(parse_worktree_create_result(&serde_json::json!({
			"type": "worktree_created",
			"workspace": { "workspace_id": "w2" },
			"worktree": { "branch": "feat/x" }
		}))
		.is_err());

		let listed = parse_worktree_list_result(&serde_json::json!({
			"type": "worktree_list",
			"worktrees": [
				{
					"path": "/repo/wt",
					"branch": "feat/x",
					"open_workspace_id": "w2",
					"is_linked_worktree": true
				}
			]
		}))
		.unwrap();
		assert_eq!(
			listed,
			vec![WorktreeListEntry {
				path: "/repo/wt".into(),
				branch: Some("feat/x".into()),
				workspace_id: Some("w2".into()),
				is_linked_worktree: true,
			}]
		);
	}

	#[test]
	fn worktree_remove_parses_workspace_id_path_and_forced() {
		let removed = parse_worktree_remove_result(&serde_json::json!({
			"type": "worktree_removed",
			"workspace_id": "w5",
			"path": "/repo/wt",
			"forced": true
		}))
		.unwrap();
		assert_eq!(removed.workspace_id, "w5");
		assert_eq!(removed.path, "/repo/wt");
		assert!(removed.forced);
		assert!(parse_worktree_remove_result(&serde_json::json!({
			"type": "worktree_created",
			"workspace_id": "w5",
			"path": "/repo/wt",
			"forced": false
		}))
		.is_err());
		assert!(parse_worktree_remove_result(&serde_json::json!({
			"type": "worktree_removed",
			"path": "/repo/wt",
			"forced": false
		}))
		.is_err());
		assert!(parse_worktree_remove_result(&serde_json::json!({
			"type": "worktree_removed",
			"workspace_id": "w5",
			"forced": false
		}))
		.is_err());
		assert!(parse_worktree_remove_result(&serde_json::json!({
			"type": "worktree_removed",
			"workspace_id": "w5",
			"path": "/repo/wt"
		}))
		.is_err());
	}

	#[test]
	fn workspace_create_parses_workspace_id_and_ignores_live_ids() {
		let created = parse_workspace_create_result(&serde_json::json!({
			"type": "workspace_created",
			"workspace": { "workspace_id": "w3", "label": "notes" },
			"tab": { "tab_id": "w3:t1" },
			"root_pane": { "pane_id": "w3:p1", "terminal_id": "term_x" }
		}))
		.unwrap();
		assert_eq!(created.workspace_id, "w3");
		assert!(parse_workspace_create_result(&serde_json::json!({
			"type": "worktree_created",
			"workspace": { "workspace_id": "w3" }
		}))
		.is_err());
		assert!(parse_workspace_create_result(&serde_json::json!({
			"type": "workspace_created",
			"workspace": { "label": "notes" }
		}))
		.is_err());
		parse_workspace_close_result(&serde_json::json!({
			"type": "workspace_closed",
			"workspace_id": "w3"
		}))
		.unwrap();
		assert!(parse_workspace_close_result(&serde_json::json!({
			"type": "workspace_created",
			"workspace_id": "w3"
		}))
		.is_err());
	}

	#[test]
	fn tab_create_and_pane_views_parse_pane_id_never_terminal_id() {
		let created = parse_tab_create_result(&serde_json::json!({
			"type": "tab_created",
			"tab": { "tab_id": "w1:t2", "workspace_id": "w1", "label": "extra" },
			"root_pane": { "pane_id": "w1:p3", "terminal_id": "term_live" }
		}))
		.unwrap();
		assert_eq!(created.workspace_id, "w1");
		assert_eq!(created.tab_id, "w1:t2");
		assert_eq!(created.pane_id, "w1:p3");
		assert!(parse_tab_create_result(&serde_json::json!({
			"type": "tab_created",
			"tab": { "tab_id": "w1:t2", "workspace_id": "w1" },
			"root_pane": { "terminal_id": "term_live" }
		}))
		.is_err());
		assert!(parse_tab_create_result(&serde_json::json!({
			"type": "workspace_created",
			"tab": { "tab_id": "w1:t1", "workspace_id": "w1" },
			"root_pane": { "pane_id": "w1:p1" }
		}))
		.is_err());

		let listed = parse_pane_list_result(&serde_json::json!({
			"type": "pane_list",
			"panes": [
				{
					"pane_id": "w1:p1",
					"tab_id": "w1:t1",
					"workspace_id": "w1",
					"terminal_id": "term_x"
				}
			]
		}))
		.unwrap();
		assert_eq!(
			listed,
			vec![PaneView {
				pane_id: "w1:p1".into(),
				tab_id: "w1:t1".into(),
				workspace_id: "w1".into(),
			}]
		);
		let got = parse_pane_view(&serde_json::json!({
			"type": "pane",
			"pane": {
				"pane_id": "w1:p1",
				"tab_id": "w1:t1",
				"workspace_id": "w1",
				"terminal_id": "term_x"
			}
		}))
		.unwrap();
		assert_eq!(got.pane_id, "w1:p1");
		assert_ne!(got.pane_id, "term_x");
		assert!(is_pane_not_found(&HerdrTransportError::Rpc(
			HerdrRpcError {
				id: "1".into(),
				code: "pane_not_found".into(),
				message: "missing".into(),
			}
		)));
		assert!(!is_pane_not_found(&HerdrTransportError::Rpc(
			HerdrRpcError {
				id: "1".into(),
				code: "unavailable".into(),
				message: "down".into(),
			}
		)));
		assert!(outcome_uncertain("tab.create"));
		assert!(outcome_uncertain("pane.close"));
		assert!(outcome_uncertain("pane.list"));
		assert!(outcome_uncertain("pane.get"));
		assert!(!outcome_uncertain("session.snapshot"));
	}

	#[test]
	fn server_stop_is_refused_without_a_socket() {
		assert!(outcome_uncertain("server.stop"));
		let err = HerdrClient::connect_path(Path::new(
			"/home/me/.config/herdr/herdr.sock",
		))
		.unwrap_err();
		assert!(matches!(err, HerdrTransportError::Refused { .. }));
		let err = HerdrClient::connect_with(
			Path::new("/tmp/ok.sock"),
			HerdrClientOptions::default(),
		)
		.unwrap()
		.request("s1", "server.stop", Value::Object(Default::default()))
		.unwrap_err();
		assert!(matches!(err, HerdrTransportError::Refused { .. }));
		let err = HerdrClient::connect_path(Path::new("/tmp/ok.sock"))
			.unwrap()
			.request(
				"sub",
				"events.subscribe",
				Value::Object(Default::default()),
			)
			.unwrap_err();
		assert!(matches!(err, HerdrTransportError::Refused { .. }));
	}
}

#[cfg(all(test, unix))]
mod unix_tests {
	use super::*;
	use serde_json::json;
	use std::io::{BufRead, BufReader};
	use std::os::unix::net::{UnixListener, UnixStream};
	use std::path::{Path, PathBuf};
	use std::sync::atomic::{AtomicUsize, Ordering as AtomicOrdering};
	use std::time::Instant;

	fn test_options() -> HerdrClientOptions {
		HerdrClientOptions {
			max_message_bytes: 1024,
			read_poll: Duration::from_millis(50),
			request_timeout: Some(Duration::from_secs(2)),
		}
	}

	fn serve(
		handler: impl Fn(UnixStream) + Send + Sync + 'static,
	) -> (tempfile::TempDir, PathBuf) {
		let dir = tempfile::tempdir().unwrap();
		let sock = dir.path().join("api.sock");
		let listener = UnixListener::bind(&sock).unwrap();
		let handler = Arc::new(handler);
		thread::spawn(move || {
			for stream in listener.incoming() {
				let Ok(stream) = stream else {
					break;
				};
				let handler = Arc::clone(&handler);
				thread::spawn(move || handler(stream));
			}
		});
		(dir, sock)
	}

	fn client(sock: &Path) -> HerdrClient {
		HerdrClient::connect_with(sock, test_options()).unwrap()
	}

	fn read_request(stream: &UnixStream) -> Value {
		let mut line = String::new();
		BufReader::new(stream.try_clone().unwrap())
			.read_line(&mut line)
			.unwrap();
		serde_json::from_str(&line).unwrap()
	}

	fn write_chunks(server: &mut UnixStream, chunks: &[&[u8]]) {
		for chunk in chunks {
			server.write_all(chunk).unwrap();
			server.flush().unwrap();
			thread::sleep(Duration::from_millis(5));
		}
	}

	#[test]
	fn fragmented_pong_roundtrip() {
		let (_dir, sock) = serve(|mut stream| {
			let req = read_request(&stream);
			assert_eq!(req["method"], "ping");
			assert_eq!(req["id"], "req_1");
			write_chunks(
				&mut stream,
				&[
					br#"{"id":"req_1","result":{"type":"po"#,
					br#"ng","version":"0.9.0","protocol":22}}"#,
					b"\n",
				],
			);
		});
		let success =
			client(&sock).request("req_1", "ping", json!({})).unwrap();
		assert_eq!(success.id, "req_1");
		assert_eq!(success.result["type"], "pong");
		assert_eq!(success.result["protocol"], 22);
	}

	#[test]
	fn concurrent_requests_use_separate_connections() {
		let seen = Arc::new(AtomicUsize::new(0));
		let seen_h = Arc::clone(&seen);
		let (_dir, sock) = serve(move |stream| {
			seen_h.fetch_add(1, AtomicOrdering::SeqCst);
			let req = read_request(&stream);
			let id = req["id"].as_str().unwrap().to_string();
			let n = if id == "a" { 1 } else { 2 };
			let mut stream = stream;
			let body = format!(
				r#"{{"id":"{id}","result":{{"type":"pong","n":{n}}}}}"#
			);
			stream.write_all(body.as_bytes()).unwrap();
			stream.write_all(b"\n").unwrap();
		});
		let client = client(&sock);
		thread::scope(|scope| {
			let a =
				scope.spawn(|| client.request("a", "ping", json!({})).unwrap());
			let b =
				scope.spawn(|| client.request("b", "ping", json!({})).unwrap());
			assert_eq!(a.join().unwrap().result["n"], 1);
			assert_eq!(b.join().unwrap().result["n"], 2);
		});
		assert_eq!(seen.load(AtomicOrdering::SeqCst), 2);
	}

	#[test]
	fn mismatched_response_id_is_unexpected() {
		let (_dir, sock) = serve(|mut stream| {
			let _ = read_request(&stream);
			stream
				.write_all(
					br#"{"id":"other","result":{"type":"pong"}}
"#,
				)
				.unwrap();
		});
		let err = client(&sock).request("p1", "ping", json!({})).unwrap_err();
		assert!(
			matches!(err, HerdrTransportError::UnexpectedMessage(_)),
			"{err}"
		);
	}

	#[test]
	fn disconnect_does_not_replay_a_mutation() {
		let seen = Arc::new(AtomicUsize::new(0));
		let seen_h = Arc::clone(&seen);
		let (_dir, sock) = serve(move |stream| {
			let req = read_request(&stream);
			assert_eq!(req["method"], "workspace.create");
			seen_h.fetch_add(1, AtomicOrdering::SeqCst);
			drop(stream);
		});
		let err = client(&sock)
			.request("m1", "workspace.create", json!({"cwd": "/tmp"}))
			.unwrap_err();
		assert!(err.is_uncertain(), "{err}");
		match err {
			HerdrTransportError::UncertainOutcome { method, .. } => {
				assert_eq!(method, "workspace.create");
			}
			other => panic!("expected UncertainOutcome, got {other:?}"),
		}
		thread::sleep(Duration::from_millis(80));
		assert_eq!(seen.load(AtomicOrdering::SeqCst), 1);
	}

	#[test]
	fn ping_disconnect_is_not_uncertain() {
		let (_dir, sock) = serve(|stream| {
			let _ = read_request(&stream);
			drop(stream);
		});
		let err = client(&sock).request("p1", "ping", json!({})).unwrap_err();
		assert!(!err.is_uncertain(), "{err}");
		assert!(matches!(err, HerdrTransportError::Disconnected { .. }));
	}

	#[test]
	fn oversize_response_fails_closed() {
		let (_dir, sock) = serve(|mut stream| {
			let _ = read_request(&stream);
			let mut huge = vec![b'x'; 2000];
			huge.push(b'\n');
			let _ = stream.write_all(&huge);
		});
		let err = client(&sock).request("p1", "ping", json!({})).unwrap_err();
		assert!(
			matches!(err, HerdrTransportError::MessageTooLarge { .. })
				|| matches!(err, HerdrTransportError::Disconnected { .. }),
			"{err}"
		);
	}

	#[test]
	fn cancel_drops_wait_without_retry() {
		let seen = Arc::new(AtomicUsize::new(0));
		let seen_h = Arc::clone(&seen);
		let (_dir, sock) = serve(move |mut stream| {
			let _ = read_request(&stream);
			seen_h.fetch_add(1, AtomicOrdering::SeqCst);
			thread::sleep(Duration::from_millis(400));
			let _ = stream.write_all(
				br#"{"id":"c1","result":{"type":"pong"}}
"#,
			);
		});
		let inflight = client(&sock)
			.start_request("c1", "ping", json!({}))
			.unwrap();
		inflight.cancel();
		let err = inflight.wait().unwrap_err();
		assert!(
			matches!(err, HerdrTransportError::Cancelled { .. }),
			"{err}"
		);
		thread::sleep(Duration::from_millis(80));
		assert_eq!(seen.load(AtomicOrdering::SeqCst), 1);
	}

	#[test]
	fn structured_rpc_error_preserves_code() {
		let (_dir, sock) = serve(|mut stream| {
			let _ = read_request(&stream);
			stream
				.write_all(br#"{"id":"e1","error":{"code":"dirty_worktree_requires_force","message":"use --force"}}
"#)
				.unwrap();
		});
		let err = client(&sock)
			.request("e1", "worktree.remove", json!({}))
			.unwrap_err();
		match err {
			HerdrTransportError::Rpc(rpc) => {
				assert_eq!(rpc.code, "dirty_worktree_requires_force");
				assert_eq!(rpc.id, "e1");
			}
			other => panic!("expected rpc, got {other:?}"),
		}
	}

	#[test]
	fn server_stop_is_not_written() {
		let seen = Arc::new(AtomicUsize::new(0));
		let seen_h = Arc::clone(&seen);
		let (_dir, sock) = serve(move |_stream| {
			seen_h.fetch_add(1, AtomicOrdering::SeqCst);
		});
		let err = client(&sock)
			.request("s1", "server.stop", json!({}))
			.unwrap_err();
		assert!(matches!(err, HerdrTransportError::Refused { .. }), "{err}");
		thread::sleep(Duration::from_millis(80));
		assert_eq!(seen.load(AtomicOrdering::SeqCst), 0);
	}

	#[test]
	fn subscribe_ack_then_event_line() {
		let dir = tempfile::tempdir().unwrap();
		let sock = dir.path().join("sub.sock");
		let listener = UnixListener::bind(&sock).unwrap();
		let worker =
			thread::spawn(move || {
				let (mut stream, _) = listener.accept().unwrap();
				let mut line = String::new();
				BufReader::new(stream.try_clone().unwrap())
					.read_line(&mut line)
					.unwrap();
				assert!(line.contains("events.subscribe"));
				stream
				.write_all(br#"{"id":"sub","result":{"type":"subscription_started"}}
{"event":"tab_created","data":{"type":"tab_created"}}
"#)
				.unwrap();
				thread::sleep(Duration::from_millis(50));
			});
		let mut sub = HerdrSubscription::connect_with(
			&sock,
			"sub",
			json!({"subscriptions":[{"type":"tab.created"}]}),
			test_options(),
		)
		.unwrap();
		assert_eq!(sub.ack.id, "sub");
		let event = sub.next_event().unwrap();
		assert_eq!(event.event, "tab_created");
		worker.join().unwrap();
	}

	struct Live {
		bin: PathBuf,
		root: tempfile::TempDir,
		namespace: crate::herdr::process::HerdrNamespace,
		server: std::process::Child,
		_lock: std::sync::MutexGuard<'static, ()>,
	}

	impl Live {
		fn start() -> Option<Self> {
			let lock = crate::herdr::lock_live_herdr_tests();
			let bin = live_binary()?;
			let root = tempfile::tempdir().unwrap();
			let xdg = root.path().join("xdg-config");
			std::fs::create_dir_all(xdg.join("herdr")).unwrap();
			std::fs::write(
				xdg.join("herdr/config.toml"),
				"onboarding = false\n\n[ui.sound]\nenabled = false\n",
			)
			.unwrap();
			let namespace =
				crate::herdr::process::resolve_namespace(xdg).unwrap();
			if let Some(parent) = namespace.socket_path.parent() {
				std::fs::create_dir_all(parent).unwrap();
			}
			let log =
				std::fs::File::create(root.path().join("server.log")).unwrap();
			let mut cmd =
				crate::no_window::command_without_windows_console(&bin);
			cmd.env("HOME", root.path().join("home"))
				.env("XDG_CONFIG_HOME", &namespace.xdg_config_home)
				.env("XDG_STATE_HOME", root.path().join("xdg-state"))
				.env("XDG_CACHE_HOME", root.path().join("xdg-cache"))
				.env("HERDR_SESSION", crate::herdr::process::SESSION_NAME)
				.env("HERDR_SOCKET_PATH", &namespace.socket_path)
				.env("HERDR_DISABLE_SOUND", "1")
				.env_remove("HERDR_CLIENT_SOCKET_PATH")
				.arg("server")
				.stdin(std::process::Stdio::null())
				.stdout(std::process::Stdio::from(log.try_clone().unwrap()))
				.stderr(std::process::Stdio::from(log));
			let server = cmd.spawn().unwrap();
			let live = Self {
				bin,
				root,
				namespace,
				server,
				_lock: lock,
			};
			live.wait_socket();
			Some(live)
		}

		fn wait_socket(&self) {
			let deadline = Instant::now() + Duration::from_secs(10);
			while Instant::now() < deadline {
				if self.server_exited() {
					panic!("herdr server exited early:\n{}", self.server_log());
				}
				if UnixStream::connect(&self.namespace.socket_path).is_ok() {
					return;
				}
				thread::sleep(Duration::from_millis(40));
			}
			panic!("herdr server socket was not ready:\n{}", self.server_log());
		}

		fn server_exited(&self) -> bool {
			let pid = self.server.id();
			!std::process::Command::new("kill")
				.args(["-0", &pid.to_string()])
				.status()
				.map(|status| status.success())
				.unwrap_or(false)
		}

		fn server_log(&self) -> String {
			std::fs::read_to_string(self.root.path().join("server.log"))
				.unwrap_or_default()
		}

		fn client(&self) -> HerdrClient {
			assert!(
				!self.server_exited(),
				"herdr server exited:\n{}",
				self.server_log()
			);
			HerdrClient::connect_path(&self.namespace.socket_path).unwrap()
		}
	}

	impl Drop for Live {
		fn drop(&mut self) {
			let mut cmd = std::process::Command::new(&self.bin);
			cmd.env("HERDR_SESSION", crate::herdr::process::SESSION_NAME)
				.env("HERDR_SOCKET_PATH", &self.namespace.socket_path)
				.env("XDG_CONFIG_HOME", &self.namespace.xdg_config_home)
				.env("HOME", self.root.path().join("home"))
				.args(["server", "stop"])
				.stdin(std::process::Stdio::null())
				.stdout(std::process::Stdio::null())
				.stderr(std::process::Stdio::null());
			let _ = cmd.status();
		}
	}

	fn live_binary() -> Option<PathBuf> {
		if let Ok(Some(path)) = crate::herdr::locate_cached_host_binary() {
			return Some(path);
		}
		let triple = crate::herdr::host_triple().ok()?;
		crate::herdr::try_resolve_sidecar(&crate::herdr::ResolveOptions {
			triple,
			exe_dir: None,
			binaries_dir: Some(&crate::herdr::default_binaries_dir()),
		})
		.ok()
		.flatten()
	}

	fn require_live() -> Option<Live> {
		match Live::start() {
			Some(live) => Some(live),
			None if crate::herdr::sidecar_required()
				|| std::env::var_os("HERDR_CONTRACT_REQUIRED").is_some() =>
			{
				panic!(
					"pinned Herdr binary missing; see docs/herdr-integration.md"
				);
			}
			None => {
				eprintln!(
					"skipping live Herdr transport test (set HERDR_SIDECAR_REQUIRED=1 to fail)"
				);
				None
			}
		}
	}

	#[test]
	fn live_ping_and_snapshot_on_2code_namespace() {
		let Some(live) = require_live() else {
			return;
		};
		assert!(
			!live
				.namespace
				.socket_path
				.to_string_lossy()
				.ends_with("herdr/herdr.sock"),
			"must not use the default session"
		);
		let client = live.client();
		let pong = client.ping().unwrap_or_else(|err| {
			panic!("ping failed: {err}\n{}", live.server_log())
		});
		assert_eq!(pong.result["type"], "pong");
		assert_eq!(pong.result["version"], "0.9.0");
		assert_eq!(pong.result["protocol"], 22);
		let snap = client.session_snapshot().unwrap_or_else(|err| {
			panic!("snapshot failed: {err}\n{}", live.server_log())
		});
		assert_eq!(snap.result["type"], "session_snapshot");
		assert!(snap.result.get("snapshot").is_some());
	}

	#[test]
	fn worktree_open_sends_absolute_path_cwd_trust_and_no_focus() {
		let (_dir, sock) = serve(|mut stream| {
			let req = read_request(&stream);
			assert_eq!(req["method"], "worktree.open");
			assert_eq!(req["params"]["cwd"], "/repo");
			assert_eq!(req["params"]["path"], "/repo/wt");
			assert_eq!(req["params"]["trust_repository"], true);
			assert_eq!(req["params"]["focus"], false);
			assert!(req["params"].get("label").is_none());
			assert!(req["params"].get("branch").is_none());
			assert!(req["params"].get("workspace_id").is_none());
			let id = req["id"].as_str().unwrap();
			let body = format!(
				r#"{{"id":"{id}","result":{{"type":"worktree_opened","already_open":false,"workspace":{{"workspace_id":"w4"}},"root_pane":{{"pane_id":"w4:p1"}}}}}}"#
			);
			stream.write_all(body.as_bytes()).unwrap();
			stream.write_all(b"\n").unwrap();
		});
		let opened = client(&sock)
			.worktree_open(Path::new("/repo"), Path::new("/repo/wt"))
			.unwrap();
		assert_eq!(opened.workspace_id, "w4");
		assert!(!opened.already_open);
	}

	#[test]
	fn worktree_create_sends_branch_cwd_path_trust_and_no_focus() {
		let (_dir, sock) = serve(|mut stream| {
			let req = read_request(&stream);
			assert_eq!(req["method"], "worktree.create");
			assert_eq!(req["params"]["cwd"], "/repo");
			assert_eq!(req["params"]["path"], "/repo/wt");
			assert_eq!(req["params"]["branch"], "feat/x");
			assert_eq!(req["params"]["trust_repository"], true);
			assert_eq!(req["params"]["focus"], false);
			assert!(req["params"].get("workspace_id").is_none());
			assert!(req["params"].get("terminal_id").is_none());
			let id = req["id"].as_str().unwrap();
			let body = format!(
				r#"{{"id":"{id}","result":{{"type":"worktree_created","workspace":{{"workspace_id":"w5"}},"tab":{{"tab_id":"w5:t1"}},"root_pane":{{"pane_id":"w5:p1","terminal_id":"term_live"}},"worktree":{{"path":"/repo/wt","branch":"feat/x"}}}}}}"#
			);
			stream.write_all(body.as_bytes()).unwrap();
			stream.write_all(b"\n").unwrap();
		});
		let created = client(&sock)
			.worktree_create(WorktreeCreateRequest {
				branch: "feat/x",
				path: Some(Path::new("/repo/wt")),
				cwd: Some(Path::new("/repo")),
				workspace_id: None,
				label: None,
			})
			.unwrap();
		assert_eq!(created.workspace_id, "w5");
		assert_eq!(created.path, "/repo/wt");
		let refused = client(&sock)
			.worktree_create(WorktreeCreateRequest {
				branch: "feat/x",
				path: Some(Path::new("relative")),
				cwd: Some(Path::new("/repo")),
				workspace_id: None,
				label: None,
			})
			.unwrap_err();
		assert!(matches!(refused, HerdrTransportError::Refused { .. }));
		let both = client(&sock)
			.worktree_create(WorktreeCreateRequest {
				branch: "feat/x",
				path: None,
				cwd: Some(Path::new("/repo")),
				workspace_id: Some("w1"),
				label: None,
			})
			.unwrap_err();
		assert!(matches!(both, HerdrTransportError::Refused { .. }));
	}

	#[test]
	fn worktree_create_does_not_auto_replay_uncertain_outcome() {
		let calls = std::sync::Arc::new(AtomicUsize::new(0));
		let seen = calls.clone();
		let (_dir, sock) = serve(move |stream| {
			let req = read_request(&stream);
			assert_eq!(req["method"], "worktree.create");
			seen.fetch_add(1, AtomicOrdering::SeqCst);
			drop(stream);
		});
		let err = client(&sock)
			.worktree_create(WorktreeCreateRequest {
				branch: "feat/x",
				path: Some(Path::new("/repo/wt")),
				cwd: Some(Path::new("/repo")),
				workspace_id: None,
				label: None,
			})
			.unwrap_err();
		assert!(err.is_uncertain(), "{err}");
		match err {
			HerdrTransportError::UncertainOutcome { method, .. } => {
				assert_eq!(method, "worktree.create");
			}
			other => panic!("expected UncertainOutcome, got {other:?}"),
		}
		thread::sleep(Duration::from_millis(80));
		assert_eq!(calls.load(AtomicOrdering::SeqCst), 1);
	}

	#[test]
	fn worktree_list_sends_cwd_xor_workspace() {
		let (_dir, sock) = serve(|mut stream| {
			let req = read_request(&stream);
			assert_eq!(req["method"], "worktree.list");
			assert_eq!(req["params"]["cwd"], "/repo");
			assert_eq!(req["params"]["trust_repository"], true);
			assert!(req["params"].get("workspace_id").is_none());
			let id = req["id"].as_str().unwrap();
			let body = format!(
				r#"{{"id":"{id}","result":{{"type":"worktree_list","worktrees":[{{"path":"/repo/wt","branch":"feat/x","open_workspace_id":"w5","is_linked_worktree":true}}]}}}}"#
			);
			stream.write_all(body.as_bytes()).unwrap();
			stream.write_all(b"\n").unwrap();
		});
		let listed = client(&sock)
			.worktree_list(Some(Path::new("/repo")), None)
			.unwrap();
		assert_eq!(listed[0].workspace_id.as_deref(), Some("w5"));
		assert!(client(&sock)
			.worktree_list(Some(Path::new("/repo")), Some("w1"))
			.is_err());
	}

	#[test]
	fn worktree_remove_sends_workspace_id_force_and_trust() {
		let (_dir, sock) = serve(|mut stream| {
			let req = read_request(&stream);
			assert_eq!(req["method"], "worktree.remove");
			assert_eq!(req["params"]["workspace_id"], "w5");
			assert_eq!(req["params"]["force"], true);
			assert_eq!(req["params"]["trust_repository"], true);
			assert!(req["params"].get("cwd").is_none());
			assert!(req["params"].get("path").is_none());
			assert!(req["params"].get("branch").is_none());
			assert!(req["params"].get("focus").is_none());
			let id = req["id"].as_str().unwrap();
			let body = format!(
				r#"{{"id":"{id}","result":{{"type":"worktree_removed","workspace_id":"w5","path":"/repo/wt","forced":true}}}}"#
			);
			stream.write_all(body.as_bytes()).unwrap();
			stream.write_all(b"\n").unwrap();
		});
		let removed = client(&sock).worktree_remove("w5", true).unwrap();
		assert_eq!(removed.workspace_id, "w5");
		assert_eq!(removed.path, "/repo/wt");
		assert!(removed.forced);
		let refused = client(&sock).worktree_remove("", false).unwrap_err();
		assert!(matches!(refused, HerdrTransportError::Refused { .. }));
		let src = include_str!("transport.rs");
		let helper = src
			.split("pub fn worktree_remove")
			.nth(1)
			.unwrap()
			.split("/// Open a folder workspace")
			.next()
			.unwrap();
		assert!(helper.contains("worktree.remove"));
		assert!(!helper.contains("worktree.create"));
		assert!(!helper.contains("workspace.close"));
		assert!(!helper.contains("pane.close"));
		assert!(!helper.contains("git worktree"));
		assert!(!helper.contains("server.stop"));
		assert!(!helper.contains("pane.send_input"));
		assert!(!helper.contains("--takeover"));
		assert!(!helper.contains("herdr-client.sock"));
	}

	#[test]
	fn worktree_remove_does_not_auto_replay_uncertain_outcome() {
		let calls = std::sync::Arc::new(AtomicUsize::new(0));
		let seen = calls.clone();
		let (_dir, sock) = serve(move |stream| {
			let req = read_request(&stream);
			assert_eq!(req["method"], "worktree.remove");
			seen.fetch_add(1, AtomicOrdering::SeqCst);
			drop(stream);
		});
		let err = client(&sock).worktree_remove("w5", false).unwrap_err();
		assert!(err.is_uncertain(), "{err}");
		match err {
			HerdrTransportError::UncertainOutcome { method, .. } => {
				assert_eq!(method, "worktree.remove");
			}
			other => panic!("expected UncertainOutcome, got {other:?}"),
		}
		thread::sleep(Duration::from_millis(80));
		assert_eq!(calls.load(AtomicOrdering::SeqCst), 1);
	}

	#[test]
	fn worktree_remove_treats_absent_workspace_as_success() {
		let (_dir, sock) = serve(|mut stream| {
			let req = read_request(&stream);
			assert_eq!(req["method"], "worktree.remove");
			let id = req["id"].as_str().unwrap();
			let body = format!(
				r#"{{"id":"{id}","error":{{"code":"workspace_not_found","message":"gone"}}}}"#
			);
			stream.write_all(body.as_bytes()).unwrap();
			stream.write_all(b"\n").unwrap();
		});
		let removed = client(&sock).worktree_remove("w9", false).unwrap();
		assert_eq!(removed.workspace_id, "w9");
		assert!(!removed.forced);
	}

	#[test]
	fn workspace_create_sends_absolute_cwd_label_and_no_focus() {
		let (_dir, sock) = serve(|mut stream| {
			let req = read_request(&stream);
			assert_eq!(req["method"], "workspace.create");
			assert_eq!(req["params"]["cwd"], "/notes");
			assert_eq!(req["params"]["label"], "folder");
			assert_eq!(req["params"]["focus"], false);
			assert!(req["params"].get("branch").is_none());
			assert!(req["params"].get("path").is_none());
			assert!(req["params"].get("workspace_id").is_none());
			assert!(req["params"].get("group").is_none());
			let id = req["id"].as_str().unwrap();
			let body = format!(
				r#"{{"id":"{id}","result":{{"type":"workspace_created","workspace":{{"workspace_id":"w3","label":"folder"}},"tab":{{"tab_id":"w3:t1"}},"root_pane":{{"pane_id":"w3:p1","terminal_id":"term_live"}}}}}}"#
			);
			stream.write_all(body.as_bytes()).unwrap();
			stream.write_all(b"\n").unwrap();
		});
		let created = client(&sock)
			.workspace_create(WorkspaceCreateRequest {
				cwd: Path::new("/notes"),
				label: Some("folder"),
			})
			.unwrap();
		assert_eq!(created.workspace_id, "w3");
		let refused = client(&sock)
			.workspace_create(WorkspaceCreateRequest {
				cwd: Path::new("relative"),
				label: None,
			})
			.unwrap_err();
		assert!(matches!(refused, HerdrTransportError::Refused { .. }));
		let src = include_str!("transport.rs");
		let helper = src
			.split("pub fn workspace_create")
			.nth(1)
			.unwrap()
			.split("/// Close one Herdr workspace")
			.next()
			.unwrap();
		assert!(helper.contains("workspace.create"));
		assert!(!helper.contains("worktree.create"));
		assert!(!helper.contains("worktree.remove"));
		assert!(!helper.contains("git worktree"));
		assert!(!helper.contains("server.stop"));
	}

	#[test]
	fn workspace_create_does_not_auto_replay_uncertain_outcome() {
		let calls = std::sync::Arc::new(AtomicUsize::new(0));
		let seen = calls.clone();
		let (_dir, sock) = serve(move |stream| {
			let req = read_request(&stream);
			assert_eq!(req["method"], "workspace.create");
			seen.fetch_add(1, AtomicOrdering::SeqCst);
			drop(stream);
		});
		let err = client(&sock)
			.workspace_create(WorkspaceCreateRequest {
				cwd: Path::new("/notes"),
				label: None,
			})
			.unwrap_err();
		assert!(err.is_uncertain(), "{err}");
		match err {
			HerdrTransportError::UncertainOutcome { method, .. } => {
				assert_eq!(method, "workspace.create");
			}
			other => panic!("expected UncertainOutcome, got {other:?}"),
		}
		thread::sleep(Duration::from_millis(80));
		assert_eq!(calls.load(AtomicOrdering::SeqCst), 1);
	}

	#[test]
	fn workspace_close_sends_workspace_id_without_group() {
		let (_dir, sock) = serve(|mut stream| {
			let req = read_request(&stream);
			assert_eq!(req["method"], "workspace.close");
			assert_eq!(req["params"]["workspace_id"], "w4");
			assert!(req["params"].get("group").is_none());
			assert!(req["params"].get("force").is_none());
			assert!(req["params"].get("cwd").is_none());
			let id = req["id"].as_str().unwrap();
			let body = format!(
				r#"{{"id":"{id}","result":{{"type":"workspace_closed","workspace_id":"w4"}}}}"#
			);
			stream.write_all(body.as_bytes()).unwrap();
			stream.write_all(b"\n").unwrap();
		});
		client(&sock).workspace_close("w4").unwrap();
		let refused = client(&sock).workspace_close("").unwrap_err();
		assert!(matches!(refused, HerdrTransportError::Refused { .. }));
		let src = include_str!("transport.rs");
		let helper = src
			.split("pub fn workspace_close")
			.nth(1)
			.unwrap()
			.split("/// Create an extra tab")
			.next()
			.unwrap();
		assert!(helper.contains("workspace.close"));
		assert!(!helper.contains("worktree.remove"));
		assert!(!helper.contains("pane.close"));
		assert!(!helper.contains("--group"));
		assert!(!helper.contains("server.stop"));
	}

	#[test]
	fn workspace_close_does_not_auto_replay_uncertain_outcome() {
		let calls = std::sync::Arc::new(AtomicUsize::new(0));
		let seen = calls.clone();
		let (_dir, sock) = serve(move |stream| {
			let req = read_request(&stream);
			assert_eq!(req["method"], "workspace.close");
			seen.fetch_add(1, AtomicOrdering::SeqCst);
			drop(stream);
		});
		let err = client(&sock).workspace_close("w4").unwrap_err();
		assert!(err.is_uncertain(), "{err}");
		thread::sleep(Duration::from_millis(80));
		assert_eq!(calls.load(AtomicOrdering::SeqCst), 1);
	}

	#[test]
	fn workspace_close_treats_absent_workspace_as_success() {
		let (_dir, sock) = serve(|mut stream| {
			let req = read_request(&stream);
			assert_eq!(req["method"], "workspace.close");
			let id = req["id"].as_str().unwrap();
			let body = format!(
				r#"{{"id":"{id}","error":{{"code":"workspace_not_found","message":"gone"}}}}"#
			);
			stream.write_all(body.as_bytes()).unwrap();
			stream.write_all(b"\n").unwrap();
		});
		client(&sock).workspace_close("w9").unwrap();
	}

	#[test]
	fn tab_create_sends_workspace_label_cwd_and_no_focus() {
		let (_dir, sock) = serve(|mut stream| {
			let req = read_request(&stream);
			assert_eq!(req["method"], "tab.create");
			assert_eq!(req["params"]["workspace_id"], "w1");
			assert_eq!(req["params"]["label"], "extra");
			assert_eq!(req["params"]["cwd"], "/repo");
			assert_eq!(req["params"]["focus"], false);
			assert!(req["params"].get("terminal_id").is_none());
			assert!(req["params"].get("env").is_none());
			assert!(req["params"].get("command").is_none());
			let id = req["id"].as_str().unwrap();
			let body = format!(
				r#"{{"id":"{id}","result":{{"type":"tab_created","tab":{{"tab_id":"w1:t2","workspace_id":"w1"}},"root_pane":{{"pane_id":"w1:p2","terminal_id":"term_y"}}}}}}"#
			);
			stream.write_all(body.as_bytes()).unwrap();
			stream.write_all(b"\n").unwrap();
		});
		let created = client(&sock)
			.tab_create("w1", "extra", Path::new("/repo"))
			.unwrap();
		assert_eq!(created.pane_id, "w1:p2");
		assert_eq!(created.tab_id, "w1:t2");
		assert_eq!(created.workspace_id, "w1");
		let refused = client(&sock)
			.tab_create("w1", "extra", Path::new("relative"))
			.unwrap_err();
		assert!(matches!(refused, HerdrTransportError::Refused { .. }));
	}

	#[test]
	fn pane_list_get_and_close_use_pane_id() {
		let calls = std::sync::Arc::new(AtomicUsize::new(0));
		let seen = calls.clone();
		let (_dir, sock) = serve(move |mut stream| {
			let req = read_request(&stream);
			let n = seen.fetch_add(1, AtomicOrdering::SeqCst);
			let id = req["id"].as_str().unwrap();
			let body = match n {
				0 => {
					assert_eq!(req["method"], "pane.list");
					assert_eq!(req["params"]["workspace_id"], "w1");
					format!(
						r#"{{"id":"{id}","result":{{"panes":[{{"pane_id":"w1:p1","tab_id":"w1:t1","workspace_id":"w1","terminal_id":"term_x"}}]}}}}"#
					)
				}
				1 => {
					assert_eq!(req["method"], "pane.get");
					assert_eq!(req["params"]["pane_id"], "w1:p1");
					format!(
						r#"{{"id":"{id}","result":{{"pane":{{"pane_id":"w1:p1","tab_id":"w1:t1","workspace_id":"w1"}}}}}}"#
					)
				}
				2 => {
					assert_eq!(req["method"], "pane.get");
					r#"{"id":"ignored","error":{"code":"pane_not_found","message":"gone"}}"#
						.replace("ignored", id)
				}
				_ => {
					assert_eq!(req["method"], "pane.close");
					assert_eq!(req["params"]["pane_id"], "w1:p1");
					format!(
						r#"{{"id":"{id}","result":{{"type":"pane_closed","pane_id":"w1:p1"}}}}"#
					)
				}
			};
			stream.write_all(body.as_bytes()).unwrap();
			stream.write_all(b"\n").unwrap();
		});
		let herdr = client(&sock);
		let listed = herdr.pane_list("w1").unwrap();
		assert_eq!(listed[0].pane_id, "w1:p1");
		assert_eq!(herdr.pane_get("w1:p1").unwrap().unwrap().pane_id, "w1:p1");
		assert!(herdr.pane_get("w1:p9").unwrap().is_none());
		herdr.pane_close("w1:p1").unwrap();
		assert!(herdr.tab_create("", "x", Path::new("/tmp")).is_err());
		assert!(herdr.tab_create("w1", "x", Path::new("rel")).is_err());
		assert!(herdr.pane_close("").is_err());
	}

	#[test]
	fn pane_send_input_sends_pane_id_and_trailing_newline() {
		let (_dir, sock) = serve(|mut stream| {
			let req = read_request(&stream);
			assert_eq!(req["method"], "pane.send_input");
			assert_eq!(req["params"]["pane_id"], "w1:p2");
			assert_eq!(req["params"]["text"], "bun dev\n");
			assert!(req["params"].get("keys").is_none());
			let id = req["id"].as_str().unwrap();
			let body = format!(r#"{{"id":"{id}","result":{{"ok":true}}}}"#);
			stream.write_all(body.as_bytes()).unwrap();
			stream.write_all(b"\n").unwrap();
		});
		client(&sock).pane_send_input("w1:p2", "bun dev\n").unwrap();
		let refused = client(&sock)
			.pane_send_input("w1:p2", "bun dev")
			.unwrap_err();
		assert!(matches!(refused, HerdrTransportError::Refused { .. }));
		assert!(client(&sock).pane_send_input("", "x\n").is_err());
		let src = include_str!("transport.rs");
		let helper = src
			.split("pub fn pane_send_input")
			.nth(1)
			.unwrap()
			.split("pub fn next_id")
			.next()
			.unwrap();
		assert!(helper.contains("pane.send_input"));
		assert!(!helper.contains("pane.send_text"));
		assert!(!helper.contains("pane.send_keys"));
		assert!(!helper.contains("pane.run"));
		assert!(!helper.contains("layout.apply"));
		assert!(!helper.contains("terminal.input"));
		assert!(!helper.contains("server.stop"));
		assert!(!helper.contains("--takeover"));
	}

	#[test]
	fn pane_send_input_does_not_auto_replay_uncertain_outcome() {
		let calls = std::sync::Arc::new(AtomicUsize::new(0));
		let seen = calls.clone();
		let (_dir, sock) = serve(move |stream| {
			let req = read_request(&stream);
			assert_eq!(req["method"], "pane.send_input");
			seen.fetch_add(1, AtomicOrdering::SeqCst);
			drop(stream);
		});
		let err = client(&sock)
			.pane_send_input("w1:p2", "echo hi\n")
			.unwrap_err();
		assert!(err.is_uncertain(), "{err}");
		match err {
			HerdrTransportError::UncertainOutcome { method, .. } => {
				assert_eq!(method, "pane.send_input");
			}
			other => panic!("expected UncertainOutcome, got {other:?}"),
		}
		thread::sleep(Duration::from_millis(80));
		assert_eq!(calls.load(AtomicOrdering::SeqCst), 1);
	}

	#[test]
	fn live_worktree_open_reuses_already_open_workspace_id() {
		let Some(live) = require_live() else {
			return;
		};
		let repo = live.root.path().join("repo");
		std::fs::create_dir_all(&repo).unwrap();
		init_git_repo(&repo);
		std::fs::write(repo.join("dirty.txt"), "keep\n").unwrap();
		let client = live.client();
		let first = client.worktree_open(&repo, &repo).unwrap_or_else(|err| {
			panic!("worktree.open failed: {err}\n{}", live.server_log())
		});
		assert!(!first.workspace_id.is_empty());
		assert!(!first.already_open);
		let second = client.worktree_open(&repo, &repo).unwrap();
		assert!(second.already_open);
		assert_eq!(second.workspace_id, first.workspace_id);
		assert_eq!(
			std::fs::read_to_string(repo.join("dirty.txt")).unwrap(),
			"keep\n"
		);
		let listed = std::process::Command::new("git")
			.args(["worktree", "list", "--porcelain"])
			.current_dir(&repo)
			.output()
			.unwrap();
		let list = String::from_utf8_lossy(&listed.stdout);
		assert_eq!(list.matches("worktree ").count(), 1);
	}

	#[test]
	fn live_worktree_create_uses_path_and_fails_closed_on_duplicate_branch() {
		let Some(live) = require_live() else {
			return;
		};
		let repo = live.root.path().join("create-repo");
		std::fs::create_dir_all(&repo).unwrap();
		init_git_repo(&repo);
		let checkout = live.root.path().join("create-wt");
		let client = live.client();
		let created = client
			.worktree_create(WorktreeCreateRequest {
				branch: "wt/task14",
				path: Some(&checkout),
				cwd: Some(&repo),
				workspace_id: None,
				label: Some("task14"),
			})
			.unwrap_or_else(|err| {
				panic!("worktree.create failed: {err}\n{}", live.server_log())
			});
		assert!(!created.workspace_id.is_empty());
		assert_eq!(Path::new(&created.path), checkout.as_path());
		assert!(checkout.exists());
		let dup = client
			.worktree_create(WorktreeCreateRequest {
				branch: "wt/task14",
				path: Some(&live.root.path().join("create-wt-dup")),
				cwd: Some(&repo),
				workspace_id: None,
				label: None,
			})
			.unwrap_err();
		match dup {
			HerdrTransportError::Rpc(rpc) => {
				assert_eq!(rpc.code, "worktree_create_failed");
			}
			other => panic!("expected worktree_create_failed, got {other}"),
		}
	}

	#[test]
	fn live_worktree_remove_fails_closed_on_dirty_without_force() {
		let Some(live) = require_live() else {
			return;
		};
		let repo = live.root.path().join("remove-repo");
		std::fs::create_dir_all(&repo).unwrap();
		init_git_repo(&repo);
		let checkout = live.root.path().join("remove-wt");
		let client = live.client();
		let created = client
			.worktree_create(WorktreeCreateRequest {
				branch: "wt/task15",
				path: Some(&checkout),
				cwd: Some(&repo),
				workspace_id: None,
				label: Some("task15"),
			})
			.unwrap_or_else(|err| {
				panic!("worktree.create failed: {err}\n{}", live.server_log())
			});
		std::fs::write(checkout.join("dirty.txt"), "keep\n").unwrap();
		let dirty = client
			.worktree_remove(&created.workspace_id, false)
			.unwrap_err();
		match dirty {
			HerdrTransportError::Rpc(rpc) => {
				assert_eq!(rpc.code, "dirty_worktree_requires_force");
			}
			other => {
				panic!("expected dirty_worktree_requires_force, got {other}")
			}
		}
		assert!(checkout.exists());
		let removed = client
			.worktree_remove(&created.workspace_id, true)
			.unwrap_or_else(|err| {
				panic!(
					"worktree.remove --force failed: {err}\n{}",
					live.server_log()
				)
			});
		assert_eq!(removed.workspace_id, created.workspace_id);
		assert!(removed.forced);
		assert!(!checkout.exists());
		let branches = std::process::Command::new("git")
			.args(["branch", "--list", "wt/task15"])
			.current_dir(&repo)
			.env("GIT_CONFIG_GLOBAL", "/dev/null")
			.env("GIT_CONFIG_SYSTEM", "/dev/null")
			.output()
			.unwrap();
		assert!(
			String::from_utf8_lossy(&branches.stdout).contains("wt/task15"),
			"worktree.remove must keep the git branch"
		);
	}

	fn init_git_repo(repo: &Path) {
		assert!(std::process::Command::new("git")
			.args(["init", "-b", "main"])
			.current_dir(repo)
			.env("GIT_CONFIG_GLOBAL", "/dev/null")
			.env("GIT_CONFIG_SYSTEM", "/dev/null")
			.status()
			.unwrap()
			.success());
		for (key, value) in [
			("user.email", "adoption@example.test"),
			("user.name", "Adoption"),
		] {
			assert!(std::process::Command::new("git")
				.args(["config", key, value])
				.current_dir(repo)
				.env("GIT_CONFIG_GLOBAL", "/dev/null")
				.env("GIT_CONFIG_SYSTEM", "/dev/null")
				.status()
				.unwrap()
				.success());
		}
		std::fs::write(repo.join("README.md"), "# fixture\n").unwrap();
		assert!(std::process::Command::new("git")
			.args(["add", "README.md"])
			.current_dir(repo)
			.env("GIT_CONFIG_GLOBAL", "/dev/null")
			.env("GIT_CONFIG_SYSTEM", "/dev/null")
			.status()
			.unwrap()
			.success());
		assert!(std::process::Command::new("git")
			.args(["commit", "-m", "init"])
			.current_dir(repo)
			.env("GIT_CONFIG_GLOBAL", "/dev/null")
			.env("GIT_CONFIG_SYSTEM", "/dev/null")
			.status()
			.unwrap()
			.success());
	}
}
