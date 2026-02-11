# 2code Documentation

## Overview

**2code** is a Tauri 2 desktop application for managing code projects with integrated terminal sessions. It provides a modern, fast development environment that combines a React 19 frontend with a Rust backend, featuring persistent PTY sessions, SQLite-based project storage, and full i18n support.

## Tech Stack

### Frontend
| Technology | Purpose |
|------------|---------|
| React 19 | UI framework with concurrent features |
| TypeScript | Type-safe development |
| Vite | Build tool and dev server |
| Chakra UI v3 | Component library |
| Tailwind CSS v4 | Utility-first styling |
| TanStack Query | Server state management |
| Zustand | Client state management |
| XTerm.js | Terminal emulator |
| Paraglide.js v2 | Internationalization |

### Backend
| Technology | Purpose |
|------------|---------|
| Rust | Systems programming |
| Tauri 2 | Desktop framework |
| Diesel ORM | Database access |
| SQLite | Embedded database |
| portable-pty | Cross-platform PTY |

## Module Structure

```
src/                          # Frontend source
├── main.tsx                  # React entry point
├── App.tsx                   # Root layout with sidebar/routes
├── api/                      # API clients
│   ├── pty.ts               # PTY commands
│   └── projects.ts          # Project commands
├── components/               # React components
│   ├── AppSidebar.tsx       # Navigation sidebar
│   ├── Terminal.tsx         # XTerm terminal instance
│   ├── TerminalLayer.tsx    # Terminal overlay manager
│   └── ...
├── hooks/                    # Custom React hooks
│   ├── useProjects.ts       # Project data hooks
│   └── ...
├── pages/                    # Route pages
│   ├── HomePage.tsx
│   ├── ProjectDetailPage.tsx
│   └── SettingsPage.tsx
├── stores/                   # Zustand stores
│   ├── terminalStore.ts     # Terminal state
│   └── fontStore.ts         # Font preferences
└── paraglide/               # Generated i18n files

src-tauri/src/                # Backend source
├── lib.rs                   # Main entry, command registration
├── main.rs                  # Binary entry
├── error.rs                 # Error types
├── db.rs                    # Database initialization
├── schema.rs                # Diesel table definitions
├── font.rs                  # System font listing
├── project/                 # Project module
│   ├── mod.rs
│   ├── models.rs            # Project data models
│   └── commands.rs          # Tauri commands
└── pty/                     # PTY module
    ├── mod.rs
    ├── models.rs            # Session data models
    ├── session.rs           # Session management
    └── commands.rs          # Tauri commands
```

## Documentation Index

| Document | Description |
|----------|-------------|
| [architecture.md](./architecture.md) | System architecture, component relationships, design decisions |
| [data-flow.md](./data-flow.md) | Data flow diagrams, request lifecycle, state management |
| [api-reference.md](./api-reference.md) | Tauri commands, IPC interface, API patterns |
| [configuration.md](./configuration.md) | Config files, environment variables, build options |

## Key Features

- **Project Management**: Create projects from folders or temporary directories with auto-generated folder names (supports CJK transliteration)
- **Persistent Terminals**: PTY sessions survive page navigation, with scrollback history stored in SQLite
- **Multi-tab Terminals**: Each project can have multiple terminal tabs
- **Internationalization**: Full i18n support via Paraglide.js (English and Chinese)
- **Customizable Fonts**: User-selectable terminal fonts from system fonts
- **Dark/Light Themes**: Automatic theme switching with custom color schemes

## Development

```bash
# Run dev server (frontend + backend hot-reload)
bun tauri dev

# Production build (creates native binary)
bun tauri build

# Run Rust tests
cd src-tauri && cargo test
```

See [CLAUDE.md](../CLAUDE.md) for detailed development commands and architecture notes.
