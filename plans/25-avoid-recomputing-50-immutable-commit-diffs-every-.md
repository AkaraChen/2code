# Avoid recomputing 50 immutable commit diffs every 10 seconds in get_git_log

> The history-pane poll burns 232–639 ms of git CPU/disk every 10 s recomputing 50 immutable commit diffs; a HEAD-oid-guarded backend cache makes the steady-state poll ~1.4 ms (up to 446x cheaper). | Severity: medium | Category: performance

## Problem

`infra::git::log` (src-tauri/crates/infra/src/git.rs:336-358) shells out to:

```
git log -{limit} --format=%H\x1f%h\x1f%an\x1f%ae\x1f%aI\x1f%s --shortstat
```

The `--shortstat` flag (git.rs:342) forces git to compute the full tree diff for **each** of the returned commits (files changed / insertions / deletions per commit). The Tauri command `get_git_log` (src-tauri/src/handler/project.rs:119-130) defaults `limit` to 50 (project.rs:127) and runs this on the blocking pool via `super::run_blocking`.

The frontend polls it aggressively: `useGitLog` (src/features/git/hooks.ts:63-72) uses `refetchOnMount: "always"` (hooks.ts:69) and `refetchInterval: enabled ? GIT_LIGHT_REFRESH_INTERVAL_MS : false` (hooks.ts:70), where `GIT_LIGHT_REFRESH_INTERVAL_MS = 10_000` (src/shared/lib/queryRefresh.ts:1). So while the history pane is open, the backend recomputes 50 full commit diffs every 10 seconds.

Commit history is immutable: if HEAD has not moved, the output of this command cannot change. Every poll where HEAD is unchanged is pure waste — git CPU, disk I/O, battery, and a blocking-pool thread occupied for the duration of the call. On repos where commits touch thousands of files (dependency bumps, generated code) each poll costs hundreds of ms to seconds.

Note: the per-commit stats ARE consumed by the UI — `CommitList.tsx` (src/features/git/components/CommitList.tsx:71-84) renders `commit.files_changed` / `insertions` / `deletions` — so simply dropping `--shortstat` would regress the UI. The fix must keep the returned data identical.

## Evidence & Measurements

Code evidence:

- src-tauri/crates/infra/src/git.rs:336-343 — `log()` passes `--shortstat`, forcing per-commit diff computation.
- src-tauri/src/handler/project.rs:127 — `limit.unwrap_or(50)`.
- src/features/git/hooks.ts:63-72 — 10 s poll + `refetchOnMount: "always"` while pane open.
- src/shared/lib/queryRefresh.ts:1 — `GIT_LIGHT_REFRESH_INTERVAL_MS = 10_000`.
- src/features/git/components/CommitList.tsx:71-84 — UI renders the per-commit stats, so they cannot be dropped.

Benchmark results (verbatim, from verification of this finding):

> Release profile, cargo test -p infra (integration test importing real infra::git::log), 10 timed iterations after 2 warmups, single-threaded. Heavy synthetic repo (50 commits, each touching 400 files of 40 lines; shortstat sanity-checked: 400 files changed / 16000 insertions per commit): baseline infra::git::log(folder,50) = 639.4 ms/call; format-only log (no --shortstat) = 4.0 ms/call (160.1x); git rev-parse HEAD (cache-hit guard) = 1.4 ms/call (446.4x). Real repo (the /home/user/2code checkout, 50 commits returned): baseline = 232.2 ms/call; format-only = 2.7 ms/call (87.3x); rev-parse HEAD = 1.4 ms/call (162.8x). At the 10 s poll interval this is 232-639 ms of git work per poll, ~2.3-6.4% of one core continuously while the pane is open, higher on bigger repos.

Measured impact: 446x cheaper per poll on cache hit (639 ms → 1.4 ms) on a heavy repo; even the 2code repo itself wastes 232 ms of git CPU/IO every 10 s poll.

## Proposed Change

Add a process-wide, HEAD-oid-guarded cache for the parsed `Vec<GitCommit>` inside `infra::git`, keyed by `(folder, limit)`. Before running the expensive `git log --shortstat`, run cheap `git rev-parse HEAD` (~1.4 ms measured); if the oid matches the cached entry's oid, return the cached commits. Any commit/amend/rebase/checkout/reset moves HEAD, so there is no staleness risk — commit objects themselves are immutable.

All changes are backend-only, in a single file: **src-tauri/crates/infra/src/git.rs**. No frontend changes (`hooks.ts` polling behavior stays as-is — the poll becomes cheap instead of being removed). No handler/service/model changes, no new Tauri command, no typegen regeneration needed (the command signature and return type are unchanged).

### Step 1 — Add the cache infrastructure (git.rs, near the top or just above `log`)

`GitCommit` already derives `Clone` (src-tauri/crates/model/src/project.rs:89-99), so cached values can be cloned cheaply (50 small structs).

```rust
use std::collections::HashMap;          // HashSet is already imported at git.rs:2
use std::sync::{Mutex, OnceLock};

struct LogCacheEntry {
	head_oid: String,
	commits: Vec<GitCommit>,
}

static LOG_CACHE: OnceLock<Mutex<HashMap<(String, u32), LogCacheEntry>>> =
	OnceLock::new();

fn log_cache() -> &'static Mutex<HashMap<(String, u32), LogCacheEntry>> {
	LOG_CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Cheap guard: current HEAD oid, or None if it cannot be resolved
/// (empty repo, not a git repo, git missing).
fn head_oid(folder: &str) -> Option<String> {
	let output = command_without_windows_console("git")
		.args(["rev-parse", "HEAD"])
		.current_dir(folder)
		.output()
		.ok()?;
	if !output.status.success() {
		return None;
	}
	let oid = String::from_utf8_lossy(&output.stdout).trim().to_string();
	if oid.is_empty() { None } else { Some(oid) }
}
```

A module-level static (rather than Tauri managed state) is deliberate: `infra` has no Tauri dependency, the app is a single process, the cache stays unit-testable with plain `cargo test -p infra`, and it requires no changes to `lib.rs`/handlers. The DB mutex (`Arc<Mutex<SqliteConnection>>`) is completely uninvolved — keep it that way.

### Step 2 — Rename the existing body and wrap it (git.rs:336-358)

Rename the current `pub fn log` to a private `fn log_uncached` (body unchanged — same args including `--shortstat`, same empty-repo handling at git.rs:347-354, same `parse_git_log` call). Then reintroduce `pub fn log` as the cached wrapper so all existing callers (handler/project.rs:127 and the unit/integration tests that call `log(...)`) are untouched:

```rust
pub fn log(folder: &str, limit: u32) -> Result<Vec<GitCommit>, AppError> {
	// Cheap HEAD guard. If it fails (empty repo / not a repo), fall through
	// to the uncached path so the existing empty-repo handling still runs.
	let oid_before = head_oid(folder);

	if let Some(oid) = &oid_before {
		if let Ok(cache) = log_cache().lock() {
			if let Some(entry) = cache.get(&(folder.to_string(), limit)) {
				if entry.head_oid == *oid {
					return Ok(entry.commits.clone());
				}
			}
		}
	}

	let commits = log_uncached(folder, limit)?;

	// Only cache when HEAD is stable across the computation, so a commit
	// landing mid-`git log` can never be keyed under the wrong oid.
	if let (Some(before), Some(after)) = (oid_before, head_oid(folder)) {
		if before == after {
			if let Ok(mut cache) = log_cache().lock() {
				cache.insert(
					(folder.to_string(), limit),
					LogCacheEntry { head_oid: before, commits: commits.clone() },
				);
			}
		}
	}

	Ok(commits)
}

fn log_uncached(folder: &str, limit: u32) -> Result<Vec<GitCommit>, AppError> {
	// ... existing body of the old `log`, verbatim (git.rs:337-357) ...
}
```

Implementation notes:

- **Do not hold the cache mutex across the git subprocess calls** — lock, check, unlock; compute; lock, insert. A race between two concurrent polls is benign (both compute identical immutable data; last insert wins).
- **Poisoned/failed lock = cache bypass**, never an error: the `if let Ok(...)` pattern above degrades to today's behavior. Do not map lock failure to `AppError::LockError` here — correctness never depends on the cache.
- **Empty-repo path must keep working** (git.rs:350-352 returns `Ok(Vec::new())` when stderr contains "does not have any commits"): `head_oid` returns `None` there, so the wrapper falls through to `log_uncached` and nothing is cached. Verified requirement from the finding review.
- **The double `rev-parse` (before + after)** closes the TOCTOU window where HEAD moves between the guard read and the `git log`; it costs ~1.4 ms only on cache misses, which are rare by construction.
- **Memory**: one entry per `(folder, limit)` pair actually queried — in practice one entry per open profile worktree, each ~50 commits of short strings (a few KB). No eviction needed; do not add one.
- **Insertion replaces the stale entry** for the same key when HEAD moves, so the map does not grow on repeated polls.

### Step 3 — Test seam (git.rs, `#[cfg(test)]` only)

To prove a cache *hit* deterministically (without flaky timing or a global counter that parallel tests would trample), expose a test-only injector next to the cache:

```rust
#[cfg(test)]
pub(crate) fn log_cache_insert_for_test(
	folder: &str,
	limit: u32,
	head_oid: String,
	commits: Vec<GitCommit>,
) {
	log_cache()
		.lock()
		.unwrap()
		.insert((folder.to_string(), limit), LogCacheEntry { head_oid, commits });
}
```

Tests plant a sentinel entry (e.g., a commit whose `message` is `"CACHED-SENTINEL"`) under the repo's real HEAD oid; if `log()` returns the sentinel, the cached path was taken. Cache keys include the tempdir folder path, which is unique per test (`create_temp_git_repo` at git.rs:2321-2341 uses a UUID), so parallel tests cannot interfere despite the static.

### Step 4 — New unit tests (git.rs `#[cfg(test)]` module, alongside `log_basic` at git.rs:2414)

Reuse the existing helpers `create_temp_git_repo()` (git.rs:2321) and `add_commit()` (git.rs:2343). Add:

1. `log_cache_hit_returns_cached_value_when_head_unchanged` — create repo, `add_commit` once, resolve HEAD via `git rev-parse HEAD` (pattern at git.rs:2254-2260), plant a sentinel via `log_cache_insert_for_test`, call `log(&dir, 50)`, assert the sentinel comes back.
2. `log_cache_invalidated_when_head_moves` — same setup, plant sentinel under the *old* HEAD oid, `add_commit` a second commit (HEAD moves), call `log(&dir, 50)`, assert the real 2 commits come back (not the sentinel) and that the new first commit's `full_hash` equals the new HEAD.
3. `log_populates_cache_and_second_call_matches` — call `log` twice on an unchanged repo; assert both results are equal (messages, hashes, and the shortstat fields `files_changed`/`insertions`/`deletions` — proving the cached value preserves stats).
4. `log_different_limits_are_independent_cache_keys` — repo with 3 commits: `log(dir, 2)` then `log(dir, 50)` must return 2 and 3 commits respectively (and again on a second round-trip, now served from cache).
5. `log_empty_repo_bypasses_cache` — empty repo: call `log` twice, both `Ok` and empty (extends existing `log_empty_repo` at git.rs:2441); then `add_commit` and assert the commit appears (nothing stale was cached while the repo was empty).

The existing tests `log_basic` (git.rs:2414), `log_limit` (git.rs:2428), `log_empty_repo` (git.rs:2441), `log_commit_with_cjk_message`-style integration tests (src-tauri/tests/integration_git.rs:278-380) and the `parse_git_log` parser tests (git.rs:2062-2100) must keep passing unchanged — they call `log(...)`/`parse_git_log(...)` on fresh unique repos, so the cache is transparent to them.

### Step 5 — Optional manual benchmark (ignored test)

Add an `#[ignore]`d test that times the win on a real repo, for manual runs only (timing asserts are flaky in CI, so print rather than assert on wall-clock):

```rust
#[test]
#[ignore] // manual: cargo test -p infra --release -- --ignored log_cache_bench --nocapture
fn log_cache_bench() {
	// Repo root = four levels up from crates/infra (src-tauri/crates/infra -> repo root)
	let repo = Path::new(env!("CARGO_MANIFEST_DIR"))
		.ancestors().nth(3).unwrap().to_string_lossy().to_string();
	let t0 = std::time::Instant::now();
	let first = log(&repo, 50).unwrap();
	let cold = t0.elapsed();
	let t1 = std::time::Instant::now();
	let second = log(&repo, 50).unwrap();
	let warm = t1.elapsed();
	println!("cold: {cold:?}, warm(cached): {warm:?}");
	assert_eq!(first.len(), second.len());
	assert!(warm <= cold);
}
```

Expected on this checkout per the verified benchmark: cold ~230 ms, warm ~1-2 ms.

## Verification

Environment constraint: **the full Tauri app crate does not build in CI containers (missing GTK libs)**. Never run plain `cargo build` / `cargo test` (that builds the app crate, including `src-tauri/tests/integration_git.rs`), and never `bun tauri ...`. Always use `-p` flags.

```bash
# 1. Backend crates build + all tests (151 pre-existing + the new ones):
cd /home/user/2code/src-tauri && cargo test -p model -p repo -p service -p infra

# 2. Focused run of the git log tests:
cd /home/user/2code/src-tauri && cargo test -p infra log_

# 3. Manual benchmark proving the cache hit (prints cold vs warm timings):
cd /home/user/2code/src-tauri && cargo test -p infra --release -- --ignored log_cache_bench --nocapture
# Expect: cold in the hundreds of ms on this checkout, warm ~1-2 ms.

# 4. Frontend regression check (no frontend files change, but confirm nothing broke):
cd /home/user/2code && bunx vitest run
```

Existing coverage of the area:

- Unit: `log_basic`, `log_limit`, `log_empty_repo` (src-tauri/crates/infra/src/git.rs:2414-2446) — behavior of `log()` on real temp repos.
- Unit: `parse_git_log` / `parse_git_log_commit_line` / shortstat parsing tests (git.rs:2062-2100) — parser untouched by this change.
- Integration (dev machines / full CI only, NOT runnable in this container): `log_returns_commit_shape`, `log_respects_limit`, `log_empty_repo_returns_empty_vec`, `log_limit_zero`, `log_commit_with_cjk_message`, `log_multiple_files_in_commit` (src-tauri/tests/integration_git.rs:278-380). No edits needed there; they must still pass wherever the app crate builds.

New tests to add: the five unit tests from Step 4 plus the ignored benchmark from Step 5, all in the existing `#[cfg(test)]` module of git.rs.

Acceptance criteria:

- `log()` returns byte-identical `Vec<GitCommit>` (including `files_changed`/`insertions`/`deletions`) whether served cold or from cache.
- A repo mutation that moves HEAD (new commit, amend, checkout, reset) is reflected on the very next `log()` call.
- Empty repo still returns `Ok(vec![])` and never caches.
- Warm call on the 2code checkout measures ~1-2 ms vs ~230 ms cold (Step 5 bench).

## Risks & Constraints

- **Do NOT drop `--shortstat` as the fix** (the "cheap" alternative from the original finding): `CommitList.tsx:71-84` renders per-commit stats; removing them silently zeroes the UI numbers. The cache approach keeps output identical.
- **Do not change the IPC surface**: `get_git_log`'s signature, name, and return type are unchanged, so `cargo tauri-typegen generate` is NOT needed and `src/generated/` must not be touched. Do not create manual API wrappers in `src/api/` (CLAUDE.md rule).
- **DB mutex must stay uninvolved** (CLAUDE.md: single connection `Arc<Mutex<SqliteConnection>>`, avoid long-held locks). The cache is a separate `Mutex<HashMap<...>>`; never hold it across a git subprocess call — lock briefly for lookup/insert only.
- **Empty-repo semantics** (git.rs:350-352) are load-bearing: `rev-parse HEAD` failure must mean "cache bypass, fall through", never an error. Same for non-git folders and missing `git` binary.
- **TOCTOU**: guard oid must be read before the log computation and re-checked before inserting into the cache (Step 2 sketch), otherwise a commit landing mid-computation could pin slightly-older output under the newer oid until the next HEAD move.
- **Concurrency**: multiple profiles/worktrees poll concurrently on the blocking pool; per-key entries and short-lived locking make this safe. A duplicate computation under race is acceptable and self-healing.
- **Worktrees share the object store but have distinct HEADs**: keying by `folder` (the worktree path passed in from `profile_worktree_path`, handler/project.rs:126) is exactly right — do not "normalize" to the main repo root.
- **Layering** (CLAUDE.md): all git process execution stays in `infra` — the cache belongs in `crates/infra/src/git.rs`, not in the handler and not in `service`. Handlers stay thin.
- **Frontend polling stays as-is** (hooks.ts:63-72): resist "fixing" this by lengthening `GIT_LIGHT_REFRESH_INTERVAL_MS` or disabling `refetchOnMount: "always"` — that would delay the UI noticing new commits made from the terminal; the point is to make the poll cheap, not rare.
- Rust code in this repo uses **tabs for indentation** (see git.rs) — match the existing style; format with the project's formatter if configured (`just fmt`).
