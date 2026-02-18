# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**2code** is a Tauri 2 desktop application for managing code projects with integrated terminal sessions. It combines a React 19 frontend with a Rust backend, featuring:

- Project management with folder selection and metadata
- Profile management via git worktrees (branch-isolated workspaces)
- Persistent PTY (pseudo-terminal) sessions with scrollback restoration
- SQLite database for project/session/profile storage
- Project-level configuration (`2code.json`) for setup/teardown scripts
- Git diff/commit history browsing
- AI agent integration via ACP (Agent Communication Protocol) with persistent sessions
- i18n support via Paraglide.js (English + Chinese)

## Commands

```bash
# Dev server (frontend + backend hot-reload)
bun tauri dev

# Frontend-only dev
bun run dev

# Production build
bun tauri build

# Frontend-only build (runs paraglide compile → tsc → vite build)
bun run build

# Rust tests
cd src-tauri && cargo test
cd src-tauri && cargo test test_name   # single test

# Regenerate TypeScript bindings from Rust commands
cargo tauri-typegen generate

# Build CLI sidecar (release / dev)
just build-helper
just build-helper-dev

# Format code
just fmt               # runs 'nr lint', 'fama', and 'cargo fmt'

# Rust test coverage (HTML report in src-tauri/coverage/)
just coverage

# Rust test coverage (summary only)
just coverage-summary

# Count lines of code
just cloc
```

## Architecture

### Frontend (`/src`)

React 19 + TypeScript + Vite. Provider stack (outermost → innermost): `QueryClientProvider` → `ChakraProvider` → `ThemeProvider` → `BrowserRouter` → `App`.

**Routing** (react-router v7): `/` → HomePage, `/projects/:id/profiles/:profileId` → ProjectDetailPage, `/settings` → SettingsPage, `*` → redirect to `/`.

**Key directories (feature-based organization):**

- `generated/` — Auto-generated Tauri IPC bindings via `tauri-typegen` (gitignored, do not edit)
- `features/home/` — HomePage
- `features/projects/` — ProjectDetailPage, project hooks (`useProjects`, `useCreateProject`, `useProjectProfiles`, etc.) and dialogs (Create/Delete/Rename)
- `features/profiles/` — Profile hooks (`useCreateProfile`, `useDeleteProfile`) and dialogs
- `features/terminal/` — Terminal hooks (`useCreateTerminalTab`, `useCloseTerminalTab`, `useRestoreTerminals`, `useTerminalTheme`), themes, and components (Terminal, TerminalTabs, TerminalLayer, TerminalPreview)
- `features/tabs/` — Unified tab management store (`useTabStore`), supporting both `TerminalTabSession` and `AgentTabSession` types. Handles session lifecycle, pending deletions, and restoration. Replaces the old terminal-centric store.
- `features/agent/` — AI agent chat UI with streaming renders, tool call blocks, markdown rendering, diff display, and conversation history. Components in `components/` subdirectory, utilities in `utils/`.
- `features/topbar/` — Configurable top bar control system with drag-and-drop arrangement, control registry, and settings UI
- `features/git/` — GitDiffDialog, ProjectTopBar (git branch display + diff trigger), and components (ChangesFileList, CommitList, GitDiffPane, HistoryFileList)
- `features/settings/` — SettingsPage, picker components, and Zustand stores (`stores/terminalSettingsStore`, `stores/themeStore`, `stores/notificationStore`)
- `features/watcher/` — File system watcher side-effect module (`fileWatcher.ts`) for live project updates via Tauri events (imported in `main.tsx`, not a hook)
- `features/debug/` — Debug panel (Cmd+Shift+D toggle), debug logger, and stores (`debugStore`, `debugLogStore`)
- `shared/lib/` — Query client config, centralized query keys, cached promise utility
- `shared/providers/` — ThemeProvider, Toaster
- `shared/components/` — Fallbacks (PageSkeleton, PageError, SidebarSkeleton), SidebarLink. ErrorBoundary is from `react-error-boundary` package.
- `shared/hooks/` — Reusable hooks (`useDialogState`, `useScrollIntoView`)
- `layout/` — AppSidebar and `sidebar/` sub-components (ProjectMenuItem, ProfileList, ProfileItem)

**State management:**

- Zustand for client state (tab management for terminal + agent sessions, font preferences, notification settings, topbar config)
- TanStack Query for server state (projects, sessions, profiles, agent sessions)
- Query keys centralized in `shared/lib/queryKeys.ts` — always use `queryKeys.projects.all` / `queryKeys.git.diff(profileId)` pattern
- `terminalSettingsStore`, `notificationStore`, and `themeStore` use persist middleware (localStorage). Tab store (`features/tabs/store.ts`) is rebuilt from DB on startup.

**UI Framework:**

- Chakra UI v3 (not v2 — breaking API differences)
- `next-themes` for dark/light mode (wrapped in custom ThemeProvider)

### Backend (`/src-tauri`)

Rust application with Tauri 2. Entry: `main.rs` → `lib.rs`.

**Layered architecture** (5 layers):

1. **Handler** (`handler/`) — Tauri `#[tauri::command]` entry points. Extracts state (DbPool, PtySessionMap), acquires DB lock, delegates to service layer. Thin layer — no business logic.
2. **Bridge** (`bridge.rs`) — Adapts Tauri framework types to service-layer trait abstractions. `TauriPtyEmitter` implements `PtyEventEmitter`, `TauriWatchSender` implements `WatchEventSender`, and `build_pty_context()` extracts managed state into a framework-agnostic `PtyContext`. This follows dependency inversion — the service layer defines interfaces, the bridge provides Tauri-specific implementations.
3. **Service** (`service/`) — Business logic and orchestration. Coordinates between repository and infrastructure layers (e.g., creating temp dirs, initializing git repos, running scripts).
4. **Repository** (`repo/`) — Direct database access via Diesel ORM. CRUD operations and complex queries (e.g., `resolve_context_folder` tries profiles table first, falls back to projects).
5. **Infrastructure** (`infra/`) — Cross-cutting concerns: `db.rs` (SQLite setup + migrations), `git.rs` (git command execution), `pty.rs` (PTY session lifecycle), `slug.rs` (CJK-aware slug generation), `config.rs` (project config loading + script execution), `logger.rs` (debug logging), `watcher.rs` (file system watching), `shell_init.rs` (ZDOTDIR-based shell init injection), `test_db.rs` (test helper for in-memory DB).

**App-level modules** (in `src-tauri/src/`): `bridge.rs` (Tauri↔service adapters), `helper.rs` (sidecar HTTP server for CLI notifications via Axum).

**Model** (`model/`) — Diesel models and DTOs: Queryable structs (`Project`, `Profile`, `PtySessionRecord`), Insertable structs (`NewProject`, `NewProfile`), AsChangeset structs (`UpdateProject`, `UpdateProfile`), and non-DB types (`GitCommit`, `GitAuthor`, `WatchEvent`, `LogEntry`).

**Database:** SQLite via Diesel ORM, single connection wrapped in `Arc<Mutex<SqliteConnection>>` (not a pool). Stored at `app_data_dir()/app.db`. Pragmas: WAL journal mode, foreign keys ON. Tables: `projects`, `profiles`, `pty_sessions`, `pty_session_output`, `agent_sessions`, `agent_session_events`.

**Database migrations:** Diesel migrations in `src-tauri/migrations/`, embedded at compile time via `diesel_migrations::embed_migrations!()` and run on app startup in `infra::db::init_db()`. Schema auto-generated in `src/schema.rs`.

**PTY output streaming:** Background thread reads 4KB chunks → emits Tauri events (`pty-output-{id}`, `pty-exit-{id}`). Separate persistence thread via mpsc channel with 32KB flush buffer. UTF-8 boundary detection prevents partial character output. Output is stored as a single BLOB per session in `pty_session_output` (1MB cap, overwritten on flush). Clear-scrollback detection (ESC[3J) resets the stored blob.

**Workspace crates** (under `crates/`): `model/` (Diesel models, schema, DTOs — includes notification types: `NotifyResponse`, `NotificationEntry`, `NotificationState`), `repo/` (database access), `service/` (business logic), `infra/` (infrastructure), `agent/` (AI agent management via ACP), `acp-client/` (ACP client adapter). **Sidecar binary**: `bins/2code-helper/` (CLI sidecar, workspace member via `bins/*` glob).

**CLI sidecar & notification pipeline:** The `2code-helper` binary is a small CLI that PTY shells invoke (via `$_2CODE_HELPER notify`) to trigger notifications. Flow: PTY env vars (`_2CODE_HELPER_URL`, `_2CODE_HELPER`, `_2CODE_SESSION_ID`) → sidecar sends HTTP GET `/notify?session_id=<sid>` → Axum server in `infra/helper.rs` plays sound + emits `pty-notify` Tauri event → frontend `terminalStore.markNotified(sessionId)` → green dot on terminal tab + sidebar profile. Focusing the tab clears the dot. Sidecar is bundled via `externalBin` in `tauri.conf.json`.

**Agent system** (`crates/agent/`): Wraps `rivet-dev/sandbox-agent` for AI code assistant management via ACP (Agent Communication Protocol). Sub-modules:

- **Manager** (`manager.rs`) — Lists agent status, installs ACP bridges, detects API credentials (Anthropic/OpenAI). Supported agents: Claude Code, Codex, Opencode, Amp, Pi, Cursor.
- **Runtime** (`runtime.rs`) — HTTP-based JSON-RPC 2.0 agent sessions: spawn, send (request/response), notify (fire-and-forget), receive push notifications, and shutdown.
- **Models** (`models.rs`) — Agent-specific data types and DTOs.
- **Session** (`session.rs`) — Persistent session management with turn-based event storage.

**ACP Client** (`crates/acp-client/`): Adapter layer for the ACP protocol, providing `adapter.rs` and `error.rs`.

Frontend: `features/agent/` provides a full chat UI (streaming, tool call rendering, markdown, diffs). `features/settings/components/` contains `AgentSettings.tsx` with credential detection and install UI.

Handler commands (`handler/agent.rs`): `list_agent_status`, `install_agent`, `detect_credentials`, `send_agent_prompt`, `close_agent_session`, `create_agent_session_persistent`, `reconnect_agent_session`, `list_project_agent_sessions`, `list_agent_session_events`, `delete_agent_session_record`.

### IPC Pattern (Frontend ↔ Backend)

The project uses **tauri-typegen** to auto-generate typed TypeScript bindings from Rust commands. Config in `tauri.conf.json` under `plugins.typegen` (output: `src/generated/`).

**Adding a new command:**

1. Define Rust command with `#[tauri::command]` in `handler/*.rs`
2. Register in `lib.rs` via `tauri::generate_handler![]`
3. Run `cargo tauri-typegen generate` to regenerate TypeScript bindings
4. Import generated function directly: `import { myCommand } from "@/generated"`
5. Consume via TanStack Query hook in the relevant `src/features/*/hooks.ts` with query invalidation on mutations

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
{
  "setup_script": ["npm install"],
  "teardown_script": ["rm -rf node_modules"],
  "init_script": ["export FOO=bar", "alias ll='ls -la'"]
}
```

- `setup_script` / `teardown_script` — Execute via `sh -c` in the project/worktree directory during profile creation/deletion.
- `init_script` — Injected into every new terminal session via ZDOTDIR-based shell init. The infrastructure writes these commands to a temporary `.zshrc` that zsh sources on startup, so they run as if typed into the shell.

### Zustand Store Convention

```typescript
// Direct access in mutations (outside React):
useTabStore.getState().addTab(...)

// Reactive subscriptions in components:
const tabs = useTabStore(s => s.profiles[profileId]?.tabs)
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

Paraglide.js v2 with inlang message format plugin. Source messages in `messages/{locale}.json`. Generated code in `src/paraglide/` (gitignored, do not edit).

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
- **PTY output has UTF-8 boundary detection** (`find_utf8_boundary`) — do not remove
- **Font listing and sound playback are macOS-only** (`core-text` crate, `/System/Library/Sounds`, `afplay`) — needs platform guards for cross-platform
- **Chakra UI v3** has major breaking changes from v2 — always check v3 API when adding components
- **Directory/branch name generation** uses `pinyin` crate for CJK → romanized slugs — well-tested, don't simplify
- **macOS title bar** uses overlay style with custom traffic light positioning — window chrome is defined in `tauri.conf.json`
- **Tauri plugins**: `tauri-plugin-opener`, `tauri-plugin-dialog`, `tauri-plugin-notification`, `tauri-plugin-store`, `tauri-plugin-shell` — all registered in `lib.rs`
- **Generated bindings** (`src/generated/`) are gitignored — run `cargo tauri-typegen generate` after changing Rust commands
- **Diesel schema** (`src-tauri/src/schema.rs`) is auto-generated — do not edit manually; run `diesel print-schema` or migrations
- **Immer MapSet plugin** — tab store uses `Set<string>` for `notifiedTabs`, requires `enableMapSet()` from immer before store creation. Already called at module level in `features/tabs/store.ts`; if adding `Set`/`Map` to other immer stores, enable it there too
