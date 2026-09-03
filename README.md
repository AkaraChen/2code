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

- **Desktop shell**: Zed GPUI + [gpui-component](https://github.com/longbridge/gpui-component) native widgets
- **Legacy shell**: Tauri 2 + React 19 (kept for existing tests)
- **Backend**: Rust workspace (`model` / `repo` / `service` / `infra`)
- **Database**: SQLite via Diesel migrations
- **Terminal runtime**: integrated PTY service
- **Package manager**: Bun (legacy frontend) + Cargo (native app)

## Getting Started

### Prerequisites

- macOS
- Bun
- Rust stable toolchain
- Tauri 2 development prerequisites
- `just` for development helper commands
- `fama` on `PATH` for `just fmt` TypeScript formatting

### Install dependencies

```bash
bun install
```

### Run the native GPUI app

```bash
cd src-tauri && cargo run
# or
bun start
```

This opens the 2code workstation as a native GPUI window. The process is GPUI — there is no webview.

### Run the legacy Tauri/React shell

```bash
cargo run --manifest-path src-tauri/Cargo.toml --features legacy-tauri
# or
bun tauri:dev
```

### Run only the legacy frontend

```bash
bun run dev
```

### Build the native app

```bash
cd src-tauri && cargo build -p gpui-app --release
```

## Useful Commands

| Command | Description |
| --- | --- |
| `cargo run -p gpui-app` | Run the native GPUI desktop app |
| `bun tauri dev` | Run the legacy Tauri/React desktop shell |
| `bun run dev` | Run the Vite frontend only |
| `bun tauri build` | Build the production desktop app |
| `cd src-tauri && cargo test` | Run Rust tests |
| `cargo tauri-typegen generate` | Regenerate frontend IPC bindings after Rust command changes |
| `just fmt` | Format TypeScript and Rust |
| `just coverage` | Generate Rust coverage report |

## Project Structure

```text
2code/
├── src/                        # React + Vite frontend
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
│   ├── crates/gpui-app/        # Native GPUI desktop shell
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
