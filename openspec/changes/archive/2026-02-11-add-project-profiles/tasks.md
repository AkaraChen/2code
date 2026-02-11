## 1. Database & Schema

- [x] 1.1 Create Diesel migration for `profiles` table (id, project_id FK with CASCADE, branch_name, worktree_path, created_at)
- [x] 1.2 Run `diesel migration run` to generate updated `schema.rs`
- [x] 1.3 Add `dirs` crate to `Cargo.toml`

## 2. Profile Models

- [x] 2.1 Create `src-tauri/src/profile/mod.rs` with `pub mod models; pub mod commands;`
- [x] 2.2 Create `src-tauri/src/profile/models.rs` with `Profile` (Queryable, Selectable, Serialize), `NewProfile` (Insertable), `UpdateProfile` (AsChangeset) structs
- [x] 2.3 Register `mod profile;` in `lib.rs`

## 3. Project Config (`2code.json`)

- [x] 3.1 Create `src-tauri/src/config.rs` with `ProjectConfig` struct (`setup_script: Vec<String>`, `teardown_script: Vec<String>`) and `load_project_config(project_folder: &str) -> ProjectConfig` function
- [x] 3.2 Add `execute_scripts(scripts: &[String], cwd: &Path)` function that runs each command via `sh -c` and logs warnings on failure
- [x] 3.3 Register `mod config;` in `lib.rs`
- [x] 3.4 Write tests for config parsing: valid file, missing file, missing fields, invalid JSON

## 4. Error Handling

- [x] 4.1 Add `AppError::GitError(String)` variant to `error.rs`

## 5. Profile Commands

- [x] 5.1 Implement `create_profile(project_id, branch_name)` — lookup project, resolve worktree path via `dirs::home_dir()`, run `git worktree add`, insert DB record, execute setup scripts, return Profile
- [x] 5.2 Implement `list_profiles(project_id)` — query profiles filtered by project_id
- [x] 5.3 Implement `get_profile(id)` — query single profile by id
- [x] 5.4 Implement `update_profile(id, branch_name: Option)` — update profile record
- [x] 5.5 Implement `delete_profile(id)` — lookup profile, execute teardown scripts, run `git worktree remove --force`, delete DB record
- [x] 5.6 Register all profile commands in `tauri::generate_handler!` in `lib.rs`

## 6. Tests

- [x] 6.1 Write tests for `create_profile`: success, project not found, git worktree failure
- [x] 6.2 Write tests for `list_profiles`: with profiles, empty, nonexistent project
- [x] 6.3 Write tests for `get_profile`: found, not found
- [x] 6.4 Write tests for `update_profile`: update branch_name, no fields, not found
- [x] 6.5 Write tests for `delete_profile`: success, not found, teardown failure, worktree already removed
- [x] 6.6 Verify all tests pass with `cargo test`
