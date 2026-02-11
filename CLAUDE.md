# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**2code** is a Tauri 2 desktop application for managing code projects with integrated terminal sessions. It combines a React 19 frontend with a Rust backend, featuring:

- Project management with folder selection and metadata
- Persistent PTY (pseudo-terminal) sessions with scrollback restoration
- SQLite database for project/session storage
- i18n support via Paraglide.js (English + Chinese)

## Commands

```bash
# Dev server (frontend + backend hot-reload)
bun tauri dev          # or: just start

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

**Routing** (react-router v7): `/` → HomePage, `/projects/:id` → ProjectDetailPage, `/settings` → SettingsPage.

**Key directories:**

- `api/` — Tauri IPC wrappers using `invoke<T>("command_name", { params })`
- `stores/` — Zustand stores (terminalStore for per-project terminal tabs, fontStore with localStorage persistence)
- `hooks/` — Custom hooks wrapping TanStack Query mutations and terminal lifecycle
- `components/` — UI components (Terminal, TerminalTabs, TerminalLayer, AppSidebar, dialogs)
- `pages/` — Route-level pages
- `lib/` — Query client config (`staleTime: 30s`, `retry: 1`) and centralized query keys
- `types.ts` — Shared TypeScript interfaces matching Rust models

**State management:**

- Zustand for client state (terminal tabs per project, font preferences)
- TanStack Query for server state (projects, sessions)
- Query keys centralized in `lib/queryKeys.ts` — always use `queryKeys.projects.all` pattern

**UI Framework:**

- Chakra UI v3 (not v2 — breaking API differences)
- Tailwind CSS v4 (layer imports, not v3 directives)
- `next-themes` for dark/light mode (wrapped in custom ThemeProvider)

### Backend (`/src-tauri`)

Rust application with Tauri 2. Entry: `main.rs` → `lib.rs`.

**Modules:** `project/` (CRUD + slug generation), `pty/` (session lifecycle + output streaming), `db.rs` (SQLite setup), `font.rs` (macOS Core Text font listing), `error.rs` (AppError enum with thiserror).

**Database:** SQLite via Diesel ORM, single connection wrapped in `Arc<Mutex<SqliteConnection>>` (not a pool). Stored at `app_data_dir()/app.db`. Pragmas: WAL journal mode, foreign keys ON. Tables: `projects`, `pty_sessions`, `pty_output_chunks`.

**PTY output streaming:** Background thread reads 4KB chunks → emits Tauri events (`pty-output-{id}`, `pty-exit-{id}`). Separate persistence thread via mpsc channel with 32KB flush buffer. UTF-8 boundary detection prevents partial character output. 1MB cap per session with oldest-chunk pruning.

### IPC Pattern (Frontend ↔ Backend)

1. Define Rust command with `#[tauri::command]` in `*/commands.rs`
2. Register in `lib.rs` via `tauri::generate_handler![]`
3. Create TypeScript wrapper in `src/api/` using `invoke<T>("command_name", { params })`
4. Consume via TanStack Query hook in `src/hooks/` with query invalidation on mutations

Commands are organized by domain: PTY commands (create/write/resize/close/list/history/delete), project commands (create/list/get/update/delete), and `list_system_fonts`.

## Key Patterns

### Terminal Persistence

Terminals never unmount — tab switches and route changes use CSS `display: none` to preserve xterm.js state. The `TerminalLayer` component renders as a persistent absolute-positioned overlay across all routes.

**Session restoration on app start:**

1. Fetch all sessions from DB (including closed ones with scrollback)
2. Create new PTY session with same metadata
3. Pass old `session.id` as `restoreFrom` prop
4. Terminal component fetches history, writes to xterm, then deletes old record

**Session cleanup:** `mark_all_open_sessions_closed()` runs both on startup (orphan cleanup) and on exit (graceful shutdown).

### Zustand Store Convention

```typescript
// Direct access in mutations (outside React):
useTerminalStore.getState().addTab(...)

// Reactive subscriptions in components:
const tabs = useTerminalStore(s => s.projects[id]?.tabs)
```

Only `fontStore` uses persist middleware (localStorage). Terminal store is rebuilt from DB on startup.

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
- **Font listing is macOS-only** (uses `core-text` crate) — needs platform guards for cross-platform
- **Chakra UI v3** has major breaking changes from v2 — always check v3 API when adding components
- **Tailwind v4** uses `@import` and `@custom-variant` syntax, not v3 `@tailwind` directives
- **Directory name generation** uses `pinyin` crate for CJK → romanized slugs — well-tested, don't simplify
