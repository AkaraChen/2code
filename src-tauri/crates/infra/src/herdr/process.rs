//! User Herdr session resolution, probe, and detached server startup.
//!
//! Production attaches to the same session the `herdr` CLI would: inherited
//! `HERDR_SOCKET_PATH` / `HERDR_SESSION`, else the default JSON socket
//! under `$XDG_CONFIG_HOME/herdr/herdr.sock`. If that default is absent
//! and `herdr session list` reports a running named session, attach there
//! instead of starting a second server. If nothing is running, start on
//! the default socket. Never a private `2code` session. Probe uses
//! `herdr status --json` plus socket-accept readiness. GUI-side
//! [`HerdrClientGuard`] drop kills client helpers only and never runs
//! `herdr server stop`.

use std::ffi::OsString;
use std::io;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Output, Stdio};
use std::sync::{mpsc, Mutex, OnceLock};
use std::time::{Duration, Instant};
use std::{env, fmt, fs, thread};

use model::error::AppError;
use serde::Deserialize;

use super::PINNED_VERSION;
use crate::no_window::command_without_windows_console;

const DEFAULT_SESSION: &str = "default";
const JSON_PROTOCOL: u64 = 22;
const ENDPOINT_GENERATION: u64 = 1;
const READY_TIMEOUT: Duration = Duration::from_secs(10);
const CLI_TIMEOUT: Duration = Duration::from_secs(5);

/// Conservative `sockaddr_un.sun_path` bound (macOS 104; Linux 108).
const SUN_PATH_CAP: usize = 104;

/// Resolved Herdr endpoint (session name + JSON API socket).
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct HerdrNamespace {
	pub session: String,
	pub socket_path: PathBuf,
	pub xdg_config_home: PathBuf,
}

impl HerdrNamespace {
	/// CLI attach follows the listener `ensure_server` actually joined,
	/// including a running named session when the default socket is absent.
	pub fn for_endpoint(self, endpoint: &HerdrEndpoint) -> Self {
		Self {
			session: endpoint.session.clone(),
			socket_path: endpoint.socket_path.clone(),
			xdg_config_home: self.xdg_config_home,
		}
	}
}

/// Inputs for probe/start. Callers supply the sidecar path from Task 3.
pub struct HerdrProcessEnv<'a> {
	pub executable: &'a Path,
	pub namespace: &'a HerdrNamespace,
	pub extra_env: &'a [(OsString, OsString)],
	pub ready_timeout: Duration,
	pub cli_timeout: Duration,
}

impl<'a> HerdrProcessEnv<'a> {
	pub fn new(executable: &'a Path, namespace: &'a HerdrNamespace) -> Self {
		Self {
			executable,
			namespace,
			extra_env: &[],
			ready_timeout: READY_TIMEOUT,
			cli_timeout: CLI_TIMEOUT,
		}
	}

	/// Point a sidecar command at the resolved shared socket.
	pub fn apply_to(&self, cmd: &mut Command) {
		apply_namespace_env(cmd, self);
	}
}

/// Result of probing the resolved shared session.
#[derive(Debug)]
pub enum Probe {
	Absent,
	Compatible(HerdrStatus),
	Incompatible(IncompatibleServer),
}

/// `herdr status --json` fields used for capability checks.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct HerdrStatus {
	pub version: String,
	pub protocol: u64,
	pub endpoint_generation: u64,
	pub socket_path: PathBuf,
	pub session: String,
	pub running: bool,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct IncompatibleServer {
	pub message: String,
	pub socket_path: PathBuf,
	pub session: Option<String>,
}

/// Connected (or just-started) shared listener. Dropping it does not
/// stop the server.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct HerdrEndpoint {
	pub socket_path: PathBuf,
	pub session: String,
	pub reused: bool,
}

/// Lease for one ensure() call. Drop releases client helpers only.
pub struct HerdrServerLease {
	pub endpoint: HerdrEndpoint,
	pub namespace: HerdrNamespace,
	helpers: Vec<Child>,
	_server: Option<Child>,
}

impl HerdrServerLease {
	pub fn release_client_helpers(&mut self) {
		for child in &mut self.helpers {
			let _ = child.kill();
			let _ = child.wait();
		}
		self.helpers.clear();
	}

	pub fn track_helper(&mut self, child: Child) {
		self.helpers.push(child);
	}
}

impl Drop for HerdrServerLease {
	fn drop(&mut self) {
		self.release_client_helpers();
	}
}

/// Process-wide holder so GUI exit can drop helpers without stopping
/// the server. Herdr-default GUI startup calls [`Self::ensure`]. The
/// explicit Local fallback must not.
#[derive(Clone, Default)]
pub struct HerdrClientGuard {
	inner: std::sync::Arc<Mutex<Option<HerdrServerLease>>>,
}

impl HerdrClientGuard {
	pub fn new() -> Self {
		Self::default()
	}

	pub fn ensure(
		&self,
		env: &HerdrProcessEnv<'_>,
	) -> Result<HerdrEndpoint, HerdrProcessError> {
		let mut slot =
			self.inner.lock().map_err(|_| HerdrProcessError::Lock)?;
		let lease = ensure_server(env)?;
		let endpoint = lease.endpoint.clone();
		*slot = Some(lease);
		Ok(endpoint)
	}

	/// Kill client helpers. Never runs `herdr server stop`.
	pub fn release_client_helpers(&self) {
		if let Ok(mut slot) = self.inner.lock() {
			*slot = None;
		}
	}
}

#[derive(Debug)]
pub enum HerdrProcessError {
	Absent { socket: PathBuf },
	Incompatible { message: String, socket: PathBuf },
	Timeout { message: String },
	Io(io::Error),
	Lock,
}

impl fmt::Display for HerdrProcessError {
	fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
		match self {
			Self::Absent { socket } => {
				write!(f, "Herdr server is absent at {}", socket.display())
			}
			Self::Incompatible { message, socket } => write!(
				f,
				"Herdr server is incompatible at {}: {message}",
				socket.display()
			),
			Self::Timeout { message } => {
				write!(f, "Herdr server timed out: {message}")
			}
			Self::Io(err) => write!(f, "Herdr process I/O: {err}"),
			Self::Lock => write!(f, "Herdr process lock poisoned"),
		}
	}
}

impl std::error::Error for HerdrProcessError {}

impl From<io::Error> for HerdrProcessError {
	fn from(err: io::Error) -> Self {
		Self::Io(err)
	}
}

impl From<HerdrProcessError> for AppError {
	fn from(err: HerdrProcessError) -> Self {
		match err {
			HerdrProcessError::Absent { .. } => {
				AppError::HerdrServerAbsent(err.to_string())
			}
			HerdrProcessError::Incompatible { .. } => {
				AppError::HerdrServerIncompatible(err.to_string())
			}
			HerdrProcessError::Lock => AppError::LockError,
			other => AppError::TerminalError(other.to_string()),
		}
	}
}

pub fn default_xdg_config_home() -> PathBuf {
	env::var_os("XDG_CONFIG_HOME")
		.map(PathBuf::from)
		.or_else(|| {
			env::var_os("HOME").map(|home| PathBuf::from(home).join(".config"))
		})
		.unwrap_or_else(|| PathBuf::from(".config"))
}

pub fn resolve_namespace(
	xdg_config_home: PathBuf,
) -> Result<HerdrNamespace, HerdrProcessError> {
	resolve_namespace_with(
		xdg_config_home,
		env::var_os("HERDR_SESSION"),
		env::var_os("HERDR_SOCKET_PATH"),
	)
}

/// CLI-equivalent resolution. `HERDR_SOCKET_PATH` wins over inherited
/// `HERDR_SESSION` (2code has no `--session` flag). Tests pass `None`
/// for both to isolate a fixture XDG from the host process env.
pub fn resolve_namespace_with(
	xdg_config_home: PathBuf,
	herdr_session: Option<OsString>,
	herdr_socket_path: Option<OsString>,
) -> Result<HerdrNamespace, HerdrProcessError> {
	let session_name = herdr_session
		.as_ref()
		.and_then(|value| value.to_str())
		.map(str::trim)
		.filter(|name| !name.is_empty());
	let socket_override = herdr_socket_path
		.filter(|value| !value.is_empty())
		.map(PathBuf::from);

	let (session, socket_path) = if let Some(socket_path) = socket_override {
		(
			session_name_for_socket(&socket_path, session_name),
			socket_path,
		)
	} else if let Some(name) =
		session_name.filter(|name| *name != DEFAULT_SESSION)
	{
		(
			name.to_string(),
			named_session_socket(&xdg_config_home, name),
		)
	} else {
		(
			DEFAULT_SESSION.to_string(),
			default_session_socket(&xdg_config_home),
		)
	};

	if path_len(&socket_path) >= SUN_PATH_CAP {
		return Err(HerdrProcessError::Io(io::Error::other(format!(
			"Herdr socket exceeds sun_path: {}",
			socket_path.display()
		))));
	}
	Ok(HerdrNamespace {
		session,
		socket_path,
		xdg_config_home,
	})
}

pub fn probe(env: &HerdrProcessEnv<'_>) -> Result<Probe, HerdrProcessError> {
	let status = match read_status(env) {
		Ok(status) => status,
		Err(HerdrProcessError::Timeout { message }) => {
			return Ok(Probe::Incompatible(IncompatibleServer {
				message: format!("status timed out: {message}"),
				socket_path: env.namespace.socket_path.clone(),
				session: Some(env.namespace.session.clone()),
			}));
		}
		Err(err) => return Err(err),
	};
	classify_status(env, &status)
}

pub fn ensure_server(
	env: &HerdrProcessEnv<'_>,
) -> Result<HerdrServerLease, HerdrProcessError> {
	let _guard = start_lock().lock().map_err(|_| HerdrProcessError::Lock)?;
	match probe(env)? {
		Probe::Compatible(status) => {
			Ok(lease_from_status(env, status, true, None))
		}
		Probe::Incompatible(info) => Err(HerdrProcessError::Incompatible {
			message: info.message,
			socket: info.socket_path,
		}),
		Probe::Absent => {
			if is_default_namespace(env.namespace) {
				if let Some(named) = first_running_named_session(env)? {
					let named_ns = HerdrNamespace {
						session: named.name,
						socket_path: named.socket_path,
						xdg_config_home: env.namespace.xdg_config_home.clone(),
					};
					let named_env = HerdrProcessEnv {
						executable: env.executable,
						namespace: &named_ns,
						extra_env: env.extra_env,
						ready_timeout: env.ready_timeout,
						cli_timeout: env.cli_timeout,
					};
					match probe(&named_env)? {
						Probe::Compatible(status) => {
							return Ok(lease_from_status(
								&named_env, status, true, None,
							));
						}
						Probe::Incompatible(info) => {
							return Err(HerdrProcessError::Incompatible {
								message: info.message,
								socket: info.socket_path,
							});
						}
						Probe::Absent => {}
					}
				}
			}
			start_detached(env)
		}
	}
}

fn start_lock() -> &'static Mutex<()> {
	static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
	LOCK.get_or_init(|| Mutex::new(()))
}

fn default_session_socket(xdg_config: &Path) -> PathBuf {
	xdg_config.join("herdr/herdr.sock")
}

fn named_session_socket(xdg_config: &Path, name: &str) -> PathBuf {
	xdg_config
		.join("herdr/sessions")
		.join(name)
		.join("herdr.sock")
}

fn is_default_namespace(namespace: &HerdrNamespace) -> bool {
	namespace.socket_path == default_session_socket(&namespace.xdg_config_home)
}

fn session_name_for_socket(
	socket: &Path,
	session_name: Option<&str>,
) -> String {
	if let Some(name) = named_session_from_socket(socket) {
		return name;
	}
	match session_name {
		Some(name) if name != DEFAULT_SESSION => name.to_string(),
		_ => DEFAULT_SESSION.to_string(),
	}
}

fn named_session_from_socket(socket: &Path) -> Option<String> {
	let file = socket.file_name()?;
	if file != "herdr.sock" {
		return None;
	}
	let sessions = socket.parent()?.parent()?;
	if sessions.file_name()? != "sessions" {
		return None;
	}
	let name = socket.parent()?.file_name()?.to_str()?;
	if name == DEFAULT_SESSION {
		return None;
	}
	Some(name.to_string())
}

fn path_len(path: &Path) -> usize {
	#[cfg(unix)]
	{
		use std::os::unix::ffi::OsStrExt;
		path.as_os_str().as_bytes().len()
	}
	#[cfg(not(unix))]
	{
		path.to_string_lossy().len()
	}
}

fn lease_from_status(
	env: &HerdrProcessEnv<'_>,
	status: HerdrStatus,
	reused: bool,
	server: Option<Child>,
) -> HerdrServerLease {
	HerdrServerLease {
		endpoint: HerdrEndpoint {
			socket_path: status.socket_path,
			session: status.session,
			reused,
		},
		namespace: env.namespace.clone(),
		helpers: Vec::new(),
		_server: server,
	}
}

fn start_detached(
	env: &HerdrProcessEnv<'_>,
) -> Result<HerdrServerLease, HerdrProcessError> {
	if let Some(parent) = env.namespace.socket_path.parent() {
		fs::create_dir_all(parent)?;
	}
	let mut cmd = detached_server_command(env.executable);
	apply_namespace_env(&mut cmd, env);
	cmd.arg("server");
	let child = cmd.spawn()?;
	wait_until_ready(env)?;
	match probe(env)? {
		Probe::Compatible(status) => {
			Ok(lease_from_status(env, status, false, Some(child)))
		}
		Probe::Incompatible(info) => Err(HerdrProcessError::Incompatible {
			message: info.message,
			socket: info.socket_path,
		}),
		Probe::Absent => Err(HerdrProcessError::Timeout {
			message: format!(
				"started herdr server but {} stayed absent",
				env.namespace.socket_path.display()
			),
		}),
	}
}

fn wait_until_ready(
	env: &HerdrProcessEnv<'_>,
) -> Result<(), HerdrProcessError> {
	let deadline = Instant::now() + env.ready_timeout;
	loop {
		match probe(env)? {
			Probe::Compatible(_) => {
				if socket_is_live(&env.namespace.socket_path) {
					return Ok(());
				}
				#[cfg(not(unix))]
				return Ok(());
			}
			Probe::Incompatible(info) => {
				if info
					.message
					.contains("socket is live but status is not_running")
				{
					// The listener can accept before `herdr status` reports
					// running. That is still starting, not a foreign server.
				} else {
					return Err(HerdrProcessError::Incompatible {
						message: info.message,
						socket: info.socket_path,
					});
				}
			}
			Probe::Absent => {}
		}
		if Instant::now() >= deadline {
			return Err(HerdrProcessError::Timeout {
				message: format!(
					"listener was not ready at {}",
					env.namespace.socket_path.display()
				),
			});
		}
		thread::sleep(Duration::from_millis(40));
	}
}

fn classify_status(
	env: &HerdrProcessEnv<'_>,
	raw: &StatusDocument,
) -> Result<Probe, HerdrProcessError> {
	let socket = if raw.server.socket.is_empty() {
		env.namespace.socket_path.clone()
	} else {
		PathBuf::from(&raw.server.socket)
	};
	let session = raw
		.server
		.session
		.clone()
		.filter(|name| !name.is_empty())
		.or_else(|| raw.client.session.clone().filter(|name| !name.is_empty()))
		.unwrap_or_else(|| env.namespace.session.clone());

	if !raw.server.running || raw.server.status == "not_running" {
		if socket_is_live(&env.namespace.socket_path) {
			return Ok(Probe::Incompatible(IncompatibleServer {
				message: "socket is live but status is not_running".into(),
				socket_path: env.namespace.socket_path.clone(),
				session: raw.server.session.clone(),
			}));
		}
		return Ok(Probe::Absent);
	}

	let version = raw.server.version.clone().unwrap_or_default();
	let protocol = raw.server.protocol.unwrap_or(0);
	let generation = raw
		.server
		.capabilities
		.as_ref()
		.and_then(|caps| caps.endpoint_protocol_generation)
		.unwrap_or(raw.client.endpoint_protocol_generation);
	let reasons = incompatibility_reasons(
		&version,
		protocol,
		generation,
		raw.server.compatible,
		raw.server.endpoint_compatible,
	);
	if !reasons.is_empty() {
		return Ok(Probe::Incompatible(IncompatibleServer {
			message: reasons.join("; "),
			socket_path: socket,
			session: Some(session),
		}));
	}

	Ok(Probe::Compatible(HerdrStatus {
		version,
		protocol,
		endpoint_generation: generation,
		socket_path: socket,
		session,
		running: true,
	}))
}

fn incompatibility_reasons(
	version: &str,
	protocol: u64,
	generation: u64,
	compatible: Option<bool>,
	endpoint_compatible: Option<bool>,
) -> Vec<String> {
	let mut reasons = Vec::new();
	if version != PINNED_VERSION {
		reasons.push(format!("version {version} (expected {PINNED_VERSION})"));
	}
	if protocol != JSON_PROTOCOL {
		reasons.push(format!("protocol {protocol} (expected {JSON_PROTOCOL})"));
	}
	if generation != ENDPOINT_GENERATION {
		reasons.push(format!(
			"endpoint generation {generation} (expected {ENDPOINT_GENERATION})"
		));
	}
	if compatible == Some(false) {
		reasons.push("status.compatible is false".into());
	}
	if endpoint_compatible == Some(false) {
		reasons.push("status.endpoint_compatible is false".into());
	}
	reasons
}

fn read_status(
	env: &HerdrProcessEnv<'_>,
) -> Result<StatusDocument, HerdrProcessError> {
	let mut cmd = command_without_windows_console(env.executable);
	apply_namespace_env(&mut cmd, env);
	cmd.args(["status", "--json"]);
	let output = run_timed(cmd, env.cli_timeout)?;
	let stdout = String::from_utf8_lossy(&output.stdout);
	serde_json::from_str::<StatusDocument>(&stdout).map_err(|err| {
		if socket_is_live(&env.namespace.socket_path) {
			HerdrProcessError::Incompatible {
				message: format!("unreadable status JSON: {err}"),
				socket: env.namespace.socket_path.clone(),
			}
		} else {
			HerdrProcessError::Io(io::Error::other(format!(
				"herdr status --json: {err}: {stdout}"
			)))
		}
	})
}

fn apply_namespace_env(cmd: &mut Command, env: &HerdrProcessEnv<'_>) {
	for (key, value) in env.extra_env {
		cmd.env(key, value);
	}
	cmd.env("HERDR_SOCKET_PATH", &env.namespace.socket_path)
		.env("XDG_CONFIG_HOME", &env.namespace.xdg_config_home)
		.env("HERDR_DISABLE_SOUND", "1")
		.env_remove("HERDR_CLIENT_SOCKET_PATH");
	if env.namespace.session.is_empty()
		|| env.namespace.session == DEFAULT_SESSION
	{
		cmd.env_remove("HERDR_SESSION");
	} else {
		cmd.env("HERDR_SESSION", &env.namespace.session);
	}
}

fn first_running_named_session(
	env: &HerdrProcessEnv<'_>,
) -> Result<Option<NamedSession>, HerdrProcessError> {
	let mut cmd = command_without_windows_console(env.executable);
	apply_namespace_env(&mut cmd, env);
	cmd.args(["session", "list", "--json"]);
	let output = match run_timed(cmd, env.cli_timeout) {
		Ok(output) => output,
		Err(_) => return Ok(None),
	};
	if !output.status.success() {
		return Ok(None);
	}
	let Ok(document) =
		serde_json::from_slice::<SessionListDocument>(&output.stdout)
	else {
		return Ok(None);
	};
	Ok(document.sessions.into_iter().find_map(|entry| {
		if !entry.running || entry.default || entry.name == DEFAULT_SESSION {
			return None;
		}
		if entry.socket_path.is_empty() {
			return None;
		}
		Some(NamedSession {
			name: entry.name,
			socket_path: PathBuf::from(entry.socket_path),
		})
	}))
}

fn detached_server_command(executable: &Path) -> Command {
	let mut cmd = command_without_windows_console(executable);
	#[cfg(unix)]
	{
		use std::os::unix::process::CommandExt;
		unsafe {
			// SAFETY: setsid() detaches the server from the GUI session
			// so process-group signals on exit cannot take it down.
			cmd.pre_exec(|| {
				if libc::setsid() == -1 {
					return Err(io::Error::last_os_error());
				}
				Ok(())
			});
		}
	}
	#[cfg(windows)]
	{
		use std::os::windows::process::CommandExt;
		const DETACHED_PROCESS: u32 = 0x00000008;
		const CREATE_NEW_PROCESS_GROUP: u32 = 0x00000200;
		const CREATE_NO_WINDOW: u32 = 0x08000000;
		cmd.creation_flags(
			DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP | CREATE_NO_WINDOW,
		);
	}
	cmd.stdin(Stdio::null())
		.stdout(Stdio::null())
		.stderr(Stdio::null());
	cmd
}

fn socket_is_live(path: &Path) -> bool {
	#[cfg(unix)]
	{
		std::os::unix::net::UnixStream::connect(path).is_ok()
	}
	#[cfg(not(unix))]
	{
		let _ = path;
		false
	}
}

fn run_timed(
	mut cmd: Command,
	timeout: Duration,
) -> Result<Output, HerdrProcessError> {
	cmd.stdin(Stdio::null())
		.stdout(Stdio::piped())
		.stderr(Stdio::piped());
	let child = cmd.spawn()?;
	let pid = child.id();
	let (tx, rx) = mpsc::channel();
	thread::spawn(move || {
		let _ = tx.send(child.wait_with_output());
	});
	match rx.recv_timeout(timeout) {
		Ok(Ok(output)) => Ok(output),
		Ok(Err(err)) => Err(err.into()),
		Err(_) => {
			terminate_pid(pid);
			let _ = rx.recv_timeout(Duration::from_secs(1));
			Err(HerdrProcessError::Timeout {
				message: format!("pid {pid} exceeded {timeout:?}"),
			})
		}
	}
}

fn terminate_pid(pid: u32) {
	#[cfg(unix)]
	unsafe {
		// SAFETY: pid is a process we spawned (status CLI helper).
		libc::kill(pid as i32, libc::SIGKILL);
	}
	#[cfg(windows)]
	{
		let _ = Command::new("taskkill")
			.args(["/PID", &pid.to_string(), "/F"])
			.stdout(Stdio::null())
			.stderr(Stdio::null())
			.status();
	}
}

#[derive(Debug, Deserialize)]
struct StatusDocument {
	client: ClientStatus,
	server: ServerStatus,
}

#[derive(Debug, Deserialize)]
struct SessionListDocument {
	#[serde(default)]
	sessions: Vec<SessionListEntry>,
}

#[derive(Debug, Deserialize)]
struct SessionListEntry {
	name: String,
	#[serde(default)]
	default: bool,
	#[serde(default)]
	running: bool,
	#[serde(default)]
	socket_path: String,
}

struct NamedSession {
	name: String,
	socket_path: PathBuf,
}

#[derive(Debug, Deserialize)]
struct ClientStatus {
	session: Option<String>,
	endpoint_protocol_generation: u64,
}

#[derive(Debug, Deserialize)]
struct ServerStatus {
	status: String,
	running: bool,
	version: Option<String>,
	protocol: Option<u64>,
	capabilities: Option<ServerCapabilities>,
	compatible: Option<bool>,
	endpoint_compatible: Option<bool>,
	socket: String,
	session: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ServerCapabilities {
	endpoint_protocol_generation: Option<u64>,
}

#[cfg(test)]
mod tests {
	use super::*;

	fn isolated_namespace(xdg: PathBuf) -> HerdrNamespace {
		resolve_namespace_with(xdg, None, None).unwrap()
	}

	#[test]
	fn production_does_not_use_a_private_2code_session() {
		let src = include_str!("process.rs")
			.split("#[cfg(test)]")
			.next()
			.unwrap();
		assert!(!src.contains("SESSION_NAME"));
		assert!(!src.contains("sessions/2code"));
		assert!(!src.contains("2code-herdr"));
		assert!(!src.contains("HERDR_SESSION\", SESSION_NAME"));
		assert!(!src.contains("refusing the user default"));
		assert!(!src.contains("dedicated 2code"));
		assert!(!src.contains("native_session_socket"));
		assert!(!src.contains("short_socket_path"));
	}

	#[test]
	fn namespace_is_the_user_default_socket() {
		let xdg = PathBuf::from("/tmp/xdg-user-ns");
		let ns = isolated_namespace(xdg.clone());
		assert_eq!(ns.session, DEFAULT_SESSION);
		assert_eq!(ns.socket_path, xdg.join("herdr/herdr.sock"));
		assert!(is_default_namespace(&ns));
	}

	#[test]
	fn inherited_socket_path_wins_over_session_name() {
		let xdg = PathBuf::from("/tmp/xdg-user-ns");
		let ns = resolve_namespace_with(
			xdg,
			Some(OsString::from("work")),
			Some(OsString::from("/tmp/custom-herdr.sock")),
		)
		.unwrap();
		assert_eq!(ns.socket_path, PathBuf::from("/tmp/custom-herdr.sock"));
		assert_eq!(ns.session, "work");
	}

	#[test]
	fn inherited_session_uses_named_socket() {
		let xdg = PathBuf::from("/tmp/xdg-user-ns");
		let ns = resolve_namespace_with(
			xdg.clone(),
			Some(OsString::from("work")),
			None,
		)
		.unwrap();
		assert_eq!(ns.session, "work");
		assert_eq!(ns.socket_path, xdg.join("herdr/sessions/work/herdr.sock"));
		assert!(!is_default_namespace(&ns));
	}

	#[test]
	fn inherited_default_session_name_uses_default_socket() {
		let xdg = PathBuf::from("/tmp/xdg-user-ns");
		let ns = resolve_namespace_with(
			xdg.clone(),
			Some(OsString::from("default")),
			None,
		)
		.unwrap();
		assert_eq!(ns.session, DEFAULT_SESSION);
		assert_eq!(ns.socket_path, default_session_socket(&xdg));
	}

	#[test]
	fn long_xdg_default_socket_fails_closed() {
		let xdg = PathBuf::from(format!("/{}", "x".repeat(90)));
		let err = resolve_namespace_with(xdg.clone(), None, None).unwrap_err();
		let message = err.to_string();
		assert!(message.contains("sun_path"), "{message}");
		assert!(
			message.contains("herdr/herdr.sock"),
			"error must name the default path: {message}"
		);
		assert!(!message.contains("2code-herdr"), "{message}");
	}

	#[cfg(unix)]
	mod unix {
		use super::*;
		use serde_json::{json, Value};
		use std::ffi::OsString;
		use std::os::unix::fs::PermissionsExt;
		use std::sync::atomic::{AtomicU32, Ordering};

		static LIVE_SEQ: AtomicU32 = AtomicU32::new(1);

		struct Fixture {
			_root: tempfile::TempDir,
			fake_dir: PathBuf,
			executable: PathBuf,
			namespace: HerdrNamespace,
			extra_env: Vec<(OsString, OsString)>,
		}

		impl Fixture {
			fn new() -> Self {
				let root = tempfile::tempdir().unwrap();
				let xdg = root.path().join("xdg-config");
				fs::create_dir_all(xdg.join("herdr")).unwrap();
				let fake_dir = root.path().join("fake");
				fs::create_dir_all(&fake_dir).unwrap();
				let executable = write_fake_herdr(&fake_dir);
				let namespace = isolated_namespace(xdg);
				let extra_env = isolated_env(root.path(), &fake_dir);
				Self {
					_root: root,
					fake_dir,
					executable,
					namespace,
					extra_env,
				}
			}

			fn env(&self) -> HerdrProcessEnv<'_> {
				HerdrProcessEnv {
					executable: &self.executable,
					namespace: &self.namespace,
					extra_env: &self.extra_env,
					ready_timeout: Duration::from_secs(3),
					cli_timeout: Duration::from_secs(3),
				}
			}

			fn write_status(&self, value: Value) {
				fs::write(self.fake_dir.join("status.json"), value.to_string())
					.unwrap();
			}

			fn args_log(&self) -> String {
				fs::read_to_string(self.fake_dir.join("args.log"))
					.unwrap_or_default()
			}

			fn env_log(&self) -> String {
				fs::read_to_string(self.fake_dir.join("env.log"))
					.unwrap_or_default()
			}

			fn starts(&self) -> u32 {
				fs::read_to_string(self.fake_dir.join("starts"))
					.ok()
					.and_then(|text| text.trim().parse().ok())
					.unwrap_or(0)
			}

			fn stop_count(&self) -> usize {
				fs::read_to_string(self.fake_dir.join("stop.log"))
					.map(|text| text.lines().count())
					.unwrap_or(0)
			}

			fn absent_status(&self) -> Value {
				status_doc(false, None, None, &self.namespace.socket_path)
			}

			fn compatible_status(&self) -> Value {
				status_doc(
					true,
					Some(PINNED_VERSION),
					None,
					&self.namespace.socket_path,
				)
			}
		}

		impl Drop for Fixture {
			fn drop(&mut self) {
				if let Ok(text) =
					fs::read_to_string(self.fake_dir.join("server.pid"))
				{
					if let Ok(pid) = text.trim().parse::<i32>() {
						unsafe {
							// SAFETY: test cleanup of the fake server pid file.
							libc::kill(pid, libc::SIGKILL);
						}
					}
				}
			}
		}

		fn isolated_env(
			root: &Path,
			fake_dir: &Path,
		) -> Vec<(OsString, OsString)> {
			vec![
				(OsString::from("HOME"), root.join("home").into_os_string()),
				(
					OsString::from("XDG_STATE_HOME"),
					root.join("xdg-state").into_os_string(),
				),
				(
					OsString::from("XDG_CACHE_HOME"),
					root.join("xdg-cache").into_os_string(),
				),
				(
					OsString::from("HERDR_FAKE_DIR"),
					fake_dir.as_os_str().to_os_string(),
				),
			]
		}

		fn status_doc(
			running: bool,
			version: Option<&str>,
			session: Option<&str>,
			socket: &Path,
		) -> Value {
			json!({
				"client": {
					"version": PINNED_VERSION,
					"channel": "stable",
					"protocol": JSON_PROTOCOL,
					"endpoint_protocol_generation": ENDPOINT_GENERATION,
					"endpoint_capabilities": [],
					"binary": "fake",
					"session": session,
				},
				"server": {
					"status": if running { "running" } else { "not_running" },
					"running": running,
					"version": version,
					"protocol": if running { Value::from(JSON_PROTOCOL) } else { Value::Null },
					"capabilities": if running {
						json!({
							"live_handoff": true,
							"detached_server_daemon": true,
							"endpoint_protocol_generation": ENDPOINT_GENERATION,
							"surface_interest": true,
							"health_check": true
						})
					} else {
						Value::Null
					},
					"compatible": if running { Value::from(true) } else { Value::Null },
					"endpoint_compatible": if running { Value::from(true) } else { Value::Null },
					"socket": socket.to_string_lossy(),
					"session": session,
					"restart_needed": false,
					"server_binary_stale": false,
				},
				"update": {
					"restart_needed": false,
					"server_binary_stale": false
				}
			})
		}

		fn write_fake_herdr(fake_dir: &Path) -> PathBuf {
			let path = fake_dir.join("herdr");
			fs::write(
			&path,
			r#"#!/bin/sh
set -eu
dir=${HERDR_FAKE_DIR:?}
mkdir -p "$dir"
printf '%s\n' "$*" >> "$dir/args.log"
printf 'HERDR_SESSION=%s HERDR_SOCKET_PATH=%s\n' "${HERDR_SESSION-}" "${HERDR_SOCKET_PATH-}" >> "$dir/env.log"
for arg in "$@"; do
  if [ "$arg" = "--version" ]; then
    echo 'herdr 0.9.0'
    exit 0
  fi
done
for arg in "$@"; do
  if [ "$arg" = "stop" ]; then
    echo stop >> "$dir/stop.log"
    exit 0
  fi
done
for arg in "$@"; do
  if [ "$arg" = "list" ]; then
    if [ -f "$dir/sessions.json" ]; then
      cat "$dir/sessions.json"
    else
      printf '%s\n' '{"sessions":[]}'
    fi
    exit 0
  fi
done
for arg in "$@"; do
  if [ "$arg" = "status" ]; then
    sock=${HERDR_SOCKET_PATH-}
    case "$sock" in
      */sessions/*)
        if [ -f "$dir/named-status.json" ]; then
          cat "$dir/named-status.json"
          exit 0
        fi
        ;;
    esac
    cat "$dir/status.json"
    exit 0
  fi
done
for arg in "$@"; do
  if [ "$arg" = "server" ]; then
    n=0
    if [ -f "$dir/starts" ]; then
      n=$(cat "$dir/starts")
    fi
    n=$((n + 1))
    printf '%s\n' "$n" > "$dir/starts"
    printf '%s\n' "$$" > "$dir/server.pid"
    if [ -n "${HERDR_FAKE_START_SLEEP-}" ]; then
      sleep "${HERDR_FAKE_START_SLEEP}"
    fi
    if [ -f "$dir/on_start_status.json" ]; then
      cp "$dir/on_start_status.json" "$dir/status.json.tmp"
      mv "$dir/status.json.tmp" "$dir/status.json"
    fi
    sock=${HERDR_SOCKET_PATH-}
    if [ -n "$sock" ]; then
      mkdir -p "$(dirname "$sock")"
      python3 - "$sock" <<'PY'
import os, socket, sys, time
path = sys.argv[1]
try:
    os.unlink(path)
except FileNotFoundError:
    pass
server = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
server.bind(path)
server.listen(8)
server.settimeout(0.5)
while True:
    try:
        conn, _ = server.accept()
        conn.close()
    except socket.timeout:
        time.sleep(0.05)
PY
    else
      sleep 60
    fi
    exit 0
  fi
done
exit 2
"#,
		)
		.unwrap();
			fs::set_permissions(&path, fs::Permissions::from_mode(0o755))
				.unwrap();
			path
		}

		fn assert_namespace_env(env_log: &str, namespace: &HerdrNamespace) {
			assert!(!env_log.contains("HERDR_SESSION=2code"), "{env_log}");
			assert!(
				env_log.contains(&format!(
					"HERDR_SOCKET_PATH={}",
					namespace.socket_path.display()
				)),
				"{env_log}"
			);
			assert!(
				env_log.contains("/herdr/herdr.sock")
					|| namespace.session != DEFAULT_SESSION,
				"default attach must target the default session: {env_log}"
			);
		}

		#[test]
		fn probe_absent_is_distinct_from_incompatible() {
			let fx = Fixture::new();
			fx.write_status(fx.absent_status());
			match probe(&fx.env()).unwrap() {
				Probe::Absent => {}
				other => panic!("expected absent, got {other:?}"),
			}

			let mut incompatible = fx.compatible_status();
			incompatible["server"]["version"] = json!("0.1.0");
			incompatible["server"]["compatible"] = json!(false);
			fx.write_status(incompatible);
			match probe(&fx.env()).unwrap() {
				Probe::Incompatible(info) => {
					assert!(info.message.contains("0.1.0"), "{}", info.message);
					assert_eq!(info.socket_path, fx.namespace.socket_path);
				}
				other => panic!("expected incompatible, got {other:?}"),
			}

			let absent_err = AppError::from(HerdrProcessError::Absent {
				socket: fx.namespace.socket_path.clone(),
			});
			let incompatible_err =
				AppError::from(HerdrProcessError::Incompatible {
					message: "protocol 1".into(),
					socket: fx.namespace.socket_path.clone(),
				});
			assert!(absent_err.to_string().contains("absent"));
			assert!(incompatible_err.to_string().contains("incompatible"));
			assert!(!absent_err.to_string().contains("incompatible"));
			assert!(!incompatible_err.to_string().contains("absent"));
			assert_eq!(fx.starts(), 0);
			assert_eq!(fx.stop_count(), 0);
		}

		#[test]
		fn probe_treats_running_default_as_compatible() {
			let fx = Fixture::new();
			fx.write_status(fx.compatible_status());
			match probe(&fx.env()).unwrap() {
				Probe::Compatible(status) => {
					assert_eq!(status.session, DEFAULT_SESSION);
					assert_eq!(status.socket_path, fx.namespace.socket_path);
				}
				other => panic!("expected compatible default, got {other:?}"),
			}
			assert_namespace_env(&fx.env_log(), &fx.namespace);
			assert!(fx.args_log().contains("status --json"));
			assert!(!fx.args_log().contains("server stop"));
		}

		#[test]
		fn ensure_reuses_compatible_listener_without_starting() {
			let fx = Fixture::new();
			fx.write_status(fx.compatible_status());
			let lease = ensure_server(&fx.env()).unwrap();
			assert!(lease.endpoint.reused);
			assert_eq!(lease.endpoint.session, DEFAULT_SESSION);
			assert_eq!(lease.endpoint.socket_path, fx.namespace.socket_path);
			assert!(lease
				.endpoint
				.socket_path
				.to_string_lossy()
				.ends_with("herdr/herdr.sock"));
			assert_eq!(fx.starts(), 0);
			assert_eq!(fx.stop_count(), 0);
			assert_namespace_env(&fx.env_log(), &fx.namespace);
		}

		#[test]
		fn ensure_starts_one_detached_server_when_absent() {
			let fx = Fixture::new();
			fx.write_status(fx.absent_status());
			fs::write(
				fx.fake_dir.join("on_start_status.json"),
				fx.compatible_status().to_string(),
			)
			.unwrap();
			let lease = ensure_server(&fx.env()).unwrap();
			assert!(!lease.endpoint.reused);
			assert_eq!(lease.endpoint.session, DEFAULT_SESSION);
			assert_eq!(lease.endpoint.socket_path, fx.namespace.socket_path);
			assert!(lease
				.endpoint
				.socket_path
				.to_string_lossy()
				.ends_with("herdr/herdr.sock"));
			assert_eq!(fx.starts(), 1);
			assert_eq!(fx.stop_count(), 0);
			assert!(fx.args_log().contains("server"));
			assert!(!fx.args_log().contains("server stop"));
			assert!(!fx.args_log().contains("2code"));
			assert_namespace_env(&fx.env_log(), &fx.namespace);
			drop(lease);
			assert_eq!(fx.stop_count(), 0);
		}

		#[test]
		fn ensure_attaches_to_running_named_session_instead_of_starting() {
			let fx = Fixture::new();
			fx.write_status(fx.absent_status());
			let named_sock = fx
				.namespace
				.xdg_config_home
				.join("herdr/sessions/work/herdr.sock");
			fs::write(
				fx.fake_dir.join("sessions.json"),
				json!({
					"sessions": [
						{
							"name": "default",
							"default": true,
							"running": false,
							"socket_path": fx.namespace.socket_path,
							"session_dir": fx.namespace.xdg_config_home.join("herdr")
						},
						{
							"name": "work",
							"default": false,
							"running": true,
							"socket_path": named_sock,
							"session_dir": fx.namespace.xdg_config_home.join("herdr/sessions/work")
						}
					]
				})
				.to_string(),
			)
			.unwrap();
			fs::write(
				fx.fake_dir.join("named-status.json"),
				status_doc(
					true,
					Some(PINNED_VERSION),
					Some("work"),
					&named_sock,
				)
				.to_string(),
			)
			.unwrap();
			let lease = ensure_server(&fx.env()).unwrap();
			assert!(lease.endpoint.reused);
			assert_eq!(lease.endpoint.session, "work");
			assert_eq!(lease.endpoint.socket_path, named_sock);
			assert_eq!(fx.starts(), 0);
			assert_eq!(fx.stop_count(), 0);
		}

		#[test]
		fn ensure_does_not_start_when_named_session_is_incompatible() {
			let fx = Fixture::new();
			fx.write_status(fx.absent_status());
			let named_sock = fx
				.namespace
				.xdg_config_home
				.join("herdr/sessions/work/herdr.sock");
			fs::write(
				fx.fake_dir.join("sessions.json"),
				json!({
					"sessions": [{
						"name": "work",
						"default": false,
						"running": true,
						"socket_path": named_sock,
						"session_dir": fx.namespace.xdg_config_home.join("herdr/sessions/work")
					}]
				})
				.to_string(),
			)
			.unwrap();
			let mut bad =
				status_doc(true, Some("0.8.2"), Some("work"), &named_sock);
			bad["server"]["protocol"] = json!(20);
			bad["server"]["compatible"] = json!(false);
			fs::write(fx.fake_dir.join("named-status.json"), bad.to_string())
				.unwrap();
			let err = match ensure_server(&fx.env()) {
				Err(err) => err,
				Ok(_) => panic!("expected incompatible named session"),
			};
			match err {
				HerdrProcessError::Incompatible { message, .. } => {
					assert!(
						message.contains("0.8.2")
							|| message.contains("protocol"),
						"{message}"
					);
				}
				other => panic!("expected incompatible, got {other:?}"),
			}
			assert_eq!(fx.starts(), 0);
			assert_eq!(fx.stop_count(), 0);
		}

		#[test]
		fn ensure_does_not_start_or_stop_an_incompatible_server() {
			let fx = Fixture::new();
			let mut bad = fx.compatible_status();
			bad["server"]["protocol"] = json!(1);
			fx.write_status(bad);
			let err = match ensure_server(&fx.env()) {
				Err(err) => err,
				Ok(_) => panic!("expected incompatible, started a server"),
			};
			match err {
				HerdrProcessError::Incompatible { message, socket } => {
					assert!(message.contains("protocol 1"), "{message}");
					assert_eq!(socket, fx.namespace.socket_path);
				}
				other => panic!("expected incompatible, got {other:?}"),
			}
			assert_eq!(fx.starts(), 0);
			assert_eq!(fx.stop_count(), 0);
		}

		#[test]
		fn concurrent_ensure_starts_at_most_one_server() {
			let fx = Fixture::new();
			fx.write_status(fx.absent_status());
			fs::write(
				fx.fake_dir.join("on_start_status.json"),
				fx.compatible_status().to_string(),
			)
			.unwrap();
			let extra = [(
				OsString::from("HERDR_FAKE_START_SLEEP"),
				OsString::from("0.2"),
			)];
			let mut env_vars = fx.extra_env.clone();
			env_vars.extend_from_slice(&extra);
			let env_a = HerdrProcessEnv {
				executable: &fx.executable,
				namespace: &fx.namespace,
				extra_env: &env_vars,
				ready_timeout: Duration::from_secs(5),
				cli_timeout: Duration::from_secs(3),
			};
			let env_b = HerdrProcessEnv {
				executable: &fx.executable,
				namespace: &fx.namespace,
				extra_env: &env_vars,
				ready_timeout: Duration::from_secs(5),
				cli_timeout: Duration::from_secs(3),
			};
			thread::scope(|scope| {
				let a = scope.spawn(|| {
					ensure_server(&env_a).map(|lease| lease.endpoint.clone())
				});
				let b = scope.spawn(|| {
					ensure_server(&env_b).map(|lease| lease.endpoint.clone())
				});
				a.join().unwrap().unwrap();
				b.join().unwrap().unwrap();
			});
			assert_eq!(fx.starts(), 1);
			assert_eq!(fx.stop_count(), 0);
		}

		#[test]
		fn dropping_lease_kills_helpers_and_does_not_stop_server() {
			let fx = Fixture::new();
			fx.write_status(fx.compatible_status());
			let mut lease = ensure_server(&fx.env()).unwrap();
			let helper = Command::new("sleep")
				.arg("30")
				.stdin(Stdio::null())
				.stdout(Stdio::null())
				.stderr(Stdio::null())
				.spawn()
				.unwrap();
			let helper_pid = helper.id();
			lease.track_helper(helper);
			lease.release_client_helpers();
			thread::sleep(Duration::from_millis(50));
			assert_eq!(fx.stop_count(), 0);
			assert_eq!(fx.starts(), 0);
			unsafe {
				// SAFETY: existence probe for the helper pid we just killed.
				assert_eq!(
					libc::kill(helper_pid as i32, 0),
					-1,
					"helper must be gone"
				);
			}
			drop(lease);
			assert_eq!(fx.stop_count(), 0);
		}

		#[test]
		fn client_guard_release_does_not_invoke_server_stop() {
			let fx = Fixture::new();
			fx.write_status(fx.absent_status());
			fs::write(
				fx.fake_dir.join("on_start_status.json"),
				fx.compatible_status().to_string(),
			)
			.unwrap();
			let guard = HerdrClientGuard::new();
			let endpoint = guard.ensure(&fx.env()).unwrap();
			assert_eq!(endpoint.session, DEFAULT_SESSION);
			assert_eq!(fx.starts(), 1);
			guard.release_client_helpers();
			assert_eq!(fx.stop_count(), 0);
			assert!(fx.args_log().lines().all(|line| !line.contains("stop")));
		}

		struct Live {
			bin: PathBuf,
			root: tempfile::TempDir,
			namespace: HerdrNamespace,
			extra_env: Vec<(OsString, OsString)>,
			_lock: std::sync::MutexGuard<'static, ()>,
		}

		impl Live {
			fn start() -> Option<Self> {
				let lock = crate::herdr::lock_live_herdr_tests();
				let bin = live_binary()?;
				let n = LIVE_SEQ.fetch_add(1, Ordering::Relaxed);
				let root = tempfile::tempdir().unwrap();
				let xdg = root.path().join("xdg-config");
				fs::create_dir_all(xdg.join("herdr")).unwrap();
				fs::write(
					xdg.join("herdr/config.toml"),
					"onboarding = false\n",
				)
				.unwrap();
				let namespace = isolated_namespace(xdg);
				let extra_env = vec![
					(
						OsString::from("HOME"),
						root.path().join("home").into_os_string(),
					),
					(
						OsString::from("XDG_STATE_HOME"),
						root.path().join("xdg-state").into_os_string(),
					),
					(
						OsString::from("XDG_CACHE_HOME"),
						root.path().join("xdg-cache").into_os_string(),
					),
				];
				let _ = n;
				Some(Self {
					bin,
					root,
					namespace,
					extra_env,
					_lock: lock,
				})
			}

			fn env(&self) -> HerdrProcessEnv<'_> {
				HerdrProcessEnv {
					executable: &self.bin,
					namespace: &self.namespace,
					extra_env: &self.extra_env,
					ready_timeout: Duration::from_secs(10),
					cli_timeout: Duration::from_secs(5),
				}
			}

			fn default_status(&self) -> Value {
				let mut cmd = Command::new(&self.bin);
				cmd.env("XDG_CONFIG_HOME", &self.namespace.xdg_config_home)
					.env("HOME", self.root.path().join("home"))
					.env_remove("HERDR_SESSION")
					.env_remove("HERDR_SOCKET_PATH")
					.args(["status", "--json"]);
				let output = cmd.output().unwrap();
				serde_json::from_slice(&output.stdout).unwrap()
			}
		}

		impl Drop for Live {
			fn drop(&mut self) {
				let mut cmd = Command::new(&self.bin);
				cmd.env_remove("HERDR_SESSION")
					.env("HERDR_SOCKET_PATH", &self.namespace.socket_path)
					.env("XDG_CONFIG_HOME", &self.namespace.xdg_config_home)
					.env("HOME", self.root.path().join("home"))
					.args(["server", "stop"]);
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
					|| env::var_os("HERDR_CONTRACT_REQUIRED").is_some() =>
				{
					panic!(
					"pinned Herdr binary missing; see docs/herdr-integration.md"
				);
				}
				None => {
					eprintln!(
					"skipping live Herdr process test (set HERDR_SIDECAR_REQUIRED=1 to fail)"
				);
					None
				}
			}
		}

		#[test]
		fn live_probe_start_reuse_and_gui_drop_leave_server() {
			let Some(live) = require_live() else {
				return;
			};
			assert!(
				live.namespace
					.socket_path
					.to_string_lossy()
					.ends_with("herdr/herdr.sock"),
				"must start the default socket: {}",
				live.namespace.socket_path.display()
			);
			assert!(
				!live
					.namespace
					.socket_path
					.to_string_lossy()
					.contains("sessions/2code"),
				"must not use a private 2code session"
			);
			match probe(&live.env()).unwrap() {
				Probe::Absent => {}
				other => panic!("expected absent before start, got {other:?}"),
			}
			let lease = ensure_server(&live.env()).unwrap();
			assert!(!lease.endpoint.reused);
			assert_eq!(lease.endpoint.session, DEFAULT_SESSION);
			assert!(socket_is_live(&live.namespace.socket_path));

			let reused = ensure_server(&live.env()).unwrap();
			assert!(reused.endpoint.reused);
			drop(reused);
			drop(lease);

			assert!(
				socket_is_live(&live.namespace.socket_path),
				"server must stay alive after client lease drop"
			);
			match probe(&live.env()).unwrap() {
				Probe::Compatible(status) => {
					assert_eq!(status.session, DEFAULT_SESSION);
					assert_eq!(status.version, PINNED_VERSION);
				}
				other => {
					panic!("expected compatible after drop, got {other:?}")
				}
			}

			let default = live.default_status();
			assert_eq!(default["server"]["running"], true);
			assert!(default["server"]["socket"]
				.as_str()
				.unwrap()
				.ends_with("herdr/herdr.sock"));
		}

		#[test]
		fn live_created_workspace_is_visible_on_default_socket() {
			let Some(live) = require_live() else {
				return;
			};
			let lease = ensure_server(&live.env()).unwrap();
			assert!(lease
				.endpoint
				.socket_path
				.to_string_lossy()
				.ends_with("herdr/herdr.sock"));
			let cwd = live.root.path().join("proof-ws");
			fs::create_dir_all(&cwd).unwrap();
			let client = crate::herdr::transport::HerdrClient::connect_path(
				&live.namespace.socket_path,
			)
			.unwrap();
			let created = client
				.workspace_create(
					crate::herdr::transport::WorkspaceCreateRequest {
						cwd: &cwd,
						label: Some("task1-default-socket"),
					},
				)
				.unwrap();
			assert!(!created.workspace_id.is_empty());

			let mut snap_cmd = Command::new(&live.bin);
			snap_cmd
				.env("HOME", live.root.path().join("home"))
				.env("XDG_CONFIG_HOME", &live.namespace.xdg_config_home)
				.env("XDG_STATE_HOME", live.root.path().join("xdg-state"))
				.env("XDG_CACHE_HOME", live.root.path().join("xdg-cache"))
				.env("HERDR_SOCKET_PATH", &live.namespace.socket_path)
				.env("HERDR_DISABLE_SOUND", "1")
				.env_remove("HERDR_SESSION")
				.args(["api", "snapshot"]);
			let output = snap_cmd.output().unwrap();
			assert!(
				output.status.success(),
				"herdr api snapshot failed: {}",
				String::from_utf8_lossy(&output.stderr)
			);
			let stdout = String::from_utf8_lossy(&output.stdout);
			assert!(!stdout.contains("HERDR_SESSION=2code"), "{stdout}");
			let snap: Value = serde_json::from_slice(&output.stdout).unwrap();
			let workspaces = snap["result"]["snapshot"]["workspaces"]
				.as_array()
				.or_else(|| snap["snapshot"]["workspaces"].as_array())
				.expect("snapshot workspaces");
			assert!(
				workspaces.iter().any(|workspace| {
					workspace["workspace_id"].as_str()
						== Some(created.workspace_id.as_str())
				}),
				"workspace {} missing from default-socket snapshot: {snap}",
				created.workspace_id
			);
			drop(lease);
			assert!(
				socket_is_live(&live.namespace.socket_path),
				"default socket must stay live after lease drop"
			);
		}

		#[test]
		fn live_incompatible_foreign_socket_is_not_overwritten() {
			let Some(live) = require_live() else {
				return;
			};
			if let Some(parent) = live.namespace.socket_path.parent() {
				fs::create_dir_all(parent).unwrap();
			}
			let sock = live.namespace.socket_path.clone();
			let listener = thread::spawn(move || {
				let _ = fs::remove_file(&sock);
				let server =
					std::os::unix::net::UnixListener::bind(&sock).unwrap();
				let _ = server.set_nonblocking(true);
				let deadline = Instant::now() + Duration::from_secs(4);
				while Instant::now() < deadline {
					let _ = server.accept();
					thread::sleep(Duration::from_millis(20));
				}
			});
			thread::sleep(Duration::from_millis(80));
			assert!(socket_is_live(&live.namespace.socket_path));
			let err = match ensure_server(&live.env()) {
				Err(err) => err,
				Ok(_) => panic!("expected incompatible, started a server"),
			};
			match err {
				HerdrProcessError::Incompatible { .. } => {}
				other => panic!("expected incompatible, got {other:?}"),
			}
			assert!(socket_is_live(&live.namespace.socket_path));
			let _ = listener.join();
		}
	}
}
