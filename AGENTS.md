# AGENTS.md — 2code

**Generated:** 2026-04-09 | **Commit:** 93661da | **Branch:** dev

## OVERVIEW
Tauri 2 desktop app for managing code projects with integrated PTY terminals. React 19 + TS frontend, Rust workspace backend, SQLite via Diesel.

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
│   ├── crates/infra/src/       # DB, PTY, git, shell init, watcher, logger, slug, helper
│   ├── crates/service/src/     # Business logic: project, profile, pty, watcher
│   ├── crates/repo/src/        # Diesel CRUD: project, profile, pty
│   ├── crates/model/src/       # DTOs, Diesel models, error types
│   ├── bins/2code-helper/src/  # CLI sidecar for PTY notifications
│   └── migrations/             # Diesel SQL migrations (embedded at compile time)
├── messages/                   # i18n source: en.json zh.json
└── justfile                    # Build helpers: build-helper, coverage, fmt
```

## WHERE TO LOOK

| Task | Location |
|------|----------|
| Add Tauri command | `src-tauri/src/handler/*.rs` → register in `lib.rs` → run `cargo tauri-typegen generate` |
| Consume IPC in frontend | Import from `@/generated` → wrap in TanStack Query hook |
| Query keys | `src/shared/lib/queryKeys.ts` — always use this, never inline strings |
| Terminal tabs/state | `src/features/terminal/store.ts` (Zustand + Immer) |
| PTY session lifecycle | `src-tauri/crates/infra/src/pty.rs` + `crates/service/src/pty.rs` |
| DB migrations | `src-tauri/migrations/` (Diesel; auto-applied on startup) |
| Git operations | `src-tauri/crates/infra/src/git.rs` + `src-tauri/src/handler/debug.rs` |
| Context ID resolution | `crates/repo/src/project.rs::resolve_context_folder` (polymorphic project/profile) |
| Worktree profiles | `crates/service/src/profile.rs` — creates `~/.2code/workspace/{id}` |
| Notification pipeline | `infra/helper.rs` → Axum server → `pty-notify` Tauri event → terminalStore |
| i18n messages | `messages/en.json` + `messages/zh.json` → `import * as m from "@/paraglide/messages.js"` |
| Shell init injection | `infra/shell_init.rs` (ZDOTDIR-based) |

## COMMANDS
```bash
bun tauri dev                    # full dev (frontend + Rust hot reload)
bun run dev                      # frontend only
bun tauri build                  # production build
cd src-tauri && cargo test       # Rust tests
cargo tauri-typegen generate     # regenerate src/generated/ after Rust command changes
just build-helper                # compile CLI sidecar (release)
just build-helper-dev            # compile CLI sidecar (debug)
just fmt                         # format TS + Rust
just coverage                    # llvm-cov HTML report
```

## STATE PATTERNS
- **Server state**: TanStack Query — always invalidate on mutations
- **Client state**: Zustand with Immer — terminal store uses `Set` (requires `enableMapSet()`)
- **Persist**: `terminalSettingsStore`, `notificationStore`, `themeStore` use localStorage via `persist` middleware
- **Outside React**: `useTerminalStore.getState().addTab(...)` (direct access, no hook)

## KEY PATTERNS
- **IPC flow**: Rust `#[tauri::command]` → `tauri-typegen` → `src/generated/` → TanStack Query hook
- **Terminal persistence**: CSS `display: none` on tab switch — NEVER unmount or conditionally render terminals
- **Context ID**: git handlers accept project ID or profile ID — backend resolves via `resolve_context_folder`
- **Rust test setup**: in-memory SQLite + `conn.run_pending_migrations(MIGRATIONS)` in `setup_db()`
- **DB lock**: single `Arc<Mutex<SqliteConnection>>` — acquire/release quickly, never hold across awaits

## ANTI-PATTERNS
- `src/api/` — forbidden; all IPC via `src/generated/` auto-gen
- `src/generated/` or `src/paraglide/` — DO NOT EDIT (gitignored, regenerated)
- `src-tauri/src/schema.rs` — DO NOT EDIT (Diesel generated)
- Conditional rendering of `<Terminal>` — breaks xterm.js state
- Chakra UI v2 API — project uses v3 (breaking changes)
- Long-held DB mutex locks — causes deadlocks
- Font listing / sound APIs without macOS platform guard (macOS-only)

## GOTCHAS
- `src-tauri/src/main.rs:1` — `#![cfg_attr(…, windows_subsystem = "windows")]` has `DO NOT REMOVE!!`
- `topbar` feature is NOT part of `git` feature despite CLAUDE.md proximity — it's a separate customizable control bar system
- Immer `MapSet` plugin must be enabled before any store using `Set`/`Map` (already done in `store.ts`)
- `noUnusedLocals` + `noUnusedParameters` enforced in tsconfig — TS will error on unused vars
- No CI/CD pipelines (no `.github/workflows/`)
- Frontend uses Vitest (`npm test` = `vitest run`); test files colocated as `*.test.ts` — Zustand store tests use `resetStore()` helper pattern
- ESLint uses `@antfu/eslint-config` with React — no `.eslintrc` file, config is in `package.json` or similar
- `openspec/` dir at root is OpenSpec workflow tooling — not application code
- `src-tauri/src/bridge.rs` — trait impls (`TauriPtyEmitter`, `TauriWatchSender`) that decouple service layer from Tauri; `helper.rs` manages sidecar port/path state
