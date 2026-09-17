//! Source-string lock: `docs/` + `AGENTS.md` describe Herdr client-mode
//! and live `pane_id` sessions, not a Local spawn / sqlite-session world.

const DATA_FLOW: &str = include_str!("../../../../docs/data-flow.md");
const ARCHITECTURE: &str = include_str!("../../../../docs/architecture.md");
const CONFIGURATION: &str = include_str!("../../../../docs/configuration.md");
const API: &str = include_str!("../../../../docs/api-reference.md");
const README: &str = include_str!("../../../../docs/README.md");
const NOTIFY: &str = include_str!("../../../../docs/notification-behavior.md");
const HERDR: &str = include_str!("../../../../docs/herdr-integration.md");
const ROOT_AGENTS: &str = include_str!("../../../../AGENTS.md");
const ROOT_CLAUDE: &str = include_str!("../../../../CLAUDE.md");
const SRC_TAURI_AGENTS: &str = include_str!("../../../AGENTS.md");
const SERVICE_AGENTS: &str = include_str!("../AGENTS.md");
const TERMINAL_KEY_PATTERNS: &str =
	include_str!("../../../../src/features/terminal/AGENTS.md");
const PIN: &str = include_str!("../../infra/tests/fixtures/herdr/pin.json");
const LIB_RS: &str = include_str!("../../../src/lib.rs");

#[test]
fn data_flow_documents_herdr_pane_reattach() {
	assert!(!DATA_FLOW.contains("resolve_context_folder"));
	assert!(!DATA_FLOW.contains("profile.worktree_path"));
	assert!(!DATA_FLOW.contains("git worktree add ~/.2code/workspace"));
	assert!(!DATA_FLOW.contains("Profile record inserted into `profiles`"));
	assert!(DATA_FLOW.contains("reattach pane_id"));
	assert!(DATA_FLOW.contains("reconcile_profile_checkout"));
	assert!(DATA_FLOW.contains("worktree.create"));
	assert!(DATA_FLOW.contains("create_terminal_session"));
	assert!(DATA_FLOW.contains("createTerminalSession"));
	assert!(DATA_FLOW.contains("handler/terminal.rs"));
	assert!(DATA_FLOW.contains("attach_terminal_output"));
	assert!(DATA_FLOW.contains("TerminalSessionRecord"));
	assert!(!DATA_FLOW.contains("Handlers keep the existing IPC names"));
}

#[test]
fn data_flow_keeps_task_1_herdr_deletion_flow() {
	let deletion = DATA_FLOW
		.split("### Deletion Flow")
		.nth(1)
		.expect("Deletion Flow");
	assert!(deletion.contains("worktree.remove"));
	assert!(deletion.contains("workspace.close"));
	assert!(deletion.contains("sqlite `profiles` is DROPped"));
	assert!(!deletion.contains("git worktree remove --force"));
}

#[test]
fn configuration_matches_live_sqlite_schema() {
	assert!(CONFIGURATION.contains("#### `projects`"));
	assert!(CONFIGURATION.contains("#### `project_groups`"));
	assert!(CONFIGURATION.contains("#### `checkout_notes`"));
	assert!(!CONFIGURATION.contains("#### `profiles`"));
	assert!(CONFIGURATION.contains("Sessions are live `pane_id`s"));
	assert!(CONFIGURATION.contains("binaries/herdr"));
}

#[test]
fn architecture_and_api_describe_herdr_only_runtime() {
	assert!(ARCHITECTURE.contains("RuntimeRouter"));
	assert!(ARCHITECTURE.contains("pane_id"));
	assert!(ARCHITECTURE.contains("create_terminal_session"));
	assert!(ARCHITECTURE.contains("`terminal.rs`"));
	assert!(!ARCHITECTURE.contains("Existing IPC names stay"));
	assert!(!API.contains("cascade to profiles/sessions"));
	assert!(API.contains("Forget the catalog row and retain"));
	assert!(API.contains("Derived GUI DTO"));
	assert!(API.contains("workspace_id"));
	assert!(API.contains("`create_terminal_session`"));
	assert!(API.contains("TerminalSessionRecord"));
	assert!(API.contains("handler/terminal.rs"));
	assert!(API.contains("There is no sqlite history restore command"));
	assert!(API.contains("Restore is reattach of a live `pane_id`"));
	assert!(!API.contains("Handlers keep these names"));
	assert!(!README.contains("2code-helper"));
	assert!(!NOTIFY.contains("2code-helper"));
}

#[test]
fn agents_md_lists_live_catalog_and_herdr_sessions() {
	assert!(ROOT_AGENTS.contains("checkout_notes"));
	assert!(ROOT_CLAUDE.contains("checkout_notes"));
	assert!(!ROOT_CLAUDE.contains("Orphan logs are reaped"));
	assert!(SRC_TAURI_AGENTS.contains("create_terminal_session"));
	assert!(!SERVICE_AGENTS.contains("git worktree add {base}"));
	assert!(SERVICE_AGENTS.contains("worktree.create"));
	assert!(TERMINAL_KEY_PATTERNS.contains("reattaches each live `pane_id`"));
	assert!(TERMINAL_KEY_PATTERNS.contains("attach_terminal_output"));
	assert!(
		!TERMINAL_KEY_PATTERNS.contains("Fetch closed session history from DB")
	);
	assert!(ROOT_CLAUDE.contains("TerminalSessionRecord"));
	assert!(ROOT_CLAUDE.contains("attach_terminal_output"));
}

#[test]
fn herdr_pin_and_lib_constraints_hold() {
	assert!(PIN.contains("\"version\": \"0.9.0\""));
	assert!(HERDR.contains("v0.9.0"));
	assert!(HERDR.contains("DROPped"));
	assert!(HERDR.contains("#394 treated Local as the production default"));
	assert!(!LIB_RS.contains("HerdrRuntimeSync"));
}

#[test]
fn herdr_docs_lock_sharing_contract() {
	assert!(HERDR.contains("## Sharing contract"));
	let sharing = HERDR
		.split("## Sharing contract")
		.nth(1)
		.expect("Sharing contract")
		.split("\n## ")
		.next()
		.expect("sharing body");
	assert!(sharing.contains("One Herdr server, shared"));
	assert!(sharing.contains("herdr api snapshot"));
	assert!(sharing.contains("herdr workspace list"));
	assert!(sharing.contains("list_with_runtime"));
	assert!(sharing.contains("create_with_runtime"));
	assert!(sharing.contains("create_session"));
	assert!(sharing.contains("herdr update"));
	assert!(sharing.contains("protocol >= 22"));
	assert!(sharing.contains("never a private `2code` session"));
	assert!(sharing.contains("does not `herdr server stop`"));
	assert!(sharing.contains("$XDG_CONFIG_HOME/herdr/herdr.sock"));
	assert!(!sharing.contains("dedicated `2code` namespace"));
	assert!(!sharing.contains("never the user default session"));
	assert!(!sharing.contains("refusing the user default"));
	assert!(!HERDR.contains(
		"The dump still uses the fixture socket, never the user default session"
	));
	assert!(HERDR.contains("That dump is **test isolation**"));
	assert!(ARCHITECTURE.contains("User herdr or pinned v0.9.0 sidecar"));
	assert!(CONFIGURATION.contains(
		"attaches to the user's Herdr session (inherited `HERDR_SOCKET_PATH` / `HERDR_SESSION`, else `$XDG_CONFIG_HOME/herdr/herdr.sock`)"
	));
	assert!(!ARCHITECTURE.contains("dedicated `2code` namespace"));
	assert!(!CONFIGURATION.contains("dedicated `2code` namespace"));
	assert!(!ROOT_AGENTS.contains("dedicated `2code` namespace"));
	assert!(!ROOT_CLAUDE.contains("dedicated `2code` namespace"));
}
