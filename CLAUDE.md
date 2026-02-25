# CLAUDE.md

This file provides guidance to Claude Code when working in this repository.

## Doc Index (Monorepo)

Use the root doc for cross-cutting workflows; use child docs for crate/package-specific details.

- `src-tauri/CLAUDE.md`
- `src-tauri/bins/2code-helper/CLAUDE.md`
- `src-tauri/crates/acp-client/CLAUDE.md`
- `src-tauri/crates/agent/CLAUDE.md`
- `src-tauri/crates/infra/CLAUDE.md`
- `src-tauri/crates/model/CLAUDE.md`
- `src-tauri/crates/repo/CLAUDE.md`
- `src-tauri/crates/service/CLAUDE.md`

## Project Overview

`2code` is a Tauri 2 desktop app for project/worktree management with persistent terminal sessions and integrated AI agent sessions.

- Frontend: React 19 + TypeScript + Vite + Chakra UI v3
- Backend: Rust + Tauri 2 + Diesel (SQLite)
- Core domains: projects/profiles (git worktrees), PTY terminals, git diff/history, AI agent sessions (ACP), snippets/skills/marketplace
- i18n: Paraglide.js (English + Chinese)

## Common Commands

### App development

- `bun tauri dev` — run full app (frontend + backend hot reload)
- `bun run dev` — run frontend only (Vite)
- `bun tauri build` — production desktop build
- `bun run build` — frontend build (`paraglide compile -> tsc -> vite build`)

### Frontend quality checks

- `bun run lint` — ESLint with autofix
- `bun run typecheck` — TypeScript check (`tsc --noEmit`)
- `bun run test` — run Vitest once
- `bun run test -- path/to/file.test.ts` — run a single Vitest file
- `bun run test -- -t "test name"` — run a specific Vitest test

### Rust / workspace

- `cd src-tauri && cargo test` — run all Rust tests
- `cd src-tauri && cargo test test_name` — run a single Rust test by name
- `just fmt` — format project (`nr lint`, `fama`, `cargo fmt`)
- `just typegen` — regenerate Tauri TS bindings and patch known tauri-typegen import issues
- `just build-helper` — build sidecar CLI (`2code-helper`, release)
- `just build-helper-dev` — build sidecar CLI (`2code-helper`, debug)
- `just coverage` / `just coverage-summary` — Rust coverage reports

## Architecture (High-Level)

### Frontend (`src/`)

Feature-oriented React app with Suspense-first data loading.

- App/provider stack in `src/main.tsx`: `QueryClientProvider -> ChakraProvider -> ThemeProvider -> BrowserRouter -> App`
- Routing in `src/App.tsx`: home, project detail, settings, assets, catch-all redirect
- Server state: TanStack Query (`useSuspenseQuery` is the default convention)
- Client state: Zustand stores (tabs, settings, notifications, debug, topbar)
- Backend IPC calls come from generated bindings in `src/generated/` (do not hand-roll API wrappers)
- Terminal UI is rendered in a persistent `TerminalLayer` so terminal instances survive route changes

### Backend (`src-tauri/`)

Tauri entrypoint is `src-tauri/src/main.rs`, which calls `code_lib::run()` in `src-tauri/src/lib.rs`.

Layering used across app and workspace crates:

1. **handler**: `#[tauri::command]` boundaries (thin)
2. **bridge**: Tauri-specific adapters to service traits
3. **service**: business orchestration
4. **repo**: Diesel DB access
5. **infra**: PTY, git, config scripts, db init/migrations, watcher, logging, helper server

Workspace crates under `src-tauri/crates/`:

- `model`, `repo`, `service`, `infra`, `agent`, `acp-client`
- Sidecar binary: `src-tauri/bins/2code-helper`

## Critical Flows and Invariants

- **Type-safe IPC**: Rust commands are exported via `tauri-typegen` to `src/generated/`; after command changes, run `just typegen`.
- **Terminal persistence**: terminals are hidden/shown with CSS (`display: none`) instead of unmounting to preserve xterm state and session continuity.
- **Startup/exit session hygiene**: backend marks orphaned PTY/agent sessions closed/destroyed on startup and again on exit.
- **Context ID polymorphism**: git operations accept project ID or profile ID; backend resolves to the correct folder/worktree.
- **Profile worktrees**: profiles map to git worktrees in `~/.2code/workspace/{profile_id}`; setup/teardown scripts run from project config.
- **Notification sidecar**: `2code-helper` talks to backend helper HTTP endpoint for PTY notifications.

## Data and Persistence

- SQLite DB is initialized in `infra::db::init_db`, with embedded Diesel migrations from `src-tauri/migrations/`.
- DB handle is a single `Arc<Mutex<SqliteConnection>>` (not a pool): avoid long-held locks.
- PTY output is streamed and persisted with UTF-8 boundary protection; scrollback restore depends on this behavior.

## i18n and Build-Time Constraints

- Paraglide generated output lives in `src/paraglide/` (generated, do not hand-edit).
- `project.inlang/settings.json` must include the message-format plugin module.
- `tsconfig.json` requires `allowJs: true` for generated Paraglide JS typings.
- `@/` path alias must stay aligned between `tsconfig.json` and `vite.config.ts`.

## Practical Guardrails

- Chakra UI is **v3**; verify API usage against v3 docs.
- Keep generated files generated: `src/generated/`, `src/paraglide/`, and Diesel schema outputs should not be manually maintained.
- When changing terminal/session behavior, preserve existing restoration and lifecycle assumptions (persistent layer + startup/exit cleanup).
