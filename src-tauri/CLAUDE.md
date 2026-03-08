# CLAUDE.md

This repository is the Tauri backend/workspace for 2code.

## Common Commands

Run these from this directory (`src-tauri/`) unless noted.

- `cargo test` — run all Rust tests (workspace + integration tests in `tests/`)
- `cargo test <test_name>` — run tests matching a name substring
- `cargo test --test integration_agent` — run one integration test file
- `cargo test --test integration_agent test_agent_session_full_lifecycle -- --exact` — run a single integration test
- `cargo test -p service` — run tests for one workspace crate (`service`, `repo`, `infra`, `model`, `agent`, `acp-client`)
- `cargo build` — build the Rust workspace
- `cargo tauri dev` — run Tauri app in dev mode
- `cargo tauri build` — build distributable app bundle
- `cargo tauri-typegen generate` — regenerate TypeScript IPC bindings to `src/generated/` after changing `#[tauri::command]` signatures

Build hooks configured in `tauri.conf.json`:

- `beforeDevCommand`: `just build-helper-dev && bun run dev`
- `beforeBuildCommand`: `just build-helper && bun run build`

## High-Level Architecture

### Workspace Structure

- `src/` (app layer): Tauri wiring only (`main.rs`, `lib.rs`, handlers, bridge, helper server)
- `crates/model`: DTOs, Diesel models/schema, shared error and domain types
- `crates/repo`: DB access layer (Diesel queries)
- `crates/service`: business logic/orchestration (project/profile/pty/agent/marketplace/skills/stats)
- `crates/infra`: infrastructure adapters (db init/migrations, git, PTY process control, shell init injection, watcher, logger, config)
- `crates/agent`: ACP runtime/session management wrapper around sandbox-agent
- `crates/acp-client`: ACP adapter/error layer
- `bins/2code-helper`: sidecar CLI used by PTY shells for notification signaling

The intended dependency direction is:
`app (src/) -> service -> repo/infra -> model`
with bridge traits in service implemented by app-layer adapters.

### App Layer (`src/lib.rs`)

`lib.rs` is the main composition root:

- initializes tracing
- initializes managed state (DB, PTY session map, read thread tracker, agent manager/session maps)
- starts helper HTTP server
- performs startup recovery:
    - mark orphaned PTY sessions closed
    - mark orphaned agent sessions destroyed
    - restore PTY sessions from persisted output
- registers all Tauri commands in `invoke_handler`
- performs shutdown cleanup (abort notification tasks, close sessions, join PTY threads, mark sessions destroyed/closed)

Keep handlers in `src/handler/*` thin: extract state and delegate to `service::*`.

### PTY System

Core PTY logic lives in `crates/service/src/pty.rs` and `crates/infra/src/pty.rs`:

- session create flow loads project `init_script` from `2code.json`, prepares shell init dir, spawns PTY, persists session metadata
- PTY output is read on a background thread, streamed to frontend via emitter trait, and persisted via a dedicated flush channel
- output persistence supports explicit flush and clear-scrollback detection (`ESC[3J`)
- startup restore path rehydrates old sessions by sanitizing stored terminal history through `vt100`, creating a fresh PTY, and deleting stale records
- UTF-8 boundary handling is explicit (`find_utf8_boundary`) to avoid emitting partial multibyte characters

### Agent System

Agent runtime is split across:

- `crates/agent/*` for process/session/runtime primitives
- `crates/service/src/agent.rs` for app-level lifecycle + DB persistence
- `src/handler/agent.rs` for Tauri commands

Important behavior:

- sessions are persisted in DB and can be lazily reconnected
- reconnect tries ACP `session/load`, then falls back to new session creation
- historical events are transferred and can be summarized into prompt context for resumed sessions

### Data and Persistence

- SQLite connection is a single `Arc<Mutex<SqliteConnection>>` (`infra::db::DbPool`), not a pool
- migrations are embedded (`embed_migrations!("../../migrations")`) and applied at startup
- DB file path is `app_data_dir()/app.db`
- pragmas set on init include WAL mode + foreign keys
- schema changes should be made via new migrations; do not edit generated schema manually

### Profiles and Git Worktrees

Profile creation/deletion (`service::profile`) manages isolated git worktrees:

- worktrees live under `~/.2code/workspace/<profile_id>`
- branch names are sanitized with CJK-aware slugification
- profile setup/teardown runs scripts from project `2code.json`

### Notification Sidecar

`bins/2code-helper` is bundled as an external binary and used by PTY sessions:

- helper HTTP server in `src/helper.rs` exposes `/notify` and `/health`
- sidecar calls `/notify?session_id=...`
- app emits `pty-notify` event and optionally plays configured system sound

## Implementation Conventions

- Add new app commands in `src/handler/*.rs`, then register in `src/lib.rs` `generate_handler![]`
- Put business logic in `crates/service`, persistence in `crates/repo`, and cross-cutting OS/process concerns in `crates/infra`
- Prefer extending service traits/bridge adapters instead of coupling service code directly to Tauri types
- For tests, follow existing pattern in `tests/common/mod.rs`: in-memory SQLite + embedded migrations + foreign keys enabled
