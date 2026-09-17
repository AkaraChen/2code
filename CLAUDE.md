# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**2code** is a Tauri 2 desktop application for managing code projects with integrated terminal sessions. It combines a React 19 frontend with a Rust backend, featuring:

- Project management with folder selection and metadata
- Profile management via Herdr workspaces (git worktrees / folder workspaces)
- Persistent Herdr terminal sessions (live `pane_id` reattach)
- SQLite database for projects / groups / checkout notes (Herdr is the profile authority)
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

React 19 + TypeScript + Vite. Provider stack (outermost → innermost): `QueryClientProvider` → `ThemeProvider` → `TooltipProvider` → `BrowserRouter` → `AppRoot`, with the shadcn `Toaster` mounted inside `TooltipProvider`.

**Routing** (react-router v7): `/` → HomePage, `/projects/:id/profiles/:profileId` → ProjectDetailPage, `/settings` → SettingsPage, `*` → redirect to `/`.

**Key directories (feature-based organization):**

- `generated/` — Auto-generated Tauri IPC bindings via `tauri-typegen` (gitignored, do not edit)
- `features/home/` — HomePage
- `features/projects/` — ProjectDetailPage, project hooks (`useProjects`, `useCreateProject`, `useProjectProfiles`, etc.) and dialogs (Create/Delete/Rename)
- `features/profiles/` — Profile hooks (`useCreateProfile`, `useDeleteProfile`) and dialogs
- `features/terminal/` — Terminal store, hooks (`useCreateTerminalTab`, `useCloseTerminalTab`, `useRestoreTerminals`, `useTerminalTheme`), themes, and components (Terminal, TerminalTabs, TerminalLayer, TerminalPreview)
- `features/git/` — GitDiffDialog, ProjectTopBar (git branch display + diff trigger), and components (ChangesFileList, CommitList, GitDiffPane, HistoryFileList)
- `features/settings/` — SettingsPage, picker components, and Zustand stores (`stores/terminalSettingsStore`, `stores/themeStore`, `stores/notificationStore`)
- `features/watcher/` — File system watcher hook (`useFileWatcher`) for live project updates via Tauri events
- `features/debug/` — Debug panel (Cmd+Shift+D toggle), debug logger, and stores (`debugStore`, `debugLogStore`)
- `shared/lib/` — Query client config, centralized query keys, cached promise utility
- `shared/providers/` — ThemeProvider
- `shared/components/` — Fallbacks (PageSkeleton, PageError, SidebarSkeleton), SidebarLink. ErrorBoundary is from `react-error-boundary` package.
- `layout/` — AppSidebar and `sidebar/` sub-components (ProjectMenuItem, ProfileList, ProfileItem)

**State management:**

- Zustand for client state (terminal tabs per project, font preferences, notification settings)
- TanStack Query for server state (projects, sessions, profiles)
- Query keys centralized in `shared/lib/queryKeys.ts` — always use `queryKeys.projects.all` / `queryKeys.git.diff(profileId)` pattern
- `terminalSettingsStore`, `notificationStore`, and `themeStore` use persist middleware (localStorage). Terminal store is rebuilt from live Herdr panes on startup.

**UI Framework:**

- shadcn/ui primitives in `src/components/ui` (Base UI + Tailwind CSS v4)
- `next-themes` for dark/light mode (wrapped in custom ThemeProvider)
- `sonner` for toast notifications

### Backend (`/src-tauri`)

Rust application with Tauri 2. Entry: `main.rs` → `lib.rs`.

**Layered architecture** (4 layers):

1. **Handler** (`handler/`) — Tauri `#[tauri::command]` entry points. Extracts state (`DbPool`, `RuntimeHandle`), acquires DB lock when sqlite is needed, delegates to service layer. Thin layer — no business logic.
2. **Service** (`service/`) — Business logic and orchestration. Coordinates between repository, infrastructure, and Herdr-only `RuntimeRouter`.
3. **Repository** (`repo/`) — Direct database access via Diesel ORM. CRUD for `projects`, `project_groups`, `checkout_notes`. Checkout paths come from live Herdr, not sqlite `profiles`.
4. **Infrastructure** (`infra/`) — Cross-cutting concerns: `db.rs` (SQLite setup + migrations), `git.rs` (git command execution), `herdr/` (pinned v0.9.0 sidecar, namespace, NDJSON transport, CLI attach), `slug.rs` (CJK-aware slug generation), `config.rs` (project config loading + script execution), `logger.rs` (debug logging), `watcher.rs` (file system watching).

**Model** (`model/`) — Diesel models and DTOs: Queryable structs (`Project`, `ProjectGroup`, `CheckoutNote`), derived GUI DTOs (`Profile` with `id` = Herdr `workspace_id`, `PtySessionRecord` from `session.snapshot`), Insertable structs (`NewProject`, `NewCheckoutNote`), AsChangeset structs (`UpdateProject`), and non-DB types (`GitCommit`, `GitAuthor`, `WatchEvent`, `LogEntry`).

**Database:** SQLite via Diesel ORM, single connection wrapped in `Arc<Mutex<SqliteConnection>>` (not a pool). Stored at `app_data_dir()/app.db`. Pragmas: WAL journal mode, foreign keys ON. Tables: `projects`, `project_groups`, `checkout_notes`. sqlite `profiles` and `pty_sessions` are DROPped. Herdr is the profile/session authority.

**Database migrations:** Diesel migrations in `src-tauri/migrations/`, embedded at compile time via `diesel_migrations::embed_migrations!()` and run on app startup in `infra::db::init_db()`. Schema auto-generated in `crates/model/src/schema.rs`.

**Herdr output streaming:** `attach_pty_output(sessionId, streamId)` registers the active sink; `stream_herdr_output` owns a `tauri::ipc::Channel<HerdrTerminalFrame>`. `detach_pty_output` must pass the same `streamId` so stale React cleanup cannot remove a newer stream for the same session. `Terminal.tsx` attaches the Herdr frame stream and writes into xterm. There is no sqlite history, `pty_logs`, or `gc_orphan_logs`. Session id is a live `pane_id`. GUI connect starts `HerdrRuntimeSync`; `lib.rs` does not name it.

**Workspace crates:** `model/`, `repo/`, `service/`, and `infra/`.

**Agent status detection:** `Terminal.tsx` detects coding-agent state from xterm screen text, OSC title, and OSC progress after live output writes. Rules live in `src/features/terminal/detector/rules/`, one manifest per agent. The detector publishes `running|waiting|idle` to `terminalStore`; waiting status can play the configured system sound via the generated `playSystemSound` Tauri command.

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

1. `listProjects` then `listProjectSessions` (live Herdr panes; `profile_id` is `workspace_id`)
2. `restoration.ts` reattaches each live `pane_id` as a tab on the same identity
3. `Terminal.tsx` attaches the Herdr frame stream — no sqlite history, no `restoreFrom`

**Session cleanup:** GUI exit releases Herdr client helpers and attachments. It does not `herdr server stop`. `delete_project` is catalog-forget + retain.

### Checkout path (live Herdr cwd)

Git operations (`get_git_diff`, `get_git_log`, `get_commit_diff`) accept a `profile_id` that is a Herdr `workspace_id`. The backend resolves the folder via `service::project::reconcile_profile_checkout()`: live `worktree.list` path / snapshot pane `cwd`. There is no sqlite `profiles.worktree_path`. Unknown id or Herdr-down fail closed.

### Profile System (Herdr workspaces)

GUI clicks stay **New Profile** / **Delete Profile**. Git New Profile is Herdr `worktree.create`; non-git is `workspace.create --cwd`. Returned `id` is `workspace_id`. Branch names are sanitized (CJK → pinyin, special chars stripped). On creation, `setup_script` from `2code.json` runs in the checkout. On deletion, `teardown_script` runs, then Herdr `worktree.remove` / `workspace.close` (primary checkout refused). sqlite `profiles` is DROPped.

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
- **Herdr frames** go over `stream_herdr_output` (`Channel<HerdrTerminalFrame>`) — `Terminal.tsx` attaches that stream; session id is a live `pane_id`
- **Terminal font metrics must be measured on an attached canvas** — WebKit only resolves locally installed fonts for canvases that are in the document; detached canvases and `OffscreenCanvas` silently report fallback metrics. xterm 6 measures offscreen but paints via the DOM, so `src/features/terminal/lib/xtermMetricsPatch.ts` redirects both of its measurement surfaces (`CharSizeService` and `WidthCache`) to attached canvases. Without it the terminal leaves ~1/6 of its width empty with any font whose advance ratio differs from the fallback's (e.g. Sarasa's 0.5 em vs Menlo's 0.6 em). See `src/features/terminal/AGENTS.md`.
- **Font listing and sound playback are platform-backed**: macOS uses `core-text` + `/System/Library/Sounds` + `afplay`; Linux uses `fontdb` + XDG sound dirs + desktop audio players; Windows uses `fontdb` + `C:\Windows\Media` + PowerShell `Media.SoundPlayer`.
- **UI components** should use shadcn/ui primitives from `src/components/ui`; do not add legacy UI-library APIs back
- **Directory/branch name generation** uses `pinyin` crate for CJK → romanized slugs — well-tested, don't simplify
- **macOS title bar** uses overlay style with custom traffic light positioning — window chrome is defined in `tauri.conf.json`
- **Tauri plugins**: `tauri-plugin-opener`, `tauri-plugin-dialog`, `tauri-plugin-notification`, `tauri-plugin-store` — all registered in `lib.rs`
- **Generated bindings** (`src/generated/`) are gitignored — run `cargo tauri-typegen generate` after changing Rust commands
- **Diesel schema** (`src-tauri/crates/model/src/schema.rs`) is auto-generated — do not edit manually; run `diesel print-schema` or migrations
