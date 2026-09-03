# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**2code** is a native GPUI desktop application for managing code projects with integrated terminal sessions. The leftover Tauri/React webview lives in `legacy/` behind `--features legacy-tauri`. The product features:

- Project management with folder selection and metadata
- Profile management via git worktrees (branch-isolated workspaces)
- Persistent PTY (pseudo-terminal) sessions with scrollback restoration
- SQLite database for project/session/profile storage
- Project-level configuration (`2code.json`) for setup/teardown scripts
- Git diff/commit history browsing
- i18n: native GPUI bilingual copy (English / Chinese); leftover React still uses Paraglide.js

## Commands

```bash
# Native GPUI app
bun start
# or
cd src-tauri && cargo run

# Production GPUI binary
bun run build

# Leftover Tauri/React webview
cargo run --manifest-path src-tauri/Cargo.toml --features legacy-tauri

# Rust tests
cd src-tauri && cargo test
cd src-tauri && cargo test test_name   # single test

# Regenerate TypeScript bindings from Rust commands
cargo tauri-typegen generate

# Format code
just fmt               # runs 'fama'
```

## Architecture

### Native shell (`src-tauri/crates/gpui-app`)

Zed GPUI + gpui-component widgets. Entry: `gpui_app::run()` from `src-tauri/src/main.rs` (unless `--features legacy-tauri`). Talks to `service` / `repo` / `infra` in-process — no webview, no Tauri IPC on the product path.

**Surfaces:** Home, project sidebar + profiles, workspace (Files / Git / Terminal), settings, dialogs, debug overlay.

**State:** `AppRoot` owns projects, workspace pane, PTY tabs, git/file buffers, and settings JSON under the app data dir.

### Leftover React (`legacy/web`)

The old Tauri/React webview. Do not add product features here. Vite + React 19 + shadcn, Paraglide i18n, and `legacy/web/src/generated/` Tauri bindings. Enabled only with `--features legacy-tauri`.

### Backend (`/src-tauri`)

Rust application with Tauri 2. Entry: `main.rs` → `lib.rs`.

**Layered architecture** (4 layers):

1. **Handler** (`handler/`) — Tauri `#[tauri::command]` entry points. Extracts state (DbPool, PtySessionMap), acquires DB lock, delegates to service layer. Thin layer — no business logic.
2. **Service** (`service/`) — Business logic and orchestration. Coordinates between repository and infrastructure layers (e.g., creating temp dirs, initializing git repos, running scripts).
3. **Repository** (`repo/`) — Direct database access via Diesel ORM. CRUD operations and complex queries (e.g., `resolve_context_folder` tries profiles table first, falls back to projects).
4. **Infrastructure** (`infra/`) — Cross-cutting concerns: `db.rs` (SQLite setup + migrations), `git.rs` (git command execution), `pty.rs` (PTY session lifecycle), `pty_log.rs` (per-session output stored as `{app_data_dir}/pty_logs/{session_id}.log` files), `slug.rs` (CJK-aware slug generation), `config.rs` (project config loading + script execution), `logger.rs` (debug logging), `watcher.rs` (file system watching), `shell_init.rs` (ZDOTDIR-based shell init injection).

**Model** (`model/`) — Diesel models and DTOs: Queryable structs (`Project`, `Profile`, `PtySessionRecord`), Insertable structs (`NewProject`, `NewProfile`), AsChangeset structs (`UpdateProject`, `UpdateProfile`), and non-DB types (`GitCommit`, `GitAuthor`, `WatchEvent`, `LogEntry`).

**Database:** SQLite via Diesel ORM, single connection wrapped in `Arc<Mutex<SqliteConnection>>` (not a pool). Stored at `app_data_dir()/app.db`. Pragmas: WAL journal mode, foreign keys ON. Tables: `projects`, `profiles`, `pty_sessions` (session **metadata** only — output bytes live in per-session files, not the DB).

**Database migrations:** Diesel migrations in `src-tauri/migrations/`, embedded at compile time via `diesel_migrations::embed_migrations!()` and run on app startup in `infra::db::init_db()`. Schema auto-generated in `src/schema.rs`.

**PTY output streaming:** Background thread reads 4KB chunks → sends raw PTY chunks to the active output sink registered by `attach_pty_output(sessionId, streamId)`. `stream_pty_output` owns a `tauri::ipc::Channel<&[u8]>` and sends each chunk with `on_output.send(chunk.as_slice())`; `detach_pty_output` must pass the same `streamId` so stale React cleanup cannot remove a newer stream for the same session. `Terminal.tsx` receives `ArrayBuffer` and writes `new Uint8Array(payload)` to xterm. Output produced before attach is recovered from the persisted log via `get_pty_session_history` (same seam the old global-event API had). Bytes are sent as-is — xterm.js decodes UTF-8 across writes, so no backend boundary splitting is needed. Session exit is still a low-volume global event (`pty-exit-{id}`). A separate persistence thread via mpsc channel with 32KB flush buffer appends raw bytes to the session's `pty_logs/{session_id}.log` file (see `infra::pty_log`). No byte cap — a log lives only for one session (removed on restore/close/delete) and scrollback is bounded on restore by the vt100 emulator (`sanitize_history`, 10k lines). Orphan logs are reaped on startup by `service::pty::gc_orphan_logs`.

**Workspace crates:** `model/`, `repo/`, `service/`, and `infra/`.

**Agent status detection:** the GPUI shell (`gpui-app/src/detector.rs`) reads vt100 screen text and OSC titles. Leftover React rules still live in `legacy/web/src/features/terminal/detector/rules/`.

### IPC Pattern (Frontend ↔ Backend)

The leftover webview uses **tauri-typegen** to auto-generate typed TypeScript bindings from Rust commands. Config in `tauri.conf.json` under `plugins.typegen` (output: `legacy/web/src/generated/`). The GPUI product talks to Rust services in-process.

**Adding a new command:**

1. Define Rust command with `#[tauri::command]` in `handler/*.rs`
2. Register in `lib.rs` via `tauri::generate_handler![]`
3. Run `cargo tauri-typegen generate` to regenerate TypeScript bindings
4. Import generated function directly: `import { myCommand } from "@/generated"`
5. Consume via TanStack Query hook in the relevant `legacy/web/src/features/*/hooks.ts` with query invalidation on mutations

**Do not** create manual API wrappers in `src/api/` — all IPC bindings are auto-generated.

## Key Patterns

### Terminal Persistence

Terminals never unmount — tab switches and route changes use CSS `display: none` to preserve xterm.js state. The `TerminalLayer` component renders as a persistent absolute-positioned overlay across all routes.

**Session restoration on app start:**

1. Fetch all sessions from DB (including closed ones with scrollback)
2. Create new PTY session with same metadata
3. Pass old `session.id` as `restoreFrom` prop
4. Terminal component fetches history, writes to xterm, then deletes old record

**Session cleanup:** `mark_all_open_sessions_closed()` runs both on startup (orphan cleanup) and on exit (graceful shutdown).

### Context ID Resolution

Git operations (`get_git_diff`, `get_git_log`, `get_commit_diff`) accept a `contextId` parameter that can be either a project ID or a profile ID. The backend resolves this polymorphically via `repo::project::resolve_context_folder()`: profile ID → profile's worktree path; project ID → project's folder. This lets git operations work seamlessly with both regular project folders and profile worktrees.

### Profile System (Git Worktrees)

Profiles create isolated branch workspaces using `git worktree add`. Each profile gets a worktree in `~/.2code/workspace/{profile_id}`. Branch names are sanitized (CJK → pinyin, special chars stripped). On creation, `setup_script` from `2code.json` runs in the worktree. On deletion, `teardown_script` runs, then the worktree and branch are removed.

### Project Configuration (`2code.json`)

Projects can include a `2code.json` in their root folder:

```json
{ "setup_script": ["npm install"], "teardown_script": ["rm -rf node_modules"] }
```

Scripts execute via `sh -c` in the project/worktree directory. Used automatically during profile creation/deletion.

### Zustand Store Convention

```typescript
// Direct access in mutations (outside React):
useTerminalStore.getState().addTab(...)

// Reactive subscriptions in components:
const tabs = useTerminalStore(s => s.profiles[profileId]?.tabs)
```

### Rust Test Pattern

Tests use in-memory SQLite with embedded migrations:

```rust
fn setup_db() -> SqliteConnection {
    let mut conn = SqliteConnection::establish(":memory:").expect("in-memory db");
    diesel::sql_query("PRAGMA foreign_keys=ON;").execute(&mut conn).ok();
    conn.run_pending_migrations(MIGRATIONS).expect("run migrations");
    conn
}
```

Tests are colocated with implementation in `#[cfg(test)]` modules.

## Internationalization (i18n)

Leftover React uses Paraglide.js v2. Source messages in `legacy/web/messages/{locale}.json`. Generated code in `legacy/web/src/paraglide/` (gitignored, do not edit). Native GPUI copy lives in `gpui-app/src/i18n.rs`.

**Usage:** `import * as m from "@/paraglide/messages.js"` → `m.home()`

**Critical:** `project.inlang/settings.json` **must** include the modules array:

```json
"modules": ["https://cdn.jsdelivr.net/npm/@inlang/plugin-message-format@latest/dist/index.js"]
```

Without this, paraglide compiles but generates empty message files. Also requires `allowJs: true` in tsconfig.json.

## Path Aliases

`@/` maps to `src/` — configured in both `vite.config.ts` (resolve.alias) and `tsconfig.json` (paths). Keep them in sync.

## Gotchas

- **Database is single-connection** (`Arc<Mutex<SqliteConnection>>`), not a pool — avoid long-held locks
- **Terminals use CSS display for show/hide** — do not refactor to conditional rendering or they lose xterm state
- **PTY output sends `&[u8]` over a per-session IPC `Channel`** (not global events; frontend receives `ArrayBuffer`) — xterm.js handles UTF-8 decoding across chunk boundaries, so no backend boundary splitting is done
- **Leftover xterm font metrics** — WebKit only resolves locally installed fonts for canvases that are in the document. See `legacy/web/src/features/terminal/AGENTS.md`. The GPUI terminal uses a vt100 cell grid, not xterm.
- **Font listing and sound playback are platform-backed**: macOS uses `core-text` + `/System/Library/Sounds` + `afplay`; Linux uses `fontdb` + XDG sound dirs + desktop audio players; Windows uses `fontdb` + `C:\Windows\Media` + PowerShell `Media.SoundPlayer`.
- **UI components** should use shadcn/ui primitives from `src/components/ui`; do not add legacy UI-library APIs back
- **Directory/branch name generation** uses `pinyin` crate for CJK → romanized slugs — well-tested, don't simplify
- **macOS title bar** uses overlay style with custom traffic light positioning — window chrome is defined in `tauri.conf.json`
- **Tauri plugins**: `tauri-plugin-opener`, `tauri-plugin-dialog`, `tauri-plugin-notification`, `tauri-plugin-store` — all registered in `lib.rs`
- **Leftover generated bindings** (`legacy/web/src/generated/`) — run `cargo tauri-typegen generate` after changing Rust commands used by the webview
- **Diesel schema** (`src-tauri/src/schema.rs`) is auto-generated — do not edit manually; run `diesel print-schema` or migrations
- **Immer MapSet plugin** — terminal store uses `Set<string>` for `notifiedTabs`, requires `enableMapSet()` from immer before store creation. Already called at module level in `store.ts`; if adding `Set`/`Map` to other immer stores, enable it there too
