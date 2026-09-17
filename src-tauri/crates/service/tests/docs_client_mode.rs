//! Source-string lock: `docs/` + `AGENTS.md` describe Herdr client-mode,
//! not the deleted Local PTY / sqlite `profiles` world as current.

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
fn data_flow_does_not_document_local_pty_or_sqlite_restore_as_current() {
	assert!(!DATA_FLOW
		.contains("Session metadata inserted into the `pty_sessions` table"));
	assert!(!DATA_FLOW.contains("service::pty::gc_orphan_logs"));
	assert!(!DATA_FLOW.contains("infra::pty::create_session()"));
	assert!(!DATA_FLOW.contains("pty_logs/{id}.log"));
	assert!(!DATA_FLOW.contains("resolve_context_folder"));
	assert!(!DATA_FLOW.contains("profile.worktree_path"));
	assert!(!DATA_FLOW.contains("git worktree add ~/.2code/workspace"));
	assert!(!DATA_FLOW.contains("Profile record inserted into `profiles`"));
	assert!(DATA_FLOW.contains("reattach pane_id"));
	assert!(DATA_FLOW.contains("reconcile_profile_checkout"));
	assert!(DATA_FLOW.contains("worktree.create"));
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
	assert!(!CONFIGURATION.contains("#### `pty_sessions`"));
	assert!(!CONFIGURATION.contains("#### `pty_output_chunks`"));
	assert!(CONFIGURATION.contains("binaries/herdr"));
}

#[test]
fn architecture_and_api_describe_herdr_only_runtime() {
	assert!(!ARCHITECTURE.contains("portable-pty"));
	assert!(!ARCHITECTURE.contains("PtySessionMap"));
	assert!(ARCHITECTURE.contains("RuntimeRouter"));
	assert!(ARCHITECTURE.contains("pane_id"));
	assert!(!API.contains("cascade to profiles/sessions"));
	assert!(API.contains("Forget the catalog row and retain"));
	assert!(API.contains("Derived GUI DTO"));
	assert!(API.contains("workspace_id"));
	assert!(API.contains("There is no `get_pty_session_history`"));
	assert!(!README.contains("2code-helper"));
	assert!(!NOTIFY.contains("2code-helper"));
}

#[test]
fn agents_md_does_not_list_sqlite_profiles_or_pty_sessions_as_the_model() {
	assert!(!ROOT_AGENTS.contains("projects, profiles, pty_sessions"));
	assert!(!ROOT_CLAUDE.contains("`projects`, `profiles`, `pty_sessions`"));
	assert!(!ROOT_CLAUDE.contains("Orphan logs are reaped"));
	assert!(!ROOT_CLAUDE.contains("service::pty::gc_orphan_logs"));
	assert!(!SRC_TAURI_AGENTS.contains("Diesel CRUD: project, profile, pty"));
	assert!(!SERVICE_AGENTS.contains("git worktree add {base}"));
	assert!(SERVICE_AGENTS.contains("worktree.create"));
	assert!(TERMINAL_KEY_PATTERNS.contains("reattaches each live `pane_id`"));
	assert!(
		!TERMINAL_KEY_PATTERNS.contains("Fetch closed session history from DB")
	);
}

#[test]
fn herdr_pin_and_lib_constraints_hold() {
	assert!(PIN.contains("\"version\": \"0.9.0\""));
	assert!(HERDR.contains("v0.9.0"));
	assert!(HERDR.contains("DROPped"));
	assert!(HERDR.contains("#394 treated Local as the production default"));
	assert!(!LIB_RS.contains("HerdrRuntimeSync"));
}
