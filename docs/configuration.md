# Configuration

## Config Files

| File                           | Location         | Purpose                                                                                     |
| ------------------------------ | ---------------- | ------------------------------------------------------------------------------------------- |
| `tauri.conf.json`              | `src-tauri/`     | Tauri app config: window, build commands, bundling, typegen plugin                          |
| `Cargo.toml`                   | `src-tauri/`     | Rust workspace config, dependencies, workspace members                                      |
| `package.json`                 | Root             | Frontend dependencies, scripts (`dev`, `build`, `lint`, `start`)                            |
| `vite.config.ts`               | Root             | Vite config: React plugin (with React Compiler), Paraglide plugin, path aliases, dev server |
| `tsconfig.json`                | Root             | TypeScript config: path aliases (`@/` → `src/`), `allowJs: true` for Paraglide              |
| `eslint.config.js`             | Root             | ESLint config (flat config format)                                                          |
| `knip.config.ts`               | Root             | Dead code detection config                                                                  |
| `justfile`                     | Root             | Build recipes: `fmt`, `coverage`, `start`                                                   |
| `project.inlang/settings.json` | Root             | Paraglide.js i18n config, must include message format plugin module                         |
| `2code.json`                   | Per-project root | Project-level setup/teardown/init scripts and terminal templates                            |

## Build Commands

| Command                        | What it does                                                                                    |
| ------------------------------ | ----------------------------------------------------------------------------------------------- |
| `bun tauri dev`                | Full dev server (frontend + Rust hot-reload). Runs `scripts/tauri-before.mjs` (Herdr sidecar) then Vite |
| `bun tauri build`              | Production build. Same sidecar install, then `bun run build`                                    |
| `bun run dev`                  | Frontend-only Vite dev server on port 1420                                                      |
| `bun run build`                | `paraglide-js compile` → `tsc` → `vite build`                                                   |
| `just fmt`                     | Run `fama` code formatter                                                                       |
| `bun ./scripts/herdr-sidecar.mjs` | Fetch/verify pinned Herdr v0.9.0 into `src-tauri/binaries/herdr-<triple>`                    |
| `cargo test`                   | Run all Rust tests (from `src-tauri/`)                                                          |
| `cargo tauri-typegen generate` | Regenerate TypeScript IPC bindings                                                              |

## Environment Variables

There is no Local env injection of `TERM` / `_2CODE_HELPER` / `ZDOTDIR`. Herdr panes own their own session environment. GUI startup isolates the dedicated `2code` Herdr namespace (never the user default session); see [Herdr integration](herdr-integration.md). No environment variable or CLI flag selects a runtime backend.

`2code.json` `init_script` and New Tab `startup_commands` are sent once after Herdr `tab.create` via `pane.send_input`.

### Build-time Environment

| Variable             | Set By     | Purpose                                                                |
| -------------------- | ---------- | ---------------------------------------------------------------------- |
| `TARGET`             | `build.rs` | Rust target triple (e.g., `aarch64-apple-darwin`) for sidecar filename |
| `CARGO_MANIFEST_DIR` | Cargo      | Used for resolving sidecar path in dev mode                            |
| `TAURI_DEV_HOST`     | Tauri CLI  | Custom dev server host for remote debugging                            |

## Database Schema

SQLite database stored at `{app_data_dir}/app.db`. Pragmas: `journal_mode=WAL`, `foreign_keys=ON`. Live schema: [`src-tauri/crates/model/src/schema.rs`](../src-tauri/crates/model/src/schema.rs).

sqlite profile/session and mapping tables are **DROPped**. They are not live. Profile identity is Herdr `workspace_id`. Sessions are live `pane_id`s.

### Tables

#### `projects`

| Column         | Type      | Constraints                    |
| -------------- | --------- | ------------------------------ |
| `id`           | TEXT      | PRIMARY KEY                    |
| `name`         | TEXT      | NOT NULL                       |
| `folder`       | TEXT      | NOT NULL                       |
| `created_at`   | TIMESTAMP | NOT NULL                       |
| `group_id`     | TEXT      | NULLABLE, FK → project_groups  |
| `sort_order`   | INTEGER   | NOT NULL                       |
| `pinned_at`    | TIMESTAMP | NULLABLE                       |
| `pinned_order` | INTEGER   | NULLABLE                       |

#### `project_groups`

| Column       | Type      | Constraints |
| ------------ | --------- | ----------- |
| `id`         | TEXT      | PRIMARY KEY |
| `name`       | TEXT      | NOT NULL    |
| `created_at` | TIMESTAMP | NOT NULL    |
| `sort_order` | INTEGER   | NOT NULL    |

#### `checkout_notes`

| Column          | Type      | Constraints                                   |
| --------------- | --------- | --------------------------------------------- |
| `project_id`    | TEXT      | NOT NULL, FK → projects(id)                   |
| `checkout_path` | TEXT      | NOT NULL                                      |
| `notes`         | TEXT      | NOT NULL                                      |
| `created_at`    | TIMESTAMP | NOT NULL                                      |

Primary key: `(project_id, checkout_path)`. Notes overlay the live Herdr catalog; they are not stored in Herdr.

### Relationships

```
project_groups 1──* projects 1──* checkout_notes
```

`projects.group_id` is nullable. Deleting a project forgets the catalog row and retains Herdr worktrees/panes.

## Project Configuration (`2code.json`)

Optional file in project root folder:

```json
{
  "setup_script": ["npm install"],
  "teardown_script": ["rm -rf node_modules"],
  "init_script": ["source ~/.nvm/nvm.sh", "nvm use"]
}
```

| Field             | Type       | When Executed                                            |
| ----------------- | ---------- | -------------------------------------------------------- |
| `setup_script`    | `string[]` | On profile creation, in the live checkout directory      |
| `teardown_script` | `string[]` | On profile deletion, in the live checkout directory      |
| `init_script`     | `string[]` | Once after Herdr `tab.create`, via `pane.send_input`     |
| `worktree_dir`    | `string`   | Optional override for git New Profile checkout path      |

Scripts execute via `sh -c` in the project/checkout directory.

## Tauri Plugins

Registered in `src-tauri/src/lib.rs`:

| Plugin                      | Purpose                                                                   |
| --------------------------- | ------------------------------------------------------------------------- |
| `tauri-plugin-opener`       | Open files/URLs with system default app                                   |
| `tauri-plugin-dialog`       | Native file/folder picker dialogs                                         |
| `tauri-plugin-notification` | System notification API                                                   |
| `tauri-plugin-store`        | Persistent key-value store (`settings.json`) for notification preferences |

## Frontend Storage

| Store                 | Backend                           | Key                     | Contents                                    |
| --------------------- | --------------------------------- | ----------------------- | ------------------------------------------- |
| Terminal settings     | localStorage                      | `terminal-settings`     | Font family, font size                      |
| Theme settings        | localStorage                      | `theme-store`           | Accent color, border radius, terminal theme |
| Notification settings | localStorage + tauri-plugin-store | `notification-settings` | Enabled flag, sound name                    |

The notification store dual-writes to both localStorage (for Zustand persist) and tauri-plugin-store `settings.json` (for the Rust backend to read when playing sounds).

## Window Configuration (`tauri.conf.json`)

| Setting           | Value                             |
| ----------------- | --------------------------------- |
| Window size       | 1440 x 900, centered              |
| Title bar         | macOS overlay style, hidden title |
| Traffic lights    | Positioned at (16, 24)            |
| Dev URL           | `http://localhost:1420`           |
| External binaries | `binaries/herdr` (pinned v0.9.0)  |
| Bundle targets    | All platforms                     |
