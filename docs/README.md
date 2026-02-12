# 2code Architecture Documentation

> Auto-generated structural documentation.

## Overview

**2code** is a Tauri 2 desktop application for managing code projects with integrated persistent terminal sessions. It combines a React 19 + TypeScript frontend with a Rust backend, using SQLite for persistence, xterm.js for terminal emulation, and git worktrees for branch-isolated workspaces (called "profiles"). The app targets macOS with a native title bar overlay and system font/sound integration.

The architecture follows a clean separation: the frontend handles UI rendering, client state, and server-state caching via TanStack Query, while the Rust backend owns all business logic, database access, PTY lifecycle, and git operations. Communication between layers uses Tauri's IPC invoke mechanism with auto-generated TypeScript bindings via `tauri-typegen`.

## Tech Stack

| Layer            | Technology                                   |
| ---------------- | -------------------------------------------- |
| Frontend         | React 19, TypeScript, Vite 7                 |
| UI Framework     | Chakra UI v3, next-themes                    |
| State Management | Zustand (client), TanStack Query v5 (server) |
| Terminal         | xterm.js 6, @xterm/addon-fit                 |
| Backend          | Rust, Tauri 2                                |
| Database         | SQLite (Diesel ORM, embedded migrations)     |
| PTY              | portable-pty 0.9                             |
| IPC Bindings     | tauri-typegen v0.4.1 (auto-generated)        |
| Git              | CLI via `std::process::Command`              |
| i18n             | Paraglide.js v2 (English + Chinese)          |
| Diff Rendering   | @pierre/diffs, Shiki syntax highlighting     |
| Package Manager  | Bun                                          |

## Module Structure

```
src/                          # Frontend (React + TypeScript)
  generated/                  # Auto-generated Tauri IPC bindings (gitignored)
  components/                 # UI components (Terminal, GitDiffDialog, dialogs, sidebar)
    settings/                 # Settings page sub-components
    sidebar/                  # Sidebar sub-components
  hooks/                      # TanStack Query hooks
  stores/                     # Zustand stores (terminal, font, notification, theme)
  pages/                      # Route-level pages (Home, ProjectDetail, Settings)
  lib/                        # Query client, query keys, terminal themes
  paraglide/                  # Generated i18n messages (gitignored)

src-tauri/                    # Backend (Rust)
  src/
    handler/                  # Tauri command entry points (thin layer)
    service/                  # Business logic and orchestration
    repo/                     # Database access (Diesel ORM)
    infra/                    # Infrastructure: db, git, pty, slug, config
    model/                    # Diesel models and DTOs
    schema.rs                 # Auto-generated Diesel schema
    error.rs                  # AppError enum (thiserror)
    lib.rs                    # App bootstrap, plugin registration, command registration
  migrations/                 # Diesel SQL migrations (embedded at compile time)
```

## Documentation Index

- [Architecture](./architecture.md) - System architecture, layered backend, component map
- [Data Flow](./data-flow.md) - IPC lifecycle, terminal streaming, session restoration
- [API Reference](./api-reference.md) - All Tauri IPC commands with types
- [Configuration](./configuration.md) - Config files, database schema, error handling

## Summary

The application uses a 4-layer backend architecture (handler/service/repo/infra) with auto-generated TypeScript bindings for type-safe IPC. Terminal persistence is achieved through CSS display toggling (never unmounting xterm.js instances) combined with SQLite-backed scrollback restoration. The profile system leverages git worktrees for zero-copy branch isolation with automated setup/teardown scripts.
