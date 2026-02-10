## Why

The app needs persistent project management — the ability to create, list, and delete projects, each tied to a local filesystem folder. Currently there is no database or persistence layer in the backend. Adding this enables future features (file browsing, terminal sessions per project, etc.) to be scoped to a project context.

## What Changes

- Add an embedded SQLite database via an ORM (e.g. Diesel or SeaORM) to the Rust backend for persistent storage.
- Create a `project` module with a `projects` table (id, name, folder path).
- Expose Tauri commands for full Project CRUD:
  - **create_project_temporary**: Generate a UUID, create a folder under `/tmp`, run `git init` inside it, and persist the project record.
  - **create_project_from_folder**: Accept a user-provided path, validate it exists, and persist the project record.
  - **list_projects**: Return all projects.
  - **get_project**: Return a single project by ID.
  - **update_project**: Update name or folder of an existing project.
  - **delete_project**: Remove the project record (does not delete the folder on disk).
- Register all new commands in `lib.rs` invoke handler.

## Capabilities

### New Capabilities

- `project-storage`: SQLite database setup, ORM integration, migrations, and the `projects` table schema.
- `project-crud`: Tauri commands for creating (temporary + from folder), listing, getting, updating, and deleting projects.

### Modified Capabilities

_(none — no existing specs are affected)_

## Impact

- **Dependencies**: New Rust crates added to `Cargo.toml` (ORM + SQLite driver + migration tooling).
- **Backend code**: New `project` module under `src-tauri/src/`, new DB initialization in `lib.rs` app setup.
- **State management**: A DB connection pool added to Tauri managed state alongside the existing PTY registry.
- **Filesystem**: Database file stored in the app's data directory (via `dirs` or Tauri's path resolver). Migrations run automatically on startup.
- **No frontend changes** in this change.
