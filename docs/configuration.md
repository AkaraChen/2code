# Configuration

## Config Files

| File | Location | Purpose |
|------|----------|---------|
| `tauri.conf.json` | `src-tauri/` | Tauri app config: window, build commands, bundling, typegen plugin |
| `Cargo.toml` | `src-tauri/` | Rust workspace config, dependencies, workspace members |
| `package.json` | Root | Frontend dependencies, scripts (`dev`, `build`, `lint`, `start`) |
| `vite.config.ts` | Root | Vite config: React plugin (with React Compiler), Paraglide plugin, path aliases, dev server |
| `tsconfig.json` | Root | TypeScript config: path aliases (`@/` → `src/`), `allowJs: true` for Paraglide |
| `eslint.config.js` | Root | ESLint config (flat config format) |
| `knip.config.ts` | Root | Dead code detection config |
| `justfile` | Root | Build recipes: `fmt`, `build-helper`, `build-helper-dev`, `start` |
| `project.inlang/settings.json` | Root | Paraglide.js i18n config, must include message format plugin module |
| `2code.json` | Per-project root | Project-level setup/teardown scripts |

## Build Commands

| Command | What it does |
|---------|-------------|
| `bun tauri dev` | Full dev server (frontend + Rust hot-reload). Runs `just build-helper-dev && bun run dev` first |
| `bun tauri build` | Production build. Runs `just build-helper && bun run build` first |
| `bun run dev` | Frontend-only Vite dev server on port 1420 |
| `bun run build` | `paraglide-js compile` → `tsc` → `vite build` |
| `just fmt` | Run `fama` code formatter |
| `just build-helper` | Build sidecar in release mode, copy to `binaries/` |
| `just build-helper-dev` | Build sidecar in debug mode, copy to `binaries/` |
| `cargo test` | Run all Rust tests (from `src-tauri/`) |
| `cargo tauri-typegen generate` | Regenerate TypeScript IPC bindings |

## Environment Variables

### PTY Session Environment

Injected into every PTY session by `infra/pty.rs`:

| Variable | Value | Purpose |
|----------|-------|---------|
| `TERM` | `xterm-256color` | Terminal type for color support |
| `_2CODE_HELPER_URL` | `http://127.0.0.1:{port}` | URL for sidecar → app HTTP communication |
| `_2CODE_HELPER` | `/path/to/2code-helper-{target}` | Path to sidecar binary |
| `_2CODE_SESSION_ID` | UUID | Session identifier for notification routing |
| `ZDOTDIR` | Temp directory path | Overrides zsh init directory for shell init injection |
| `_2CODE_ORIG_ZDOTDIR` | Original `$ZDOTDIR` | Preserved original ZDOTDIR for restoration |

### Build-time Environment

| Variable | Set By | Purpose |
|----------|--------|---------|
| `TARGET` | `build.rs` | Rust target triple (e.g., `aarch64-apple-darwin`) for sidecar filename |
| `CARGO_MANIFEST_DIR` | Cargo | Used for resolving sidecar path in dev mode |
| `TAURI_DEV_HOST` | Tauri CLI | Custom dev server host for remote debugging |

## Database Schema

SQLite database stored at `{app_data_dir}/app.db`. Pragmas: `journal_mode=WAL`, `foreign_keys=ON`.

### Tables

#### `projects`

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | TEXT | PRIMARY KEY |
| `name` | TEXT | NOT NULL |
| `folder` | TEXT | NOT NULL |
| `created_at` | TIMESTAMP | NOT NULL |

#### `profiles`

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | TEXT | PRIMARY KEY |
| `project_id` | TEXT | NOT NULL, FK → projects(id) ON DELETE CASCADE |
| `branch_name` | TEXT | NOT NULL |
| `worktree_path` | TEXT | NOT NULL |
| `created_at` | TIMESTAMP | NOT NULL |
| `is_default` | BOOLEAN | NOT NULL |

#### `pty_sessions`

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | TEXT | PRIMARY KEY |
| `profile_id` | TEXT | NOT NULL, FK → profiles(id) ON DELETE CASCADE |
| `title` | TEXT | NOT NULL |
| `shell` | TEXT | NOT NULL |
| `cwd` | TEXT | NOT NULL |
| `created_at` | TIMESTAMP | NOT NULL |
| `closed_at` | TIMESTAMP | NULLABLE |

#### `pty_output_chunks`

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | INTEGER | PRIMARY KEY (nullable for auto-increment) |
| `session_id` | TEXT | NOT NULL, FK → pty_sessions(id) ON DELETE CASCADE |
| `data` | BLOB | NOT NULL |

### Relationships

```
projects 1──* profiles 1──* pty_sessions 1──* pty_output_chunks
```

All foreign keys use `ON DELETE CASCADE`.

## Project Configuration (`2code.json`)

Optional file in project root folder:

```json
{
  "setup_script": ["npm install"],
  "teardown_script": ["rm -rf node_modules"],
  "init_script": ["source ~/.nvm/nvm.sh", "nvm use"]
}
```

| Field | Type | When Executed |
|-------|------|--------------|
| `setup_script` | `string[]` | On profile creation, in worktree directory |
| `teardown_script` | `string[]` | On profile deletion, in worktree directory |
| `init_script` | `string[]` | On every new PTY session, injected via ZDOTDIR `.zshenv` |

Scripts execute via `sh -c` in the project/worktree directory.

## Tauri Plugins

Registered in `src-tauri/src/lib.rs`:

| Plugin | Purpose |
|--------|---------|
| `tauri-plugin-opener` | Open files/URLs with system default app |
| `tauri-plugin-dialog` | Native file/folder picker dialogs |
| `tauri-plugin-notification` | System notification API |
| `tauri-plugin-store` | Persistent key-value store (`settings.json`) for notification preferences |

## Frontend Storage

| Store | Backend | Key | Contents |
|-------|---------|-----|----------|
| Terminal settings | localStorage | `terminal-settings` | Font family, font size |
| Theme settings | localStorage | `theme-store` | Accent color, border radius, terminal theme |
| Notification settings | localStorage + tauri-plugin-store | `notification-settings` | Enabled flag, sound name |

The notification store dual-writes to both localStorage (for Zustand persist) and tauri-plugin-store `settings.json` (for the Rust backend to read when playing sounds).

## Window Configuration (`tauri.conf.json`)

| Setting | Value |
|---------|-------|
| Window size | 1440 x 900, centered |
| Title bar | macOS overlay style, hidden title |
| Traffic lights | Positioned at (16, 18) |
| Dev URL | `http://localhost:1420` |
| CSP | Disabled (null) |
| External binaries | `binaries/2code-helper` |
| Bundle targets | All platforms |
