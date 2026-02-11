# Configuration

## Overview

2code configuration is split across multiple files: build configuration, application settings, and internationalization. The project uses a modern toolchain with Vite for frontend building and Tauri for the desktop wrapper.

## Configuration Files

### Build Configuration

#### `package.json`
**Location:** `package.json`

Frontend dependencies and build scripts.

```json
{
  "scripts": {
    "dev": "vite",                                    // Development server
    "build": "paraglide-js compile --project ./project.inlang --outdir ./src/paraglide && tsc && vite build",
    "preview": "vite preview",
    "tauri": "tauri",
    "start": "tauri dev"                              // Full dev with Rust hot-reload
  }
}
```

#### `vite.config.ts`
**Location:** `vite.config.ts`

Vite configuration with Tauri-specific settings.

```typescript
export default defineConfig(async () => ({
  plugins: [
    tailwindcss(),
    react(),
    paraglideVitePlugin({
      project: "./project.inlang",
      outdir: "./src/paraglide",
    }),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),    // Path alias
    },
  },
  clearScreen: false,                              // Keep Rust errors visible
  server: {
    port: 1420,
    strictPort: true,                              // Fail if port unavailable
    host: host || false,
    hmr: host ? { protocol: "ws", host, port: 1421 } : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],                // Don't watch Rust files
    },
  },
}));
```

### Tauri Configuration

#### `tauri.conf.json`
**Location:** `src-tauri/tauri.conf.json`

Application window and bundle configuration.

```json
{
  "$schema": "https://schema.tauri.app/config/2",
  "productName": "code",
  "version": "0.1.0",
  "identifier": "com.akrc.code",
  "build": {
    "beforeDevCommand": "bun run dev",
    "devUrl": "http://localhost:1420",
    "beforeBuildCommand": "bun run build",
    "frontendDist": "../dist"
  },
  "app": {
    "windows": [
      {
        "title": "code",
        "width": 1440,
        "height": 900,
        "center": true,
        "maximizable": true,
        "decorations": true
      }
    ],
    "security": {
      "csp": null
    }
  },
  "bundle": {
    "active": true,
    "targets": "all",
    "icon": [
      "icons/32x32.png",
      "icons/128x128.png",
      "icons/128x128@2x.png",
      "icons/icon.icns",
      "icons/icon.ico"
    ]
  }
}
```

### Rust Configuration

#### `Cargo.toml`
**Location:** `src-tauri/Cargo.toml`

Rust dependencies and crate configuration.

```toml
[package]
name = "code"
version = "0.1.0"
edition = "2021"

[lib]
name = "code_lib"
crate-type = ["staticlib", "cdylib", "rlib"]

[build-dependencies]
tauri-build = { version = "2", features = [] }

[dependencies]
# Core
tauri = { version = "2", features = [] }
tauri-plugin-opener = "2"
serde = { version = "1", features = ["derive"] }
serde_json = "1"

# PTY
portable-pty = "0.9"

# Error handling
thiserror = "2"

# Utilities
uuid = { version = "1", features = ["v4"] }
slug = "0.1"
pinyin = "0.11"

# Database
diesel = { version = "2", features = ["sqlite"] }
diesel_migrations = "2"

# Dialogs
tauri-plugin-dialog = "2"

# Fonts (macOS)
core-text = "20"
```

### TypeScript Configuration

#### `tsconfig.json`
**Location:** `tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": true,
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "allowJs": true,                       // Required for Paraglide.js output
    "baseUrl": ".",
    "paths": {
      "@/*": ["./src/*"]                  // Path alias
    }
  },
  "include": ["src"],
  "references": [{ "path": "./tsconfig.node.json" }]
}
```

## Internationalization Configuration

#### `project.inlang/settings.json`
**Location:** `project.inlang/settings.json`

```json
{
  "baseLocale": "en",
  "locales": ["en", "zh"],
  "modules": [
    "https://cdn.jsdelivr.net/npm/@inlang/plugin-message-format@latest/dist/index.js"
  ],
  "plugin.inlang.messageFormat": {
    "pathPattern": "./messages/{locale}.json"
  }
}
```

**Important:** The `modules` array is **required** for Paraglide.js to generate message functions. Without it, compilation succeeds but generates empty message files.

### Message Files

**Location:** `messages/en.json`, `messages/zh.json`

Example structure:
```json
{
  "home": "Home",
  "projects": "Projects",
  "newProject": "New Project",
  "deleteProject": "Delete Project",
  "renameProject": "Rename Project",
  "settings": "Settings",
  "noTerminalsOpen": "No terminals open",
  "noTerminalsOpenDescription": "Click the button below to open a new terminal",
  "newTerminal": "New Terminal"
}
```

## Database Configuration

### SQLite Setup

**Location:** `src-tauri/src/db.rs`

The database is stored in the app's data directory:
- macOS: `~/Library/Application Support/com.akrc.code/app.db`
- Windows: `%APPDATA%/com.akrc.code/app.db`
- Linux: `~/.local/share/com.akrc.code/app.db`

### Schema

```sql
-- Projects table
CREATE TABLE projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    folder TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- PTY Sessions table
CREATE TABLE pty_sessions (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id),
    title TEXT NOT NULL,
    shell TEXT NOT NULL,
    cwd TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    closed_at TIMESTAMP
);

-- PTY Output Chunks table (scrollback storage)
CREATE TABLE pty_output_chunks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL REFERENCES pty_sessions(id),
    data BLOB NOT NULL
);
```

### Database Settings

```rust
// PRAGMA settings applied on connection
diesel::sql_query("PRAGMA journal_mode=WAL;").execute(&mut conn)?;
diesel::sql_query("PRAGMA foreign_keys=ON;").execute(&mut conn)?;
```

- **WAL Mode**: Write-Ahead Logging for better concurrency
- **Foreign Keys**: Enforce referential integrity

## Error Handling Configuration

### Error Types (`src-tauri/src/error.rs`)

```rust
#[derive(Error, Debug)]
pub enum AppError {
    #[error("IO error: {0}")]
    IoError(#[from] std::io::Error),

    #[error("Lock error: failed to acquire lock")]
    LockError,

    #[error("PTY error: {0}")]
    PtyError(String),

    #[error("Database error: {0}")]
    DbError(String),

    #[error("Not found: {0}")]
    NotFound(String),
}
```

Errors are serialized to strings and returned to the frontend via Tauri's error channel.

## Environment Variables

### Development

| Variable | Purpose | Example |
|----------|---------|---------|
| `TAURI_DEV_HOST` | Mobile development host | `192.168.1.100` |

### Build

No environment variables required for standard builds. The application uses compile-time constants from `tauri.conf.json`.

## Performance Configuration

### Terminal Output Buffering

```rust
// src-tauri/src/pty/commands.rs
const FLUSH_THRESHOLD: usize = 32 * 1024;      // 32KB
const MAX_OUTPUT_PER_SESSION: usize = 1024 * 1024;  // 1MB
```

- **Flush Threshold**: Output is batched in 32KB chunks before database writes
- **Max Output**: Oldest chunks are pruned when total exceeds 1MB per session

### TanStack Query Configuration

```typescript
// src/lib/queryClient.ts
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,  // 5 minutes
      gcTime: 10 * 60 * 1000,    // 10 minutes
    },
  },
});
```

## Security Configuration

### CSP (Content Security Policy)

```json
// tauri.conf.json
"security": {
  "csp": null  // Disabled for development
}
```

For production, a strict CSP should be configured:
```json
"csp": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'"
```

### Database Security

- SQLite runs in WAL mode for better isolation
- Foreign keys are enforced
- No sensitive data is stored (only project paths and terminal scrollback)

### PTY Security

- Shell commands run with user privileges
- No sandbox escape from PTY
- Environment variables sanitized (`TERM=xterm-256color`)
