## Context

The app manages projects (folder + metadata in SQLite) and PTY sessions. There is no concept of branching or parallel workspaces. Users who want to work on multiple branches must manually manage Git worktrees outside the app.

The backend uses Diesel ORM with a single `Arc<Mutex<SqliteConnection>>`, embedded migrations, and the `AppError`/`AppResult` pattern for all commands. Existing modules (`project/`, `pty/`) follow the same structure: `models.rs` + `commands.rs` + `mod.rs`.

## Goals / Non-Goals

**Goals:**

- Add a `profiles` table and full CRUD commands following existing patterns
- Automate Git worktree creation/removal tied to profile lifecycle
- Parse `2code.json` from project directories for setup/teardown scripts
- Execute lifecycle scripts (setup on create, teardown on delete)
- Full test coverage for all operations

**Non-Goals:**

- Frontend UI (deferred)
- PTY integration with profiles (deferred — future change will allow passing profile_id when creating PTY)
- Profile-level terminal configuration (startup commands etc.) — deferred
- Cross-platform support for worktree paths (macOS only for now, same as rest of app)

## Decisions

### 1. Database schema: `profiles` table

```sql
CREATE TABLE profiles (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  branch_name TEXT NOT NULL,
  worktree_path TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

- UUID v4 for `id`, same as projects
- `ON DELETE CASCADE` so deleting a project cleans up its profiles
- `worktree_path` stores the absolute path to the worktree directory
- No unique constraint on `branch_name` per project — the user might recreate a profile for the same branch after deletion, and Git worktree itself enforces uniqueness of checked-out branches

**Alternatives considered:**

- Storing status (active/archived) — rejected as unnecessary; profiles exist or they don't
- Storing config (setup/teardown) per profile — rejected; config belongs in `2code.json` at the project level

### 2. Worktree path: `~/.2code/workspace/{profile_id}/`

Use only the profile UUID as the directory name under `~/.2code/workspace/`. This avoids encoding branch names in paths (which can contain `/` and other problematic characters) and keeps the scheme simple.

Resolve `~` via `dirs::home_dir()` at runtime. The `dirs` crate is already commonly used in Rust; we'll add it as a dependency.

**Alternatives considered:**

- Using `{project_id}-{branch_name}` — rejected per user feedback; profile_id alone is simpler
- Using app_data_dir — rejected; `~/.2code/` is the user-facing workspace root

### 3. Git worktree operations via `std::process::Command`

Use `git worktree add <path> <branch>` and `git worktree remove <path>` via `Command`, executed with `cwd` set to the project's folder (the main repo).

- On create: `git worktree add ~/.2code/workspace/{profile_id} {branch_name}`
- On delete: `git worktree remove ~/.2code/workspace/{profile_id}` (with `--force` if needed), then remove the DB record

No git2 library — keeps dependencies minimal and matches the existing `Command`-based pattern used for `git init` in project creation.

### 4. `2code.json` config file

Location: `{project.folder}/2code.json`

```json
{
  "setup_script": ["npm install", "cp .env.example .env"],
  "teardown_script": ["rm -rf node_modules"]
}
```

- Both fields are `Vec<String>`, each string is a complete shell command
- File is optional — missing file or missing fields means no scripts to run
- Parsed with serde_json (already a transitive dependency via Tauri)
- Scripts execute sequentially via `Command` with `sh -c "<command>"`, cwd set to the worktree path
- Script failure during create: log warning but still complete profile creation (worktree already exists)
- Script failure during delete: log warning but still proceed with worktree removal and DB cleanup

**Alternatives considered:**

- TOML/YAML config — rejected; JSON is simpler and serde_json is already available
- Storing scripts in DB — rejected per user requirement; config lives in the project directory
- Failing the whole operation on script error — rejected; the worktree itself is the critical resource, scripts are convenience

### 5. Module structure

New `src-tauri/src/profile/` module following existing patterns:

```
profile/
  mod.rs        — pub mod models; pub mod commands;
  models.rs     — Profile, NewProfile structs with Diesel derives
  commands.rs   — Tauri commands + tests
```

New `src-tauri/src/config.rs` for `2code.json` parsing (small enough for a single file, no sub-module needed).

### 6. New `AppError` variant

Add `AppError::GitError(String)` for git worktree failures, distinct from `PtyError` which is PTY-specific.

## Risks / Trade-offs

- **Git CLI dependency** — requires `git` on PATH. Mitigated: same assumption as existing `git init` in project creation.
- **Cascading delete doesn't clean filesystem** — `ON DELETE CASCADE` removes the DB record but not the worktree on disk. Mitigated: profile deletion command handles both; direct project deletion will leave orphaned worktrees. Could add cleanup logic to project delete in the future.
- **Script execution is shell-dependent** — `sh -c` assumes a POSIX shell. Acceptable for macOS-only target.
- **Single DB connection contention** — profile CRUD adds more DB operations through the shared mutex. Acceptable: operations are fast (single row inserts/deletes) and the app doesn't have high concurrency.
- **`dirs` crate dependency** — adds a new dependency. Mitigated: it's a small, well-maintained crate with no transitive dependencies worth worrying about.
