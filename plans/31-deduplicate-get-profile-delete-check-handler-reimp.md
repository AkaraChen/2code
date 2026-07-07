# Deduplicate get_profile_delete_check: handler reimplements service::profile::delete_check

> Handlers duplicate service-layer logic byte-for-byte (delete-check + 10 git command orchestrations), violating the codebase's thin-handler rule and leaving the real service functions dead or hand-synced. | Severity: low | Category: dx

## Problem

The repo's own layering docs are explicit: handlers are "thin delegation only" (`src-tauri/CLAUDE.md`), and "DB queries or git operations directly in handler" is a listed anti-pattern (`src-tauri/src/handler/CLAUDE.md`). Two handler files currently violate this by reimplementing service-layer logic instead of calling it:

**1. Profile delete check is implemented twice, line-for-line.**

- `src-tauri/src/handler/profile.rs:51-82` — `get_profile_delete_check` runs the full sequence itself inside `run_blocking`: `repo::profile::find_by_id` (under a short DB lock) → `infra::git::diff_stats` → `infra::git::branch_unique_commits` → `infra::git::commit_diff_stats` → assemble `ProfileDeleteCheck`.
- `src-tauri/crates/service/src/profile.rs:551-572` — `delete_check(conn: &mut SqliteConnection, id)` is the identical sequence. It has **zero callers anywhere in src-tauri** (verified by grep, including tests) — pure dead code that must be manually kept in sync with the handler.
- The private helper `add_diff_stats` is duplicated verbatim: `handler/profile.rs:8-14` vs `service/profile.rs:574-580`. The handler copy even carries its own unit tests (`handler/profile.rs:99-142`); the service copy has none.

The only real difference is lock scoping: the handler locks the single-connection DB mutex (`DbPool = Arc<Mutex<SqliteConnection>>`, `src-tauri/crates/infra/src/db.rs:11`) only for the row lookup and runs the three git subprocesses outside the lock, whereas the conn-based service signature would hold the mutex for the whole call. That lock scoping is load-bearing and must be preserved — but the service layer already has the pattern for this: `service::profile::create_with_db(db: &DbPool, ...)` (`service/profile.rs:382-428`) and `service::filesystem::get_profile_worktree_path(db: &DbPool, ...)` (`crates/service/src/filesystem.rs:29-36`).

**2. Every git IPC command in `handler/project.rs` bypasses its service-layer counterpart.**

`src-tauri/src/handler/project.rs:12-23` defines local helpers `profile_worktree_path(db, profile_id)` and `project_folder(db, project_id)`, and the git commands (`get_git_diff` at :77, `get_git_diff_snapshot` :91, `get_git_diff_stats` :105, `get_git_log` :119, `get_commit_diff` :134, `get_git_binary_preview` :149, `commit_git_changes` :215, `discard_git_file_changes` :232, `get_git_ahead_count` :247, `list_git_branches` :261, `checkout_git_branch` :275, `git_push` :290, `get_git_pull_request_status` :304, `get_project_config` :391, `save_project_config` :405, `get_project_github_avatar` :420) each inline the lookup + `infra::git`/`infra::config` call directly in the handler.

Meanwhile `src-tauri/crates/service/src/project.rs:215-362` contains a parallel set of conn-based wrappers doing the same thing: `get_diff` (:215), `get_diff_stats` (:223), `get_log` (:231), `get_commit_diff` (:240), `get_binary_preview` (:249 — including the same 50-line `match source` block duplicated at handler/project.rs:165-206), `commit_changes` (:305), `discard_file_changes` (:316), `get_ahead_count` (:325), `push` (:333), `get_github_avatar` (:356). Of these:

- `get_diff`, `get_log`, `get_commit_diff`, `commit_changes` are called only from `src-tauri/tests/integration_git.rs` (27 call sites) — so the integration tests validate a code path production **no longer runs**.
- `get_diff_stats`, `get_binary_preview`, `discard_file_changes`, `get_ahead_count`, `push`, `get_github_avatar` have **zero callers** anywhere.

Consequence: any future fix to this path (error mapping, the short-lock pattern, the binary-preview `source` match) must be applied twice, and drift between the two copies is silent because nothing enforces they stay in sync.

## Evidence & Measurements

No benchmark applies (non-perf finding). Concrete evidence:

- Byte-identical logic: compare `handler/profile.rs:57-79` with `service/profile.rs:555-571` — same call sequence, same struct assembly; `add_diff_stats` at `handler/profile.rs:8-14` and `service/profile.rs:574-580` are character-identical bodies.
- Dead code: `grep -rn "service::profile::delete_check" src-tauri/` returns only the definition. `grep -rn "service::project::get_diff_stats\|get_binary_preview\|discard_file_changes\|get_ahead_count\|service::project::push\|get_github_avatar" src-tauri/` — no callers outside `crates/service/src/project.rs`.
- Test-only callers: `grep -n "service::project::" src-tauri/tests/integration_git.rs` shows 27 calls to `get_diff`/`get_log`/`get_commit_diff`/`commit_changes` — none of which is the code the shipped handlers execute.
- Measured impact: ~30 lines of exact duplication for delete_check + add_diff_stats; 10 handler commands bypassing 10 hand-synced service wrappers; 2 duplicate unit tests; 4 handler-local helper tests (`handler/project.rs:474-508`) testing code that belongs in the service layer.

## Proposed Change

Pure refactor, no behavior change, no IPC signature change (no `tauri-typegen` regeneration needed — command names/params/returns are unchanged). Direction: move orchestration into the service layer with **`&DbPool`-based signatures that lock only for the row lookup** (copying the handler's existing lock scoping), make handlers one-line delegations, delete the conn-based service duplicates, and port the integration tests.

**CRITICAL constraint:** do NOT simply have handlers call the existing conn-based `service::project::*`/`delete_check` functions — that would hold the single DB mutex across git subprocess execution (a documented anti-pattern: "Long-held `Mutex` locks across async operations"). The new service functions must take `&DbPool` and scope the lock exactly as the handlers do today.

### Step 1 — `src-tauri/crates/service/src/profile.rs`: replace `delete_check` with `delete_check_with_db`

Replace the dead `delete_check` (lines 551-572) with a DbPool variant, named to match the sibling `create_with_db` convention. `use infra::db::DbPool;` is already imported (line 5).

```rust
pub fn delete_check_with_db(
	db: &DbPool,
	id: &str,
) -> Result<ProfileDeleteCheck, AppError> {
	let profile = {
		let conn = &mut *db.lock().map_err(|_| AppError::LockError)?;
		repo::profile::find_by_id(conn, id)?
	};
	let working_tree_diff = infra::git::diff_stats(&profile.worktree_path)?;
	let unpushed_commits = infra::git::branch_unique_commits(
		&profile.worktree_path,
		&profile.branch_name,
	)?;
	let unpushed_commit_diff =
		infra::git::commit_diff_stats(&profile.worktree_path, &unpushed_commits)?;

	Ok(ProfileDeleteCheck {
		total_diff: add_diff_stats(&working_tree_diff, &unpushed_commit_diff),
		working_tree_diff,
		unpushed_commit_count: unpushed_commits.len() as u32,
		unpushed_commit_diff,
	})
}
```

Keep `add_diff_stats` here (`service/profile.rs:574-580`) — this becomes its only copy. Move the two unit tests `add_diff_stats_sums_fields` and `add_diff_stats_keeps_zero_side_neutral` from `handler/profile.rs:103-141` into the existing `#[cfg(test)] mod tests` of `service/profile.rs` (it starts at line 582; the tests need no new imports beyond what `use super::*;` provides — `GitDiffStats` is already imported at file top).

### Step 2 — `src-tauri/src/handler/profile.rs`: delegate

Replace the body of `get_profile_delete_check` (lines 51-82) with:

```rust
#[tauri::command]
#[tracing::instrument(skip_all)]
pub async fn get_profile_delete_check(
	id: String,
	state: State<'_, DbPool>,
) -> Result<ProfileDeleteCheck, AppError> {
	let db = state.inner().clone();
	super::run_blocking(move || service::profile::delete_check_with_db(&db, &id))
		.await
}
```

Then delete from this file: the local `add_diff_stats` (lines 8-14), the entire `#[cfg(test)] mod tests` (lines 99-142, now moved to the service crate), and the now-unused import `use model::project::GitDiffStats;` (line 6). The other imports (`Profile`, `ProfileDeleteCheck`, `DbPool`, `AppError`) remain in use.

### Step 3 — `src-tauri/crates/service/src/project.rs`: DbPool-based git orchestration

Add `use infra::db::DbPool;` and extend the `model::project` import with `GitBranchInfo`, `GitDiffSnapshot`, `ProjectConfig` (currently imported only in the handler).

Move the two helpers from `handler/project.rs:12-23` here, verbatim, as private functions:

```rust
fn profile_worktree_path(
	db: &DbPool,
	profile_id: &str,
) -> Result<String, AppError> {
	let conn = &mut *db.lock().map_err(|_| AppError::LockError)?;
	Ok(repo::profile::find_by_id(conn, profile_id)?.worktree_path)
}

fn project_folder(db: &DbPool, project_id: &str) -> Result<String, AppError> {
	let conn = &mut *db.lock().map_err(|_| AppError::LockError)?;
	Ok(repo::project::find_by_id(conn, project_id)?.folder)
}
```

Rewrite the ten existing conn-based wrappers (lines 215-362) in place, keeping their names but changing the first parameter from `conn: &mut SqliteConnection` to `db: &DbPool` and resolving the path via the helper (lock is released before any git subprocess runs). Pattern:

```rust
pub fn get_diff(db: &DbPool, profile_id: &str) -> Result<String, AppError> {
	let worktree_path = profile_worktree_path(db, profile_id)?;
	infra::git::diff(&worktree_path)
}
```

Apply identically to: `get_diff`, `get_diff_stats`, `get_log(db, profile_id, limit)`, `get_commit_diff(db, profile_id, commit_hash)`, `commit_changes(db, profile_id, files, message, body)`, `discard_file_changes(db, profile_id, paths)`, `get_ahead_count(db, profile_id)`, `push(db, profile_id)`, `get_github_avatar(db, project_id)` (uses `project_folder`), and `get_binary_preview(db, profile_id, cache_root: &Path, path, source, commit_hash)` — for the last one, keep the existing `match source` body from `service/project.rs:258-302` (it is already identical to the handler copy at `handler/project.rs:165-206`); only the profile lookup line changes.

Add new wrappers, same pattern, for the handler-only commands that currently have no service counterpart:

```rust
pub fn get_diff_snapshot(db: &DbPool, profile_id: &str) -> Result<GitDiffSnapshot, AppError>   // infra::git::diff_snapshot
pub fn list_branches(db: &DbPool, profile_id: &str) -> Result<Vec<GitBranchInfo>, AppError>    // infra::git::list_branches
pub fn checkout_branch(db: &DbPool, profile_id: &str, branch: &str) -> Result<(), AppError>    // infra::git::checkout_branch
pub fn get_pull_request_status(db: &DbPool, profile_id: &str, branch_name: Option<&str>) -> Result<Option<GitPullRequestStatus>, AppError>
	// resolves worktree, then calls the existing get_pull_request_status_for_folder (service/project.rs:341-354);
	// get_pull_request_status_for_folder can then become private (its only caller was handler/project.rs:312)
pub fn get_config(db: &DbPool, project_id: &str) -> Result<ProjectConfig, AppError>            // infra::config::load_project_config(&folder)
pub fn save_config(db: &DbPool, project_id: &str, config: &ProjectConfig) -> Result<(), AppError> // infra::config::write_project_config(&folder, config)
```

Finally, move the four helper tests from `handler/project.rs:432-509` (`setup_db` + `profile_worktree_path_reads_only_the_needed_field`, `project_folder_reads_only_the_needed_field`, and the two `*_returns_not_found_*` tests) into a new `#[cfg(test)] mod tests` at the bottom of `service/project.rs`, unchanged (the helpers stay private; same-module tests can call them). The tests need `diesel::prelude::*`, `diesel_migrations::MigrationHarness`, `model::profile::NewProfile`, `model::project::NewProject`, `std::sync::{Arc, Mutex}` — all already available to the service crate (its `profile.rs` tests use diesel/diesel_migrations dev-deps today).

### Step 4 — `src-tauri/src/handler/project.rs`: delegate everything

Delete the local `profile_worktree_path`/`project_folder` helpers (lines 12-23) and the whole `#[cfg(test)]` module (lines 432-509). Rewrite each command body to a single service call inside `run_blocking`. Examples:

```rust
// get_git_diff
super::run_blocking(move || service::project::get_diff(&db, &profile_id)).await

// get_git_log
super::run_blocking(move || {
	service::project::get_log(&db, &profile_id, limit.unwrap_or(50))
})
.await

// get_git_binary_preview — cache dir MUST still be resolved in the handler
// (needs AppHandle; keep handler/project.rs:158-162 exactly as-is):
let cache_root = app
	.path()
	.app_cache_dir()
	.map_err(|err| AppError::IoError(std::io::Error::other(err)))?
	.join("git-preview-cache");
super::run_blocking(move || {
	service::project::get_binary_preview(
		&db,
		&profile_id,
		&cache_root,
		&path,
		&source,
		commit_hash.as_deref(),
	)
})
.await

// commit_git_changes
super::run_blocking(move || {
	service::project::commit_changes(
		&db, &profile_id, &files, &message, body.as_deref(),
	)
})
.await

// get_git_pull_request_status
super::run_blocking(move || {
	service::project::get_pull_request_status(
		&db, &profile_id, branch_name.as_deref(),
	)
})
.await

// get_project_config / save_project_config / get_project_github_avatar
service::project::get_config(&db, &project_id)
service::project::save_config(&db, &project_id, &config)
service::project::get_github_avatar(&db, &project_id)
```

Map the rest mechanically: `get_git_diff_snapshot` → `get_diff_snapshot`, `get_git_diff_stats` → `get_diff_stats`, `get_commit_diff` → `get_commit_diff`, `discard_git_file_changes` → `discard_file_changes`, `get_git_ahead_count` → `get_ahead_count`, `list_git_branches` → `list_branches`, `checkout_git_branch` → `checkout_branch`, `git_push` → `push`. Do not touch `create_project_from_folder`, `list_projects`, `update_project`, `delete_project`, `get_git_branch`, the project-group commands, or `update_project_sidebar_layout` — those already delegate correctly. After the rewrite, prune now-unused imports (e.g. `GitBinaryPreview`'s handler-side construction disappears; `Manager` is still needed for `app.path()`; keep `GitDiffStats` etc. only where still referenced in signatures).

No changes to `src-tauri/src/lib.rs` (command list unchanged) and no `cargo tauri-typegen generate` needed (IPC surface identical).

### Step 5 — `src-tauri/tests/integration_git.rs` (+ `tests/common/mod.rs`): port to DbPool signatures

The 27 call sites for `get_diff`/`get_log`/`get_commit_diff`/`commit_changes` pass `&mut conn`; they must pass `&DbPool` now. Add a helper to `src-tauri/tests/common/mod.rs`:

```rust
use infra::db::DbPool;
use std::sync::{Arc, Mutex};

/// Wrap a test connection in the app's DbPool type.
pub fn wrap_db(conn: SqliteConnection) -> DbPool {
	Arc::new(Mutex::new(conn))
}
```

Then in each affected test, wrap after seeding (`setup_db`/`create_project_with_git_repo` stay conn-based and unchanged):

```rust
let mut conn = setup_db();
let (_project, default_profile, dir) = create_project_with_git_repo(&mut conn);
let db = wrap_db(conn);
// ...
let diff = service::project::get_diff(&db, &default_profile.id).unwrap();
```

If any test needs raw connection access after wrapping, use `&mut *db.lock().unwrap()`. Note: `wrap_db` may trigger a dead-code warning from test binaries that don't use it (`tests/common/mod.rs` is shared) — add `#[allow(dead_code)]` on it like any other selectively-used common helper if warnings appear. These tests now exercise the exact code path production runs, fixing the "tests validate dead code" problem.

### Step 6 (optional, recommended) — new service-level test for `delete_check_with_db`

`service/profile.rs`'s test module already has `create_temp_git_repo`/`create_project_with_git_repo` helpers (lines 602-635). Add one test that seeds a project with a real git repo, wraps the conn in a `DbPool`, and asserts `delete_check_with_db` returns a clean result, then a dirty one:

```rust
#[test]
fn delete_check_with_db_counts_working_tree_changes() {
	let mut conn = setup_db();
	let (project, dir) = create_project_with_git_repo(&mut conn);
	// the default profile's worktree_path is the project folder
	let profile_id = format!("default-{}", project.id);
	let db: DbPool = std::sync::Arc::new(std::sync::Mutex::new(conn));

	let clean = delete_check_with_db(&db, &profile_id).unwrap();
	assert_eq!(clean.working_tree_diff.files_changed, 0);

	std::fs::write(dir.path().join("README.md"), "# Changed").unwrap();
	let dirty = delete_check_with_db(&db, &profile_id).unwrap();
	assert_eq!(dirty.working_tree_diff.files_changed, 1);
}
```

Keep assertions to `working_tree_diff` — `unpushed_commit_count` depends on `infra::git::branch_unique_commits` semantics for a branch with no upstream; check that function's behavior before asserting on it, or leave it unasserted.

## Verification

Environment note: **the full app crate cannot be built in CI containers** (missing GTK system libs). Never run plain `cargo build`/`cargo test`/`bun tauri ...` there.

1. **In the container (covers steps 1, 3, 6 — all service-crate changes):**
   ```bash
   cd /home/user/2code/src-tauri && cargo test -p model -p repo -p service -p infra
   ```
   Baseline is 151 passing tests. After this change expect that count **plus** the moved tests (2 `add_diff_stats` tests into service/profile.rs, 4 helper tests into service/project.rs) plus any new test from step 6 — and no test lost. A fast iteration loop: `cargo check -p service`.

2. **Grep checks (container-safe) that the duplication is actually gone:**
   ```bash
   grep -rn "infra::git::" /home/user/2code/src-tauri/src/handler/   # expect: no matches
   grep -rn "infra::config::" /home/user/2code/src-tauri/src/handler/ # expect: no matches
   grep -rn "add_diff_stats" /home/user/2code/src-tauri/src/          # expect: no matches (only in crates/service)
   grep -rn "fn delete_check(" /home/user/2code/src-tauri/            # expect: no matches (replaced by delete_check_with_db)
   ```

3. **On a dev machine or CI with GTK/macOS (covers steps 2, 4, 5 — app crate + integration tests):**
   ```bash
   cd src-tauri && cargo test
   ```
   This compiles the handlers and runs `tests/integration_git.rs` (now exercising the production DbPool path). Because handler edits cannot be test-verified in the container, keep them strictly mechanical as sketched above.

4. **Frontend:** untouched — no bindings change (command names/params identical, so `src/generated/` is stable). Optionally confirm nothing regressed: `cd /home/user/2code && bunx vitest run` (baseline 671 passing).

5. **Manual smoke (dev machine only, `bun tauri dev`):** open a project profile, trigger the delete-profile dialog (exercises `get_profile_delete_check`), open the git diff view and commit history (exercises `get_git_diff`/`get_git_log`/`get_commit_diff`), and commit a change from the UI (`commit_git_changes`).

Existing coverage of this area: `src-tauri/tests/integration_git.rs` (diff/log/commit-diff/commit paths), handler helper tests being relocated (worktree/folder resolution incl. NotFound cases), and the `add_diff_stats` unit tests being relocated.

## Risks & Constraints

- **Lock scoping is the whole point (CLAUDE.md invariant):** the DB is a single `Arc<Mutex<SqliteConnection>>`, not a pool. Every new service function must lock only for `repo::*::find_by_id` and release before spawning git subprocesses (`diff_stats`, `branch_unique_commits`, `commit_diff_stats`, `commit`, `push`, ...). Holding the mutex across a slow `git push` would block every other DB operation in the app. The sketches above encode this via the `{ let conn = ...; }` block / helper call — do not "simplify" it away.
- **Do not change IPC shape:** command names, parameter names (camelCase mapping), and return types must stay identical, or `src/generated/` bindings (gitignored, regenerated via `cargo tauri-typegen generate`) and every frontend hook would need regeneration. This refactor requires zero frontend changes; if typegen output would differ, something went wrong.
- **Handler changes are compile-verified only outside the container:** steps 2 and 4 (and the integration-test port in step 5) cannot be built where GTK is missing. Keep them mechanical; the service-crate tests are the safety net that the logic itself is unchanged.
- **Error-path parity:** `get_binary_preview`'s `commit_hash is required...` / `Unsupported preview source` `GitError` messages and the `AppError::LockError` / `AppError::NotFound` mappings must survive verbatim — the frontend may match on messages, and the relocated NotFound tests assert on the variants.
- **`get_git_binary_preview` cache dir:** `app.path().app_cache_dir()` needs the `AppHandle` and must stay in the handler; the service takes `cache_root: &Path` (the existing conn-based `get_binary_preview` signature already models this — keep it).
- **Parallel-agent constraint from the environment:** implementer works on the listed files only; do not touch `project.inlang/settings.json`, `src/paraglide/`, or `src/schema.rs` (Diesel-generated).
- **Known adjacent smell left out of scope:** `handler/profile.rs:86-97` (`update_profile_notes`) calls `repo::profile::update_notes` directly, skipping the service layer. It is a trivial single-query pass-through with no duplication, so this plan leaves it alone; fold it into the service layer only if a `service::profile::update_notes` is wanted for consistency.
- **Naming:** `delete_check_with_db` follows the existing `create_with_db` convention in `service/profile.rs`. The `service::project` functions keep their current names with changed signatures because their conn-based forms are deleted in the same commit — there is no coexistence window and no other caller to migrate.
