# AGENTS.md — 2code

**Generated:** 2026-04-09 | **Branch:** cursor/gpui-rewrite-ee3c

## OVERVIEW
GPUI desktop app for managing code projects with integrated PTY terminals. Product UI is `src-gpui/` calling Rust domain crates directly. Leftover Tauri 2 + React 19 in `src/` / `src-tauri/` is reference only. SQLite via Diesel.

## STRUCTURE
```
2code/
├── src-gpui/                   # GPUI product UI (bin: 2code)
│   └── src/ui/                 # sidebar home workspace tree terminal git settings dialogs
├── src-tauri/
│   ├── crates/infra/src/       # DB, PTY, git, shell init, watcher, logger, slug
│   ├── crates/service/src/     # Business logic: project, profile, pty, watcher
│   ├── crates/repo/src/        # Diesel CRUD: project, profile, pty
│   ├── crates/model/src/       # DTOs, Diesel models, error types
│   ├── src/handler/            # Leftover Tauri #[tauri::command] entry points
│   └── migrations/             # Diesel SQL migrations (embedded at compile time)
├── src/                        # Leftover React 19 + Vite frontend (not shipping)
├── messages/                   # i18n source: en.json zh.json (GPUI loads these)
├── docs/ui-inventory.md        # Visual/behavior rewrite spec
└── justfile                    # start / gpui / verify / leftover-tauri
```

## WHERE TO LOOK

| Task | Location |
|------|----------|
| Product window / actions | `src-gpui/src/app.rs` + `src-gpui/src/main.rs` |
| Call domain services | `src-gpui/src/backend.rs` (no IPC) |
| Terminal tabs / PTY grid | `src-gpui/src/ui/terminal.rs` + `src-gpui/src/state.rs` |
| File tree / icons | `src-gpui/src/ui/file_tree.rs` + `file_icons.rs` |
| Settings window | `src-gpui/src/ui/settings.rs` |
| i18n | `messages/en.json` + `zh.json` → `src-gpui/src/i18n.rs` |
| Agent status detection | `src-gpui/src/detector/` |
| PTY session lifecycle | `src-tauri/crates/infra/src/pty.rs` + `crates/service/src/pty.rs` |
| DB migrations | `src-tauri/migrations/` (Diesel; auto-applied on startup) |
| Git operations | `src-tauri/crates/infra/src/git.rs` |
| Context ID resolution | `crates/repo/src/project.rs::resolve_context_folder` |
| Worktree profiles | `crates/service/src/profile.rs` — creates `~/.2code/workspace/{id}` |
| Shell init injection | `infra/shell_init.rs` (ZDOTDIR-based) |
| Leftover Tauri command | `src-tauri/src/handler/*.rs` — do not add product features here |

## COMMANDS
```bash
just start                       # GPUI product UI
just gpui                        # cd src-gpui && cargo run
just verify                      # cargo test (GPUI) + cargo test (domain)
just leftover-tauri              # leftover webview shell only
cd src-tauri && cargo test       # domain crate tests
just fmt                         # format leftover TS + Rust
```

## STATE PATTERNS
- **GPUI**: `AppView` + `AppData` / `Overlay` in `state.rs`; prefs in `gpui-prefs.json`
- **Domain**: Diesel via `Backend` (single SQLite mutex)
- **Leftover React**: TanStack Query + Zustand — do not extend for product work

## KEY PATTERNS
- **No IPC in the product UI**: GPUI calls `service::*` / `repo::*` on the same process
- **Terminal persistence**: keep every `pty-{id}` mounted; hide inactive sessions
- **Context ID**: git accepts project ID or profile ID — `resolve_context_folder`
- **Rust test setup**: in-memory SQLite + `conn.run_pending_migrations(MIGRATIONS)`
- **DB lock**: single `Arc<Mutex<SqliteConnection>>` — acquire/release quickly

## ANTI-PATTERNS
- Treating `src/` React or `bun tauri dev` as the product
- Dropping `pty-{id}` from the element tree (GPUI unmounts the session)
- Unmounting the file tree when the profile sidebar closes (use width 0)
- Opening Settings as a route instead of a second window
- Wholesale rustfmt of `src-gpui/src/ui/settings.rs` or `dialogs.rs`
- Editing `src-tauri/src/schema.rs` (Diesel generated)
- Long-held DB mutex locks

## GOTCHAS
- rustc 1.87+; `cc = "=1.2.67"` pin in `src-gpui/Cargo.toml`
- `ElementId` via `ui::eid(...)` (`SharedString`), not `From<String>`
- Safe rustfmt: `--edition 2021 --config hard_tabs=true,tab_spaces=4,max_width=120`
- Font listing / sound APIs are platform-backed
- CI product gate: `.github/workflows/gpui-check.yml` (`cargo test` in `src-gpui`)
- Release ships GPUI binaries (`2code-linux-x64` / `2code-macos-arm64` / `2code-windows-x64.exe`)
- Leftover `tauri-smoke.yml` is workflow_dispatch / workflow_call only
- `openspec/` dir at root is OpenSpec workflow tooling — not application code
