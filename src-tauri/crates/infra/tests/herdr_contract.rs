//! Live probe of the pinned Herdr integration contract.
//!
//! Binaries are not in git. See `docs/herdr-integration.md`.
//!
//! ```text
//! HERDR_CONTRACT_REQUIRED=1 cargo test -p infra --test herdr_contract -- --nocapture --test-threads=1
//! ```
//!
//! Override the executable with `HERDR_BIN`. Live tests skip when the binary
//! is missing unless `HERDR_CONTRACT_REQUIRED=1`.
//!
//! DSR/DA coverage shells out to `python3` with `termios`/`tty`.

use serde_json::{json, Value};
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Output, Stdio};
use std::time::{Duration, Instant};
use std::{env, fs, thread};

fn fixtures_dir() -> PathBuf {
	Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/herdr")
}

fn load_json(name: &str) -> Value {
	let path = fixtures_dir().join(name);
	let raw = fs::read_to_string(&path)
		.unwrap_or_else(|err| panic!("read {}: {err}", path.display()));
	serde_json::from_str(&raw)
		.unwrap_or_else(|err| panic!("parse {}: {err}", path.display()))
}

fn pin() -> Value {
	load_json("pin.json")
}

fn current_asset<'a>(pin: &'a Value) -> Option<&'a Value> {
	let os = match env::consts::OS {
		"macos" => "macos",
		"linux" => "linux",
		"windows" => "windows",
		_ => return None,
	};
	let arch = env::consts::ARCH;
	pin["assets"].as_array()?.iter().find(|asset| {
		asset["os"].as_str() == Some(os) && asset["arch"].as_str() == Some(arch)
	})
}

fn default_cache_dir(pin: &Value) -> PathBuf {
	let version = pin["version"].as_str().unwrap();
	let root = env::var_os("XDG_CACHE_HOME")
		.map(PathBuf::from)
		.or_else(|| {
			env::var_os("HOME").map(|home| PathBuf::from(home).join(".cache"))
		})
		.unwrap_or_else(env::temp_dir);
	root.join("2code/herdr").join(format!("v{version}"))
}

fn sha256_hex(path: &Path) -> String {
	let output = if cfg!(target_os = "macos") {
		Command::new("shasum")
			.args(["-a", "256"])
			.arg(path)
			.output()
	} else {
		Command::new("sha256sum").arg(path).output()
	}
	.unwrap_or_else(|err| panic!("checksum {err}"));
	assert!(
		output.status.success(),
		"checksum failed: {}",
		String::from_utf8_lossy(&output.stderr)
	);
	let stdout = String::from_utf8(output.stdout).unwrap();
	stdout
		.split_whitespace()
		.next()
		.expect("checksum output")
		.to_string()
}

fn locate_herdr() -> Option<PathBuf> {
	let pin = pin();
	let asset = current_asset(&pin)?;
	let expected = asset["sha256"].as_str()?;
	if let Some(explicit) = env::var_os("HERDR_BIN") {
		let path = PathBuf::from(explicit);
		let actual = sha256_hex(&path);
		assert_eq!(
			actual, expected,
			"HERDR_BIN checksum mismatch for pinned {}",
			pin["version"]
		);
		return Some(path);
	}
	let cached = default_cache_dir(&pin).join(asset["name"].as_str()?);
	if !cached.is_file() {
		return None;
	}
	let actual = sha256_hex(&cached);
	assert_eq!(
		actual, expected,
		"cached herdr checksum mismatch; re-download the pinned release"
	);
	Some(cached)
}

fn require_herdr() -> Option<PathBuf> {
	match locate_herdr() {
		Some(path) => Some(path),
		None if env::var_os("HERDR_CONTRACT_REQUIRED").is_some() => {
			panic!(
				"pinned Herdr binary missing; see docs/herdr-integration.md"
			);
		}
		None => {
			eprintln!(
				"skipping live Herdr contract test (set HERDR_BIN or download the pinned binary)"
			);
			None
		}
	}
}

#[test]
fn pin_fixture_records_an_exact_release() {
	let pin = pin();
	assert_eq!(pin["version"], "0.9.0");
	assert_eq!(pin["tag"], "v0.9.0");
	assert_eq!(
		pin["source_commit"],
		"b99002ac99b09e00b4ca692436cb15a6b0d676f1"
	);
	assert_eq!(pin["license"]["spdx"], "Apache-2.0");
	assert_eq!(pin["protocol"]["json_api"], 22);
	let assets = pin["assets"].as_array().unwrap();
	assert_eq!(assets.len(), 5);
	for asset in assets {
		let sha = asset["sha256"].as_str().unwrap();
		assert_eq!(sha.len(), 64, "{}", asset["name"]);
		assert!(
			asset["url"].as_str().unwrap().contains("/download/v0.9.0/"),
			"download URL must pin v0.9.0, not latest"
		);
	}

	let excerpt = load_json("schema-excerpt.json");
	assert_eq!(excerpt["protocol"], 22);
	let methods = excerpt["control_methods"].as_array().unwrap();
	for required in [
		"ping",
		"session.snapshot",
		"workspace.create",
		"workspace.list",
		"workspace.close",
		"worktree.list",
		"worktree.create",
		"worktree.open",
		"worktree.remove",
		"tab.create",
		"pane.split",
		"pane.read",
		"pane.scroll",
		"pane.send_text",
		"pane.send_keys",
		"pane.send_input",
		"pane.close",
		"pane.process_info",
		"events.subscribe",
	] {
		assert!(
			methods.iter().any(|method| method == required),
			"missing {required}"
		);
	}
}

fn decode_base64(input: &str) -> Vec<u8> {
	fn val(byte: u8) -> u8 {
		match byte {
			b'A'..=b'Z' => byte - b'A',
			b'a'..=b'z' => byte - b'a' + 26,
			b'0'..=b'9' => byte - b'0' + 52,
			b'+' => 62,
			b'/' => 63,
			_ => panic!("invalid base64 byte {byte}"),
		}
	}
	let bytes: Vec<u8> = input
		.bytes()
		.filter(|byte| !byte.is_ascii_whitespace())
		.collect();
	let mut out = Vec::new();
	for chunk in bytes.chunks(4) {
		if chunk.len() < 2 {
			break;
		}
		let a = val(chunk[0]);
		let b = val(chunk[1]);
		out.push((a << 2) | (b >> 4));
		if chunk.len() > 2 && chunk[2] != b'=' {
			let c = val(chunk[2]);
			out.push((b << 4) | (c >> 2));
			if chunk.len() > 3 && chunk[3] != b'=' {
				out.push((c << 6) | val(chunk[3]));
			}
		}
	}
	out
}

fn contains_bytes(hay: &[u8], needle: &[u8]) -> bool {
	hay.windows(needle.len()).any(|window| window == needle)
}

#[test]
fn frame_fixtures_encode_full_vs_incremental() {
	let full = load_json("frames/full-redraw.json");
	assert_eq!(full["record"]["full"], true);
	assert_eq!(full["record"]["type"], "terminal.frame");
	let full_bytes = decode_base64(full["record"]["bytes"].as_str().unwrap());
	assert!(contains_bytes(&full_bytes, b"\x1b[?2026h"));
	assert!(contains_bytes(&full_bytes, b"\x1b[2J"));
	assert!(contains_bytes(&full_bytes, b"\x1b[1;1H"));

	let incr = load_json("frames/incremental.json");
	assert_eq!(incr["record"]["full"], false);
	let incr_bytes = decode_base64(incr["record"]["bytes"].as_str().unwrap());
	assert!(contains_bytes(&incr_bytes, b"INCR_LINE_XYZ"));
	assert!(
		!contains_bytes(&incr_bytes, b"\x1b[2J"),
		"incremental frames must not clear the screen"
	);

	let uni = load_json("frames/unicode-ansi.json");
	let uni_bytes = decode_base64(uni["record"]["bytes"].as_str().unwrap());
	assert!(contains_bytes(&uni_bytes, "αβγ".as_bytes()));
	assert!(contains_bytes(&uni_bytes, b"\x1b[31m"));

	let dsr = load_json("frames/dsr-da.json");
	assert!(dsr["xtermjs_rule"]
		.as_str()
		.unwrap()
		.contains("must not additionally answer"));
}

/// Conservative `sockaddr_un.sun_path` bound (macOS 104; Linux 108).
#[cfg(unix)]
const SUN_PATH_CAP: usize = 104;

#[cfg(unix)]
fn unix_path_len(path: &Path) -> usize {
	use std::os::unix::ffi::OsStrExt;
	path.as_os_str().as_bytes().len()
}

#[cfg(unix)]
fn derive_client_socket(api: &Path) -> PathBuf {
	let stem = api.file_stem().and_then(|s| s.to_str()).unwrap_or("herdr");
	api.with_file_name(format!("{stem}-client.sock"))
}

/// Default Herdr layout: `$XDG_CONFIG_HOME/herdr/sessions/<name>/herdr.sock`.
/// `config_parent` is the directory that contains `xdg-config`.
#[cfg(unix)]
fn nested_session_api_socket(config_parent: &Path, session: &str) -> PathBuf {
	config_parent
		.join("xdg-config/herdr/sessions")
		.join(session)
		.join("herdr.sock")
}

#[cfg(unix)]
fn assert_socket_fits(path: &Path) {
	let len = unix_path_len(path);
	assert!(
		len < SUN_PATH_CAP,
		"Unix socket path exceeds sun_path ({len} >= {SUN_PATH_CAP}): {}",
		path.display()
	);
}

#[cfg(unix)]
#[test]
fn nested_session_sockets_under_long_tmpdir_exceed_sun_path() {
	let tmpdir = PathBuf::from(format!("/{}", "x".repeat(70)));
	let session = format!("t{}", "a".repeat(32));
	let api = nested_session_api_socket(&tmpdir, &session);
	let client = api.with_file_name("herdr-client.sock");
	assert!(
		unix_path_len(&api) >= SUN_PATH_CAP,
		"expected API socket {} to exceed sun_path, len {}",
		api.display(),
		unix_path_len(&api)
	);
	assert!(
		unix_path_len(&client) >= SUN_PATH_CAP,
		"expected client socket {} to exceed sun_path, len {}",
		client.display(),
		unix_path_len(&client)
	);
}

#[cfg(unix)]
#[test]
fn short_override_sockets_fit_sun_path() {
	let api = PathBuf::from("/tmp/2cdead.sock");
	let client = derive_client_socket(&api);
	assert_socket_fits(&api);
	assert_socket_fits(&client);
	assert_eq!(client, PathBuf::from("/tmp/2cdead-client.sock"));
}

#[cfg(unix)]
#[test]
fn bind_rejects_nested_session_socket_over_sun_path() {
	use std::os::unix::net::UnixListener;
	let tmpdir = PathBuf::from("/tmp")
		.join(format!("2cl{}", std::process::id()))
		.join("x".repeat(70));
	let session = format!("t{}", "a".repeat(32));
	let api = nested_session_api_socket(&tmpdir, &session);
	assert!(
		unix_path_len(&api) >= SUN_PATH_CAP,
		"fixture path too short to reproduce overflow: {} len {}",
		api.display(),
		unix_path_len(&api)
	);
	if let Some(parent) = api.parent() {
		fs::create_dir_all(parent).unwrap();
	}
	let err = UnixListener::bind(&api)
		.expect_err("nested session socket over sun_path must not bind");
	let msg = err.to_string();
	assert!(
		msg.contains("sun_path")
			|| msg.contains("SUN_LEN")
			|| msg.to_ascii_lowercase().contains("too long")
			|| err.kind() == std::io::ErrorKind::InvalidInput,
		"unexpected bind error for {}: {err:?}",
		api.display()
	);
	let _ = fs::remove_dir_all(
		PathBuf::from("/tmp").join(format!("2cl{}", std::process::id())),
	);
}

#[cfg(unix)]
mod live {
	use super::*;
	use std::os::unix::net::UnixStream;
	use std::sync::atomic::{AtomicU32, Ordering};
	use std::sync::mpsc;

	const READY_TIMEOUT: Duration = Duration::from_secs(10);
	const SOCK_TIMEOUT: Duration = Duration::from_secs(2);
	const FRAME_TIMEOUT: Duration = Duration::from_secs(5);
	const CMD_TIMEOUT: Duration = Duration::from_secs(12);
	const STOP_TIMEOUT: Duration = Duration::from_secs(2);

	static SOCK_SEQ: AtomicU32 = AtomicU32::new(1);

	struct Harness {
		bin: PathBuf,
		root: tempfile::TempDir,
		state: PathBuf,
		server: Child,
		sock: PathBuf,
		client_sock: PathBuf,
		repo: PathBuf,
	}

	impl Harness {
		fn start(bin: PathBuf) -> Self {
			let root = tempfile::tempdir().unwrap();
			// Keep XDG long enough that default `--session` sockets overflow
			// sun_path; JSON/client sockets stay under `/tmp/2c…`.
			let state = root.path().join("x".repeat(80));
			fs::create_dir_all(&state).unwrap();
			let xdg = state.join("xdg-config");
			let home = state.join("home");
			let repo = state.join("repo");
			let worktrees = state.join("worktrees");
			fs::create_dir_all(xdg.join("herdr")).unwrap();
			fs::create_dir_all(&home).unwrap();
			fs::create_dir_all(&repo).unwrap();
			fs::create_dir_all(&worktrees).unwrap();
			fs::write(home.join(".zshrc"), "PS1='$ '\n").unwrap();
			fs::write(
				xdg.join("herdr/config.toml"),
				format!(
					"onboarding = false\n\n\
[ui.sound]\nenabled = false\n\n\
[ui.toast]\ndelivery = \"off\"\n\n\
[worktrees]\ndirectory = {}\n\n\
[server]\nheadless_cols = 80\nheadless_rows = 24\n\n\
[terminal]\ndefault_shell = \"/bin/sh\"\n",
					toml_string(worktrees.to_str().unwrap())
				),
			)
			.unwrap();

			init_git_repo(&repo);

			let n = SOCK_SEQ.fetch_add(1, Ordering::Relaxed);
			let sock = PathBuf::from(format!(
				"/tmp/2c{:x}{:x}.sock",
				std::process::id(),
				n
			));
			let client_sock = derive_client_socket(&sock);
			assert_socket_fits(&sock);
			assert_socket_fits(&client_sock);
			let nested = nested_session_api_socket(
				&state,
				&format!("t{}", "a".repeat(32)),
			);
			assert!(
				unix_path_len(&nested) >= SUN_PATH_CAP,
				"harness XDG must reproduce nested-session overflow, len {} for {}",
				unix_path_len(&nested),
				nested.display()
			);
			let _ = fs::remove_file(&sock);
			let _ = fs::remove_file(&client_sock);
			let log = fs::File::create(root.path().join("server.log")).unwrap();
			let mut cmd = Command::new(&bin);
			cmd.arg("server");
			apply_env(&mut cmd, &state, &sock);
			cmd.stdin(Stdio::null())
				.stdout(Stdio::from(log.try_clone().unwrap()))
				.stderr(Stdio::from(log));
			let server = cmd.spawn().unwrap();
			let harness = Self {
				bin,
				root,
				state,
				server,
				sock,
				client_sock,
				repo,
			};
			harness.wait_ready();
			harness
		}

		fn wait_ready(&self) {
			let deadline = Instant::now() + READY_TIMEOUT;
			while Instant::now() < deadline {
				if self.server_exited() {
					panic!("herdr server exited early:\n{}", self.server_log());
				}
				let api = UnixStream::connect(&self.sock).ok();
				let client = UnixStream::connect(&self.client_sock).ok();
				if let (Some(api), Some(client)) = (api, client) {
					let _ = api.set_read_timeout(Some(SOCK_TIMEOUT));
					let _ = api.set_write_timeout(Some(SOCK_TIMEOUT));
					drop(client);
					return;
				}
				thread::sleep(Duration::from_millis(40));
			}
			panic!("herdr server was not ready:\n{}", self.server_log());
		}

		fn server_exited(&self) -> bool {
			let pid = self.server.id();
			Command::new("kill")
				.args(["-0", &pid.to_string()])
				.status()
				.map(|status| !status.success())
				.unwrap_or(true)
		}

		fn server_log(&self) -> String {
			fs::read_to_string(self.root.path().join("server.log"))
				.unwrap_or_default()
		}

		fn env_command(&self) -> Command {
			let mut cmd = Command::new(&self.bin);
			apply_env(&mut cmd, &self.state, &self.sock);
			cmd
		}

		fn cli(&self, args: &[&str]) -> Output {
			let mut cmd = self.env_command();
			cmd.args(args);
			run_timed(cmd, CMD_TIMEOUT)
		}

		fn cli_ok(&self, args: &[&str]) -> Output {
			let output = self.cli(args);
			assert!(
				output.status.success(),
				"herdr {args:?} failed ({:?})\nstdout:\n{}\nstderr:\n{}",
				output.status.code(),
				String::from_utf8_lossy(&output.stdout),
				String::from_utf8_lossy(&output.stderr)
			);
			output
		}

		fn cli_json(&self, args: &[&str]) -> Value {
			let output = self.cli_ok(args);
			serde_json::from_slice(&output.stdout).unwrap_or_else(|err| {
				panic!(
					"json {args:?}: {err}\n{}",
					String::from_utf8_lossy(&output.stdout)
				)
			})
		}

		fn cli_err_json(&self, args: &[&str]) -> Value {
			let output = self.cli(args);
			assert!(
				!output.status.success(),
				"expected failure for {args:?}: {}",
				String::from_utf8_lossy(&output.stdout)
			);
			let raw = if output.stderr.is_empty() {
				output.stdout
			} else {
				output.stderr
			};
			serde_json::from_slice(&raw).unwrap_or_else(|err| {
				panic!(
					"error json {args:?}: {err}\n{}",
					String::from_utf8_lossy(&raw)
				)
			})
		}

		fn rpc(&self, id: &str, method: &str, params: Value) -> Value {
			let req = json!({
				"id": id,
				"method": method,
				"params": params
			});
			let mut stream = UnixStream::connect(&self.sock).unwrap();
			stream.set_read_timeout(Some(SOCK_TIMEOUT)).unwrap();
			stream.set_write_timeout(Some(SOCK_TIMEOUT)).unwrap();
			writeln!(stream, "{req}").unwrap();
			let mut line = String::new();
			BufReader::new(stream).read_line(&mut line).unwrap();
			serde_json::from_str(&line)
				.unwrap_or_else(|err| panic!("rpc {method}: {err} ({line})"))
		}

		fn create_workspace(&self, label: &str) -> Value {
			self.cli_json(&[
				"workspace",
				"create",
				"--cwd",
				self.repo.to_str().unwrap(),
				"--label",
				label,
				"--env",
				"CONTRACT_ENV=from_probe",
				"--no-focus",
			])
		}

		fn spawn_terminal_inner(
			&self,
			mode: &str,
			target: &str,
			takeover: bool,
			stderr_path: Option<&Path>,
		) -> Child {
			let mut cmd = self.env_command();
			cmd.args([
				"terminal", "session", mode, target, "--cols", "80", "--rows",
				"24",
			]);
			if takeover {
				cmd.arg("--takeover");
			}
			cmd.stdin(Stdio::piped()).stdout(Stdio::piped());
			if let Some(path) = stderr_path {
				let log = fs::File::create(path).unwrap();
				cmd.stderr(Stdio::from(log));
			} else {
				cmd.stderr(Stdio::null());
			}
			cmd.spawn().unwrap()
		}

		fn spawn_session(
			&self,
			mode: &str,
			target: &str,
			takeover: bool,
			must_stay: bool,
		) -> TerminalSession {
			let n = SOCK_SEQ.fetch_add(1, Ordering::Relaxed);
			let stderr_path =
				self.root.path().join(format!("term-{mode}-{n}.err"));
			let mut child = self.spawn_terminal_inner(
				mode,
				target,
				takeover,
				Some(&stderr_path),
			);
			let stdout = child.stdout.take().expect("terminal stdout");
			let rx = json_line_reader(stdout);
			if must_stay {
				thread::sleep(Duration::from_millis(50));
				if let Ok(Some(status)) = child.try_wait() {
					let err =
						fs::read_to_string(&stderr_path).unwrap_or_default();
					panic!(
						"terminal session {mode} {target} exited immediately ({status:?})\n--- stderr ---\n{err}\n--- server ---\n{}",
						self.server_log()
					);
				}
			}
			TerminalSession {
				child,
				rx,
				stderr_path,
				server_log: self.root.path().join("server.log"),
				label: format!("{mode} {target}"),
			}
		}

		fn stop_server_process(&mut self) {
			let mut stop = self.env_command();
			if let Ok(mut child) = stop
				.args(["server", "stop"])
				.stdin(Stdio::null())
				.stdout(Stdio::null())
				.stderr(Stdio::null())
				.spawn()
			{
				if !wait_try(&mut child, STOP_TIMEOUT) {
					let _ = child.kill();
					let _ = wait_try(&mut child, Duration::from_secs(1));
				}
			}
			let _ = self.server.kill();
			if !wait_try(&mut self.server, STOP_TIMEOUT) {
				let _ = Command::new("kill")
					.args(["-9", &self.server.id().to_string()])
					.status();
				let _ = wait_try(&mut self.server, Duration::from_secs(1));
			}
			let _ = fs::remove_file(&self.sock);
			let _ = fs::remove_file(&self.client_sock);
		}

		fn restart_server(&mut self) {
			self.stop_server_process();
			let deadline = Instant::now() + STOP_TIMEOUT;
			while self.sock.exists() && Instant::now() < deadline {
				thread::sleep(Duration::from_millis(20));
			}
			let log =
				fs::File::create(self.root.path().join("server.log")).unwrap();
			let mut cmd = Command::new(&self.bin);
			cmd.arg("server");
			apply_env(&mut cmd, &self.state, &self.sock);
			cmd.stdin(Stdio::null())
				.stdout(Stdio::from(log.try_clone().unwrap()))
				.stderr(Stdio::from(log));
			self.server = cmd.spawn().unwrap();
			self.wait_ready();
		}
	}

	impl Drop for Harness {
		fn drop(&mut self) {
			self.stop_server_process();
		}
	}

	struct TerminalSession {
		child: Child,
		rx: mpsc::Receiver<String>,
		stderr_path: PathBuf,
		server_log: PathBuf,
		label: String,
	}

	impl TerminalSession {
		fn still_running(&mut self) -> bool {
			self.child.try_wait().ok().flatten().is_none()
		}

		fn send(&mut self, value: &Value) {
			let stdin = self.child.stdin.as_mut().expect("terminal stdin");
			writeln!(stdin, "{value}").unwrap();
			stdin.flush().unwrap();
		}

		fn drain_seq(&mut self) -> u64 {
			let mut seq = 0u64;
			for _ in 0..2 {
				thread::sleep(Duration::from_millis(80));
				while let Ok(line) = self.rx.try_recv() {
					if let Ok(frame) = serde_json::from_str::<Value>(&line) {
						seq = seq.max(frame["seq"].as_u64().unwrap_or(0));
					}
				}
			}
			seq
		}

		fn collect_until(&mut self, timeout: Duration) -> Vec<Value> {
			let deadline = Instant::now() + timeout;
			let mut out = Vec::new();
			while Instant::now() < deadline {
				let remaining =
					deadline.saturating_duration_since(Instant::now());
				match self
					.rx
					.recv_timeout(remaining.min(Duration::from_millis(100)))
				{
					Ok(line) if !line.is_empty() => {
						if let Ok(frame) = serde_json::from_str::<Value>(&line)
						{
							out.push(frame);
						}
					}
					_ => {}
				}
			}
			out
		}

		fn diagnostics(&mut self, phase: &str, extra: &str) -> String {
			let status = self.child.try_wait();
			let err = fs::read_to_string(&self.stderr_path).unwrap_or_default();
			let log = fs::read_to_string(&self.server_log).unwrap_or_default();
			let log_tail: String = log
				.lines()
				.rev()
				.take(40)
				.collect::<Vec<_>>()
				.into_iter()
				.rev()
				.collect::<Vec<_>>()
				.join("\n");
			format!(
				"phase={phase} session={} pid={} child_status={status:?} {extra}\n--- stderr ---\n{err}\n--- server (tail) ---\n{log_tail}",
				self.label,
				self.child.id()
			)
		}

		fn wait_json(&mut self, timeout: Duration, phase: &str) -> Value {
			let deadline = Instant::now() + timeout;
			loop {
				let remaining =
					deadline.saturating_duration_since(Instant::now());
				if remaining.is_zero() {
					panic!(
						"timed out waiting for terminal json after {timeout:?}\n{}",
						self.diagnostics(phase, "")
					);
				}
				let line =
					self.rx.recv_timeout(remaining).unwrap_or_else(|_| {
						panic!(
							"timed out waiting for terminal json after {timeout:?}\n{}",
							self.diagnostics(phase, "")
						)
					});
				if line.is_empty() {
					continue;
				}
				return serde_json::from_str(&line).unwrap_or_else(|err| {
					panic!(
						"terminal json during {phase}: {err} ({line})\n{}",
						self.diagnostics(phase, "")
					)
				});
			}
		}

		fn wait_matching(
			&mut self,
			timeout: Duration,
			phase: &str,
			pred: impl Fn(&Value) -> bool,
		) -> Value {
			let deadline = Instant::now() + timeout;
			let mut seen = Vec::new();
			loop {
				let remaining =
					deadline.saturating_duration_since(Instant::now());
				if remaining.is_zero() {
					panic!(
						"timed out waiting for matching terminal json after {timeout:?}\n{}",
						self.diagnostics(
							phase,
							&format!("seen=[{}]", seen.join(" | "))
						)
					);
				}
				let frame = self.wait_json(remaining, phase);
				let ty = frame["type"].as_str().unwrap_or("?");
				let seq = frame["seq"].as_u64().unwrap_or(0);
				seen.push(format!("{ty}#{seq}"));
				if seen.len() > 24 {
					seen.remove(0);
				}
				if pred(&frame) {
					return frame;
				}
			}
		}

		fn wait_frame(&mut self, timeout: Duration, phase: &str) -> Value {
			let frame = self.wait_json(timeout, phase);
			assert_eq!(
				frame["type"],
				"terminal.frame",
				"expected terminal.frame during {phase}, got {frame}\n{}",
				self.diagnostics(phase, "")
			);
			frame
		}

		fn wait_until_exit(&mut self, timeout: Duration, phase: &str) {
			if wait_try(&mut self.child, timeout) {
				return;
			}
			panic!(
				"session did not exit during {phase} after {timeout:?}\n{}",
				self.diagnostics(phase, "")
			);
		}

		fn reap_or_kill(&mut self, timeout: Duration) {
			if !wait_try(&mut self.child, timeout) {
				let _ = self.child.kill();
				if !wait_try(&mut self.child, Duration::from_secs(1)) {
					let _ = Command::new("kill")
						.args(["-9", &self.child.id().to_string()])
						.status();
					let _ = wait_try(&mut self.child, Duration::from_secs(1));
				}
			}
		}
	}

	impl Drop for TerminalSession {
		fn drop(&mut self) {
			self.reap_or_kill(Duration::from_secs(1));
		}
	}

	fn wait_output_bounded(
		child: Child,
		timeout: Duration,
		what: &str,
	) -> Output {
		let pid = child.id();
		let (tx, rx) = mpsc::channel();
		thread::spawn(move || {
			let _ = tx.send(child.wait_with_output());
		});
		match rx.recv_timeout(timeout) {
			Ok(Ok(output)) => output,
			Ok(Err(err)) => panic!("{what} failed: {err}"),
			Err(_) => {
				let _ = Command::new("kill")
					.args(["-9", &pid.to_string()])
					.status();
				let reaped = rx.recv_timeout(Duration::from_secs(1));
				panic!(
					"{what} timed out after {timeout:?}; killed pid {pid}; reap {reaped:?}"
				);
			}
		}
	}

	fn run_timed(mut cmd: Command, timeout: Duration) -> Output {
		cmd.stdin(Stdio::null())
			.stdout(Stdio::piped())
			.stderr(Stdio::piped());
		wait_output_bounded(cmd.spawn().unwrap(), timeout, "herdr command")
	}

	fn wait_try(child: &mut Child, timeout: Duration) -> bool {
		let deadline = Instant::now() + timeout;
		loop {
			if child.try_wait().ok().flatten().is_some() {
				return true;
			}
			if Instant::now() >= deadline {
				return false;
			}
			thread::sleep(Duration::from_millis(20));
		}
	}

	fn toml_string(value: &str) -> String {
		serde_json::to_string(value).unwrap()
	}

	fn apply_env(cmd: &mut Command, root: &Path, sock: &Path) {
		cmd.env("XDG_CONFIG_HOME", root.join("xdg-config"))
			.env("XDG_STATE_HOME", root.join("xdg-state"))
			.env("XDG_CACHE_HOME", root.join("xdg-cache"))
			.env("HOME", root.join("home"))
			.env("SHELL", "/bin/sh")
			.env("HERDR_DISABLE_SOUND", "1")
			.env("HERDR_SOCKET_PATH", sock)
			.env_remove("HERDR_SESSION")
			.env_remove("HERDR_CONFIG_PATH")
			.env_remove("HERDR_CLIENT_SOCKET_PATH");
	}

	fn git() -> Command {
		let mut cmd = Command::new("git");
		cmd.env("GIT_CONFIG_GLOBAL", "/dev/null")
			.env("GIT_CONFIG_SYSTEM", "/dev/null")
			.stdout(Stdio::null())
			.stderr(Stdio::null());
		cmd
	}

	fn init_git_repo(repo: &Path) {
		assert!(git()
			.args(["init", "-b", "main"])
			.current_dir(repo)
			.status()
			.unwrap()
			.success());
		for (key, value) in [
			("user.email", "contract@example.test"),
			("user.name", "Contract"),
		] {
			assert!(git()
				.args(["config", key, value])
				.current_dir(repo)
				.status()
				.unwrap()
				.success());
		}
		fs::write(repo.join("README.md"), "# fixture\n").unwrap();
		assert!(git()
			.args(["add", "README.md"])
			.current_dir(repo)
			.status()
			.unwrap()
			.success());
		assert!(git()
			.args(["commit", "-m", "init"])
			.current_dir(repo)
			.status()
			.unwrap()
			.success());
	}

	fn json_line_reader(
		stdout: std::process::ChildStdout,
	) -> mpsc::Receiver<String> {
		let (tx, rx) = mpsc::channel();
		thread::spawn(move || {
			let mut reader = BufReader::new(stdout);
			let mut line = String::new();
			while reader.read_line(&mut line).unwrap_or(0) > 0 {
				if tx.send(line.trim().to_string()).is_err() {
					break;
				}
				line.clear();
			}
		});
		rx
	}

	fn pid_alive(pid: u32) -> bool {
		Command::new("kill")
			.args(["-0", &pid.to_string()])
			.stdout(Stdio::null())
			.stderr(Stdio::null())
			.status()
			.map(|status| status.success())
			.unwrap_or(false)
	}

	fn assert_process_dead(pid: u32, what: &str) {
		let deadline = Instant::now() + Duration::from_secs(2);
		while pid_alive(pid) && Instant::now() < deadline {
			thread::sleep(Duration::from_millis(40));
		}
		assert!(!pid_alive(pid), "{what} must terminate pid {pid}");
	}

	fn shell_pid(harness: &Harness, pane: &str) -> u32 {
		let info =
			harness.rpc("pi", "pane.process_info", json!({"pane_id": pane}));
		let pi = &info["result"]["process_info"];
		if let Some(pid) = pi["shell_pid"].as_u64() {
			return pid as u32;
		}
		pi["foreground_processes"]
			.as_array()
			.and_then(|procs| procs.first())
			.and_then(|proc| proc["pid"].as_u64())
			.expect("pane.process_info pid") as u32
	}

	fn visible_text(harness: &Harness, pane: &str) -> String {
		let vis = harness.cli_ok(&[
			"pane", "read", pane, "--source", "visible", "--lines", "50",
		]);
		String::from_utf8_lossy(&vis.stdout).into_owned()
	}

	fn scr_nums(text: &str) -> Vec<u32> {
		text.lines()
			.filter_map(|line| {
				line.trim()
					.strip_prefix("SCR")
					.and_then(|rest| rest.parse().ok())
			})
			.collect()
	}

	fn live_scroll_frame(
		frame: &Value,
		pre_seq: u64,
		newly: &[u32],
		after_scr: &[u32],
	) -> bool {
		if frame["type"] != "terminal.frame" {
			return false;
		}
		if frame["seq"].as_u64().unwrap_or(0) <= pre_seq {
			return false;
		}
		let Some(raw) = frame["bytes"].as_str() else {
			return false;
		};
		let bytes = decode_base64(raw);
		let Some(top) = newly.iter().min() else {
			return false;
		};
		let Some(bottom) = after_scr.iter().max() else {
			return false;
		};
		contains_bytes(&bytes, format!("{top:02}").as_bytes())
			&& contains_bytes(&bytes, format!("SCR{bottom:02}").as_bytes())
			&& !contains_bytes(&bytes, b"SCR40")
	}

	fn summarize_frames(frames: &[Value]) -> String {
		frames
			.iter()
			.take(12)
			.map(|frame| {
				format!(
					"{}#{} full={}",
					frame["type"].as_str().unwrap_or("?"),
					frame["seq"].as_u64().unwrap_or(0),
					frame["full"]
				)
			})
			.collect::<Vec<_>>()
			.join(",")
	}

	fn wait_path(path: &Path, timeout: Duration, what: &str) {
		let deadline = Instant::now() + timeout;
		while Instant::now() < deadline {
			if path.is_file() {
				return;
			}
			thread::sleep(Duration::from_millis(40));
		}
		panic!("{what}: missing {} after {timeout:?}", path.display());
	}

	#[test]
	fn server_startup_lifetime_and_restart() {
		let Some(bin) = require_herdr() else {
			return;
		};
		let mut harness = Harness::start(bin);

		let ping = harness.rpc("ping1", "ping", json!({}));
		assert_eq!(ping["result"]["type"], "pong");
		assert_eq!(ping["result"]["version"], "0.9.0");
		assert_eq!(ping["result"]["protocol"], 22);
		assert_eq!(
			ping["result"]["capabilities"]["endpoint_protocol_generation"],
			1
		);

		let status = harness.cli_json(&["status", "--json"]);
		assert_eq!(status["client"]["version"], "0.9.0");
		assert_eq!(status["server"]["status"], "running");
		assert_eq!(
			status["server"]["socket"].as_str().unwrap(),
			harness.sock.to_str().unwrap()
		);
		let sock = harness.sock.to_str().unwrap();
		assert!(
			sock.starts_with("/tmp/2c") && sock.ends_with(".sock"),
			"API socket must be a short /tmp/2c override, got {sock}"
		);
		assert!(
			!sock.contains(&"x".repeat(80)),
			"API socket must not inherit the long XDG path: {sock}"
		);
		assert_socket_fits(&harness.sock);
		assert_socket_fits(&harness.client_sock);

		let snapshot = harness.cli_json(&["api", "snapshot"]);
		assert_eq!(snapshot["result"]["type"], "session_snapshot");
		assert!(snapshot["result"]["snapshot"]["workspaces"]
			.as_array()
			.unwrap()
			.is_empty());

		let created = harness.create_workspace("persist");
		let pane = created["result"]["root_pane"]["pane_id"]
			.as_str()
			.unwrap()
			.to_string();
		let term = created["result"]["root_pane"]["terminal_id"]
			.as_str()
			.unwrap()
			.to_string();
		let workspace = created["result"]["workspace"]["workspace_id"]
			.as_str()
			.unwrap()
			.to_string();

		let idle = harness.rpc("ag0", "pane.get", json!({"pane_id": pane}));
		assert_eq!(
			idle["result"]["pane"]["agent_status"], "unknown",
			"empty-shell pane must report agent_status unknown: {idle}"
		);
		let agents = harness.cli_json(&["api", "snapshot"]);
		assert!(
			agents["result"]["snapshot"]["agents"]
				.as_array()
				.unwrap()
				.is_empty(),
			"idle shell must not appear in snapshot.agents: {agents}"
		);

		harness.cli_ok(&["pane", "run", &pane, "printenv CONTRACT_ENV"]);
		harness.cli_ok(&[
			"pane",
			"wait-output",
			&pane,
			"--match",
			"from_probe",
			"--timeout",
			"5000",
		]);
		let env_out = harness.cli_ok(&[
			"pane", "read", &pane, "--source", "recent", "--lines", "30",
		]);
		let env_text = String::from_utf8_lossy(&env_out.stdout);
		assert!(
			env_text.contains("from_probe"),
			"--env CONTRACT_ENV=from_probe must reach the pane: {env_text:?}"
		);
		harness.cli_ok(&["pane", "run", &pane, "echo BEFORE_RESTART"]);
		harness.cli_ok(&[
			"pane",
			"wait-output",
			&pane,
			"--match",
			"BEFORE_RESTART",
			"--timeout",
			"5000",
		]);

		// CLI exit must leave the server and live terminal running.
		let still = harness.rpc("ping2", "ping", json!({}));
		assert_eq!(still["result"]["type"], "pong");
		let listed = harness.cli_json(&["pane", "get", &pane]);
		assert_eq!(listed["result"]["pane"]["terminal_id"], term);

		let root_tab = created["result"]["tab"]["tab_id"]
			.as_str()
			.unwrap()
			.to_string();
		let split = harness.cli_json(&[
			"pane",
			"split",
			&pane,
			"--direction",
			"right",
			"--no-focus",
		]);
		let split_pane = split["result"]["pane"]["pane_id"]
			.as_str()
			.unwrap()
			.to_string();
		let split_term = split["result"]["pane"]["terminal_id"]
			.as_str()
			.unwrap()
			.to_string();

		let mut sub = UnixStream::connect(&harness.sock).unwrap();
		sub.set_read_timeout(Some(SOCK_TIMEOUT)).unwrap();
		sub.set_write_timeout(Some(SOCK_TIMEOUT)).unwrap();
		writeln!(
			sub,
			"{}",
			json!({
				"id": "sub",
				"method": "events.subscribe",
				"params": {
					"subscriptions": [{"type": "tab.created"}]
				}
			})
		)
		.unwrap();
		let mut reader = BufReader::new(sub);
		let mut ack = String::new();
		reader.read_line(&mut ack).unwrap();
		let ack_json: Value = serde_json::from_str(&ack).unwrap();
		assert_eq!(ack_json["result"]["type"], "subscription_started");
		let extra = harness.cli_json(&[
			"tab",
			"create",
			"--workspace",
			&workspace,
			"--label",
			"extra",
			"--no-focus",
		]);
		let extra_tab = extra["result"]["tab"]["tab_id"]
			.as_str()
			.unwrap()
			.to_string();
		let extra_pane = extra["result"]["root_pane"]["pane_id"]
			.as_str()
			.unwrap()
			.to_string();
		let extra_term = extra["result"]["root_pane"]["terminal_id"]
			.as_str()
			.unwrap()
			.to_string();
		let mut event = String::new();
		reader.read_line(&mut event).unwrap();
		let event_json: Value = serde_json::from_str(&event).unwrap();
		assert_eq!(event_json["event"], "tab_created");

		harness.restart_server();
		let restored = harness.cli_json(&["api", "snapshot"]);
		let snap = &restored["result"]["snapshot"];
		let panes = snap["panes"].as_array().unwrap();
		let tabs = snap["tabs"].as_array().unwrap();
		assert!(snap["workspaces"]
			.as_array()
			.unwrap()
			.iter()
			.any(|item| item["workspace_id"] == workspace));
		assert!(tabs.iter().any(|item| item["tab_id"] == root_tab));
		assert!(tabs.iter().any(|item| item["tab_id"] == extra_tab));
		let restored_root = panes
			.iter()
			.find(|item| item["pane_id"] == pane)
			.expect("root pane id");
		let restored_split = panes
			.iter()
			.find(|item| item["pane_id"] == split_pane)
			.expect("split pane id");
		let restored_extra = panes
			.iter()
			.find(|item| item["pane_id"] == extra_pane)
			.expect("extra tab pane id");
		assert_eq!(restored_root["workspace_id"], workspace);
		assert_eq!(restored_root["tab_id"], root_tab);
		assert_eq!(restored_split["tab_id"], root_tab);
		assert_eq!(restored_extra["tab_id"], extra_tab);
		assert_ne!(restored_root["terminal_id"], term);
		assert_ne!(restored_split["terminal_id"], split_term);
		assert_ne!(restored_extra["terminal_id"], extra_term);
		let recent = harness.cli_ok(&[
			"pane", "read", &pane, "--source", "recent", "--lines", "20",
		]);
		assert!(
			!String::from_utf8_lossy(&recent.stdout).contains("BEFORE_RESTART"),
			"server restart must not preserve the live process or its output"
		);
	}

	#[test]
	fn terminal_control_observe_and_exclusivity() {
		let Some(bin) = require_herdr() else {
			return;
		};
		let harness = Harness::start(bin);
		let created = harness.create_workspace("term");
		let pane = created["result"]["root_pane"]["pane_id"]
			.as_str()
			.unwrap()
			.to_string();
		let marker = format!(
			"MARK_{}",
			harness
				.sock
				.file_stem()
				.and_then(|s| s.to_str())
				.unwrap_or("x")
		);
		harness.cli_ok(&[
			"pane",
			"run",
			&pane,
			&format!("printf '{marker} UNI:αβγ\\n'"),
		]);
		harness.cli_ok(&[
			"pane",
			"wait-output",
			&pane,
			"--match",
			&marker,
			"--timeout",
			"5000",
		]);
		harness.cli_ok(&[
			"pane",
			"run",
			&pane,
			"printf '\\033[31mRED_COLOR\\033[0m\\n'",
		]);
		harness.cli_ok(&[
			"pane",
			"wait-output",
			&pane,
			"--match",
			"RED_COLOR",
			"--timeout",
			"5000",
		]);
		let ansi = harness.cli_ok(&[
			"pane", "read", &pane, "--source", "recent", "--ansi", "--lines",
			"30",
		]);
		let ansi_text = String::from_utf8_lossy(&ansi.stdout);
		assert!(ansi_text.contains(&marker));
		assert!(ansi_text.contains("αβγ"));
		assert!(
			ansi_text.contains('\u{1b}') && ansi_text.contains("RED_COLOR"),
			"pane.read --ansi should keep SGR around RED_COLOR: {ansi_text:?}"
		);

		let mut observe = harness.spawn_session("observe", &pane, false, true);
		let frame = observe.wait_frame(FRAME_TIMEOUT, "observe-initial");
		assert_eq!(frame["encoding"], "ansi");
		assert_eq!(frame["full"], true);
		assert_eq!(frame["width"], 80);
		assert_eq!(frame["height"], 24);
		let bytes = decode_base64(frame["bytes"].as_str().unwrap());
		assert!(contains_bytes(&bytes, b"\x1b[?2026h"));
		assert!(contains_bytes(&bytes, b"\x1b[2J"));
		assert!(
			contains_bytes(&bytes, marker.as_bytes()),
			"initial full frame should include current screen contents"
		);
		let first_seq = frame["seq"].as_u64().expect("seq");

		let mut control = harness.spawn_session("control", &pane, false, true);
		let first = control.wait_frame(FRAME_TIMEOUT, "control-initial");
		assert_eq!(first["full"], true);
		assert!(
			observe.still_running(),
			"observer must keep running beside a controller"
		);
		assert!(control.still_running());

		harness.cli_ok(&["pane", "run", &pane, "printf 'INCR_LINE_XYZ\\n'"]);
		let incr = observe.wait_matching(
			FRAME_TIMEOUT,
			"observe-incremental",
			|frame| {
				if frame["type"] != "terminal.frame" || frame["full"] != false {
					return false;
				}
				let bytes =
					decode_base64(frame["bytes"].as_str().unwrap_or(""));
				contains_bytes(&bytes, b"INCR_LINE_XYZ")
			},
		);
		let incr_bytes = decode_base64(incr["bytes"].as_str().unwrap());
		assert!(
			!contains_bytes(&incr_bytes, b"\x1b[2J"),
			"incremental frames must not CSI 2J"
		);
		let incr_seq = incr["seq"].as_u64().expect("incr seq");
		assert!(
			incr_seq > first_seq,
			"observer seq must increase: {first_seq} then {incr_seq}"
		);

		let rival = harness.spawn_terminal_inner("control", &pane, false, None);
		let rival_out = wait_child(rival, Duration::from_secs(3));
		assert!(rival_out.status.success());
		let closed: Value = serde_json::from_slice(&rival_out.stdout)
			.or_else(|_| serde_json::from_slice(&rival_out.stderr))
			.unwrap();
		assert_eq!(closed["type"], "terminal.closed");
		let reason = closed["reason"].as_str().unwrap();
		assert!(
			reason.contains("already has an attached client"),
			"{reason}"
		);
		assert!(reason.contains("--takeover"), "{reason}");

		let mut takeover = harness.spawn_session("control", &pane, true, true);
		let taken = control.wait_matching(
			Duration::from_secs(3),
			"control-taken-over",
			|frame| frame["type"] == "terminal.closed",
		);
		assert_eq!(taken["reason"], "terminal attach taken over");
		control.wait_until_exit(STOP_TIMEOUT, "control-after-takeover");
		assert!(
			!control.still_running(),
			"previous controller must exit after takeover"
		);

		let _ = takeover.wait_frame(FRAME_TIMEOUT, "takeover-initial");
		let from_ctrl = harness.repo.join("from_ctrl.ran");
		takeover.send(&json!({
			"type": "terminal.input",
			"text": format!("touch {}\n", from_ctrl.display())
		}));
		wait_path(&from_ctrl, Duration::from_secs(5), "control input");
		let via_api = harness.repo.join("send_input.ran");
		let sent = harness.rpc(
			"si",
			"pane.send_input",
			json!({
				"pane_id": pane,
				"text": format!("touch {}\n", via_api.display())
			}),
		);
		assert!(
			sent.get("error").is_none(),
			"pane.send_input is the JSON stand-in for CLI pane run: {sent}"
		);
		wait_path(&via_api, Duration::from_secs(5), "pane.send_input");

		let scroll_lines: String = (1..=40)
			.map(|i| format!("SCR{i:02}"))
			.collect::<Vec<_>>()
			.join("\\n");
		harness.cli_ok(&[
			"pane",
			"run",
			&pane,
			&format!("printf '{scroll_lines}\\n'"),
		]);
		harness.cli_ok(&[
			"pane",
			"wait-output",
			&pane,
			"--match",
			"SCR40",
			"--timeout",
			"5000",
		]);
		let obs_seq = observe.drain_seq();
		let ctrl_seq = takeover.drain_seq();
		let at_bottom = harness.rpc("g0", "pane.get", json!({"pane_id": pane}));
		assert_eq!(
			at_bottom["result"]["pane"]["scroll"]["offset_from_bottom"],
			0
		);
		let before_vis = visible_text(&harness, &pane);
		let before_scr = scr_nums(&before_vis);
		assert!(
			before_scr.contains(&40),
			"bottom unique line SCR40 must be visible before scroll: {before_vis:?}"
		);
		assert!(
			!before_scr.contains(&1),
			"SCR01 must be above the viewport before scroll: {before_vis:?}"
		);
		takeover.send(
			&json!({"type":"terminal.scroll","direction":"up","lines":12}),
		);
		let scroll_deadline = Instant::now() + FRAME_TIMEOUT;
		let mut term_offset = 0u64;
		while Instant::now() < scroll_deadline {
			let got = harness.rpc("gs", "pane.get", json!({"pane_id": pane}));
			term_offset = got["result"]["pane"]["scroll"]["offset_from_bottom"]
				.as_u64()
				.unwrap_or(0);
			if term_offset > 0 {
				break;
			}
			thread::sleep(Duration::from_millis(40));
		}
		assert!(
			term_offset > 0,
			"terminal.scroll should increase offset_from_bottom, got {term_offset}"
		);
		let after_vis = visible_text(&harness, &pane);
		let after_scr = scr_nums(&after_vis);
		assert_ne!(
			after_scr, before_scr,
			"viewport unique lines must change after terminal.scroll\nbefore={before_scr:?}\nafter={after_scr:?}\n{after_vis:?}"
		);
		assert!(
			after_scr.iter().max() < before_scr.iter().max(),
			"scroll up must hide later unique lines: before={before_scr:?} after={after_scr:?}"
		);
		let newly: Vec<u32> = after_scr
			.iter()
			.copied()
			.filter(|n| !before_scr.contains(n))
			.collect();
		assert!(
			!newly.is_empty(),
			"scroll up must reveal earlier unique lines: before={before_scr:?} after={after_scr:?}"
		);
		let obs_live = observe.collect_until(Duration::from_secs(1));
		let ctrl_live = takeover.collect_until(Duration::from_secs(1));
		let obs_hit = obs_live
			.iter()
			.any(|frame| live_scroll_frame(frame, obs_seq, &newly, &after_scr));
		let ctrl_hit = ctrl_live.iter().any(|frame| {
			live_scroll_frame(frame, ctrl_seq, &newly, &after_scr)
		});
		assert!(
			obs_hit && ctrl_hit,
			"already-attached observe/control must receive scrolled viewport frames (obs_hit={obs_hit} ctrl_hit={ctrl_hit} newly={newly:?} after={after_scr:?} obs={} ctrl={})\nobs={}\nctrl={}",
			obs_live.len(),
			ctrl_live.len(),
			summarize_frames(&obs_live),
			summarize_frames(&ctrl_live)
		);
		let mut surface = harness.spawn_session("observe", &pane, false, true);
		let surface_frame =
			surface.wait_frame(FRAME_TIMEOUT, "scrolled-surface-observe");
		assert_eq!(
			surface_frame["full"], true,
			"fresh observe of a scrolled pane starts with a full surface"
		);
		let surface_bytes =
			decode_base64(surface_frame["bytes"].as_str().unwrap());
		assert!(
			newly.iter().any(|n| {
				contains_bytes(
					&surface_bytes,
					format!("SCR{n:02}").as_bytes(),
				)
			}),
			"scrolled full frame must include newly visible unique lines {newly:?}"
		);
		if !after_scr.contains(&40) {
			assert!(
				!contains_bytes(&surface_bytes, b"SCR40"),
				"scrolled full frame must not still show hidden SCR40"
			);
		}
		surface.reap_or_kill(STOP_TIMEOUT);
		assert!(
			observe.still_running(),
			"original observer must stay attached through scroll"
		);
		let scrolled = harness.rpc(
			"sc1",
			"pane.scroll",
			json!({"pane_id": pane, "offset_from_bottom": 8}),
		);
		assert_eq!(
			scrolled["result"]["pane"]["scroll"]["offset_from_bottom"],
			8
		);
		let pane_vis = visible_text(&harness, &pane);
		let pane_scr = scr_nums(&pane_vis);
		assert_ne!(
			pane_scr, before_scr,
			"pane.scroll must also change unique viewport lines: {pane_vis:?}"
		);
		assert!(
			!pane_scr.contains(&40),
			"pane.scroll should move SCR40 out of the viewport: {pane_vis:?}"
		);

		takeover.send(&json!({"type":"terminal.resize","cols":90,"rows":28}));
		let resized =
			takeover.wait_matching(FRAME_TIMEOUT, "takeover-resize", |frame| {
				frame["type"] == "terminal.frame"
					&& frame["width"] == 90
					&& frame["height"] == 28
			});
		assert_eq!(resized["width"], 90);
		let resize_seq = resized["seq"].as_u64().unwrap_or(0);
		assert!(resize_seq > incr_seq || resized["full"] == true);

		harness.cli_ok(&[
			"pane",
			"run",
			&pane,
			"printf '\\033[?1049h\\033[2J\\033[HALT_ONLY\\n'",
		]);
		harness.cli_ok(&[
			"pane",
			"wait-output",
			&pane,
			"--source",
			"visible",
			"--match",
			"ALT_ONLY",
			"--timeout",
			"5000",
		]);
		let in_alt = harness.cli_ok(&[
			"pane", "read", &pane, "--source", "visible", "--lines", "30",
		]);
		assert!(
			String::from_utf8_lossy(&in_alt.stdout).contains("ALT_ONLY"),
			"visible snapshot must show alternate-screen contents"
		);
		let alt_frame = observe.wait_matching(
			FRAME_TIMEOUT,
			"observe-alt-screen",
			|frame| {
				frame["type"] == "terminal.frame"
					&& contains_bytes(
						&decode_base64(frame["bytes"].as_str().unwrap_or("")),
						b"ALT_ONLY",
					)
			},
		);
		assert_eq!(alt_frame["type"], "terminal.frame");
		assert!(
			observe.still_running() && takeover.still_running(),
			"observer and controller must stay attached through alt-screen"
		);
		harness.cli_ok(&[
			"pane",
			"run",
			&pane,
			"printf '\\033[?1049lLEFT_ALT\\n'",
		]);
		harness.cli_ok(&[
			"pane",
			"wait-output",
			&pane,
			"--match",
			"LEFT_ALT",
			"--timeout",
			"5000",
		]);

		assert!(
			Command::new("python3")
				.args(["-c", "import termios, tty"])
				.status()
				.map(|status| status.success())
				.unwrap_or(false),
			"python3 with termios/tty is required; see docs/herdr-integration.md"
		);
		let dsr_py = harness.repo.join("dsr.py");
		fs::write(
			&dsr_py,
			r#"
import os, select, sys, termios, tty
fd = sys.stdin.fileno()
old = termios.tcgetattr(fd)
try:
    tty.setraw(fd)
    os.write(1, b"\x1b[6n")
    ready, _, _ = select.select([sys.stdin], [], [], 2.0)
    data = os.read(fd, 64) if ready else b""
finally:
    termios.tcsetattr(fd, termios.TCSADRAIN, old)
sys.stdout.write("\nDSR_RAW=" + repr(data) + "\n")
"#,
		)
		.unwrap();
		harness.cli_ok(&[
			"pane",
			"run",
			&pane,
			&format!("python3 {}", dsr_py.display()),
		]);
		harness.cli_ok(&[
			"pane",
			"wait-output",
			&pane,
			"--match",
			"DSR_RAW=",
			"--timeout",
			"5000",
		]);
		let dsr_out = harness.cli_ok(&[
			"pane", "read", &pane, "--source", "recent", "--lines", "20",
		]);
		let dsr_text = String::from_utf8_lossy(&dsr_out.stdout);
		assert!(
			dsr_text.contains("DSR_RAW=b'\\x1b[") && dsr_text.contains("R'"),
			"Herdr must answer CSI 6n as PTY input CPR: {dsr_text}"
		);

		let da_py = harness.repo.join("da.py");
		fs::write(
			&da_py,
			r#"
import os, select, sys, termios, tty
fd = sys.stdin.fileno()
old = termios.tcgetattr(fd)
try:
    tty.setraw(fd)
    os.write(1, b"\x1b[c")
    ready, _, _ = select.select([sys.stdin], [], [], 2.0)
    data = os.read(fd, 64) if ready else b""
finally:
    termios.tcsetattr(fd, termios.TCSADRAIN, old)
sys.stdout.write("\nDA_RAW=" + repr(data) + "\n")
"#,
		)
		.unwrap();
		harness.cli_ok(&[
			"pane",
			"run",
			&pane,
			&format!("python3 {}", da_py.display()),
		]);
		harness.cli_ok(&[
			"pane",
			"wait-output",
			&pane,
			"--match",
			"DA_RAW=",
			"--timeout",
			"5000",
		]);
		let da_out = harness.cli_ok(&[
			"pane", "read", &pane, "--source", "recent", "--lines", "20",
		]);
		let da_text = String::from_utf8_lossy(&da_out.stdout);
		assert!(
			da_text.contains("DA_RAW=b'\\x1b[?") && da_text.contains("c'"),
			"Herdr must answer CSI c as PTY input DA: {da_text}"
		);
		assert!(
			observe.still_running() && takeover.still_running(),
			"observer and controller must stay attached through DSR/DA"
		);

		let term_before = harness.cli_json(&["pane", "get", &pane])["result"]
			["pane"]["terminal_id"]
			.as_str()
			.unwrap()
			.to_string();
		let pid_before = shell_pid(&harness, &pane);
		assert!(
			pid_alive(pid_before),
			"shell pid {pid_before} must be alive before detach"
		);
		let reset = harness.rpc(
			"sb",
			"pane.scroll",
			json!({"pane_id": pane, "offset_from_bottom": 0}),
		);
		assert_eq!(reset["result"]["pane"]["scroll"]["offset_from_bottom"], 0);
		harness.cli_ok(&[
			"pane",
			"run",
			&pane,
			"printf 'DETACH_LIVE_TOKEN\\n'",
		]);
		harness.cli_ok(&[
			"pane",
			"wait-output",
			&pane,
			"--match",
			"DETACH_LIVE_TOKEN",
			"--timeout",
			"5000",
		]);

		takeover.send(&json!({"type":"terminal.release"}));
		takeover.wait_until_exit(STOP_TIMEOUT, "control-release");
		assert!(
			!takeover.still_running(),
			"controller must exit after terminal.release"
		);
		observe.reap_or_kill(STOP_TIMEOUT);
		assert!(
			!observe.still_running(),
			"observer must be gone after detach"
		);

		let after_detach = harness.cli_json(&["pane", "get", &pane]);
		assert_eq!(
			after_detach["result"]["pane"]["pane_id"].as_str(),
			Some(pane.as_str())
		);
		assert_eq!(
			after_detach["result"]["pane"]["terminal_id"].as_str(),
			Some(term_before.as_str()),
			"terminal_id must survive client disconnect"
		);
		assert!(
			pid_alive(pid_before),
			"same shell pid {pid_before} must keep running with no clients"
		);
		assert_eq!(shell_pid(&harness, &pane), pid_before);
		let detached_text = visible_text(&harness, &pane);
		assert!(
			detached_text.contains("DETACH_LIVE_TOKEN"),
			"live process output must remain after detach: {detached_text:?}"
		);

		let mut reconnect =
			harness.spawn_session("control", &pane, false, true);
		let recon = reconnect.wait_frame(FRAME_TIMEOUT, "reconnect-initial");
		assert_eq!(
			recon["full"], true,
			"reconnect without --takeover starts with a full frame"
		);
		let recon_bytes = decode_base64(recon["bytes"].as_str().unwrap());
		assert!(
			contains_bytes(&recon_bytes, b"DETACH_LIVE_TOKEN"),
			"reconnect full frame must include the live screen"
		);
		let after_recon = harness.cli_json(&["pane", "get", &pane]);
		assert_eq!(
			after_recon["result"]["pane"]["terminal_id"].as_str(),
			Some(term_before.as_str())
		);
		assert_eq!(shell_pid(&harness, &pane), pid_before);
		let reconnected = harness.repo.join("reconnected.ran");
		reconnect.send(&json!({
			"type": "terminal.input",
			"text": format!("touch {}\n", reconnected.display())
		}));
		wait_path(&reconnected, Duration::from_secs(5), "reconnect input");
	}

	#[test]
	fn workspace_worktree_splits_and_identity() {
		let Some(bin) = require_herdr() else {
			return;
		};
		let harness = Harness::start(bin);
		fs::write(harness.repo.join("dirty-primary.txt"), "PRIMARY_DIRTY\n")
			.unwrap();
		let created = harness.create_workspace("root");
		assert_eq!(
			fs::read_to_string(harness.repo.join("dirty-primary.txt")).unwrap(),
			"PRIMARY_DIRTY\n",
			"adopting a dirty primary checkout must not recreate it"
		);
		let adopted = harness.cli_json(&[
			"worktree",
			"open",
			"--cwd",
			harness.repo.to_str().unwrap(),
			"--path",
			harness.repo.to_str().unwrap(),
			"--no-focus",
			"--trust-repository",
		]);
		assert_eq!(adopted["result"]["already_open"], true);
		assert_eq!(
			adopted["result"]["workspace"]["workspace_id"],
			created["result"]["workspace"]["workspace_id"]
		);
		let workspace = created["result"]["workspace"]["workspace_id"]
			.as_str()
			.unwrap()
			.to_string();
		let pane = created["result"]["root_pane"]["pane_id"]
			.as_str()
			.unwrap()
			.to_string();
		let term = created["result"]["root_pane"]["terminal_id"]
			.as_str()
			.unwrap()
			.to_string();
		let tab = created["result"]["tab"]["tab_id"]
			.as_str()
			.unwrap()
			.to_string();

		let mut sub = UnixStream::connect(&harness.sock).unwrap();
		sub.set_read_timeout(Some(SOCK_TIMEOUT)).unwrap();
		sub.set_write_timeout(Some(SOCK_TIMEOUT)).unwrap();
		writeln!(
			sub,
			"{}",
			json!({
				"id": "sub",
				"method": "events.subscribe",
				"params": {
					"subscriptions": [
						{"type": "pane.created"},
						{"type": "pane.closed"},
						{"type": "layout.updated"}
					]
				}
			})
		)
		.unwrap();
		let mut events = BufReader::new(sub);
		let mut ack = String::new();
		events.read_line(&mut ack).unwrap();
		assert_eq!(
			serde_json::from_str::<Value>(&ack).unwrap()["result"]["type"],
			"subscription_started"
		);

		let split = harness.cli_json(&[
			"pane",
			"split",
			&pane,
			"--direction",
			"right",
			"--no-focus",
		]);
		let split_pane = split["result"]["pane"]["pane_id"]
			.as_str()
			.unwrap()
			.to_string();
		assert_ne!(split_pane, pane);
		assert_eq!(split["result"]["pane"]["tab_id"], tab);
		assert_ne!(split["result"]["pane"]["terminal_id"], term);
		let layout = harness.cli_json(&["pane", "layout", "--pane", &pane]);
		let layout_obj = if layout["result"].get("layout").is_some() {
			&layout["result"]["layout"]
		} else {
			&layout["result"]
		};
		let splits = layout_obj["splits"].as_array().unwrap();
		assert!(!splits.is_empty(), "external split must appear in layout");

		let mut saw_pane_created = false;
		let mut saw_layout_updated = false;
		for _ in 0..8 {
			let mut line = String::new();
			if events.read_line(&mut line).unwrap_or(0) == 0 {
				break;
			}
			let event: Value = serde_json::from_str(&line).unwrap();
			match event["event"].as_str() {
				Some("pane_created") => {
					assert_eq!(event["data"]["pane"]["pane_id"], split_pane);
					saw_pane_created = true;
				}
				Some("layout_updated") => saw_layout_updated = true,
				_ => {}
			}
			if saw_pane_created && saw_layout_updated {
				break;
			}
		}
		assert!(
			saw_pane_created,
			"split must emit pane.created / pane_created"
		);
		assert!(
			saw_layout_updated,
			"split must emit layout.updated / layout_updated"
		);

		let mut split_obs =
			harness.spawn_session("observe", &split_pane, false, true);
		let split_frame =
			split_obs.wait_frame(FRAME_TIMEOUT, "split-observe-initial");
		assert_eq!(split_frame["type"], "terminal.frame");
		assert_eq!(split_frame["full"], true);
		split_obs.reap_or_kill(STOP_TIMEOUT);
		harness.cli_json(&["pane", "close", &split_pane]);
		let mut saw_pane_closed = false;
		for _ in 0..8 {
			let mut line = String::new();
			if events.read_line(&mut line).unwrap_or(0) == 0 {
				break;
			}
			let event: Value = serde_json::from_str(&line).unwrap();
			if event["event"] == "pane_closed" {
				let id = event["data"]["pane"]["pane_id"]
					.as_str()
					.or_else(|| event["data"]["pane_id"].as_str());
				assert_eq!(id, Some(split_pane.as_str()), "{event}");
				saw_pane_closed = true;
				break;
			}
		}
		assert!(
			saw_pane_closed,
			"closing a split pane must emit pane.closed / pane_closed"
		);
		let after_split =
			harness.cli_json(&["pane", "list", "--workspace", &workspace]);
		let after_ids: Vec<&str> = after_split["result"]["panes"]
			.as_array()
			.unwrap()
			.iter()
			.map(|item| item["pane_id"].as_str().unwrap())
			.collect();
		assert_eq!(after_ids, vec![pane.as_str()]);
		assert!(!after_ids.contains(&split_pane.as_str()));

		let renamed = harness.cli_json(&[
			"workspace",
			"rename",
			&workspace,
			"renamed-root",
		]);
		assert_eq!(renamed["result"]["workspace"]["workspace_id"], workspace);
		let panes =
			harness.cli_json(&["pane", "list", "--workspace", &workspace]);
		let ids: Vec<&str> = panes["result"]["panes"]
			.as_array()
			.unwrap()
			.iter()
			.map(|item| item["pane_id"].as_str().unwrap())
			.collect();
		assert_eq!(ids, vec![pane.as_str()]);

		let wt = harness.cli_json(&[
			"worktree",
			"create",
			"--cwd",
			harness.repo.to_str().unwrap(),
			"--branch",
			"wt/contract",
			"--label",
			"wt-contract",
			"--no-focus",
			"--trust-repository",
		]);
		assert_eq!(wt["result"]["type"], "worktree_created");
		let wt_ws = wt["result"]["workspace"]["workspace_id"]
			.as_str()
			.unwrap()
			.to_string();
		let wt_path =
			PathBuf::from(wt["result"]["worktree"]["path"].as_str().unwrap());
		assert!(wt_path.exists());
		assert_eq!(
			wt["result"]["workspace"]["worktree"]["is_linked_worktree"],
			true
		);

		let external = harness.root.path().join("external-wt");
		assert!(git()
			.args([
				"worktree",
				"add",
				"-b",
				"wt/external",
				external.to_str().unwrap()
			])
			.current_dir(&harness.repo)
			.status()
			.unwrap()
			.success());
		fs::write(external.join("dirty.txt"), "uncommitted\n").unwrap();
		let opened = harness.cli_json(&[
			"worktree",
			"open",
			"--cwd",
			harness.repo.to_str().unwrap(),
			"--path",
			external.to_str().unwrap(),
			"--label",
			"external",
			"--no-focus",
			"--trust-repository",
		]);
		assert_eq!(opened["result"]["already_open"], false);
		assert_eq!(
			fs::read_to_string(external.join("dirty.txt")).unwrap(),
			"uncommitted\n"
		);
		let opened_ws = opened["result"]["workspace"]["workspace_id"]
			.as_str()
			.unwrap()
			.to_string();
		let opened_pane = opened["result"]["root_pane"]["pane_id"]
			.as_str()
			.unwrap()
			.to_string();
		let reopened = harness.cli_json(&[
			"worktree",
			"open",
			"--cwd",
			harness.repo.to_str().unwrap(),
			"--path",
			external.to_str().unwrap(),
			"--no-focus",
			"--trust-repository",
		]);
		assert_eq!(reopened["result"]["already_open"], true);
		assert_eq!(reopened["result"]["workspace"]["workspace_id"], opened_ws);
		assert_eq!(reopened["result"]["root_pane"]["pane_id"], opened_pane);

		let dup = harness.cli_err_json(&[
			"worktree",
			"create",
			"--cwd",
			harness.repo.to_str().unwrap(),
			"--branch",
			"wt/external",
			"--no-focus",
			"--trust-repository",
		]);
		assert_eq!(dup["error"]["code"], "worktree_create_failed");

		let opened_term = opened["result"]["root_pane"]["terminal_id"]
			.as_str()
			.unwrap()
			.to_string();
		let opened_pid = shell_pid(&harness, &opened_pane);
		assert!(pid_alive(opened_pid));
		let dirty = harness.cli_err_json(&[
			"worktree",
			"remove",
			"--workspace",
			&opened_ws,
		]);
		assert_eq!(dirty["error"]["code"], "dirty_worktree_requires_force");
		assert!(external.exists());
		let dirty_still = harness.cli_json(&["pane", "get", &opened_pane]);
		assert_eq!(
			dirty_still["result"]["pane"]["terminal_id"].as_str(),
			Some(opened_term.as_str()),
			"dirty refusal must keep the runtime pane record"
		);
		assert!(
			j_workspace_ids(&harness).iter().any(|id| id == &opened_ws),
			"dirty refusal must keep the workspace record"
		);
		assert!(
			pid_alive(opened_pid),
			"dirty refusal must not kill pid {opened_pid}"
		);

		harness.cli_json(&[
			"worktree",
			"remove",
			"--workspace",
			&opened_ws,
			"--force",
			"--trust-repository",
		]);
		assert!(!external.exists());
		let gone = harness.cli_err_json(&["pane", "get", &opened_pane]);
		assert_eq!(gone["error"]["code"], "pane_not_found");
		assert!(
			j_workspace_ids(&harness).iter().all(|id| id != &opened_ws),
			"forced remove must drop the workspace record immediately"
		);
		assert_process_dead(opened_pid, "forced worktree remove");
		let branches = Command::new("git")
			.args(["branch", "--list", "wt/external"])
			.current_dir(&harness.repo)
			.env("GIT_CONFIG_GLOBAL", "/dev/null")
			.env("GIT_CONFIG_SYSTEM", "/dev/null")
			.output()
			.unwrap();
		assert!(
			String::from_utf8_lossy(&branches.stdout).contains("wt/external")
		);

		let wt_pane = wt["result"]["root_pane"]["pane_id"]
			.as_str()
			.unwrap()
			.to_string();
		let wt_pid = shell_pid(&harness, &wt_pane);
		assert!(pid_alive(wt_pid));
		harness.cli_json(&[
			"worktree",
			"remove",
			"--workspace",
			&wt_ws,
			"--trust-repository",
		]);
		assert!(!wt_path.exists());
		let wt_gone = harness.cli_err_json(&["pane", "get", &wt_pane]);
		assert_eq!(wt_gone["error"]["code"], "pane_not_found");
		assert!(j_workspace_ids(&harness).iter().all(|id| id != &wt_ws));
		assert_process_dead(wt_pid, "clean worktree remove");
		let wt_branch = Command::new("git")
			.args(["branch", "--list", "wt/contract"])
			.current_dir(&harness.repo)
			.env("GIT_CONFIG_GLOBAL", "/dev/null")
			.env("GIT_CONFIG_SYSTEM", "/dev/null")
			.output()
			.unwrap();
		assert!(
			String::from_utf8_lossy(&wt_branch.stdout).contains("wt/contract"),
			"clean remove must keep the git branch"
		);

		let group = harness.cli_json(&[
			"worktree",
			"create",
			"--cwd",
			harness.repo.to_str().unwrap(),
			"--branch",
			"wt/g",
			"--no-focus",
			"--trust-repository",
		]);
		let group_path = PathBuf::from(
			group["result"]["worktree"]["path"].as_str().unwrap(),
		);
		let close = harness.cli_err_json(&["workspace", "close", &workspace]);
		assert_eq!(close["error"]["code"], "workspace_group_close_required");
		harness.cli_json(&["workspace", "close", &workspace, "--group"]);
		let remaining = harness.cli_json(&["workspace", "list"]);
		assert!(remaining["result"]["workspaces"]
			.as_array()
			.unwrap()
			.is_empty());
		assert!(
			group_path.exists(),
			"workspace close must not delete the git worktree checkout"
		);

		let last = harness.create_workspace("last-pane");
		let last_ws = last["result"]["workspace"]["workspace_id"]
			.as_str()
			.unwrap()
			.to_string();
		let last_pane = last["result"]["root_pane"]["pane_id"]
			.as_str()
			.unwrap()
			.to_string();
		let last_split = harness.cli_json(&[
			"pane",
			"split",
			&last_pane,
			"--direction",
			"down",
			"--no-focus",
		]);
		let last_split_pane = last_split["result"]["pane"]["pane_id"]
			.as_str()
			.unwrap()
			.to_string();
		harness.cli_json(&["pane", "close", &last_split_pane]);
		assert!(
			j_workspace_ids(&harness).iter().any(|id| id == &last_ws),
			"workspace must remain after closing a split pane"
		);
		harness.cli_json(&["pane", "close", &last_pane]);
		assert!(
			j_workspace_ids(&harness).iter().all(|id| id != &last_ws),
			"closing the last pane must close the workspace"
		);
		let missing = harness.cli_err_json(&["pane", "get", &last_pane]);
		assert_eq!(missing["error"]["code"], "pane_not_found");
	}

	fn j_workspace_ids(harness: &Harness) -> Vec<String> {
		harness.cli_json(&["workspace", "list"])["result"]["workspaces"]
			.as_array()
			.unwrap()
			.iter()
			.map(|item| item["workspace_id"].as_str().unwrap().to_string())
			.collect()
	}

	fn wait_child(child: Child, timeout: Duration) -> Output {
		wait_output_bounded(child, timeout, "child")
	}
}
