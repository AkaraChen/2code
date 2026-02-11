# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**2code** is a Tauri 2 desktop application for managing code projects with integrated terminal sessions. It combines a React 19 frontend with a Rust backend, featuring:

- Project management with folder selection and metadata
- Persistent PTY (pseudo-terminal) sessions
- SQLite database for project/session storage
- i18n support via Paraglide.js

## Commands

### Development

```bash
# Run dev server (frontend + backend hot-reload)
bun tauri dev

# Or using just
just start

# Frontend-only dev
bun run dev

# Production build (creates native binary)
bun tauri build

# Frontend-only build (TypeScript + Vite)
bun run build
```

### Testing

```bash
# Run Rust tests
cd src-tauri && cargo test

# Run specific test
cd src-tauri && cargo test test_name
```

### Linting/Formatting

```bash
# Format using just (runs 'fama')
just fmt
```

## Architecture

### Frontend (`/src`)

React 19 + TypeScript application bundled by Vite.

**Key directories:**
- `main.tsx` - Entry point, sets up providers (Chakra UI, theme, i18n)
- `App.tsx` - Main layout with sidebar and routing
- `components/` - Reusable UI components (terminal, project cards, etc.)
- `pages/` - Route-level pages (Welcome, Project)
- `stores/` - Zustand state management
- `hooks/` - Custom React hooks
- `paraglide/` - Generated i18n files (do not edit manually)

**State management:**
- Zustand for global state (projects, active terminal sessions)
- TanStack Query (React Query) for async data fetching

**UI Framework:**
- Chakra UI v3 for component library
- Tailwind CSS v4 for utility styling
- `next-themes` for dark/light mode

### Backend (`/src-tauri`)

Rust application with Tauri 2.

**Entry:** `src/main.rs` → `src/lib.rs`

**Module structure:**
```
src/
├── lib.rs           # Main entry, Tauri builder, command registration
├── main.rs          # Binary entry
├── error.rs         # Custom error types (AppError)
├── db.rs            # Database initialization, connection pool
├── schema.rs        # Diesel table definitions
├── font.rs          # System font listing
├── project/         # Project management
│   ├── mod.rs
│   ├── models.rs    # Project, CreateProject, etc.
│   └── commands.rs  # Tauri commands
├── pty/             # PTY (terminal) management
│   ├── mod.rs
│   ├── models.rs    # Session, PtySize, etc.
│   ├── session.rs   # Session map management
│   └── commands.rs  # Tauri commands
```

**Database (SQLite):**
- Diesel ORM for migrations and queries
- Stored in app data dir: `app.path().app_data_dir()`
- Tables: `projects`, `terminal_sessions`, `__diesel_schema_migrations`

**PTY Sessions:**
- `portable-pty` crate for cross-platform PTY
- Sessions stored in managed state (Arc<Mutex<SessionMap>>)
- Database persistence for session metadata and scrollback
- Output streaming via async Rust

### IPC (Frontend ↔ Backend)

Commands are registered in `lib.rs` via `tauri::generate_handler![]`.

**PTY Commands:**
- `create_pty_session` - Create new terminal session
- `write_to_pty` - Send input to terminal
- `resize_pty` - Resize terminal
- `close_pty_session` - Close session
- `list_active_sessions` - List all sessions
- `get_pty_session_history` - Get scrollback history
- `delete_pty_session_record` - Delete from DB

**Project Commands:**
- `create_project_temporary` - Create empty project
- `create_project_from_folder` - Import from folder
- `list_projects` - List all projects
- `get_project` - Get single project
- `update_project` - Update metadata
- `delete_project` - Remove project

**Font Commands:**
- `list_system_fonts` - List available system fonts

## Internationalization (i18n)

Uses **Paraglide.js v2** with the inlang message format plugin.

**Configuration:**
- Settings: `project.inlang/settings.json`
- Source messages: `messages/` directory
- Generated code: `src/paraglide/` (gitignored)

**Important:** The `settings.json` **must** include a `modules` array with the message format plugin URL:
```json
"modules": [
  "https://cdn.jsdelivr.net/npm/@inlang/plugin-message-format@latest/dist/index.js"
]
```

Without this, paraglide compiles but generates empty message files.

**Build notes:**
- `allowJs: true` in `tsconfig.json` is required for TypeScript to read JSDoc types from generated `.js` files
- Build script runs `paraglide-js compile` before `tsc` since Vite plugin only runs during vite build

## Key Configuration Files

| File | Purpose |
|------|---------|
| `src-tauri/tauri.conf.json` | Tauri app config (window, bundle, dev server) |
| `src-tauri/Cargo.toml` | Rust dependencies |
| `package.json` | Frontend dependencies, scripts |
| `vite.config.ts` | Vite/React config with path aliasing |
| `tsconfig.json` | TypeScript config with path aliasing |
| `project.inlang/settings.json` | Paraglide i18n configuration |

## Path Aliases

The `@` alias is configured in both Vite and TypeScript:
- **Vite:** `resolve.alias: { "@": path.resolve(__dirname, "./src") }`
- **TypeScript:** `paths: { "@/*": ["./src/*"] }`

Use `@/` for imports from the `src` directory.
