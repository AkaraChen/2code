# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**2code** is a Tauri 2 desktop application for managing code projects with integrated terminal sessions. It combines a React 19 frontend with a Rust backend, featuring:

- Project management with folder selection and metadata
- Profile management via git worktrees (branch-isolated workspaces)
- Persistent PTY (pseudo-terminal) sessions with scrollback restoration
- SQLite database for project/session/profile storage
- Project-level configuration (`2code.json`) for setup/teardown scripts
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

# Format code
just fmt               # runs 'fama'
```

## Architecture

### Frontend (`/src`)

React 19 + TypeScript + Vite. Provider stack (outermost → innermost): `QueryClientProvider` → `ChakraProvider` → `ThemeProvider` → `BrowserRouter` → `App`.

**Routing** (react-router v7): `/` → HomePage, `/projects/:id` → ProjectDetailPage, `/projects/:id/profiles/:profileId` → ProjectDetailPage, `/settings` → SettingsPage.

**Key directories:**

- `api/` — Tauri IPC wrappers (`projects`, `profiles`, `pty`, `fonts`, `notification`)
- `stores/` — Zustand stores (`terminalStore`, `fontStore`, `notificationStore`)
- `hooks/` — TanStack Query hooks (`useProjects`, `useProfiles`, `useCreateTerminalTab`, `useCloseTerminalTab`, `useRestoreTerminals`, `useTerminalTheme`)
- `components/` — UI components (Terminal, TerminalTabs, TerminalLayer, AppSidebar, dialogs)
- `pages/` — Route-level pages
- `lib/` — Query client config (`staleTime: 30s`, `retry: 1`), centralized query keys, terminal theme definitions

**State management:**

- Zustand for client state (terminal tabs per project, font preferences, notification settings)
- TanStack Query for server state (projects, sessions, profiles)
- Query keys centralized in `lib/queryKeys.ts` — always use `queryKeys.projects.all` / `queryKeys.profiles.byProject(id)` pattern
- `fontStore` and `notificationStore` use persist middleware (localStorage). Terminal store is rebuilt from DB on startup.

**UI Framework:**

- Chakra UI v3 (not v2 — breaking API differences)
- `next-themes` for dark/light mode (wrapped in custom ThemeProvider)

### Backend (`/src-tauri`)

Rust application with Tauri 2. Entry: `main.rs` → `lib.rs`.

**Modules:** `project/` (CRUD + slug generation), `profile/` (git worktree management), `pty/` (session lifecycle + output streaming), `config.rs` (project config loading + script execution), `db.rs` (SQLite setup), `font.rs` (macOS font listing), `sound.rs` (macOS system sounds), `error.rs` (AppError enum with thiserror).

**Database:** SQLite via Diesel ORM, single connection wrapped in `Arc<Mutex<SqliteConnection>>` (not a pool). Stored at `app_data_dir()/app.db`. Pragmas: WAL journal mode, foreign keys ON. Tables: `projects`, `profiles`, `pty_sessions`, `pty_output_chunks`.

**PTY output streaming:** Background thread reads 4KB chunks → emits Tauri events (`pty-output-{id}`, `pty-exit-{id}`). Separate persistence thread via mpsc channel with 32KB flush buffer. UTF-8 boundary detection prevents partial character output. 1MB cap per session with oldest-chunk pruning.

### IPC Pattern (Frontend ↔ Backend)

1. Define Rust command with `#[tauri::command]` in `*/commands.rs`
2. Register in `lib.rs` via `tauri::generate_handler![]`
3. Create TypeScript wrapper in `src/api/` using `invoke<T>("command_name", { params })`
4. Consume via TanStack Query hook in `src/hooks/` with query invalidation on mutations

Commands organized by domain: PTY commands (create/write/resize/close/list/history/delete), project commands (create_temporary/create_from_folder/list/get/update/delete), profile commands (create/list/get/update/delete), and utility commands (`list_system_fonts`, `list_system_sounds`, `play_system_sound`).

## Key Patterns

### Terminal Persistence

Terminals never unmount — tab switches and route changes use CSS `display: none` to preserve xterm.js state. The `TerminalLayer` component renders as a persistent absolute-positioned overlay across all routes.

**Session restoration on app start:**

1. Fetch all sessions from DB (including closed ones with scrollback)
2. Create new PTY session with same metadata
3. Pass old `session.id` as `restoreFrom` prop
4. Terminal component fetches history, writes to xterm, then deletes old record

**Session cleanup:** `mark_all_open_sessions_closed()` runs both on startup (orphan cleanup) and on exit (graceful shutdown).

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
