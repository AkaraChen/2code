# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**2code** is a GPUI desktop application for managing code projects with integrated PTY terminals. The shipping UI lives in `src-gpui/` and calls the existing Rust domain crates directly (no Tauri IPC).

- Two windows: main (1440×900 overlay chrome) and Settings (880×640)
- Project management with folder selection and metadata
- Profile management via git worktrees (branch-isolated workspaces)
- Persistent PTY sessions with scrollback restoration (never unmount on tab/route change)
- SQLite database for project/session/profile storage
- Project-level configuration (`2code.json`) for setup/teardown scripts
- Git diff/commit history browsing
- i18n from `messages/en.json` + `messages/zh.json` (loaded directly by GPUI)

The leftover Tauri 2 + React 19 shell in `src/` + `src-tauri/` is **not** the product. Domain crates under `src-tauri/crates/` are shared. Visual/behavior spec: `docs/ui-inventory.md`.

## Commands

```bash
# Product UI (GPUI)
just start                 # same as just gpui
just gpui                  # cd src-gpui && cargo run
cd src-gpui && cargo run

# Tests / gate
just verify                # gpui tests + domain crate tests
just gpui-check            # cd src-gpui && cargo test
cd src-tauri && cargo test
cd src-tauri && cargo test test_name

# Leftover Tauri + React (reference only)
just leftover-tauri
bun run leftover:tauri:dev

# Format
just fmt                   # fama (TS leftover) + rustfmt
```

App data matches the old Tauri path: `dirs::data_dir()/com.akrc.code` (`app.db` + `gpui-prefs.json`).

## Architecture

### Product UI (`/src-gpui`)

Standalone crate (not in the `src-tauri` workspace), bin name `2code`. Stack: `gpui` + `gpui-component`, path-deps on `../src-tauri/crates/{model,repo,infra,service}`.

**Key modules:**

- `main.rs` — window chrome, tracing + debug log channel
- `app.rs` — `AppView` actions, shortcuts, orchestration
- `backend.rs` — direct service/repo calls (no IPC)
- `state.rs` — workspaces, overlays, dialogs, toasts
- `prefs.rs` — `gpui-prefs.json` (theme, fonts, top bar, templates, sidebar)
- `ui/` — sidebar, home, workspace, file tree, terminal, git, settings, dialogs, palette, debug
- `detector/` — agent status manifests (same rules as the leftover React detector)
- `i18n.rs` — `t` / `tf` over `messages/{en,zh}.json`
- `platform.rs` — fonts, sounds, installed apps
- `updater.rs` — GitHub releases + in-place GPUI binary replace

**Windows:** main 1440×900 overlay title bar, macOS traffic lights at (16, 24); Settings via `cx.open_window` 880×640, title `"Settings"`.

**Shortcuts:** Cmd+, settings · Cmd+Shift+D debug · Cmd+K palette · Cmd+T/W terminal · Cmd+E sidebar · Cmd+G git diff · Cmd+S save · Cmd/Ctrl+Enter commit.

**Invariants:**

- Terminals stay mounted: every session keeps a stable `pty-{id}` element. Hide inactive ones; do not omit the id for a frame.
- File tree stays mounted across Files/Git/Notes **and** when the profile sidebar is closed (width 0, not unmount).
- Settings is a second window, not a route.
- Brand text `"2Code"` is hardcoded.

### Domain crates (`/src-tauri/crates`)

No Tauri dependency. Four layers plus models:

1. **Service** — business logic (project, profile, pty, watcher, filesystem)
2. **Repository** — Diesel CRUD; `resolve_context_folder` tries profiles then projects
3. **Infrastructure** — SQLite + migrations, git, PTY, pty_log, slug, config, logger, watcher, shell_init
4. **Model** — Diesel models and DTOs

**Database:** SQLite, single `Arc<Mutex<SqliteConnection>>` (not a pool) at `app_data_dir()/app.db`. WAL, foreign keys ON. Tables: `projects`, `profiles`, `pty_sessions` (metadata only — output bytes live in `pty_logs/{session_id}.log`). Migrations in `src-tauri/migrations/`, embedded at compile time.

**PTY:** `service::pty::create_session` + `PtyContext` + `PtyEventEmitter`. Restore: `mark_all_closed` → fetch sessions → `restore_session` → feed history into vt100 → attach. GPUI renders the vt100 screen; leftover React used xterm.js over a Tauri Channel.

**Workspace crates:** `model/`, `repo/`, `service/`, and `infra/`.

### Leftover Tauri + React (`/src`, `/src-tauri`)

Reference implementation of the old webview UI. Do not add product features there. Do not delete until a real-machine GUI pass against `docs/ui-inventory.md` §20. Default start/release/CI paths are GPUI.

## Key Patterns

### Terminal Persistence

All PTY grids from every workspace stay in one layer with stable `pty-{id}` ids. Tab switches and profile changes hide inactive terminals; they must not be dropped from the element tree.

**Session restoration on app start:**

1. `mark_all_open_sessions_closed()`
2. Fetch sessions (including closed ones with scrollback)
3. `restore_session` with the old id
4. Feed persisted history into vt100, then attach live output

### Context ID Resolution

Git operations accept a project ID or a profile ID. `repo::project::resolve_context_folder()`: profile → worktree path; project → folder.

### Profile System (Git Worktrees)

`git worktree add` into `~/.2code/workspace/{profile_id}` (or the configured worktree dir). Branch names are sanitized (CJK → pinyin). `setup_script` / `teardown_script` from `2code.json` run on create/delete.

### Project Configuration (`2code.json`)

```json
{ "setup_script": ["npm install"], "teardown_script": ["rm -rf node_modules"] }
```

Scripts execute via `sh -c` in the project/worktree directory.

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

Tests are colocated with implementation in `#[cfg(test)]` modules. GPUI unit tests live in `src-gpui/src/**`.

## Internationalization (i18n)

Source messages in `messages/{locale}.json`. GPUI loads them in `src-gpui/src/i18n.rs` (`t` / `tf`). The leftover React shell still uses Paraglide (`src/paraglide/`, gitignored).

**Critical for leftover Paraglide:** `project.inlang/settings.json` **must** include:

```json
"modules": ["https://cdn.jsdelivr.net/npm/@inlang/plugin-message-format@latest/dist/index.js"]
```

## Gotchas

- **Database is single-connection** — acquire/release quickly, never hold across awaits
- **Do not drop `pty-{id}`** — GPUI persistence is by ElementId; omitting an id unmounts the session
- **Do not rustfmt `src-gpui/src/ui/settings.rs` or `dialogs.rs` wholesale** — `settings.rs` has `rustfmt_skip`; both explode under default rustfmt
- Safe rustfmt: `rustfmt --edition 2021 --config hard_tabs=true,tab_spaces=4,max_width=120` on edited files only
- **`ElementId` does not impl `From<String>`** — use `ui::eid(...)` (`SharedString`)
- **`div().overflow_y_scroll()` and `div().tooltip(...)` do not exist** — Button has `.tooltip(String)`
- **`InputState::selected_text` is `pub(super)`** — use `EntityInputHandler::selected_text_range` (UTF-16)
- Font listing / sound playback are platform-backed (core-text / fontdb / XDG / Windows Media)
- Directory/branch slugs use the `pinyin` crate — don't simplify
- Diesel schema `src-tauri/src/schema.rs` is auto-generated — do not edit
- `src/` / `src/generated/` / `src/paraglide/` are leftover React — do not treat as the product UI
- rustc **1.87+**; pin **`cc = "=1.2.67"`** in `src-gpui/Cargo.toml`
