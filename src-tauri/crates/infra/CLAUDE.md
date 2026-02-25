# CLAUDE.md

This file guides Claude Code when working in `src-tauri/crates/infra`.

## Scope

`infra` is the infrastructure crate for 2code’s Tauri backend. It provides OS/process/DB/git/shell primitives used by higher layers. Business rules should stay outside this crate.

## Common Commands

Run from `src-tauri/crates/infra` unless noted.

- Build/check crate:
  - `cargo check -p infra`
  - `cargo build -p infra`
- Run tests for this crate:
  - `cargo test -p infra`
  - Single test: `cargo test -p infra test_name`
  - Single module test example: `cargo test -p infra git::tests::diff_unstaged_changes`
- Lint/format (workspace-level consistency):
  - From `src-tauri/`: `cargo clippy -p infra --all-targets -- -D warnings`
  - From `src-tauri/`: `cargo fmt --all`

## Architecture Overview

`infra/src/lib.rs` exposes focused infrastructure modules. The crate depends on shared types/errors from `model` and is consumed by service/handler layers.

### Core responsibilities

- `db.rs`
  - Initializes SQLite DB file at app data path (`app.db`), enables `WAL` and `foreign_keys`, and runs embedded Diesel migrations.
  - Defines `DbPool = Arc<Mutex<SqliteConnection>>` and `DbPoolExt::conn()` for lock-aware access.
  - Important: this is a single mutex-guarded connection, not a pooled multi-connection setup.

- `pty.rs`
  - Manages PTY lifecycle (`create_session`, `write_to_pty`, `resize_pty`, `close_session`, `close_all_sessions`).
  - Stores active PTYs in `PtySessionMap` (`Arc<Mutex<HashMap<...>>>`).
  - Injects environment for terminal integrations:
    - `_2CODE_HELPER_URL`, `_2CODE_HELPER`, `_2CODE_SESSION_ID` for notification sidecar wiring.
    - `ZDOTDIR` + `_2CODE_ORIG_ZDOTDIR` for shell init injection.
  - Tracks read threads (`PtyReadThreads`) and provides `join_all_read_threads` for graceful shutdown flush behavior.

- `shell_init.rs` + `scripts/default_init.sh`
  - Builds per-session temp init directory with generated `.zshenv`.
  - One-shot shell init hook runs default + project init commands, restores original `ZDOTDIR`, then self-cleans temp files.
  - `default_init.sh` installs wrappers/hooks under `~/.2code` so CLI tools (`claude`, `opencode`, `codex`) can trigger helper-based notifications.

- `config.rs`
  - Reads/writes project config from `2code.json` (`ProjectConfig` re-exported from `model`).
  - Executes setup/teardown/init scripts via `sh -c` in a specified cwd; execution is best-effort and stops on first failure.

- `git.rs`
  - Infrastructure wrapper over git/gh subprocesses for branch, full-diff, log, show, worktree, and GitHub PR status queries.
  - `diff()` uses a temporary `GIT_INDEX_FILE` so staged+unstaged changes can be inspected without mutating the real index.
  - Includes parsing/validation helpers (`parse_git_log`, `parse_shortstat`, `validate_commit_hash`, remote parsing).

- `logger.rs`
  - Defines a `tracing` layer (`ChannelLayer`) forwarding log entries through an mpsc channel to a detachable sink.
  - Filters forwarded events to `INFO` and above before emitting `model::debug::LogEntry`.

- `slug.rs`
  - Converts CJK text to pinyin then slugifies (`slugify_cjk`) for safe branch/path naming.

- `watcher.rs`
  - Defines watcher shutdown flag alias (`Arc<AtomicBool>`) and constructor.

- `test_db.rs`
  - Test helpers for in-memory and file-backed SQLite DBs with migrations applied.

## Design Patterns and Constraints

- Keep this crate framework-agnostic where possible; expose primitives, not UI or handler-layer orchestration.
- Prefer explicit subprocess handling with stdout/stderr checks and typed `AppError` mapping.
- For git/pty operations, treat failures as user-facing infrastructure errors; for cleanup paths, use best-effort logging.
- Preserve DB/migration assumptions:
  - embedded migrations in `db::MIGRATIONS`
  - foreign keys enabled in both runtime and test DB helpers.

## Testing Style in This Crate

- Unit tests are colocated in each module (`#[cfg(test)] mod tests`).
- Infra-heavy tests use temporary directories/repos and real subprocesses (git) where needed.
- DB tests should use `test_db::create_test_db()` unless filesystem inspection is explicitly needed (`create_file_test_db`).
