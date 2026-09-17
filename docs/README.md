# 2code Architecture Documentation

> Structural documentation for the **2code** Tauri 2 desktop application.

## Overview

**2code** is a desktop app for managing code projects with integrated Herdr terminal sessions. It pairs a React 19 frontend with a Rust backend, connected via Tauri 2 IPC with auto-generated TypeScript bindings. Herdr (pinned **v0.9.0**) is the production runtime and profile authority. sqlite stores `projects` / `project_groups` / `checkout_notes`.

### Tech Stack

| Layer          | Technology                                 |
| -------------- | ------------------------------------------ |
| Frontend       | React 19, TypeScript, Vite 8, shadcn/ui    |
| State (client) | Zustand 5 + immer                          |
| State (server) | TanStack Query 5                           |
| Routing        | react-router v7                            |
| Terminal       | xterm.js 6                                 |
| Backend        | Rust, Tauri 2                              |
| Database       | SQLite via Diesel ORM                      |
| IPC codegen    | tauri-typegen                              |
| i18n           | Paraglide.js v2                            |
| Sidecar        | Pinned Herdr v0.9.0 (`binaries/herdr`)     |

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
│   │   └── bridge.rs           # Trait impls decoupling service from Tauri
│   ├── crates/
│   │   ├── service/            # Business logic + Herdr-only RuntimeRouter
│   │   ├── repo/               # Diesel ORM: projects, groups, checkout_notes
│   │   ├── infra/              # DB, Herdr sidecar/transport, git, watcher
│   │   └── model/              # Diesel models, DTOs, error types
│   └── migrations/             # Diesel SQL migrations
│
├── messages/                   # i18n source files (en.json, zh.json)
├── project.inlang/             # Paraglide.js config
└── justfile                    # Build recipes (fmt, coverage, etc.)
```

## Documentation Index

| Document                          | Contents                                                                  |
| --------------------------------- | ------------------------------------------------------------------------- |
| [Architecture](architecture.md)   | Layer diagram, component map, design decisions                            |
| [Data Flow](data-flow.md)         | IPC lifecycle, Herdr pane streaming, notification pipeline, reattach restore |
| [API Reference](api-reference.md) | Tauri commands, channels, key types                                       |
| [Configuration](configuration.md) | Config files, environment variables, live sqlite schema                   |
| [Notification Behavior](notification-behavior.md) | Terminal unread-dot state machine and click behavior          |
| [Herdr integration](herdr-integration.md) | Pinned Herdr v0.9.0 contract, protocol, and capability matrix |
