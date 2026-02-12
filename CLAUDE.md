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

# Format code
just fmt               # runs 'fama'
```

## Architecture

### Frontend (`/src`)

React 19 + TypeScript + Vite. Provider stack (outermost → innermost): `QueryClientProvider` → `ChakraProvider` → `ThemeProvider` → `BrowserRouter` → `App`.

**Routing** (react-router v7): `/` → HomePage, `/projects/:id` → ProjectDetailPage, `/projects/:id/profiles/:profileId` → ProjectDetailPage, `/settings` → SettingsPage.

**Key directories (feature-based organization):**

- `generated/` — Auto-generated Tauri IPC bindings via `tauri-typegen` (gitignored, do not edit)
- `features/projects/` — Project hooks (`useProjects`, `useCreateProject`, etc.) and dialogs (Create/Delete/Rename)
- `features/profiles/` — Profile hooks (`useProfiles`, `useCreateProfile`, `useDeleteProfile`) and dialogs
- `features/terminal/` — Terminal store, hooks (`useCreateTerminalTab`, `useCloseTerminalTab`, `useRestoreTerminals`, `useTerminalTheme`), themes, and components (Terminal, TerminalTabs, TerminalLayer, TerminalPreview)
- `features/git/` — GitDiffDialog, ProjectTopBar (git branch display + diff trigger)
- `features/settings/` — SettingsPage, picker components, and Zustand stores (`stores/fontStore`, `stores/themeStore`, `stores/notificationStore`)
- `shared/lib/` — Query client config, centralized query keys, cached promise utility
- `shared/providers/` — ThemeProvider, Toaster
- `shared/components/` — ErrorBoundary, Fallbacks, SidebarLink
- `layout/` — AppSidebar, HomePage, ProjectDetailPage, and `sidebar/` sub-components

**State management:**

- Zustand for client state (terminal tabs per project, font preferences, notification settings)
- TanStack Query for server state (projects, sessions, profiles)
- Query keys centralized in `shared/lib/queryKeys.ts` — always use `queryKeys.projects.all` / `queryKeys.profiles.byProject(id)` pattern
- `fontStore`, `notificationStore`, and `themeStore` use persist middleware (localStorage). Terminal store is rebuilt from DB on startup.

**UI Framework:**

- Chakra UI v3 (not v2 — breaking API differences)
- `next-themes` for dark/light mode (wrapped in custom ThemeProvider)

### Backend (`/src-tauri`)

Rust application with Tauri 2. Entry: `main.rs` → `lib.rs`.

**Layered architecture** (4 layers):

1. **Handler** (`handler/`) — Tauri `#[tauri::command]` entry points. Extracts state (DbPool, PtySessionMap), acquires DB lock, delegates to service layer. Thin layer — no business logic.
2. **Service** (`service/`) — Business logic and orchestration. Coordinates between repository and infrastructure layers (e.g., creating temp dirs, initializing git repos, running scripts).
3. **Repository** (`repo/`) — Direct database access via Diesel ORM. CRUD operations and complex queries (e.g., `resolve_context_folder` tries profiles table first, falls back to projects).
4. **Infrastructure** (`infra/`) — Cross-cutting concerns: `db.rs` (SQLite setup + migrations), `git.rs` (git command execution), `pty.rs` (PTY session lifecycle), `slug.rs` (CJK-aware slug generation), `config.rs` (project config loading + script execution).

**Model** (`model/`) — Diesel models and DTOs: Queryable structs (`Project`, `Profile`, `PtySessionRecord`), Insertable structs (`NewProject`, `NewProfile`), AsChangeset structs (`UpdateProject`, `UpdateProfile`), and non-DB types (`GitCommit`, `GitAuthor`).

**Database:** SQLite via Diesel ORM, single connection wrapped in `Arc<Mutex<SqliteConnection>>` (not a pool). Stored at `app_data_dir()/app.db`. Pragmas: WAL journal mode, foreign keys ON. Tables: `projects`, `profiles`, `pty_sessions`, `pty_output_chunks`.

**Database migrations:** Diesel migrations in `src-tauri/migrations/`, embedded at compile time via `diesel_migrations::embed_migrations!()` and run on app startup in `infra::db::init_db()`. Schema auto-generated in `src/schema.rs`.

**PTY output streaming:** Background thread reads 4KB chunks → emits Tauri events (`pty-output-{id}`, `pty-exit-{id}`). Separate persistence thread via mpsc channel with 32KB flush buffer. UTF-8 boundary detection prevents partial character output. 1MB cap per session with oldest-chunk pruning.

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
{ "setup_script": ["npm install"], "teardown_script": ["rm -rf node_modules"] }
```

Scripts execute via `sh -c` in the project/worktree directory. Used automatically during profile creation/deletion.

### Zustand Store Convention

```typescript
// Direct access in mutations (outside React):
useTerminalStore.getState().addTab(...)

// Reactive subscriptions in components:
const tabs = useTerminalStore(s => s.projects[id]?.tabs)
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
- **Tauri plugins**: `tauri-plugin-opener`, `tauri-plugin-dialog`, `tauri-plugin-notification` — all registered in `lib.rs`
- **Generated bindings** (`src/generated/`) are gitignored — run `cargo tauri-typegen generate` after changing Rust commands
- **Diesel schema** (`src-tauri/src/schema.rs`) is auto-generated — do not edit manually; run `diesel print-schema` or migrations
