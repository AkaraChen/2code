# 2code Architecture Documentation

> Auto-generated structural documentation.

## Overview

**2code** is a Tauri 2 desktop application for managing code projects with integrated persistent terminal sessions. It combines a React 19 + TypeScript frontend with a Rust backend, using SQLite for persistence, xterm.js for terminal emulation, and git worktrees for branch-isolated workspaces (called "profiles"). The app targets macOS with a native title bar overlay and system font/sound integration.

The architecture follows a clean separation: the frontend handles UI rendering, client state, and server-state caching via TanStack Query, while the Rust backend owns all business logic, database access, PTY lifecycle, and git operations. Communication between layers uses Tauri's IPC invoke mechanism with auto-generated TypeScript bindings via `tauri-typegen`.

## Tech Stack

| Layer            | Technology                                     |
| ---------------- | ---------------------------------------------- |
| Frontend         | React 19, TypeScript, Vite 7                   |
| UI Framework     | Chakra UI v3, next-themes                      |
| State Management | Zustand 5 (client), TanStack Query v5 (server) |
| Terminal         | xterm.js 6, @xterm/addon-fit                   |
| Backend          | Rust (2021 edition), Tauri 2                   |
| Database         | SQLite (Diesel ORM 2, embedded migrations)     |
| PTY              | portable-pty 0.9                               |
| File Watching    | notify 8                                       |
| IPC Bindings     | tauri-typegen (auto-generated)                 |
| Git              | CLI via `std::process::Command`                |
| Logging          | tracing + tracing-subscriber                   |
| i18n             | Paraglide.js v2 (English + Chinese)            |
| Diff Rendering   | @pierre/diffs                                  |
| Package Manager  | Bun                                            |

## Module Structure

```
src/                              # Frontend (React + TypeScript)
  main.tsx                        # Entry point, provider stack
  App.tsx                         # Root component, routes, layout
  app.css                         # Global styles
  generated/                      # Auto-generated Tauri IPC bindings (gitignored)
  paraglide/                      # Generated i18n messages (gitignored)
  features/                       # Feature-based modules
    home/                         # HomePage
    projects/                     # ProjectDetailPage, project hooks & dialogs
    profiles/                     # Profile creation/deletion dialogs & hooks
    terminal/                     # Terminal store, components, themes, hooks
    git/                          # GitDiffDialog, ProjectTopBar, commit history
    settings/                     # SettingsPage, pickers, Zustand stores
    watcher/                      # useFileWatcher hook
    debug/                        # Debug log panel, stores, useDebugLogger
  layout/                         # App shell
    AppSidebar.tsx                # Main sidebar
    sidebar/                      # ProjectMenuItem, ProfileList, ProfileItem
  shared/                         # Cross-cutting concerns
    lib/                          # Query client, query keys, cached promise
    providers/                    # ThemeProvider, Toaster
    components/                   # Fallbacks, SidebarLink

src-tauri/                        # Backend (Rust)
  src/
    main.rs                       # Binary entry point
    lib.rs                        # App bootstrap, plugin/state/command registration
    error.rs                      # AppError enum (thiserror)
    schema.rs                     # Auto-generated Diesel schema
    handler/                      # Tauri command entry points (thin layer)
      project.rs, pty.rs, profile.rs, font.rs, sound.rs, watcher.rs, debug.rs
    service/                      # Business logic and orchestration
      project.rs, pty.rs, profile.rs, watcher.rs
    repo/                         # Database access (Diesel ORM)
      project.rs, pty.rs, profile.rs
    infra/                        # Infrastructure
      db.rs, git.rs, pty.rs, slug.rs, config.rs, watcher.rs, logger.rs
    model/                        # Diesel models and DTOs
      project.rs, pty.rs, profile.rs, watcher.rs, debug.rs
  migrations/                     # Diesel SQL migrations (embedded at compile time)
```

## Documentation Index

- [Architecture](./architecture.md) - System architecture, layered backend, component map
- [Data Flow](./data-flow.md) - IPC lifecycle, terminal streaming, session restoration, file watching
- [API Reference](./api-reference.md) - All 22 Tauri IPC commands with types
- [Configuration](./configuration.md) - Config files, database schema, error handling

## Summary

The application uses a 4-layer backend architecture (handler/service/repo/infra) with auto-generated TypeScript bindings for type-safe IPC. Terminal persistence is achieved through CSS display toggling (never unmounting xterm.js instances) combined with SQLite-backed scrollback restoration. The profile system leverages git worktrees for zero-copy branch isolation with automated setup/teardown scripts. A file watcher system monitors project directories and pushes change events to the frontend via Tauri channels with debouncing. A debug logging system forwards Rust `tracing` events to the frontend via a custom `ChannelLayer`.
