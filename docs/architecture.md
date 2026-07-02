# Architecture

## Architecture Diagram

```mermaid
graph TD
    subgraph Frontend ["Frontend (React 19 + Vite)"]
        App[App.tsx<br/>Routes + Layout]
        TQ[TanStack Query<br/>Server State]
        ZS[Zustand Stores<br/>Client State]
        XT[xterm.js<br/>Terminal Emulator]
        Gen[generated/<br/>IPC Bindings]
    end

    subgraph Backend ["Backend (Rust + Tauri 2)"]
        H[Handler Layer<br/>Tauri Commands]
        S[Service Layer<br/>Business Logic]
        R[Repo Layer<br/>Diesel ORM]
        I[Infrastructure<br/>PTY, Git, DB, FS]
    end

    subgraph External ["External"]
        DB[(SQLite)]
        FS[File System]
        Git[Git CLI]
        Shell[User Shell<br/>zsh/bash]
    end

    App --> Gen
    Gen -->|IPC| H
    H --> S
    S --> R
    S --> I
    R --> DB
    I -->|portable-pty| Shell
    I -->|git commands| Git
    I -->|notify crate| FS
    I -->|per-session Channel<ArrayBuffer>| XT
    XT -->|agent status| ZS
```

## Architecture Pattern

**Layered architecture** with 4 backend layers and a feature-based frontend. The backend enforces strict dependency direction: Handler → Service → Repo/Infrastructure. The frontend uses feature modules with co-located hooks, components, and stores.

## Backend Layers

### 1. Handler (`src-tauri/src/handler/`)

Tauri `#[tauri::command]` entry points. Extracts managed state (`DbPool`, `PtySessionMap`), acquires DB lock, delegates to service layer. No business logic.

| File         | Commands                                                                                                                                                                          |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `project.rs` | `create_project_from_folder`, `list_projects`, `update_project`, `delete_project`, `get_git_branch`, `get_git_diff`, `get_git_log`, `get_commit_diff` |
| `pty.rs`     | `create_pty_session`, `write_to_pty`, `resize_pty`, `close_pty_session`, `list_project_sessions`, `get_pty_session_history`, `delete_pty_session_record`                          |
| `profile.rs` | `create_profile`, `delete_profile`                                                                                                                                                |
| `watcher.rs` | `watch_projects`                                                                                                                                                                  |
| `font.rs`    | `list_system_fonts`                                                                                                                                                               |
| `sound.rs`   | `list_system_sounds`, `play_system_sound`                                                                                                                                         |
| `debug.rs`   | `start_debug_log`, `stop_debug_log`                                                                                                                                               |

### 2. Service (`src-tauri/crates/service/`)

Business logic and orchestration. Coordinates between repo and infrastructure layers.

| File         | Responsibility                                                                                                         |
| ------------ | ---------------------------------------------------------------------------------------------------------------------- |
| `project.rs` | Project CRUD, git branch/diff/log resolution via context ID                                                            |
| `profile.rs` | Profile creation (git worktree + setup script), deletion (teardown + cleanup), branch name sanitization                |
| `pty.rs`     | Session lifecycle, read loop, output persistence to per-session log files, orphan-log GC, session cleanup             |
| `watcher.rs` | File system watch orchestration                                                                                        |

### 3. Repository (`src-tauri/crates/repo/`)

Direct database access via Diesel ORM. Pure CRUD plus composite queries.

| File         | Responsibility                                                                             |
| ------------ | ------------------------------------------------------------------------------------------ |
| `project.rs` | Project CRUD, `resolve_context_folder()` (profile ID → worktree path, project ID → folder) |
| `profile.rs` | Profile CRUD, project folder lookup                                                        |
| `pty.rs`     | Session metadata CRUD (insert/list/dimensions/mark-closed/delete); output bytes live in files via `infra::pty_log` |

### 4. Infrastructure (`src-tauri/crates/infra/`)

Cross-cutting concerns and external system integrations.

| File            | Responsibility                                                                                               |
| --------------- | ------------------------------------------------------------------------------------------------------------ |
| `db.rs`         | SQLite init, WAL + FK pragmas, embedded migrations. Type: `DbPool = Arc<Mutex<SqliteConnection>>`            |
| `pty.rs`        | PTY session map, `create_session()` / `write_to_pty()` / `resize_pty()` / `close_session()` via portable-pty |
| `pty_log.rs`    | Per-session output log files: append/read/clear/remove plus startup orphan GC                               |
| `git.rs`        | Git CLI execution: branch, diff, log, show. Commit parsing, shortstat parsing                                |
| `shell_init.rs` | Prepares ZDOTDIR temp directory with `.zshenv` for shell init script injection                               |
| `filesystem.rs` | File-tree operations: list/rename/move/delete/create/search with worktree containment                        |
| `config.rs`     | Loads `2code.json` project config, executes setup/teardown scripts                                           |
| `no_window.rs`  | No-window label helper for startup/background flows                                                          |
| `slug.rs`       | CJK-aware slug generation (pinyin crate)                                                                     |
| `logger.rs`     | Tracing channel layer for debug log streaming                                                                |
| `watcher.rs`    | File system watching via `notify` crate, shutdown flag                                                       |

## Frontend Architecture

### Provider Stack (`src/main.tsx`)

```
QueryClientProvider → ThemeProvider → TooltipProvider → BrowserRouter → AppRoot
```

### Routing (`src/App.tsx`)

| Path                                | Component           |
| ----------------------------------- | ------------------- |
| `/`                                 | `HomePage`          |
| `/projects/:id/profiles/:profileId` | `ProjectDetailPage` |
| `/settings`                         | `SettingsPage`      |
| `*`                                 | Redirect to `/`     |

### State Management

| Store                 | Type              | Location                                            | Persistence                       |
| --------------------- | ----------------- | --------------------------------------------------- | --------------------------------- |
| Terminal tabs         | Zustand + immer   | `features/terminal/store.ts`                        | Rebuilt from DB on startup        |
| Terminal settings     | Zustand + persist | `features/settings/stores/terminalSettingsStore.ts` | localStorage                      |
| Notification settings | Zustand + persist | `features/settings/stores/notificationStore.ts`     | localStorage + tauri-plugin-store |
| Theme settings        | Zustand + persist | `features/settings/stores/themeStore.ts`            | localStorage                      |
| Debug panel           | Zustand           | `features/debug/debugStore.ts`                      | None                              |
| Debug logs            | Zustand           | `features/debug/debugLogStore.ts`                   | None                              |
| Server data           | TanStack Query    | `shared/lib/queryClient.ts`                         | None (refetched)                  |

### Terminal Architecture

Terminals never unmount. `TerminalLayer` (`features/terminal/TerminalLayer.tsx`) renders as a persistent absolute-positioned overlay. Tab switches use CSS `display: none` to preserve xterm.js state. Each terminal instance wraps xterm.js and receives live PTY output over a per-session Tauri channel (`Channel<ArrayBuffer>`); session exit remains a Tauri event (`pty-exit-{id}`).

## Workspace Crates

```
src-tauri/
├── Cargo.toml          # workspace root
├── crates/
│   ├── infra/          # DB, PTY, logs, git, filesystem, watcher, config
│   ├── model/          # DTOs, Diesel models, error types
│   ├── repo/           # Diesel repositories
│   └── service/        # Business logic
└── src/                # Tauri app shell, handlers, bridge implementations
```

## Design Decisions

| Decision                                | Rationale                                                                                   |
| --------------------------------------- | ------------------------------------------------------------------------------------------- |
| Single SQLite connection (`Arc<Mutex>`) | Desktop app with single user; pool overhead unnecessary                                     |
| CSS display for terminal visibility     | xterm.js loses state on unmount; display toggle preserves it                                |
| tauri-typegen for IPC bindings          | Eliminates manual TS wrappers, type-safe end-to-end                                         |
| Frontend-driven agent notifications     | Terminal output detection owns running/waiting state; waiting transitions can play the configured system sound |
| ZDOTDIR injection for shell init        | Non-destructive way to inject init scripts into zsh without modifying user dotfiles         |
| immer `enableMapSet()`                  | Terminal store uses `Set<string>` for notification tracking; requires explicit immer plugin |
| Feature-based frontend structure        | Co-locates hooks, components, and stores per domain for cohesion                            |
