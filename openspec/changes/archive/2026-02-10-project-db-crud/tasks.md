## 1. Dependencies & Diesel Setup

- [x] 1.1 Add `diesel`, `diesel_migrations` (with `sqlite` feature) to `src-tauri/Cargo.toml`
- [x] 1.2 Create `diesel.toml` in `src-tauri/` pointing to `src/project/schema.rs`
- [x] 1.3 Generate the `create_projects` migration via `diesel migration generate create_projects`
- [x] 1.4 Write the `up.sql` (CREATE TABLE projects with id, name, folder, created_at) and `down.sql` (DROP TABLE projects)
- [x] 1.5 Run `diesel migration run` to apply and auto-generate `schema.rs`

## 2. Database Initialization

- [x] 2.1 Create `src-tauri/src/db.rs` with `init_db` function: resolve app data dir, establish `SqliteConnection`, run embedded migrations, return `Arc<Mutex<SqliteConnection>>`
- [x] 2.2 Define `DbPool` type alias (`Arc<Mutex<SqliteConnection>>`) in `db.rs`
- [x] 2.3 Wire `db::init_db` into `lib.rs` — call it in `setup()` and register the pool via `.manage()`

## 3. Project Module — Models

- [x] 3.1 Create `src-tauri/src/project/mod.rs` with submodule declarations
- [x] 3.2 Move/verify `src-tauri/src/project/schema.rs` contains the Diesel `table!` macro for `projects`
- [x] 3.3 Create `src-tauri/src/project/models.rs` with `Project` (Queryable, Serialize) and `NewProject` (Insertable) structs
- [x] 3.4 Add `mod project;` to `lib.rs`

## 4. Project Module — Commands

- [x] 4.1 Create `src-tauri/src/project/commands.rs` with all command functions
- [x] 4.2 Implement `create_project_temporary`: generate UUID, `fs::create_dir`, run `git init` via `Command`, insert record, return `Project`
- [x] 4.3 Implement `create_project_from_folder`: validate path exists, generate UUID, insert record, return `Project`
- [x] 4.4 Implement `list_projects`: query all rows, return `Vec<Project>`
- [x] 4.5 Implement `get_project`: query by id, return `Project` or error
- [x] 4.6 Implement `update_project`: accept optional name/folder, update matching row, return updated `Project`
- [x] 4.7 Implement `delete_project`: delete by id, return error if not found

## 5. Integration & Registration

- [x] 5.1 Register all 6 project commands in `tauri::generate_handler!` in `lib.rs`
- [x] 5.2 Verify the app compiles with `cargo build` from `src-tauri/`
- [x] 5.3 Smoke test: run `bun tauri dev` and invoke commands from the browser console via `window.__TAURI__.core.invoke()`
