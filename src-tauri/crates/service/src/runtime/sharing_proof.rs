//! Bidirectional sharing proof for the user's default Herdr session.
//!
//! Task 1 already covers transport-level `workspace.create` →
//! `herdr api snapshot`. This drives `connect_gui_herdr` /
//! `RuntimeRouter` / `create_with_runtime` / `create_session` /
//! `list_with_runtime` on a fixture XDG default socket.

use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{Arc, Mutex};

use diesel::prelude::*;
use diesel::sqlite::SqliteConnection;
use diesel_migrations::MigrationHarness;
use infra::db::DbPool;
use infra::herdr::process::{
	HerdrClientGuard, HerdrNamespace, HerdrProcessEnv,
};
use model::session::{TerminalConfig, TerminalSessionMeta};
use serde_json::Value;

use super::{
	connect_gui_herdr, release_herdr_client_helpers, GuiHerdrConnect,
	RuntimeRouter, TerminalRuntime,
};
use crate::profile::create_with_runtime;
use crate::project::{create_from_folder, list_with_runtime};

struct Live {
	bin: PathBuf,
	root: tempfile::TempDir,
	namespace: HerdrNamespace,
	extra_env: Vec<(OsString, OsString)>,
}

impl Live {
	fn start() -> Option<Self> {
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
			infra::herdr::process::resolve_namespace_with(xdg, None, None)
				.unwrap();
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
		Some(Self {
			bin,
			root,
			namespace,
			extra_env,
		})
	}

	fn env(&self) -> HerdrProcessEnv<'_> {
		HerdrProcessEnv {
			executable: &self.bin,
			namespace: &self.namespace,
			extra_env: &self.extra_env,
			ready_timeout: std::time::Duration::from_secs(10),
			cli_timeout: std::time::Duration::from_secs(5),
		}
	}

	fn cli(&self, args: &[&str]) -> (String, String, bool) {
		let mut cmd = Command::new(&self.bin);
		self.env().apply_to(&mut cmd);
		cmd.env("HOME", self.root.path().join("home"))
			.env_remove("HERDR_SESSION")
			.args(args);
		let output = cmd.output().unwrap();
		let stdout = String::from_utf8_lossy(&output.stdout).into_owned();
		let stderr = String::from_utf8_lossy(&output.stderr).into_owned();
		(stdout, stderr, output.status.success())
	}

	fn quoted_cli(&self, args: &[&str]) -> String {
		format!(
			"XDG_CONFIG_HOME={} HERDR_SOCKET_PATH={} herdr {}",
			self.namespace.xdg_config_home.display(),
			self.namespace.socket_path.display(),
			args.join(" ")
		)
	}

	fn sanitize(&self, text: &str) -> String {
		let root = self.root.path();
		let canon = root.canonicalize().unwrap_or_else(|_| root.to_path_buf());
		text.replace(&canon.display().to_string(), "/tmp/…")
			.replace(&root.display().to_string(), "/tmp/…")
	}

	fn dump(&self, label: &str, command: &str, body: &str) {
		eprintln!(
			"SHARING_PROOF {label}\n  command: {}\n  output:\n{}",
			self.sanitize(command),
			self.sanitize(body.trim())
		);
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
	if let Ok(Some(path)) = infra::herdr::locate_cached_host_binary() {
		return Some(path);
	}
	let triple = infra::herdr::host_triple().ok()?;
	infra::herdr::try_resolve_sidecar(&infra::herdr::ResolveOptions {
		triple,
		exe_dir: None,
		binaries_dir: Some(&infra::herdr::default_binaries_dir()),
	})
	.ok()
	.flatten()
}

fn require_live() -> Option<Live> {
	match Live::start() {
		Some(live) => Some(live),
		None if infra::herdr::sidecar_required()
			|| std::env::var_os("HERDR_CONTRACT_REQUIRED").is_some() =>
		{
			panic!(
				"pinned Herdr binary missing; see docs/herdr-integration.md"
			);
		}
		None => {
			eprintln!(
				"skipping live Herdr sharing test (set HERDR_SIDECAR_REQUIRED=1 to fail)"
			);
			None
		}
	}
}

fn setup_db() -> DbPool {
	let mut conn =
		SqliteConnection::establish(":memory:").expect("in-memory db");
	diesel::sql_query("PRAGMA foreign_keys=ON;")
		.execute(&mut conn)
		.ok();
	conn.run_pending_migrations(infra::db::MIGRATIONS)
		.expect("run migrations");
	Arc::new(Mutex::new(conn))
}

fn insert_project(db: &DbPool, name: &str, folder: &Path) -> String {
	let mut conn = db.lock().unwrap();
	create_from_folder(&mut conn, name, folder.to_str().expect("utf-8 folder"))
		.unwrap()
		.id
}

fn snapshot_inner(value: &Value) -> &Value {
	if value.get("type").and_then(Value::as_str) == Some("session_snapshot") {
		value.get("snapshot").unwrap_or(value)
	} else if let Some(result) = value.get("result") {
		if result.get("type").and_then(Value::as_str)
			== Some("session_snapshot")
		{
			result.get("snapshot").unwrap_or(result)
		} else {
			result.get("snapshot").unwrap_or(result)
		}
	} else {
		value.get("snapshot").unwrap_or(value)
	}
}

fn workspace_ids(snapshot: &Value) -> Vec<String> {
	snapshot_inner(snapshot)["workspaces"]
		.as_array()
		.unwrap_or(&Vec::new())
		.iter()
		.filter_map(|workspace| {
			workspace["workspace_id"].as_str().map(str::to_string)
		})
		.collect()
}

fn pane_ids(snapshot: &Value) -> Vec<String> {
	snapshot_inner(snapshot)["panes"]
		.as_array()
		.unwrap_or(&Vec::new())
		.iter()
		.filter_map(|pane| pane["pane_id"].as_str().map(str::to_string))
		.collect()
}

fn socket_is_live(path: &Path) -> bool {
	std::os::unix::net::UnixStream::connect(path).is_ok()
}

fn profiles_for<'a>(
	listed: &'a [model::project::ProjectWithProfiles],
	project_id: &str,
) -> Vec<&'a model::profile::Profile> {
	listed
		.iter()
		.find(|project| project.id == project_id)
		.map(|project| project.profiles.iter().collect())
		.unwrap_or_default()
}

#[test]
fn live_runtime_sharing_is_visible_both_ways_on_default_socket() {
	assert!(
		std::env::var_os("HERDR_SOCKET_PATH").is_none(),
		"host HERDR_SOCKET_PATH would retarget the fixture off the default socket"
	);
	let session = std::env::var_os("HERDR_SESSION");
	assert!(
		session
			.as_ref()
			.is_none_or(|value| value.is_empty() || value == "default"),
		"host HERDR_SESSION would skip the fixture default socket"
	);

	let Some(live) = require_live() else {
		return;
	};
	assert!(
		live.namespace
			.socket_path
			.to_string_lossy()
			.ends_with("herdr/herdr.sock"),
		"must use the fixture default socket: {}",
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

	let forward_dir = live.root.path().join("forward-project");
	let reverse_dir = live.root.path().join("reverse-project");
	let other_dir = live.root.path().join("other-folder");
	std::fs::create_dir_all(&forward_dir).unwrap();
	std::fs::create_dir_all(&reverse_dir).unwrap();
	std::fs::create_dir_all(&other_dir).unwrap();

	let db = setup_db();
	let empty = live.root.path().join("empty-bins");
	std::fs::create_dir_all(&empty).unwrap();
	let guard = HerdrClientGuard::new();
	let adapter = connect_gui_herdr(GuiHerdrConnect {
		db: db.clone(),
		guard: &guard,
		xdg_config_home: live.namespace.xdg_config_home.clone(),
		extra_env: &live.extra_env,
		sidecar: Some(live.bin.clone()),
		path_dirs: Some(&[]),
		exe_dir: Some(empty.clone()),
		binaries_dir: Some(empty),
	})
	.expect("GUI connect should start the fixture default session");
	let router = RuntimeRouter::new(adapter);

	let forward_id = insert_project(&db, "forward", &forward_dir);
	let profile =
		create_with_runtime(&router, &db, &forward_id, "forward", None)
			.unwrap();
	assert!(
		profile.id.starts_with('w'),
		"create_with_runtime must return workspace_id, got {}",
		profile.id
	);
	let created = router
		.create_session(
			&TerminalSessionMeta {
				profile_id: profile.id.clone(),
				title: "forward-tab".into(),
			},
			&TerminalConfig {
				shell: "/bin/sh".into(),
				cwd: profile.worktree_path.clone(),
				rows: 24,
				cols: 80,
				startup_commands: Vec::new(),
			},
		)
		.unwrap();
	assert!(
		created.session_id.contains(':'),
		"create_session must return pane_id, got {}",
		created.session_id
	);

	let json_snap = router
		.herdr_worktrees()
		.unwrap()
		.session_snapshot()
		.unwrap();
	assert!(
		workspace_ids(&json_snap).iter().any(|id| id == &profile.id),
		"JSON session.snapshot missing workspace {}: {json_snap}",
		profile.id
	);
	assert!(
		pane_ids(&json_snap)
			.iter()
			.any(|id| id == &created.session_id),
		"JSON session.snapshot missing pane {}: {json_snap}",
		created.session_id
	);

	let (api_stdout, api_stderr, api_ok) = live.cli(&["api", "snapshot"]);
	assert!(
		api_ok,
		"herdr api snapshot failed: {api_stderr}\n{api_stdout}"
	);
	assert!(!api_stdout.contains("HERDR_SESSION=2code"), "{api_stdout}");
	let api_snap: Value = serde_json::from_str(&api_stdout).unwrap();
	assert!(
		workspace_ids(&api_snap).iter().any(|id| id == &profile.id),
		"herdr api snapshot missing workspace {}: {api_stdout}",
		profile.id
	);
	assert!(
		pane_ids(&api_snap)
			.iter()
			.any(|id| id == &created.session_id),
		"herdr api snapshot missing pane {}: {api_stdout}",
		created.session_id
	);
	live.dump(
		"forward herdr api snapshot",
		&live.quoted_cli(&["api", "snapshot"]),
		&api_stdout,
	);

	let (list_stdout, list_stderr, list_ok) = live.cli(&["workspace", "list"]);
	assert!(
		list_ok,
		"herdr workspace list failed: {list_stderr}\n{list_stdout}"
	);
	assert!(
		list_stdout.contains(&profile.id),
		"herdr workspace list missing {}: {list_stdout}",
		profile.id
	);
	live.dump(
		"forward herdr workspace list",
		&live.quoted_cli(&["workspace", "list"]),
		&list_stdout,
	);

	let reverse_id = insert_project(&db, "reverse", &reverse_dir);
	let before = workspace_ids(&json_snap);
	let create_args = [
		"workspace",
		"create",
		"--cwd",
		reverse_dir.to_str().unwrap(),
		"--label",
		"reverse",
	];
	let (create_stdout, create_stderr, create_ok) = live.cli(&create_args);
	assert!(
		create_ok,
		"herdr workspace create failed: {create_stderr}\n{create_stdout}"
	);
	live.dump(
		"reverse herdr workspace create",
		&live.quoted_cli(&create_args),
		&format!("{create_stdout}{create_stderr}"),
	);

	let after_snap = router
		.herdr_worktrees()
		.unwrap()
		.session_snapshot()
		.unwrap();
	let reverse_ws = workspace_ids(&after_snap)
		.into_iter()
		.find(|id| !before.contains(id))
		.expect("CLI workspace create must add a workspace_id");

	let listed = list_with_runtime(&router, &db).unwrap();
	let reverse_profiles = profiles_for(&listed, &reverse_id);
	assert!(
		reverse_profiles.iter().any(|profile| profile.id == reverse_ws),
		"list_with_runtime must live-read CLI workspace {reverse_ws} for {reverse_id}"
	);
	let forward_profiles = profiles_for(&listed, &forward_id);
	assert!(
		forward_profiles.iter().any(|item| item.id == profile.id),
		"forward workspace {} missing after reverse create",
		profile.id
	);
	assert!(
		forward_profiles.iter().all(|item| item.id != reverse_ws),
		"join key leaked reverse workspace {reverse_ws} into forward project"
	);

	let other_args = [
		"workspace",
		"create",
		"--cwd",
		other_dir.to_str().unwrap(),
		"--label",
		"other",
	];
	let (other_stdout, other_stderr, other_ok) = live.cli(&other_args);
	assert!(
		other_ok,
		"herdr workspace create (other) failed: {other_stderr}\n{other_stdout}"
	);
	let other_snap = router
		.herdr_worktrees()
		.unwrap()
		.session_snapshot()
		.unwrap();
	let known = [profile.id.clone(), reverse_ws.clone()];
	let other_ws = workspace_ids(&other_snap)
		.into_iter()
		.find(|id| !known.contains(id) && !before.contains(id))
		.expect("unrelated CLI workspace");
	let listed_after = list_with_runtime(&router, &db).unwrap();
	assert!(
		listed_after
			.iter()
			.flat_map(|project| &project.profiles)
			.all(|item| item.id != other_ws),
		"join key leaked unrelated workspace {other_ws} into sqlite projects"
	);
	live.dump(
		"reverse list_with_runtime ids",
		"list_with_runtime (live read, not adopt)",
		&format!(
			"forward_project={} workspace_id={} pane_id={}\nreverse_project={} workspace_id={}\nunrelated_workspace_id={} (not listed)",
			forward_id,
			profile.id,
			created.session_id,
			reverse_id,
			reverse_ws,
			other_ws
		),
	);

	let (list_after, _, _) = live.cli(&["workspace", "list"]);
	live.dump(
		"reverse herdr workspace list",
		&live.quoted_cli(&["workspace", "list"]),
		&list_after,
	);

	assert!(!live
		.namespace
		.xdg_config_home
		.join("herdr/sessions/2code")
		.exists());
	drop(router);
	release_herdr_client_helpers(&guard);
	assert!(
		socket_is_live(&live.namespace.socket_path),
		"GUI/lease drop must leave the shared default socket running"
	);
}
