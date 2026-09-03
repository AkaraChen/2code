# 2code Architecture Documentation

> Structural documentation for **2code**. The current product UI is the GPUI native shell in `src-gpui/`. The Tauri + React tree remains as a reference implementation.

## Overview

**2code** is a desktop app for managing code projects with integrated persistent terminal sessions. The GPUI rewrite in `src-gpui/` owns the windows and UI; it reuses the existing Rust domain crates (`model`, `repo`, `service`, `infra`) without Tauri IPC.

### Tech Stack

| Layer          | Technology                                 |
| -------------- | ------------------------------------------ |
| Native UI      | GPUI + gpui-component (`src-gpui/`)        |
| Frontend       | React 19, TypeScript, Vite 8, shadcn/ui (legacy Tauri shell)    |
| State (client) | Zustand 5 + immer                          |
| State (server) | TanStack Query 5                           |
| Routing        | react-router v7                            |
| Terminal       | xterm.js 6                                 |
| Backend        | Rust, Tauri 2                              |
| Database       | SQLite via Diesel ORM                      |
| IPC codegen    | tauri-typegen                              |
| i18n           | Paraglide.js v2                            |
| Sidecar        | `2code-helper` CLI (Rust, clap + ureq)     |

### Module Structure

```
2code/
├── src/                        # Frontend (React + TypeScript)
│   ├── main.tsx                # App entry point, provider stack
│   ├── App.tsx                 # Routes, layout, error boundaries
│   ├── features/               # Feature-based organization
│   │   ├── home/               # HomePage
│   │   ├── projects/           # ProjectDetailPage, CRUD hooks, dialogs
│   │   ├── profiles/           # Profile CRUD hooks, dialogs
│   │   ├── terminal/           # Terminal store, hooks, components, themes
│   │   ├── git/                # Git diff/log dialog, components
│   │   ├── settings/           # SettingsPage, pickers, Zustand stores
│   │   ├── watcher/            # File system watcher hook
│   │   └── debug/              # Debug panel (Cmd+Shift+D), log store
│   ├── layout/                 # AppSidebar, ProjectMenuItem, ProfileItem
│   ├── shared/                 # Query client, query keys, providers, components
│   ├── generated/              # Auto-generated Tauri IPC bindings (gitignored)
│   └── paraglide/              # Generated i18n code (gitignored)
│
├── src-gpui/                   # GPUI native rewrite (primary desktop shell)
│
├── src-tauri/                  # Backend (Rust)
│   ├── src/
│   │   ├── lib.rs              # App setup: plugins, state, commands, lifecycle
│   │   ├── handler/            # Tauri command entry points (thin delegation)
│   │   ├── service/            # Business logic and orchestration
│   │   ├── repo/               # Diesel ORM database access
│   │   ├── infra/              # Infrastructure: DB, PTY, git, HTTP server, etc.
│   │   ├── model/              # Diesel models, DTOs, non-DB types
│   │   ├── error.rs            # AppError enum (thiserror)
│   │   └── schema.rs           # Diesel-generated schema (do not edit)
│   ├── shared/                 # Shared types crate (server ↔ sidecar)
│   ├── 2code-helper/           # CLI sidecar binary
│   └── migrations/             # Diesel SQL migrations
│
├── messages/                   # i18n source files (en.json, zh.json)
├── project.inlang/             # Paraglide.js config
└── justfile                    # Build recipes (fmt, build-helper, etc.)
```

## Documentation Index

| Document                          | Contents                                                                  |
| --------------------------------- | ------------------------------------------------------------------------- |
| [Architecture](architecture.md)   | Layer diagram, component map, design decisions                            |
| [Data Flow](data-flow.md)         | IPC lifecycle, PTY streaming, notification pipeline, terminal restoration |
| [API Reference](api-reference.md) | All Tauri commands, Tauri events, HTTP endpoints                          |
| [Configuration](configuration.md) | Config files, environment variables, database schema                      |
| [Notification Behavior](notification-behavior.md) | Terminal unread-dot state machine and click behavior          |
| [UI Inventory](ui-inventory.md) | Framework-agnostic rewrite spec for every window, screen, component, layout, and dialog |
| [Sidebar UI Inventory](sidebar-ui-inventory.md) | Pixel-level appendix: app sidebar + profile sidebar |
| [Home / Project UI Inventory](ui-inventory-home-project.md) | Pixel-level appendix: home, file tree, viewer, command palette, project dialogs |
| [Settings / Terminal / Git UI Inventory](ui-inventory-settings-terminal-git-debug-updater.md) | Pixel-level appendix: settings window, terminal, git, debug, updater |
| [GPUI rewrite](../src-gpui/README.md) | Native GPUI desktop shell that implements the UI inventory |
