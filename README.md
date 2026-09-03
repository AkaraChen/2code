# 2code

Desktop software for vibe coding.

2code is a desktop workstation where terminals, AI coding agents, Git, and worktree-based project lanes live together. It is built for developers who want to stay inside one calm coding workspace instead of spreading a session across terminal windows, Git tools, editors, and agent panes.

> 2code is still early and under active construction. macOS is the primary supported platform; Windows and Linux builds are still experimental.

## Install 2code

### macOS

```bash
brew install --cask akarachen/tap/2code
```

If you install from the DMG and macOS blocks opening the app, move `2code.app` to Applications and remove the quarantine attribute:

```bash
sudo xattr -dr com.apple.quarantine /Applications/2code.app
```

Windows and Linux support is still experimental.

## Why 2code

AI-assisted development creates more parallel state than a normal coding session: long-running commands, multiple agents, branch experiments, diffs to review, and half-finished ideas that should not be lost when attention shifts.

2code treats that state as the primary interface. Terminals are persistent work surfaces, Git state stays close to the task, and each feature can live in its own isolated profile with its own worktree and terminal context.

## Features

- **Persistent terminals**: keep shell sessions, scrollback, and terminal layout close to where you left them.
- **Git visibility**: review diffs, staged changes, history, and shipping state without leaving the workstation.
- **Worktree profiles**: split features, bugfixes, and experiments into isolated lanes backed by Git worktrees.
- **Project management**: organize local code projects and launch focused workspaces quickly.
- **Agent status awareness**: detect running/waiting agent state from terminal output, titles, and progress sequences.
- **Localized UI**: i18n message sources live in `messages/` and are generated into the frontend.

## Tech Stack

- **Desktop shell**: GPUI + gpui-component (`src-gpui/`) — this is the current product UI
- **Domain backend**: Rust workspace crates in `src-tauri/crates/` (model, repo, service, infra)
- **Database**: SQLite via Diesel migrations
- **Terminal runtime**: integrated PTY service + vt100
- **Legacy reference shell**: Tauri 2 + React 19 (kept in `src/` / `src-tauri/` while the GPUI rewrite lands)

## Getting Started

### Prerequisites

- Rust 1.87+ (GPUI)
- `just` for development helper commands
- On Linux: `libxkbcommon`, Vulkan, and Wayland/X11 development libraries
- The previous Tauri + React shell also needs Bun and Tauri 2 if you still run that path

### Run the desktop app

```bash
just start
# or
just gpui
# or
cd src-gpui && cargo run
```

The GPUI app uses the same SQLite database as the old Tauri shell: `$XDG_DATA_HOME/com.akrc.code/app.db` (or the platform equivalent). Preferences live in `gpui-prefs.json` next to the DB.

### Legacy Tauri + React shell

```bash
bun install
bun tauri dev
```

### Build

```bash
cd src-gpui && cargo build --release
```

The legacy Tauri bundle is still `bun tauri build`.

## Useful Commands

| Command | Description |
| --- | --- |
| `just start` / `./start.sh` | Run the GPUI desktop app |
| `just gpui` | Run the GPUI desktop app |
| `just gpui-check` | Type-check the GPUI crate |
| `cd src-tauri && cargo test` | Run Rust domain tests |
| `just fmt` | Format TypeScript and Rust |
| `just coverage` | Generate Rust coverage report |
| `bun tauri dev` | Run the legacy Tauri + React shell |

## Project Structure

```text
2code/
├── src-gpui/                   # GPUI native desktop shell (primary)
├── src/                        # Legacy React + Vite frontend
│   ├── features/               # Feature-first app modules
│   ├── shared/                 # Shared lib, providers, components, hooks
│   ├── layout/                 # App shell and sidebar
│   ├── generated/              # Generated Tauri IPC bindings
│   └── paraglide/              # Generated i18n messages
├── src-tauri/
│   ├── src/handler/            # Tauri command entry points
│   ├── crates/infra/           # DB, PTY, Git, watcher infrastructure
│   ├── crates/service/         # Business logic
│   ├── crates/repo/            # Diesel repositories
│   ├── crates/model/           # DTOs, Diesel models, error types
│   └── migrations/             # Embedded Diesel migrations
├── messages/                   # i18n source messages
└── justfile                    # Development helper commands
```

## Development Notes

- Add Tauri commands in `src-tauri/src/handler/*.rs`, register them in `src-tauri/src/lib.rs`, then run `cargo tauri-typegen generate`.
- Consume IPC from `src/generated/`; do not hand-write frontend API clients for Tauri commands.
- Use `src/shared/lib/queryKeys.ts` for TanStack Query keys.
- Keep terminal components mounted. Terminal tab switching should hide inactive terminals with CSS instead of unmounting them.
- Database access uses a single `Arc<Mutex<SqliteConnection>>`; keep lock scopes short and never hold the lock across `await`.
- Diesel migrations in `src-tauri/migrations/` are embedded and applied on startup.
- Worktree profiles are created under `~/.2code/workspace/{id}`.

## Links

- Website: <https://2code.akr.moe/>
- Repository: <https://github.com/akarachen/2code>
- Latest release: <https://github.com/akarachen/2code/releases/latest>
