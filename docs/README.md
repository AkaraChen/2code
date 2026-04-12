# 2code Architecture Documentation

> Auto-generated structural documentation for the **2code** Tauri 2 desktop application.

## Overview

**2code** is a macOS desktop app for managing code projects with integrated persistent terminal sessions. It pairs a React 19 frontend with a Rust backend, connected via Tauri 2 IPC with auto-generated TypeScript bindings.

### Tech Stack

| Layer          | Technology                                 |
| -------------- | ------------------------------------------ |
| Frontend       | React 19, TypeScript, Vite 7, Chakra UI v3 |
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
