# AGENTS.md — 2code

**Generated:** 2026-04-09 | **Commit:** 93661da | **Branch:** dev

## OVERVIEW
Tauri 2 desktop app for managing code projects with integrated Herdr terminals. React 19 + TS frontend, Rust workspace backend, SQLite via Diesel. Herdr (pinned v0.9.0) is the profile/session authority; sqlite stores `projects` / `project_groups` / `checkout_notes`.

## STRUCTURE
```
2code/
├── src/                        # React 19 + Vite frontend
│   ├── features/               # Feature-first: debug git home profiles projects settings terminal topbar watcher
│   ├── shared/                 # lib/ providers/ components/ hooks/
│   ├── layout/                 # AppSidebar + sidebar/ sub-components
│   ├── generated/              # AUTO-GENERATED Tauri IPC bindings (DO NOT EDIT, gitignored)
│   └── paraglide/              # AUTO-GENERATED i18n messages (DO NOT EDIT, gitignored)
├── src-tauri/
│   ├── src/handler/            # #[tauri::command] entry points (8 files)
│   ├── crates/infra/src/       # DB, Herdr sidecar/transport, git, watcher, logger, slug
│   ├── crates/service/src/     # Business logic: project, profile, RuntimeRouter, watcher
│   ├── crates/repo/src/        # Diesel CRUD: project, project_group, checkout_notes
│   ├── crates/model/src/       # DTOs, Diesel models, error types
│   └── migrations/             # Diesel SQL migrations (embedded at compile time)
├── messages/                   # i18n source: en.json zh.json
└── justfile                    # Build helpers: coverage, fmt
```

## WHERE TO LOOK

| Task | Location |
|------|----------|
| Add Tauri command | `src-tauri/src/handler/*.rs` → register in `lib.rs` → run `cargo tauri-typegen generate` |
| Consume IPC in frontend | Import from `@/generated` → wrap in TanStack Query hook |
| Query keys | `src/shared/lib/queryKeys.ts` — always use this, never inline strings |
| Terminal tabs/state | `src/features/terminal/store.ts` (Zustand + Immer) |
| Session lifecycle | `src-tauri/crates/service/src/runtime.rs` + `runtime/herdr.rs` (live `pane_id`) |
| DB migrations | `src-tauri/migrations/` (Diesel; auto-applied on startup) |
| Git operations | `src-tauri/crates/infra/src/git.rs` + `src-tauri/src/handler/project.rs` |
| Checkout path resolution | `crates/service/src/project.rs::reconcile_profile_checkout` (live Herdr cwd) |
| Worktree profiles | `crates/service/src/profile.rs` — Herdr `worktree.create` / `workspace.create`; id = `workspace_id` |
| Agent status detection | `src/features/terminal/detector/` → `Terminal.tsx` → terminalStore |
| i18n messages | `messages/en.json` + `messages/zh.json` → `import * as m from "@/paraglide/messages.js"` |
| Herdr sidecar | `infra::herdr` + `scripts/herdr-sidecar.mjs` (pinned v0.9.0) |

## COMMANDS
```bash
bun tauri dev                    # full dev (frontend + Rust hot reload)
bun run dev                      # frontend only
bun tauri build                  # production build
cd src-tauri && cargo test       # Rust tests
cargo tauri-typegen generate     # regenerate src/generated/ after Rust command changes
just fmt                         # format TS + Rust
just coverage                    # llvm-cov HTML report
```

## STATE PATTERNS
- **Server state**: TanStack Query — always invalidate on mutations
- **Client state**: Zustand with Immer/mutative — terminal tabs and agent status live in `terminalStore`
- **Persist**: `terminalSettingsStore`, `notificationStore`, `themeStore` use localStorage via `persist` middleware
- **Outside React**: `useTerminalStore.getState().addTab(...)` (direct access, no hook)

## KEY PATTERNS
- **IPC flow**: Rust `#[tauri::command]` → `tauri-typegen` → `src/generated/` → TanStack Query hook
- **Terminal persistence**: CSS `display: none` on tab switch — NEVER unmount or conditionally render terminals
- **Checkout path**: git handlers accept a Herdr `workspace_id` (`profile_id`) — backend uses `reconcile_profile_checkout` (live cwd)
- **Rust test setup**: in-memory SQLite + `conn.run_pending_migrations(MIGRATIONS)` in `setup_db()`
- **DB lock**: single `Arc<Mutex<SqliteConnection>>` — acquire/release quickly, never hold across awaits

## ANTI-PATTERNS
- `src/api/` — forbidden; all IPC via `src/generated/` auto-gen
- `src/generated/` or `src/paraglide/` — DO NOT EDIT (gitignored, regenerated)
- `src-tauri/src/schema.rs` / `crates/model/src/schema.rs` — DO NOT EDIT (Diesel generated)
- Conditional rendering of `<Terminal>` — breaks xterm.js state
- Legacy UI-library APIs/components — removed; use shadcn/ui primitives from `src/components/ui`
- Long-held DB mutex locks — causes deadlocks
- Reintroducing Local PTY, `TWOCODE_RUNTIME`, or sqlite `profiles` as authority

## GOTCHAS
- `src-tauri/src/main.rs:1` — `#![cfg_attr(…, windows_subsystem = "windows")]` has `DO NOT REMOVE!!`
- `topbar` feature is NOT part of `git` feature despite CLAUDE.md proximity — it's a separate customizable control bar system
- `noUnusedLocals` + `noUnusedParameters` enforced in tsconfig — TS will error on unused vars
- CI: `.github/workflows/tauri-smoke.yml` — smoke test on `ubuntu-24.04` using `xvfb-run` (virtual display) + `webkit2gtk-driver` + Tauri driver. Not a full test suite.
- E2E: `e2e-tests/` uses Mocha + Selenium WebDriver via Tauri driver (not Playwright/Cypress)
- Frontend uses Vitest (`npm test` = `vitest run`); test files colocated as `*.test.ts` — Zustand store tests use `resetStore()` helper pattern
- ESLint uses `@antfu/eslint-config` with React flat config — configuration lives in `eslint.config.js` at the repo root
- `openspec/` dir at root is OpenSpec workflow tooling — not application code
- `src-tauri/src/bridge.rs` — trait impls (`TauriWatchSender`, `build_runtime`) that decouple service from Tauri
