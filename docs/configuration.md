# Configuration

## Config Files

| File                                   | Format     | Purpose                                                             |
| -------------------------------------- | ---------- | ------------------------------------------------------------------- |
| `package.json`                         | JSON       | Frontend dependencies, build scripts                                |
| `vite.config.ts`                       | TypeScript | Vite build config, path aliases, Paraglide plugin, Tauri dev server |
| `tsconfig.json`                        | JSON       | TypeScript compiler options, path aliases, `allowJs` for Paraglide  |
| `src-tauri/tauri.conf.json`            | JSON       | Tauri app config, window settings, build hooks, typegen config      |
| `src-tauri/Cargo.toml`                 | TOML       | Rust dependencies and crate config                                  |
| `src-tauri/diesel.toml`                | TOML       | Diesel ORM schema output path (`src/schema.rs`)                     |
| `project.inlang/settings.json`         | JSON       | Paraglide i18n settings, locales, message format plugin             |
| `messages/en.json`, `messages/zh.json` | JSON       | i18n message strings                                                |
| `justfile`                             | Justfile   | Task runner (`just fmt` runs `fama`)                                |

## Build Configuration

### Build Pipeline

```
bun tauri dev     → runs "bun run dev" (Vite) + Rust hot-reload
bun tauri build   → runs "bun run build" (paraglide → tsc → vite) + Rust release build
```

The `build` script chain: `paraglide-js compile` → `tsc` → `vite build` (order matters: paraglide generates code that tsc checks, then vite bundles).

### Vite Settings (`vite.config.ts`)

- **Port**: 1420 (strict — fails if unavailable)
- **HMR**: Custom WebSocket on port 1421 when `TAURI_DEV_HOST` is set
- **Watch exclusion**: `**/src-tauri/**` (prevents circular reloads)
- **Plugins**: `@vitejs/plugin-react`, `paraglideVitePlugin`
- **Path alias**: `@` → `./src`

### Tauri Window Settings (`tauri.conf.json`)

- **Window**: 1440x900, centered, maximizable
- **Title bar**: Overlay style, hidden title (macOS native chrome)
- **Traffic lights**: Custom position at `{x: 16, y: 18}`
- **CSP**: Disabled (`null`)

### TypeScript Binding Generation (`tauri.conf.json` → `plugins.typegen`)

- **Output**: `./src/generated` (gitignored)
- **Source scan**: `./src-tauri`
- **Validation**: None (no Zod/Yup runtime validation)
- **Regenerate**: `cargo tauri-typegen generate`

## Database Configuration

### SQLite Setup (`src-tauri/src/infra/db.rs`)

Stored at the OS-specific app data directory:

- **macOS**: `~/Library/Application Support/com.akrc.code/app.db`
- **Linux**: `~/.local/share/com.akrc.code/app.db`
- **Windows**: `%APPDATA%/com.akrc.code/app.db`

**Pragmas** (applied on every connection):

```sql
PRAGMA journal_mode=WAL;    -- Write-Ahead Logging for better concurrency
PRAGMA foreign_keys=ON;     -- Enforce referential integrity
```

### Schema (4 tables)

```sql
-- Projects (top-level entity)
CREATE TABLE projects (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    folder TEXT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- PTY Sessions (belongs to project, CASCADE delete)
CREATE TABLE pty_sessions (
    id TEXT PRIMARY KEY NOT NULL,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    title TEXT NOT NULL DEFAULT '',
    shell TEXT NOT NULL,
    cwd TEXT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    closed_at TIMESTAMP
);

-- PTY Output Chunks (belongs to session, CASCADE delete)
CREATE TABLE pty_output_chunks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL REFERENCES pty_sessions(id) ON DELETE CASCADE,
    data BLOB NOT NULL
);
CREATE INDEX idx_pty_output_session ON pty_output_chunks(session_id);

-- Profiles (belongs to project, CASCADE delete)
CREATE TABLE profiles (
    id TEXT PRIMARY KEY NOT NULL,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    branch_name TEXT NOT NULL,
    worktree_path TEXT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

### Migrations (`src-tauri/migrations/`)

Managed by Diesel, embedded at compile time via `embed_migrations!("migrations")`, run on app startup:

| Migration                                | Tables                              |
| ---------------------------------------- | ----------------------------------- |
| `2026-02-10-064457-0000_create_projects` | `projects`                          |
| `2026-02-11-000000_create_pty_tables`    | `pty_sessions`, `pty_output_chunks` |
| `2026-02-11-080917-0000_create_profiles` | `profiles`                          |

## Internationalization (`project.inlang/settings.json`)

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

The `modules` array is **required** -- without it, paraglide compiles but generates empty message files.

## Project Configuration (`2code.json`)

Optional per-project config file in the project root:

```json
{
    "setup_script": ["npm install"],
    "teardown_script": ["rm -rf node_modules"]
}
```

Scripts run via `sh -c` in the project/worktree directory during profile creation (`setup_script`) and deletion (`teardown_script`).

## Performance Tuning

### Terminal Output Buffering (`src-tauri/src/service/pty.rs`)

| Constant                 | Value | Purpose                             |
| ------------------------ | ----- | ----------------------------------- |
| `FLUSH_THRESHOLD`        | 32 KB | Buffer size before database write   |
| `MAX_OUTPUT_PER_SESSION` | 1 MB  | Oldest chunks pruned above this cap |
| Read buffer              | 4 KB  | PTY read chunk size                 |

### TanStack Query (`src/lib/queryClient.ts`)

| Setting     | Value      |
| ----------- | ---------- |
| `staleTime` | 30 seconds |
| `retry`     | 1          |

## Environment Variables

| Variable         | Purpose                                                      | Default |
| ---------------- | ------------------------------------------------------------ | ------- |
| `TAURI_DEV_HOST` | Set HMR host for mobile dev (enables WebSocket on port 1421) | Not set |

No other environment variables are required. The application uses compile-time constants from `tauri.conf.json`.

## Error Handling

### AppError Enum (`src-tauri/src/error.rs`)

| Variant     | Source                 | Example                           |
| ----------- | ---------------------- | --------------------------------- |
| `IoError`   | `From<std::io::Error>` | File not found, permission denied |
| `LockError` | Mutex poisoning        | Failed to acquire DB/PTY lock     |
| `PtyError`  | PTY operations         | Session not found, spawn failed   |
| `DbError`   | Diesel operations      | Constraint violation              |
| `NotFound`  | Record lookups         | Project/profile/session not found |
| `GitError`  | Git CLI failures       | Branch exists, invalid hash       |

Errors are serialized to plain strings via a custom `Serialize` impl and returned to the frontend through Tauri's IPC error channel.
