# AGENTS.md — src-tauri

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
│   └── handler/        # #[tauri::command] entry points — thin delegation
├── crates/
│   ├── infra/          # DB, PTY, git/, shell init, watcher, logger, slug, helper (Axum)
│   ├── service/        # Business logic: project, profile, pty, watcher, filesystem
│   ├── repo/           # Diesel CRUD: project, profile, pty
│   └── model/          # Diesel models, DTOs, error types, schema, git_error, rewrite
├── bins/
│   └── 2code-helper/   # CLI sidecar — PTY notification endpoint
├── migrations/         # Diesel SQL migrations (embedded via embed_migrations!())
├── tests/              # Integration tests
└── capabilities/       # Tauri plugin permission definitions
```

## MANAGED STATE (passed to handlers)
- `DbPool = Arc<Mutex<SqliteConnection>>` — single DB connection; acquire/release fast (use the resolve-then-drop pattern)
- `Arc<Mutex<HashMap<String, PtySession>>>` — active PTY sessions map
- `GitCancelTokens = Arc<Mutex<HashMap<String, CancelToken>>>` — keyed by `op_id` for cancellable git operations
- `GitWatchers` — live `.git/` watchers keyed by profile_id
- `AppHandle` — Tauri app handle for events and window management

## COMMAND CATEGORIES

The `tauri::generate_handler![]` block in `lib.rs` registers ~90 commands across:
- **PTY**: 9 commands for session lifecycle, I/O, restore
- **Projects**: 7 commands for CRUD + config
- **Git**: ~50 commands. See `src/handler/CLAUDE.md` for the full breakdown — split into reads, non-cancellable writes, and cancellable writes (which take an `op_id` for `cancel_git_operation`)
- **Filesystem**: file search and read for the file viewer
- **System**: fonts, sounds, profile create/delete, watcher, debug logging, topbar

## ADDING A COMMAND
1. Implement in `handler/*.rs` — thin: extract state, resolve folder/IDs, drop the DB lock, call service inside `run_blocking` (or `run_cancellable_op` for long-running ops)
2. Add a service-layer passthrough if needed
3. Register in `lib.rs` via `tauri::generate_handler![]`
4. `cargo tauri-typegen generate` → regenerates `src/generated/` (until typegen output is the source of truth, the git layer hand-writes bindings in `src/features/git/changesTabBindings.ts`)

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

For git tests that need a real repository, see helpers in `crates/infra/src/git/cli.rs::tests` (`create_index_status_repo`, `make_bare_remote`, `clone_with_remote_branches`).

## KEY DEPENDENCY NOTES
- **gix 0.82** — pinned with `default-features = false` + explicit `sha1` feature in `crates/infra/Cargo.toml`. Without `sha1`, `gix-hash`'s `Kind` enum has zero variants and matches become non-exhaustive on rustc ≥ 1.94.
- **`SignatureRef::time` is `&str`** (raw header) in gix 0.82 — call `.time()?.seconds` to parse, not `.time.seconds`.

## ANTI-PATTERNS
- Business logic in handlers — delegate to service layer
- Long-held `Mutex` locks across async operations — causes deadlocks; use resolve-then-drop
- Long-running git ops without a cancel token — UI hangs with no way out
- Editing `src/schema.rs` manually — Diesel generated
- Font/sound APIs without `#[cfg(target_os = "macos")]` guard
- Skipping arg validation when adding a git CLI shell-out — see the validators in `infra::git::cli` (`validate_branch_name`, `validate_commit_hash`, `validate_remote_token`, `validate_revspec`)
