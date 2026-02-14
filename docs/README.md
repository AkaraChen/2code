# 2code Architecture Documentation

> Auto-generated structural documentation for the 2code desktop application.

## Overview

**2code** is a Tauri 2 desktop application for managing code projects with integrated terminal sessions. It provides a unified workspace where developers can organize projects, create branch-isolated profiles via git worktrees, and run persistent PTY terminal sessions with scrollback restoration. The app features git diff/commit browsing, AI agent management via ACP, and full i18n support (English + Chinese).

The frontend is a React 19 SPA communicating with a Rust backend through auto-generated typed IPC bindings. All terminal sessions persist across app restarts, and the UI preserves xterm.js state by never unmounting terminal components.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Language (Frontend) | TypeScript 5.6 |
| Language (Backend) | Rust (2021 edition) |
| Framework | Tauri 2 |
| UI Library | React 19 + Chakra UI v3 |
| State (Client) | Zustand 5 (with immer) |
| State (Server) | TanStack Query 5 |
| Terminal | xterm.js 6 |
| Database | SQLite (Diesel ORM 2) |
| PTY | portable-pty 0.9 |
| Git | CLI subprocess (`git`) |
| i18n | Paraglide.js v2 |
| Build | Vite 6 + Cargo |
| Package Manager | Bun |
| Agent Integration | rivet-dev/sandbox-agent (ACP) |

## Module Structure

```
2code/
├── src/                          # Frontend (React 19 + TypeScript)
│   ├── main.tsx                  # Entry point, provider stack
│   ├── App.tsx                   # Routing + error boundary
│   ├── generated/                # Auto-generated Tauri IPC bindings (gitignored)
│   ├── features/                 # Feature modules
│   │   ├── terminal/             # PTY terminal sessions + xterm.js
│   │   ├── projects/             # Project CRUD + detail page
│   │   ├── profiles/             # Git worktree profile management
│   │   ├── git/                  # Diff viewer + commit history
│   │   ├── settings/             # Settings page + Zustand stores
│   │   ├── topbar/               # Customizable top bar controls
│   │   ├── watcher/              # File system watcher (query invalidation)
│   │   └── debug/                # Debug panel + log viewer
│   ├── layout/                   # AppSidebar + sidebar sub-components
│   └── shared/                   # Providers, hooks, query keys, fallbacks
├── src-tauri/                    # Backend (Rust)
│   ├── src/                      # Main app layer
│   │   ├── lib.rs                # Tauri builder + setup
│   │   ├── bridge.rs             # Tauri → service trait adapters
│   │   └── handler/              # IPC command handlers (8 modules)
│   ├── crates/                   # Workspace crates (layered architecture)
│   │   ├── model/                # Diesel models, schema, DTOs
│   │   ├── repo/                 # Database access (CRUD)
│   │   ├── service/              # Business logic orchestration
│   │   ├── infra/                # PTY, git, DB, config, watcher, shell init
│   │   └── agent/                # AI agent management (ACP)
│   ├── bins/2code-helper/        # CLI sidecar for notifications
│   └── migrations/               # Diesel SQL migrations (6)
├── messages/                     # i18n source files (en.json, zh.json)
├── justfile                      # Task runner commands
└── docs/                         # This documentation
```

## Documentation Index

- [Architecture](./architecture.md) — System architecture diagram, layered pattern, component map, design decisions
- [Data Flow](./data-flow.md) — Terminal lifecycle, session restoration, notification pipeline, state management
- [API Reference](./api-reference.md) — All 28 Tauri IPC commands + event channels
- [Configuration](./configuration.md) — Config files, environment variables, build pipeline, i18n, migrations

### Component Deep Dives

- [Terminal System](./components/terminal-system.md) — PTY lifecycle, persistence, ZDOTDIR init, output streaming
- [Agent System](./components/agent-system.md) — ACP integration, manager, runtime, credential detection
- [Git Integration](./components/git-integration.md) — Temp index diff, worktree profiles, context ID resolution

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

# Count lines of code
just cloc
```

## Summary

2code demonstrates a clean layered architecture with trait-based dependency inversion between the Tauri framework and business logic. Notable patterns include CSS-based terminal persistence (never unmounting xterm.js), vt100-sanitized session restoration, ZDOTDIR-based shell initialization injection, and a temp-index git diff strategy that avoids modifying the user's staging area. The workspace crate structure ensures clear separation between data models, repository access, business logic, and infrastructure concerns.
