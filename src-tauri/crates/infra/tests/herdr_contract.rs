//! Live probe of the pinned Herdr integration contract.
//!
//! Binaries are not in git. See `docs/herdr-integration.md`.
//!
//! ```text
//! cargo test -p infra --test herdr_contract -- --nocapture
//! ```
//!
//! Override the executable with `HERDR_BIN`. Fail instead of skipping when
//! the binary is missing by setting `HERDR_CONTRACT_REQUIRED=1`.

use serde_json::{json, Value};
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Output, Stdio};
use std::time::{Duration, Instant};
use std::{env, fs, thread};
use uuid::Uuid;

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
		"workspace.close",
		"worktree.create",
		"worktree.open",
		"worktree.remove",
		"tab.create",
		"pane.split",
		"pane.read",
		"pane.scroll",
		"events.subscribe",
	] {
		assert!(
			methods.iter().any(|method| method == required),
			"missing {required}"
		);
	}
}

#[cfg(unix)]
mod live {
	use super::*;
	use std::os::unix::net::UnixStream;
	use std::sync::mpsc;

	struct Harness {
		bin: PathBuf,
		session: String,
		root: tempfile::TempDir,
		server: Child,
		sock: PathBuf,
		repo: PathBuf,
	}

	impl Harness {
		fn start(bin: PathBuf) -> Self {
			let root = tempfile::tempdir().unwrap();
			let session = format!("t{}", Uuid::new_v4().simple());
			let xdg = root.path().join("xdg-config");
			let home = root.path().join("home");
			let repo = root.path().join("repo");
			let worktrees = root.path().join("worktrees");
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

			let sock =
				xdg.join("herdr/sessions").join(&session).join("herdr.sock");
			let log = fs::File::create(root.path().join("server.log")).unwrap();
			let mut cmd = Command::new(&bin);
			cmd.args(["--session", &session, "server"]);
			apply_env(&mut cmd, root.path());
			cmd.stdin(Stdio::null())
				.stdout(Stdio::from(log.try_clone().unwrap()))
				.stderr(Stdio::from(log));
			let server = cmd.spawn().unwrap();
			let harness = Self {
				bin,
				session,
				root,
				server,
				sock,
				repo,
			};
			harness.wait_ready();
			harness
		}

		fn wait_ready(&self) {
			let deadline = Instant::now() + Duration::from_secs(15);
			while Instant::now() < deadline {
				if self.server_exited() {
					panic!("herdr server exited early:\n{}", self.server_log());
				}
				if UnixStream::connect(&self.sock).is_ok() {
					return;
				}
				thread::sleep(Duration::from_millis(40));
			}
			panic!("herdr server was not ready:\n{}", self.server_log());
		}

		fn server_exited(&self) -> bool {
			// Child::try_wait needs &mut self; probe via kill(0) on pid.
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
			cmd.arg("--session").arg(&self.session);
			apply_env(&mut cmd, self.root.path());
			cmd
		}

		fn cli(&self, args: &[&str]) -> Output {
			self.env_command().args(args).output().unwrap()
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
			stream
				.set_read_timeout(Some(Duration::from_secs(8)))
				.unwrap();
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
				"--no-focus",
			])
		}

		fn spawn_terminal(
			&self,
			mode: &str,
			target: &str,
			takeover: bool,
		) -> Child {
			let mut cmd = self.env_command();
			cmd.args([
				"terminal", "session", mode, target, "--cols", "80", "--rows",
				"24",
			]);
			if takeover {
				cmd.arg("--takeover");
			}
			cmd.stdin(Stdio::piped())
				.stdout(Stdio::piped())
				.stderr(Stdio::piped())
				.spawn()
				.unwrap()
		}

		fn restart_server(&mut self) {
			let _ = self.cli(&["session", "stop", &self.session]);
			let _ = self.server.kill();
			let _ = self.server.wait();
			let deadline = Instant::now() + Duration::from_secs(8);
			while self.sock.exists() && Instant::now() < deadline {
				thread::sleep(Duration::from_millis(40));
			}
			let log =
				fs::File::create(self.root.path().join("server.log")).unwrap();
			let mut cmd = Command::new(&self.bin);
			cmd.args(["--session", &self.session, "server"]);
			apply_env(&mut cmd, self.root.path());
			cmd.stdin(Stdio::null())
				.stdout(Stdio::from(log.try_clone().unwrap()))
				.stderr(Stdio::from(log));
			self.server = cmd.spawn().unwrap();
			self.wait_ready();
		}
	}

	impl Drop for Harness {
		fn drop(&mut self) {
			let _ = self.cli(&["session", "stop", &self.session]);
			let _ = self.server.kill();
			let _ = self.server.wait();
		}
	}

	fn toml_string(value: &str) -> String {
		serde_json::to_string(value).unwrap()
	}

	fn apply_env(cmd: &mut Command, root: &Path) {
		cmd.env("XDG_CONFIG_HOME", root.join("xdg-config"))
			.env("XDG_STATE_HOME", root.join("xdg-state"))
			.env("XDG_CACHE_HOME", root.join("xdg-cache"))
			.env("HOME", root.join("home"))
			.env("SHELL", "/bin/sh")
			.env("HERDR_DISABLE_SOUND", "1")
			.env_remove("HERDR_SOCKET_PATH")
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

	fn wait_frame(rx: &mpsc::Receiver<String>, timeout: Duration) -> Value {
		let line = rx
			.recv_timeout(timeout)
			.unwrap_or_else(|_| panic!("timed out waiting for terminal frame"));
		serde_json::from_str(&line)
			.unwrap_or_else(|err| panic!("terminal json: {err} ({line})"))
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
		assert_eq!(status["server"]["session"], harness.session);
		assert_eq!(
			status["server"]["socket"].as_str().unwrap(),
			harness.sock.to_str().unwrap()
		);

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

		harness.cli_ok(&["pane", "run", &pane, "echo BEFORE_RESTART"]);
		harness.cli_ok(&[
			"pane",
			"wait-output",
			&pane,
			"--match",
			"BEFORE_RESTART",
			"--timeout",
			"8000",
		]);

		// CLI exit must leave the server and live terminal running.
		let still = harness.rpc("ping2", "ping", json!({}));
		assert_eq!(still["result"]["type"], "pong");
		let listed = harness.cli_json(&["pane", "get", &pane]);
		assert_eq!(listed["result"]["pane"]["terminal_id"], term);

		let mut sub = UnixStream::connect(&harness.sock).unwrap();
		sub.set_read_timeout(Some(Duration::from_secs(8))).unwrap();
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
		harness.cli_json(&[
			"tab",
			"create",
			"--workspace",
			&workspace,
			"--label",
			"extra",
			"--no-focus",
		]);
		let mut event = String::new();
		reader.read_line(&mut event).unwrap();
		let event_json: Value = serde_json::from_str(&event).unwrap();
		assert_eq!(event_json["event"], "tab_created");

		harness.restart_server();
		let restored = harness.cli_json(&["api", "snapshot"]);
		let panes = restored["result"]["snapshot"]["panes"].as_array().unwrap();
		let restored_pane = panes
			.iter()
			.find(|item| item["pane_id"] == pane)
			.expect("restored pane id");
		assert_eq!(restored_pane["workspace_id"], workspace);
		assert_ne!(restored_pane["terminal_id"], term);
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
		let marker = format!("MARK_{}", &harness.session[1..7]);
		harness.cli_ok(&[
			"pane",
			"run",
			&pane,
			&format!(
				"printf '{marker} UNICODE:αβγ COLOR:\\033[31mred\\033[0m\\n'"
			),
		]);
		harness.cli_ok(&[
			"pane",
			"wait-output",
			&pane,
			"--match",
			&marker,
			"--timeout",
			"8000",
		]);

		let mut observe = harness.spawn_terminal("observe", &pane, false);
		let obs_rx = json_line_reader(observe.stdout.take().unwrap());
		let frame = wait_frame(&obs_rx, Duration::from_secs(3));
		assert_eq!(frame["type"], "terminal.frame");
		assert_eq!(frame["encoding"], "ansi");
		assert_eq!(frame["full"], true);
		assert_eq!(frame["width"], 80);
		assert_eq!(frame["height"], 24);
		let bytes = data_encoding_std_base64(&frame["bytes"]);
		assert!(bytes.contains(&0x1b), "full frame is ANSI");
		assert!(
			String::from_utf8_lossy(&bytes).contains(&marker)
				|| bytes.windows(marker.len()).any(|w| w == marker.as_bytes()),
			"initial full frame should include current screen contents"
		);
		let _ = observe.kill();
		let _ = observe.wait();

		let mut control = harness.spawn_terminal("control", &pane, false);
		let ctrl_rx = json_line_reader(control.stdout.take().unwrap());
		let first = wait_frame(&ctrl_rx, Duration::from_secs(3));
		assert_eq!(first["type"], "terminal.frame");
		assert_eq!(first["full"], true);

		let rival = harness.spawn_terminal("control", &pane, false);
		let rival_out = wait_child(rival, Duration::from_secs(5));
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

		let mut takeover = harness.spawn_terminal("control", &pane, true);
		let taken = wait_frame(&ctrl_rx, Duration::from_secs(5));
		assert_eq!(taken["type"], "terminal.closed");
		assert_eq!(taken["reason"], "terminal attach taken over");
		let _ = control.wait();

		let take_rx = json_line_reader(takeover.stdout.take().unwrap());
		let _ = wait_frame(&take_rx, Duration::from_secs(3));
		{
			let stdin = takeover.stdin.as_mut().unwrap();
			writeln!(
				stdin,
				"{}",
				json!({"type":"terminal.input","text":"echo FROM_CTRL\n"})
			)
			.unwrap();
			stdin.flush().unwrap();
		}
		harness.cli_ok(&[
			"pane",
			"wait-output",
			&pane,
			"--match",
			"FROM_CTRL",
			"--timeout",
			"8000",
		]);

		{
			let stdin = takeover.stdin.as_mut().unwrap();
			writeln!(
				stdin,
				"{}",
				json!({"type":"terminal.resize","cols":90,"rows":28})
			)
			.unwrap();
			stdin.flush().unwrap();
		}
		let mut saw_resize = false;
		for _ in 0..8 {
			let frame = wait_frame(&take_rx, Duration::from_secs(3));
			if frame["type"] == "terminal.frame"
				&& frame["width"] == 90
				&& frame["height"] == 28
			{
				saw_resize = true;
				break;
			}
		}
		assert!(saw_resize, "resize should emit a frame at 90x28");

		harness.cli_ok(&["pane", "run", &pane, "seq 1 80"]);
		thread::sleep(Duration::from_millis(400));
		let scrolled = harness.rpc(
			"sc1",
			"pane.scroll",
			json!({"pane_id": pane, "offset_from_bottom": 5}),
		);
		assert_eq!(
			scrolled["result"]["pane"]["scroll"]["offset_from_bottom"],
			5
		);

		{
			let stdin = takeover.stdin.as_mut().unwrap();
			writeln!(stdin, "{}", json!({"type":"terminal.release"})).unwrap();
			stdin.flush().unwrap();
		}
		let mut released = false;
		for _ in 0..8 {
			let frame = wait_frame(&take_rx, Duration::from_secs(5));
			if frame["type"] == "terminal.closed" {
				released = true;
				break;
			}
		}
		assert!(released, "release should close the controller stream");
		let _ = takeover.wait();

		let mut reconnect = harness.spawn_terminal("control", &pane, false);
		let recon_rx = json_line_reader(reconnect.stdout.take().unwrap());
		let again = wait_frame(&recon_rx, Duration::from_secs(3));
		assert_eq!(again["type"], "terminal.frame");
		writeln!(
			reconnect.stdin.as_mut().unwrap(),
			"{}",
			json!({"type":"terminal.release"})
		)
		.unwrap();
		let _ = reconnect.wait();
	}

	#[test]
	fn workspace_worktree_splits_and_identity() {
		let Some(bin) = require_herdr() else {
			return;
		};
		let harness = Harness::start(bin);
		let created = harness.create_workspace("root");
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
		assert!(ids.contains(&pane.as_str()));
		assert!(ids.contains(&split_pane.as_str()));

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

		let dirty = harness.cli_err_json(&[
			"worktree",
			"remove",
			"--workspace",
			&opened_ws,
		]);
		assert_eq!(dirty["error"]["code"], "dirty_worktree_requires_force");
		assert!(external.exists());
		harness.cli_json(&[
			"worktree",
			"remove",
			"--workspace",
			&opened_ws,
			"--force",
			"--trust-repository",
		]);
		assert!(!external.exists());
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

		harness.cli_json(&[
			"worktree",
			"remove",
			"--workspace",
			&wt_ws,
			"--trust-repository",
		]);
		assert!(!wt_path.exists());

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
	}

	fn wait_child(child: Child, timeout: Duration) -> Output {
		let (tx, rx) = mpsc::channel();
		thread::spawn(move || {
			let _ = tx.send(child.wait_with_output());
		});
		rx.recv_timeout(timeout)
			.unwrap_or_else(|_| panic!("child did not exit"))
			.unwrap()
	}

	fn data_encoding_std_base64(value: &Value) -> Vec<u8> {
		decode_base64(value.as_str().unwrap())
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
}
