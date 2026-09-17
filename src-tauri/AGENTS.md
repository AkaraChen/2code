# AGENTS.md — src-tauri

**Generated:** 2026-04-09 | **Commit:** 93661da

## OVERVIEW
Rust Cargo workspace. Tauri 2 application binary + 4 domain crates. Layered architecture: handler → service → repo → infra. Herdr is the production runtime (pinned v0.9.0). sqlite stores `projects` / `project_groups` / `checkout_notes`. Sessions are live Herdr `pane_id`s.

## STRUCTURE
```
src-tauri/
├── src/
│   ├── lib.rs          # App setup: register commands, plugins, managed state
│   ├── main.rs         # Binary entry (DO NOT REMOVE windows_subsystem attribute)
│   ├── bridge.rs       # Trait impls (TauriWatchSender, build_gui_runtime) — decouples service from Tauri
│   └── handler/        # #[tauri::command] entry points — thin delegation only
├── crates/
│   ├── infra/          # DB, Herdr sidecar/transport, git, watcher, logger, slug
│   ├── service/        # Business logic: project, profile, RuntimeRouter, watcher
│   ├── repo/           # Diesel CRUD: project, project_group, checkout_notes
│   └── model/          # Diesel models, DTOs, error types, schema
├── migrations/         # Diesel SQL migrations (embedded via embed_migrations!())
├── tests/              # Integration tests: git, project, filesystem, migrations, sqlite schema (catalog allowlist)
└── capabilities/       # Tauri plugin permission definitions
```

There is no Local spawn adapter, no sqlite profile/session tables, and no orphan-log GC.

## MANAGED STATE (passed to handlers)
- `Arc<Mutex<SqliteConnection>>` (`DbPool`) — single DB connection; acquire/release fast
- `RuntimeHandle` (`Arc<RuntimeRouter>`) — Herdr-only terminal/profile runtime
- `AppHandle` — Tauri app handle for events and window management

GUI connect starts `HerdrRuntimeSync` inside `connect_gui_herdr`. `lib.rs` does not name `HerdrRuntimeSync`.

## COMMANDS EXPOSED (handler/mod.rs)
Terminal: `create_terminal_session`, `write_to_terminal`, `resize_terminal`, `scroll_terminal`, `close_terminal_session`, `list_project_sessions`, `get_session_backend`, `get_session_agent_status`, `stream_session_agent_status`, `attach_terminal_output`, `stream_herdr_output`, `detach_terminal_output`, `flush_terminal_output`, `clear_terminal_output`

Projects (6): `create_project_from_folder`, `list_projects`, `update_project`, `delete_project`, `get_project_config`, `save_project_config`

Git (5): `get_git_branch`, `get_git_diff`, `get_git_diff_stats`, `get_git_log`, `get_commit_diff`

System (7): `list_system_fonts`, `list_system_sounds`, `play_system_sound`, `create_profile`, `delete_profile`, `watch_projects`, `start_debug_log`, `stop_debug_log`

Session ids are live `pane_id`s. Profile ids are Herdr `workspace_id`. `delete_project` is catalog-forget + retain.

## ADDING A COMMAND
1. Implement in `handler/*.rs` — thin: extract state, acquire lock, call service
2. Register in `lib.rs` via `tauri::generate_handler![]`
3. `cargo tauri-typegen generate` → regenerates `src/generated/`

## TEST PATTERN
```rust
fn setup_db() -> SqliteConnection {
    let mut conn = SqliteConnection::establish(":memory:").unwrap();
    diesel::sql_query("PRAGMA foreign_keys=ON;").execute(&mut conn).ok();
    conn.run_pending_migrations(MIGRATIONS).unwrap();
    conn
}
```
Tests colocated in `#[cfg(test)]` modules. Integration tests in `tests/`.

## ANTI-PATTERNS
- Business logic in handlers — delegate to service layer
- Long-held `Mutex` locks across async operations — causes deadlocks
- Editing `src/schema.rs` / `crates/model/src/schema.rs` manually — Diesel generated
- Reintroducing a Local adapter, an env-or-CLI runtime-backend switch, sqlite profile/session tables as authority, or Local session-layer names in live identifiers
