# Hold the DB mutex only for the profile lookup in search_file / get_file_tree_git_status handlers

> The global SQLite mutex is held across a full worktree walk (~95ms) / `git status` subprocess (~46ms) per call, starving other DB users (including the sync main-thread `resize_pty`) for up to tens of seconds during typing in the file-search box; fix by resolving the profile's worktree path under a short lock and doing all I/O lock-free, matching every sibling function in the same file. | Severity: high | Category: performance

## Problem

The backend has a **single** SQLite connection wrapped in `Arc<Mutex<SqliteConnection>>` (`pub type DbPool = Arc<Mutex<SqliteConnection>>;` — `src-tauri/crates/infra/src/db.rs:11`). Every handler and background job (project listing, profile CRUD, PTY session bookkeeping, watcher reconcile poll) contends for this one mutex, so the handler-layer rule is explicit: *"Holding `conn` lock longer than one service call"* is an anti-pattern (`src-tauri/src/handler/CLAUDE.md`).

Two filesystem handlers violate it — the only two in the file that do:

- `src-tauri/src/handler/filesystem.rs:197-208` — `search_file`:

  ```rust
  let db = state.inner().clone();
  super::run_blocking(move || {
      let conn = &mut *db.lock().map_err(|_| AppError::LockError)?;
      service::filesystem::search_file(conn, &profile_id, &query)
  })
  .await
  ```

- `src-tauri/src/handler/filesystem.rs:210-222` — `get_file_tree_git_status`: same shape, calls `service::filesystem::get_file_tree_git_status(conn, &profile_id)` at line 219 with the lock held.

The service functions then perform heavy I/O **while the mutex is still held**:

- `src-tauri/crates/service/src/filesystem.rs:10-18` — `search_file(conn: &mut SqliteConnection, ...)` does `repo::profile::find_by_id(conn, profile_id)` (the only work that actually needs the connection, ~20µs), then calls `infra::filesystem::search_files(root, query)` — an `ignore`-crate `WalkBuilder` recursive walk of the **entire worktree** (`src-tauri/crates/infra/src/filesystem.rs:303-343`).
- `src-tauri/crates/service/src/filesystem.rs:20-26` — `get_file_tree_git_status(conn, ...)` does the same `find_by_id`, then `infra::git::status(&profile.worktree_path)` — a spawned `git status --porcelain=v1 -z --untracked-files=all --ignored=matching` subprocess (`src-tauri/crates/infra/src/git.rs:129-139`).

While the lock is held, every other DB user blocks: `list_projects`, profile creation, the watcher's reconcile poll, and — critically — the **synchronous** `resize_pty` command (`src-tauri/src/handler/pty.rs:39-52`), which calls `db.lock()` at line 48 on the main thread. A background file search thus becomes a visible UI freeze.

The frontend fires `search_file` **per keystroke** (each query string is a distinct TanStack Query key), so during typing the mutex is re-acquired back-to-back. Because `std::sync::Mutex` is unfair, a competing locker can be starved for many seconds, not just one walk's duration.

This is an oversight, not a design choice: all 11 sibling functions in `src-tauri/crates/service/src/filesystem.rs` already use the short-lock pattern — see `get_profile_worktree_path(db: &DbPool, ...)` at lines 29-36 (doc comment: *"short DB lock"*), which locks only around `find_by_id` and releases before any I/O. `resolve_terminal_file_path` (lines 240-247), `read_file_content` (131-143), etc. all take `&DbPool`.

## Evidence & Measurements

Verified benchmark results (release profile, Linux container, tmpfs-backed temp tree: 30,000 tracked files across 3,000 dirs + 2,000 gitignored files, committed clean git repo; in-memory SQLite with real migrations, project+profile rows; bench file `src-tauri/crates/service/tests/__bench_fs_lock_2566.rs` (deleted after run), `cargo test -p service --test __bench_fs_lock_2566 --release -- --nocapture`, total run 117.7s):

RAW MUTEX HOLD TIME (current code, 5 iters after 2 warmups, real production functions):
- `infra::filesystem::search_files(root, "main")`: mean 95.0ms, min 84.3ms, max 133.9ms  == lock hold per `search_file` call
- `infra::git::status(worktree)`, clean tree: mean 45.7ms, min 43.5ms, max 47.4ms  == lock hold per `get_file_tree_git_status` call
- `repo::profile::find_by_id` (the only work needing the lock): ~0.02ms (200 iters)

CONTENTION A/B (writer hammers the op for 3s of reader-clock; reader locks pool + `find_by_id` every 5ms, timing lock+query; production baseline vs short-lock fix reimplemented in the bench, identical outputs asserted):
- `search_file` CURRENT (lock across walk): reader got 1 sample in the window — first lock acquisition took 29,308ms (starved by unfair std Mutex; writer ran 339 back-to-back searches ~86ms each during that time)
- `search_file` FIXED (short lock): 583 reader samples, p50 0.019ms, p99 0.1ms, max 0.1ms; writer 34 iters/3s (~88ms/search — no throughput loss)
- `git_status` CURRENT (lock across subprocess): reader got 2 samples, first acquisition 78,426ms (starved; writer 1,637 statuses ~48ms each)
- `git_status` FIXED (short lock): 544 reader samples, p50 0.020ms, p99 0.0ms, max 0.1ms

Net: competing DB-user lock latency drops from 46-95ms minimum (up to multi-second starvation under repeated calls) to ~0.02ms — a ~4,000x reduction in hold time per call. The absolute per-call hold time scales with repo size (30k files is mid-size; 100k+ file repos would hold the lock hundreds of ms per keystroke). The fixed variants were verified to return **identical results** to the current code on the same fixture.

## Proposed Change

Two files change (plus the colocated tests in one of them). No behavior difference, no new APIs — just adopt the existing sibling pattern.

### 1. `src-tauri/crates/service/src/filesystem.rs`

Change both functions to take `&DbPool` and resolve the worktree path via the existing `get_profile_worktree_path` helper (already in this file at line 29), so the lock is released before the walk / subprocess:

```rust
pub fn search_file(
	db: &DbPool,
	profile_id: &str,
	query: &str,
) -> Result<Vec<FileSearchResult>, AppError> {
	let root = get_profile_worktree_path(db, profile_id)?; // short DB lock
	infra::filesystem::search_files(&root, query)
}

pub fn get_file_tree_git_status(
	db: &DbPool,
	profile_id: &str,
) -> Result<Vec<FileTreeGitStatusEntry>, AppError> {
	let worktree = get_profile_worktree_path(db, profile_id)?; // short DB lock
	infra::git::status(&worktree.to_string_lossy())
}
```

Notes:
- `get_profile_worktree_path` returns `PathBuf`; `infra::filesystem::search_files` takes `&Path` (pass `&root`), and `infra::git::status` takes `&str` (pass `&worktree.to_string_lossy()`). The current code passes `&profile.worktree_path` (a `String`) to `status`, so `to_string_lossy()` is equivalent for any path that round-trips (all real worktree paths do — they were stored from strings).
- After this change the `use diesel::SqliteConnection;` import at line 3 may become unused in the non-test build (the `#[cfg(test)]` module still uses `SqliteConnection` via `diesel::prelude::*`). Remove it from the top-level imports if `cargo test -p service` warns; the tests import their own prelude.
- Do NOT change `get_profile_worktree_path` itself, `infra::filesystem::search_files`, or `infra::git::status`.

### 2. `src-tauri/crates/service/src/filesystem.rs` — colocated tests (lines 249-312)

The two tests `search_file_uses_the_profiles_worktree` (line 284) and `search_file_returns_a_not_found_error_for_unknown_profiles` (line 305) currently pass `&mut conn` directly. After the signature change they must wrap the connection in a `DbPool`:

```rust
#[test]
fn search_file_uses_the_profiles_worktree() {
	let dir = tempdir().expect("tempdir");
	std::fs::create_dir_all(dir.path().join("src")).expect("mkdir src");
	std::fs::write(dir.path().join("src/main.rs"), "fn main() {}")
		.expect("write main");
	std::fs::write(dir.path().join("README.md"), "# readme")
		.expect("write readme");

	let mut conn = setup_db();
	let profile_id = insert_profile(&mut conn, &dir.path().to_string_lossy());
	let db: infra::db::DbPool =
		std::sync::Arc::new(std::sync::Mutex::new(conn));

	let results =
		search_file(&db, &profile_id, "main").expect("search files");

	assert_eq!(results.len(), 1);
	assert_eq!(results[0].name, "main.rs");
	assert_eq!(results[0].relative_path, "src/main.rs");
}

#[test]
fn search_file_returns_a_not_found_error_for_unknown_profiles() {
	let conn = setup_db();
	let db: infra::db::DbPool =
		std::sync::Arc::new(std::sync::Mutex::new(conn));

	let result = search_file(&db, "missing-profile", "main");

	assert!(matches!(result, Err(AppError::NotFound(_))));
}
```

(The `DbPool` type alias is `Arc<Mutex<SqliteConnection>>` from `infra::db` — already imported at the top of the file as `use infra::db::DbPool;`, which the tests can reference via `super::` or a direct `use`.)

### 3. `src-tauri/src/handler/filesystem.rs` (lines 197-222)

Stop locking in the handlers; pass `&db` like every sibling handler in this file (e.g. `resolve_terminal_file_path` at lines 224-239, `get_file_preview` at 183-192):

```rust
#[tauri::command]
#[tracing::instrument(skip_all)]
pub async fn search_file(
	profile_id: String,
	query: String,
	state: State<'_, DbPool>,
) -> Result<Vec<FileSearchResult>, AppError> {
	let db = state.inner().clone();
	super::run_blocking(move || {
		service::filesystem::search_file(&db, &profile_id, &query)
	})
	.await
}

#[tauri::command]
#[tracing::instrument(skip_all)]
pub async fn get_file_tree_git_status(
	profile_id: String,
	state: State<'_, DbPool>,
) -> Result<Vec<FileTreeGitStatusEntry>, AppError> {
	let db = state.inner().clone();
	super::run_blocking(move || {
		service::filesystem::get_file_tree_git_status(&db, &profile_id)
	})
	.await
}
```

Command names, parameters, and return types are unchanged, so **no `cargo tauri-typegen generate` run is needed** and no frontend changes are required.

## Verification

CRITICAL: the full Tauri app crate does NOT build in CI containers (missing GTK system libs). Never run plain `cargo build` / `cargo test` or `bun tauri ...`. Always use `-p` flags for workspace crates.

1. Workspace-crate tests (must all pass; this compiles the changed service crate and runs the two updated colocated tests plus everything else — 151 tests at time of writing):

   ```bash
   cd /home/user/2code/src-tauri && cargo test -p model -p repo -p service -p infra
   ```

2. Handler-file compile check: the app crate cannot be built here, so the handler edit is verified by inspection — it must be shape-identical to the adjacent `resolve_terminal_file_path` handler (same file, lines 224-239), differing only in the service function called. `cargo check -p service` catches any signature mismatch on the service side. If you have a GTK-capable environment (local dev machine), additionally run `cd src-tauri && cargo check` to compile the app crate.

3. Existing tests covering the area:
   - `crates/service/src/filesystem.rs` — `search_file_uses_the_profiles_worktree`, `search_file_returns_a_not_found_error_for_unknown_profiles` (updated in step 2 of the change; they assert result content and the NotFound error path, so they prove behavior is unchanged).
   - `infra` crate tests cover `search_files` / git plumbing independently and are untouched.

4. New test to add (in the same `#[cfg(test)]` module of `crates/service/src/filesystem.rs`): a lock-release regression test proving the DB mutex is free while the search runs. Simplest robust form — after calling `search_file(&db, ...)` successfully, assert the pool is immediately lockable with `try_lock`:

   ```rust
   #[test]
   fn search_file_releases_the_db_lock_before_returning() {
       // setup identical to search_file_uses_the_profiles_worktree ...
       let results = search_file(&db, &profile_id, "main").expect("search files");
       assert_eq!(results.len(), 1);
       // The pool must not be poisoned or held.
       assert!(db.try_lock().is_ok());
   }
   ```

   A stronger (optional) variant: spawn a thread that holds `db.lock()` for ~200ms *after* handing the worktree path to the DB, and assert `search_file` still completes — but that inverts the dependency; the `try_lock` assertion plus the code shape (lock scoped inside `get_profile_worktree_path`) is sufficient for regression purposes. Do not add a timing-based test — timing tests are flaky in CI.

5. Optional benchmark reproduction (only if re-measurement is requested): recreate a throwaway `src-tauri/crates/service/tests/` bench that builds a 30k-file git fixture, times `db.lock()` acquisition from a competing thread while hammering `search_file`, and run with `cargo test -p service --test <name> --release -- --nocapture`. Expected: competing-lock p50 ~0.02ms after the fix (vs. 29s+ starvation before). Delete the bench file afterwards — do not commit it.

6. Frontend: no changes, but sanity-check nothing broke in the generated-bindings consumers:

   ```bash
   cd /home/user/2code && bunx vitest run src/features
   ```

## Risks & Constraints

- **CLAUDE.md invariants**:
  - Handlers stay thin (no business logic added — this change makes them thinner) and must not hold the `conn` lock longer than one repo call, which is exactly what the fix enforces.
  - The DB is single-connection (`Arc<Mutex<SqliteConnection>>`), not a pool — do not "fix" this by adding a connection pool; that is out of scope.
  - `src/generated/` bindings are auto-generated; since command signatures (names/params/returns) are unchanged, do not regenerate or touch them.
  - Do not edit `src-tauri/src/schema.rs`, `project.inlang/settings.json`, or `src/paraglide/`.
- **Staleness window (accepted, pre-existing)**: between the profile lookup and the walk / `git status`, the profile row could theoretically be deleted or its worktree moved. This window is identical in kind to all 11 sibling functions that already use `get_profile_worktree_path` (e.g. `read_file_content`, `resolve_terminal_file_path`), and the I/O layer already returns `NotFound`/`IoError` for missing directories (`infra/src/filesystem.rs:311-316` checks `root.is_dir()`). No new failure mode is introduced.
- **`String` → `PathBuf` → `&str` round-trip for `infra::git::status`**: `to_string_lossy()` is lossless for the paths involved (they originate as UTF-8 strings stored in SQLite TEXT columns). Behavior-identical.
- **Unused-import warning**: removing/keeping `use diesel::SqliteConnection;` at the top of `crates/service/src/filesystem.rs` — check compiler warnings after the edit; the crate may deny warnings in CI. The test module still needs `diesel::prelude::*` (already imported there).
- **Do not** widen scope: `resize_pty`'s own main-thread sync `db.lock()` (handler/pty.rs:48) is a separate finding (finding 1) — leave it alone here; this change already removes its worst blocker.
- **Regression risk is minimal**: the fix reuses an existing, tested helper; the verifier confirmed the fixed variants produce byte-identical results to the current code on a 30k-file fixture.
