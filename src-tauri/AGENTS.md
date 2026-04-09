# AGENTS.md — src-tauri

**Generated:** 2026-04-09 | **Commit:** 93661da

## OVERVIEW
Rust Cargo workspace. Tauri 2 application binary + 4 domain crates + 1 sidecar binary. Layered architecture: handler → service → repo → infra.

## STRUCTURE
```
src-tauri/
├── src/
│   ├── lib.rs          # App setup: register commands, plugins, managed state
│   ├── main.rs         # Binary entry (DO NOT REMOVE windows_subsystem attribute)
│   ├── bridge.rs       # Trait impls (TauriPtyEmitter, TauriWatchSender) — decouples service from Tauri
│   ├── helper.rs       # Sidecar port/path state management
│   └── handler/        # #[tauri::command] entry points — 8 files, thin delegation only
├── crates/
│   ├── infra/          # DB, PTY, git, shell init, watcher, logger, slug, helper (Axum)
│   ├── service/        # Business logic: project, profile, pty, watcher, debug
│   ├── repo/           # Diesel CRUD: project, profile, pty
│   └── model/          # Diesel models, DTOs, error types, schema
├── bins/
│   └── 2code-helper/   # CLI sidecar — PTY notification endpoint
├── migrations/         # Diesel SQL migrations (embedded via embed_migrations!())
├── tests/              # Integration tests: git, project, pty_db (4 files)
└── capabilities/       # Tauri plugin permission definitions
```

## MANAGED STATE (passed to handlers)
- `Arc<Mutex<SqliteConnection>>` — single DB connection; acquire/release fast
- `Arc<Mutex<HashMap<String, PtySession>>>` — active PTY sessions map
- `AppHandle` — Tauri app handle for events and window management

## COMMANDS EXPOSED (handler/mod.rs)
PTY (9): `create_pty_session`, `write_to_pty`, `resize_pty`, `close_pty_session`, `list_project_sessions`, `get_pty_session_history`, `delete_pty_session_record`, `flush_pty_output`, `restore_pty_session`

Projects (7): `create_project_temporary`, `create_project_from_folder`, `list_projects`, `update_project`, `delete_project`, `get_project_config`, `save_project_config`

Git (5): `get_git_branch`, `get_git_diff`, `get_git_diff_stats`, `get_git_log`, `get_commit_diff`

System (7): `list_system_fonts`, `list_system_sounds`, `play_system_sound`, `create_profile`, `delete_profile`, `watch_projects`, `start_debug_log`, `stop_debug_log`

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
- Editing `src/schema.rs` manually — Diesel generated
- Font/sound APIs without `#[cfg(target_os = "macos")]` guard
