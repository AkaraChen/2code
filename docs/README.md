# 2code Architecture Documentation

> Auto-generated structural documentation for the 2code desktop application.

## Overview

**2code** is a Tauri 2 desktop application for managing code projects with integrated terminal sessions and AI agent support. It combines a React 19 frontend with a Rust backend to provide project management, git worktree-based profile isolation, persistent PTY terminal sessions with scrollback restoration, git diff/history browsing, AI agent chat via ACP (Agent Communication Protocol), and i18n support. The application targets macOS and uses SQLite for local data persistence.

The frontend is a React 19 SPA communicating with a Rust backend through auto-generated typed IPC bindings (`tauri-typegen`). All terminal sessions persist across app restarts, and the UI preserves xterm.js state by never unmounting terminal components (CSS `display: none` toggling).

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19, TypeScript 5.8, Vite 7 |
| UI Framework | Chakra UI v3, Emotion, next-themes |
| State (Client) | Zustand 5 + Immer |
| State (Server) | TanStack Query 5 |
| Routing | react-router v7 |
| Terminal | xterm.js 6 (+ fit, web-links addons) |
| AI Agent | ACP SDK 0.14, Streamdown, Shiki |
| Backend | Rust (edition 2021), Tauri 2 |
| Database | SQLite via Diesel ORM 2 |
| PTY | portable-pty 0.9 |
| Git | CLI subprocess (`git`) |
| IPC | tauri-typegen auto-generated TypeScript bindings |
| i18n | Paraglide.js v2 (English + Chinese) |
| Build | Bun, Vite, Cargo, Just |
| Testing | Vitest 4 (frontend), Cargo test (backend) |
| Linting | ESLint 9 (@antfu/eslint-config), Knip |
| DnD | dnd-kit (sortable topbar controls) |

## Module Structure

```
2code/
├── src/                           # Frontend (React 19 + TypeScript)
│   ├── main.tsx                   # Entry: provider stack mount
│   ├── App.tsx                    # Root layout + routing + debug toggle
│   ├── features/                  # Feature-based modules
│   │   ├── agent/                 #   AI agent chat (ACP integration)
│   │   ├── debug/                 #   Debug panel (Cmd+Shift+D)
│   │   ├── git/                   #   Git diff/history viewer
│   │   ├── home/                  #   Landing page
│   │   ├── profiles/              #   Profile (worktree) management
│   │   ├── projects/              #   Project CRUD + detail page
│   │   ├── settings/              #   App settings, pickers, Zustand stores
│   │   ├── tabs/                  #   Unified tab session abstraction
│   │   ├── terminal/              #   xterm.js terminal components
│   │   ├── topbar/                #   Configurable top bar controls
│   │   └── watcher/               #   File system watcher
│   ├── generated/                 # Auto-generated Tauri IPC bindings (gitignored)
│   ├── layout/                    # AppSidebar + sidebar components
│   ├── paraglide/                 # i18n generated files (gitignored)
│   └── shared/                    # Query client, providers, components, hooks
│
├── src-tauri/                     # Backend (Rust + Tauri 2)
│   ├── src/
│   │   ├── main.rs                # Tauri bootstrap
│   │   ├── lib.rs                 # Command registration + plugin setup
│   │   ├── bridge.rs              # Adapts Tauri types → service interfaces
│   │   ├── handler/               # Tauri command handlers (thin layer)
│   │   └── schema.rs              # Diesel auto-generated schema
│   ├── crates/
│   │   ├── model/                 # Diesel models + DTOs
│   │   ├── repo/                  # Database access layer (CRUD)
│   │   ├── service/               # Business logic orchestration
│   │   ├── infra/                 # Infrastructure (PTY, git, DB, watcher, shell init)
│   │   ├── agent/                 # AI agent management (ACP)
│   │   └── shared/                # Types shared with sidecar
│   ├── bins/
│   │   └── twocode-helper/        # CLI sidecar for notifications
│   └── migrations/                # Diesel SQLite migrations (9 total)
│
├── messages/                      # i18n source messages (en.json, zh.json)
├── project.inlang/                # Paraglide.js config
├── justfile                       # Task runner commands
├── package.json                   # Frontend dependencies + scripts
└── docs/                          # This documentation
```

## Documentation Index

- [Architecture](./architecture.md) — System architecture, layered design, component map, design decisions
- [Data Flow](./data-flow.md) — Terminal session lifecycle, PTY streaming, agent communication, state management
- [API Reference](./api-reference.md) — All IPC commands, Tauri events, and communication protocols
- [Configuration](./configuration.md) — Config files, environment variables, database schema, build setup

### Component Deep Dives

- [Terminal System](./components/terminal.md) — PTY lifecycle, persistence, xterm.js integration, output streaming
- [Agent System](./components/agent.md) — ACP integration, session management, streaming UI
- [Tab System](./components/tabs.md) — Unified tab abstraction, session registry, restoration

## Quick Start

```bash
# Install dependencies
bun install

# Dev server (frontend + backend hot-reload)
bun tauri dev

# Production build
bun tauri build

# Run tests
bun test                          # Frontend (Vitest)
cd src-tauri && cargo test        # Backend (Rust)

# Regenerate IPC bindings after Rust command changes
cargo tauri-typegen generate

# Format code
just fmt

# Code coverage
just coverage                     # HTML report
just coverage-summary             # Terminal summary
```

## Summary

2code follows a clean layered architecture with strict separation between Tauri command handlers, business logic services, and database repositories. The frontend uses a feature-based module structure with Zustand for client state and TanStack Query for server state, connected to the Rust backend via auto-generated typed IPC bindings. Notable patterns include CSS-based terminal persistence (never unmounting xterm.js), UTF-8 boundary-aware PTY output streaming, ZDOTDIR-based shell initialization injection, and a unified tab session abstraction that supports both terminal and AI agent tabs.
