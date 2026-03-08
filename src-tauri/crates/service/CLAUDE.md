# CLAUDE.md

## Scope

These notes apply to the `src-tauri/crates/service` crate only.

## Common Commands

Run from this crate directory unless noted.

- Build: `cargo build`
- Check (fast compile validation): `cargo check`
- Run tests (this crate): `cargo test`
- Run one test: `cargo test module::tests::test_name`
- Run tests with output: `cargo test -- --nocapture`
- Lint (if clippy is available): `cargo clippy --all-targets --all-features -- -D warnings`
- Format: `cargo fmt`

When working from workspace root (`src-tauri/`), you can target this crate explicitly:

- `cargo test -p service`
- `cargo build -p service`

## High-Level Architecture

This crate is the business-logic layer between Tauri command handlers and lower-level crates.

- `repo` crate: persistent data access (SQLite via Diesel)
- `infra` crate: system integrations (git/worktree, PTY runtime, watcher, config, shell init, DB handle)
- `model` crate: DTOs/domain types/errors
- `agent` crate: ACP agent process/session runtime

`src/lib.rs` exposes service modules and two bridge traits:

- `PtyEventEmitter`: emits PTY output/exit to app layer
- `WatchEventSender`: emits filesystem watch events to app layer

This keeps the service crate framework-agnostic while the app/bridge layer provides concrete implementations.

## Module Map

- `project.rs`: project lifecycle and git read operations. Creates default profile on project creation and captures stats before project deletion.
- `profile.rs`: profile lifecycle around git worktrees (`~/.2code/workspace/<profile_id>`), branch-name sanitization, setup/teardown script execution.
- `pty.rs`: terminal session orchestration. Creates PTY sessions, persists output, emits live output, restores previous sessions, and handles UTF-8-safe streaming.
- `agent.rs`: managed ACP session lifecycle (create/reconnect/close/delete), event persistence, conversation-history reconstruction for reconnect.
- `watcher.rs`: long-lived filesystem watcher coordinator. Polls DB for project list, reconciles watcher set, debounces change events, skips `.git` internals.
- `marketplace.rs`: fetches ACP registry JSON from CDN and manages local marketplace agent records.
- `skill.rs`: CRUD for user skills under `~/.claude/skills/<name>/SKILL.md` with YAML frontmatter parsing/serialization.
- `snippet.rs`: simple snippet CRUD service wrapper.
- `stats.rs`: captures terminal/agent session stats before hard deletes; rolls up homepage stats via repo APIs.

## Important Flows

### Project + Profile lifecycle

1. Project creation writes project row and a default profile row.
2. Additional profiles create git worktrees from project folder.
3. Profile creation/deletion optionally executes `setup_script` / `teardown_script` from project config.

### PTY session lifecycle

1. Resolve profile/project context and load init scripts.
2. Prepare shell-init directory and create PTY session via `infra::pty`.
3. Persist session metadata, then stream output:
    - emit text to frontend through `PtyEventEmitter`
    - persist raw bytes in DB via dedicated persistence thread
4. On startup restore, old history is sanitized through `vt100`, prewritten into new session history, then old session row is deleted.

### Agent session reconnect

1. Load old session + profile worktree path + marketplace distribution launch spec.
2. Try ACP `session/load`; fallback to creating a new session when unsupported.
3. Transfer persisted events from old to new session record.
4. Build conversation-history text from stored events and attach it for first prompt context.

## Concurrency and State Expectations

- DB access uses `DbPool` (mutex-guarded connection). Keep lock scope minimal.
- PTY path uses multiple threads (read thread + persistence thread) coordinated by channels.
- Agent session runtime map is async-locked; DB writes are separate from runtime map updates.
- Watcher coordinator runs in its own thread and periodically reconciles watchers from DB state.

## Testing Notes

- Unit tests are colocated in each module (`#[cfg(test)]`).
- High-signal tests in this crate cover:
    - branch/dir name sanitization
    - UTF-8 boundary handling for streamed PTY output
    - ANSI/vt100 history sanitization behavior
    - skill frontmatter parsing/roundtrip
