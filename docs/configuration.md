# Configuration

## Config Files

| File | Location | Purpose |
|------|----------|---------|
| `tauri.conf.json` | `src-tauri/` | Tauri app config: window, build commands, bundling, typegen plugin |
| `Cargo.toml` | `src-tauri/` | Rust workspace config, dependencies, workspace members (`crates/*`, `bins/*`) |
| `package.json` | Root | Frontend dependencies, scripts (`dev`, `build`, `lint`, `start`, `test`) |
| `vite.config.ts` | Root | Vite config: React plugin (with React Compiler), Paraglide plugin, `@/` alias |
| `tsconfig.json` | Root | TypeScript config: `@/` path alias, `allowJs: true` for Paraglide |
| `vitest.config.ts` | Root | Vitest config: jsdom environment, test setup file |
| `eslint.config.js` | Root | ESLint flat config (@antfu/eslint-config with React) |
| `knip.config.ts` | Root | Dead code detection (ignores `generated/`, `paraglide/`) |
| `justfile` | Root | Task runner: `fmt`, `build-helper`, `coverage`, `cloc` |
| `project.inlang/settings.json` | Root | Paraglide.js i18n config (must include message format plugin module) |
| `diesel.toml` | `src-tauri/` | Diesel ORM config: schema output path (`crates/model/src/schema.rs`) |
| `.editorconfig` | `src-tauri/` | Editor config: tabs, UTF-8, double quotes for JS/TS |
| `2code.json` | Per-project root | Project-level setup/teardown/init scripts |

## Build Pipeline

### Development

```bash
bun tauri dev
```

Runs:
1. `just build-helper-dev` — Build sidecar in debug mode
2. `bun run dev` — Start Vite dev server (port 1420)
3. Tauri launches Rust backend pointing to `http://localhost:1420`

### Production

```bash
bun tauri build
```

Runs:
1. `just build-helper` — Build sidecar in release mode
2. `paraglide-js compile` — Generate i18n code to `src/paraglide/`
3. `tsc` — TypeScript type checking
4. `vite build` — Bundle frontend to `dist/`
5. Cargo builds Rust backend in release mode
6. Tauri packages app with sidecar binary

### Sidecar Build

The `just build-helper` command:
1. Gets host triple via `rustc --print host-tuple`
2. Builds `twocode-helper` package in release mode
3. Copies binary to `src-tauri/binaries/2code-helper-{TARGET_TRIPLE}`

## Environment Variables

### PTY Session Environment

Injected into every PTY session by `service::pty`:

| Variable | Value | Purpose |
|----------|-------|---------|
| `TERM` | `xterm-256color` | Terminal type for color support |
| `_2CODE_HELPER_URL` | `http://127.0.0.1:{port}` | URL for sidecar HTTP communication |
| `_2CODE_HELPER` | `/path/to/2code-helper-{target}` | Path to sidecar binary |
| `_2CODE_SESSION_ID` | UUID | Session identifier for notification routing |
| `ZDOTDIR` | Temp directory path | Overrides zsh init directory for shell init injection |
| `_2CODE_ORIG_ZDOTDIR` | Original `$ZDOTDIR` | Preserved original ZDOTDIR for restoration |

### Build-time Environment

| Variable | Set By | Purpose |
|----------|--------|---------|
| `TARGET` | `build.rs` | Rust target triple for sidecar filename |
| `CARGO_MANIFEST_DIR` | Cargo | Resolves sidecar path in dev mode |
| `TAURI_DEV_HOST` | Tauri CLI | Custom dev server host for remote debugging |

## Database

### Connection

SQLite via Diesel ORM, single connection wrapped in `Arc<Mutex<SqliteConnection>>`. Stored at `{app_data_dir}/app.db`.

**Pragmas:** `journal_mode=WAL`, `foreign_keys=ON`

### Schema

#### `projects`

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | TEXT | PRIMARY KEY |
| `name` | TEXT | NOT NULL |
| `folder` | TEXT | NOT NULL |
| `created_at` | TIMESTAMP | NOT NULL, DEFAULT CURRENT_TIMESTAMP |

#### `profiles`

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | TEXT | PRIMARY KEY |
| `project_id` | TEXT | NOT NULL, FK → projects(id) ON DELETE CASCADE |
| `branch_name` | TEXT | NOT NULL |
| `worktree_path` | TEXT | NOT NULL |
| `created_at` | TIMESTAMP | NOT NULL, DEFAULT CURRENT_TIMESTAMP |
| `is_default` | BOOLEAN | NOT NULL, DEFAULT 0 |

#### `pty_sessions`

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | TEXT | PRIMARY KEY |
| `profile_id` | TEXT | NOT NULL, FK → profiles(id) ON DELETE CASCADE |
| `title` | TEXT | NOT NULL, DEFAULT '' |
| `shell` | TEXT | NOT NULL |
| `cwd` | TEXT | NOT NULL |
| `created_at` | TIMESTAMP | NOT NULL, DEFAULT CURRENT_TIMESTAMP |
| `closed_at` | TIMESTAMP | NULLABLE |
| `cols` | INTEGER | DEFAULT 80 |
| `rows` | INTEGER | DEFAULT 24 |

#### `pty_session_output`

| Column | Type | Constraints |
|--------|------|-------------|
| `session_id` | TEXT | PRIMARY KEY, FK → pty_sessions(id) ON DELETE CASCADE |
| `data` | BLOB | NOT NULL, DEFAULT X'' |

### Relationships

```
projects 1──* profiles 1──* pty_sessions 1──1 pty_session_output
```

All foreign keys use `ON DELETE CASCADE`.

### Migrations

| Migration | Date | Description |
|-----------|------|-------------|
| `create_projects` | 2026-02-10 | Create `projects` table |
| `create_pty_tables` | 2026-02-11 | Create `pty_sessions` + `pty_output_chunks` (initial chunked design) |
| `create_profiles` | 2026-02-11 | Create `profiles` table |
| `profile_first_refactor` | 2026-02-13 | Add `is_default` to profiles, migrate `pty_sessions` FK from project to profile |
| `add_pty_dimensions` | 2026-02-13 | Add `cols` and `rows` to `pty_sessions` |
| `single_blob_output` | 2026-02-14 | Replace `pty_output_chunks` (1:N) with `pty_session_output` (1:1 BLOB) |

Migrations are embedded at compile time via `diesel_migrations::embed_migrations!()` and run on app startup in `infra::db::init_db()`.

## Project Configuration (`2code.json`)

Optional file in project root folder:

```json
{
  "setup_script": ["npm install"],
  "teardown_script": ["rm -rf node_modules"],
  "init_script": ["export FOO=bar", "alias ll='ls -la'"]
}
```

| Field | Type | When Executed |
|-------|------|---------------|
| `setup_script` | `string[]` | On profile creation, in worktree directory (via `sh -c`) |
| `teardown_script` | `string[]` | On profile deletion, in worktree directory (via `sh -c`) |
| `init_script` | `string[]` | On every new PTY session, injected via ZDOTDIR `.zshenv` |

## Internationalization (i18n)

Paraglide.js v2 with inlang message format plugin. Source messages in `messages/{locale}.json` (106 keys each for English and Chinese).

**Critical requirement:** `project.inlang/settings.json` must include the modules array:

```json
{
  "baseLocale": "en",
  "locales": ["en", "zh"],
  "modules": [
    "https://cdn.jsdelivr.net/npm/@inlang/plugin-message-format@latest/dist/index.js"
  ]
}
```

Without this, paraglide compiles but generates empty message files.

**Usage:** `import * as m from "@/paraglide/messages.js"` → `m.home()`

## Tauri Plugins

| Plugin | Purpose |
|--------|---------|
| `tauri-plugin-opener` | Open files/URLs with system default app |
| `tauri-plugin-dialog` | Native file/folder picker dialogs |
| `tauri-plugin-notification` | System notification API |
| `tauri-plugin-store` | Persistent key-value store (`settings.json`) for notification preferences |
| `tauri-plugin-shell` | Execute external commands (VS Code, GitHub Desktop, Cursor, Windsurf) |

## Window Configuration

| Setting | Value |
|---------|-------|
| Window size | 1440 x 900, centered |
| Title bar | macOS overlay style, hidden title |
| Traffic lights | Positioned at (16, 18) |
| Dev URL | `http://localhost:1420` |
| External binaries | `binaries/2code-helper` |
| Bundle targets | All platforms |

## Error Handling

The backend uses `AppError` (defined in `crates/model/src/error.rs`) with `thiserror` derive:

- `AppError::NotFound(String)` — Entity not found
- `AppError::Database(String)` — Diesel/SQLite errors
- `AppError::Git(String)` — Git command failures
- `AppError::Io(String)` — File system errors
- `AppError::Internal(String)` — General errors

All handler functions return `Result<T, AppError>`. Tauri serializes errors as strings to the frontend.
