# Collapse diff_snapshot's 6-spawn pipeline (double diff, per-call index re-hash, orphan object leak) into one git invocation
> Fix an unbounded loose-object disk leak in the hottest git path and make the dominant nothing-changed 10s poll ~46x cheaper via a fingerprint cache, while de-duplicating the diff computed twice per call. | Severity: high | Category: performance

## Problem

`infra::git::diff_snapshot` (`src-tauri/crates/infra/src/git.rs:165-203`) is the hottest git path in the app:

- The frontend polls it **every 10 seconds per active profile**: `useGitDiff` (`src/features/git/hooks.ts:42-51`) and `useGitDiffStats` (`src/features/git/hooks.ts:81-94`) both call the generated `getGitDiffSnapshot` binding with `refetchInterval: GIT_LIGHT_REFRESH_INTERVAL_MS` (`10_000`, `src/shared/lib/queryRefresh.ts:1`).
- `SidebarModeSwitch` (`src/features/projects/SidebarModeSwitch.tsx:34`) keeps the stats query live whenever the profile is active — **even with the diff dialog closed** — while rendering only the `+N`/`-N` counts (lines 57-66) from a snapshot whose payload carries the full diff text.
- The file watcher also invalidates these queries on every relevant FS event (`src/features/watcher/fileWatcher.ts:119` and surrounding invalidations), so during active agent editing the call fires far more often than the 10s cadence.

Each `diff_snapshot` call today spawns **5 git processes** (the finding title says 6; the verified count is 5) and does substantial redundant work:

1. `git status --porcelain --untracked-files=all` — full worktree scan just to answer "any changes?" (`has_any_changes`, `git.rs:205-218`).
2. `git rev-parse --git-path index` (`resolve_git_index_path`, `git.rs:309-334`) followed by a **byte copy of the entire real index** (`std::fs::copy` at `git.rs:297`, tens of MB on large repos) into a temp dir (`create_temp_index_from_repo`, `git.rs:287-307`).
3. `git add -A` into that throwaway temp index (`stage_all_changes`, `git.rs:220-234`, via `GIT_INDEX_FILE` at `git.rs:224`). Because the temp index is recreated from the real index **every call**, this re-stats and **re-hashes every modified + untracked file on every poll**, and — critically — **writes a permanent loose object into `.git/objects` for every unique dirty content it hashes**. Nothing references these objects, nothing in 2code ever runs `git gc`, and unreferenced objects do not trigger auto-gc. While a coding agent is actively editing files this is an **unbounded disk leak** (measured: +1 loose object per changed file per poll).
4. `run_cached_diff(folder, &tmp_index, false)` (`git.rs:174`) — the full patch text.
5. `run_cached_diff(folder, &tmp_index, true)` (`git.rs:188`) — **the exact same diff computed a second time** with `--shortstat` (`run_cached_diff`, `git.rs:236-258`).

Finally, the full diff text (unbounded; 2.38 MB at benchmark scale) is copied into a `String` (`git.rs:176`) and JSON-serialized over IPC every 10 s even for the sidebar consumer that renders two integers.

Call path: `get_git_diff_snapshot` handler (`src-tauri/src/handler/project.rs:89-101`) → `infra::git::diff_snapshot`. The wrappers `diff()` (`git.rs:157-159`) and `diff_stats()` (`git.rs:161-163`) also route through `diff_snapshot`, so `get_git_diff` / `get_git_diff_stats` handlers (`handler/project.rs:78-115`), `service::project::get_diff_stats` (`crates/service/src/project.rs:223-228`), `service::profile` delete-check (`crates/service/src/profile.rs:556`), and `handler/profile.rs:61` all pay the same cost and all benefit from this fix.

## Evidence & Measurements

Verified benchmark results (verbatim, from a release-profile Rust integration-test harness that was created and deleted during verification):

> Harness: temporary Rust integration test crates/infra/tests/__bench_diffsnap_a598a04b.rs (deleted after run), cargo test -p infra --release, git 2.43.0, Linux container. Repo: 2000 committed files (~200 lines each, unique content), 500 modified + 50 deleted + 200 untracked = 750 dirty files; resulting snapshot: 750 files changed, +41000/-10000, diff text 2,381,388 bytes. 10 timed iterations after 2 warmups per variant.
>
> Steady-state poll (nothing changed between calls):
> - A real infra::git::diff_snapshot: mean 244.3 ms (min 234.4, max 270.5)
> - B add -A + ONE combined `--cached --shortstat -p` diff: mean 198.6 ms (1.23x vs A)
> - C proposed add -N + ONE worktree `--shortstat -p HEAD` diff: mean 240.6 ms (1.02x vs A — no steady-state win)
> - D fingerprint short-circuit (`status --porcelain -z -uall` + hash): mean 5.3 ms (46x vs A)
>
> Cold object store (first call after gc --prune=now): A 289.6 ms writing +700 loose objects; C 203.4 ms (1.43x) writing +1 object (constant empty blob).
>
> Per-step breakdown (mean of 5): status -uall 5.5 ms; status -z fingerprint 5.1 ms; rev-parse+index copy 1.8 ms; add -A (blobs already in store) 31.6 ms; diff --cached -p 108.8 ms; diff --cached --shortstat 92.1 ms (the redundant second diff); add -N 9.4 ms; worktree diff --shortstat -p with intent-to-add index 220.5 ms.
>
> Loose-object leak: steady-state repeat polls with no edits: +0 objects. Agent-editing simulation (100 files re-written between polls, 3 cycles): baseline diff_snapshot +[100,100,100] objects per poll; add -N variant +[0,0,0]. Correctness: variants A, B, C produced byte-identical diff text and identical stats (verified incl. deletions and untracked files); combined `--shortstat -p` emits the shortstat line first, patch starts at first "diff --git".

Interpretation — how to weigh the three sub-fixes (do not oversell):

1. **The `add -N` (intent-to-add) change is the leak fix, not a speed win.** Steady-state it is ~1.0x (240.6 vs 244.3 ms) because the worktree diff must re-read every dirty file each call, but it reduces loose-object writes from +1 per changed file per poll to **+0** (only a one-time constant empty blob, ever), with byte-identical output.
2. **The fingerprint short-circuit is the wall-clock win**: 244 ms → 5.3 ms (46x) for the dominant unchanged-repo poll.
3. **Merging the two diffs into one invocation** is a real but modest win on cache-miss calls (1.23x measured for the `--cached` variant) and removes one spawn.

## Proposed Change

All backend work is in `src-tauri/crates/infra/src/git.rs`. One small frontend change in `src/features/git/hooks.ts`. No new Tauri commands, no signature changes, so **no `cargo tauri-typegen generate` run is needed** (`getGitDiffStats` already exists at `src/generated/commands.ts:205`).

### Step 1 — `git.rs`: fingerprint + per-folder snapshot cache (the 46x win)

Replace `has_any_changes` (`git.rs:205-218`) with a function that returns the raw `-z` status bytes so one spawn serves both the empty-repo short-circuit and the fingerprint (`has_any_changes` has no other callers — verified by grep):

```rust
fn status_porcelain_z_uall(folder: &str) -> Result<Vec<u8>, AppError> {
	let output = command_without_windows_console("git")
		.args(["status", "--porcelain", "-z", "--untracked-files=all"])
		.current_dir(folder)
		.output()?;
	if !output.status.success() {
		return Err(AppError::GitError(
			String::from_utf8_lossy(&output.stderr).trim().to_string(),
		));
	}
	Ok(output.stdout)
}
```

**Fingerprint — MUST be content-aware.** A hash of the status output alone is NOT sufficient: re-editing an already-modified file does not change `git status` output (same `M path` line), so the cache would serve stale diffs while an agent edits. Include per-file `lstat` data (size + mtime) for every path listed in status, plus HEAD (a commit/amend/reset can change the correct diff without changing the status listing shape):

```rust
fn head_commit(folder: &str) -> Option<String> {
	let output = command_without_windows_console("git")
		.args(["rev-parse", "HEAD"])
		.current_dir(folder)
		.output()
		.ok()?;
	output
		.status
		.success()
		.then(|| String::from_utf8_lossy(&output.stdout).trim().to_string())
}

fn snapshot_fingerprint(folder: &str, status_z: &[u8]) -> u64 {
	let mut hasher = DefaultHasher::new(); // already imported at top of git.rs
	status_z.hash(&mut hasher);
	head_commit(folder).hash(&mut hasher);
	for path in status_z_paths(status_z) {
		match std::fs::symlink_metadata(Path::new(folder).join(&path)) {
			Ok(md) => {
				md.len().hash(&mut hasher);
				md.modified()
					.ok()
					.and_then(|t| {
						t.duration_since(std::time::UNIX_EPOCH).ok()
					})
					.map(|d| (d.as_secs(), d.subsec_nanos()))
					.hash(&mut hasher);
			}
			Err(_) => 0u8.hash(&mut hasher), // deleted / unreadable
		}
	}
	hasher.finish()
}

/// Paths from `status --porcelain -z` output. Mirrors the record walk in
/// parse_porcelain_status_z (git.rs:1320): rename/copy entries are followed
/// by an extra NUL record holding the origin path — skip it (the raw status
/// bytes hashed above already cover it).
fn status_z_paths(output: &[u8]) -> Vec<String> {
	let records: Vec<&[u8]> = output
		.split(|byte| *byte == 0)
		.filter(|record| !record.is_empty())
		.collect();
	let mut paths = Vec::new();
	let mut index = 0usize;
	while let Some(record) = records.get(index) {
		if record.len() < 4 {
			index += 1;
			continue;
		}
		let status_code = &record[..2];
		paths.push(String::from_utf8_lossy(&record[3..]).into_owned());
		if status_code.contains(&b'R') || status_code.contains(&b'C') {
			index += 1;
		}
		index += 1;
	}
	paths
}
```

Cache (module-level; `infra::git` is a free-function API so there is no struct to hang state on):

```rust
use std::sync::{Mutex, OnceLock};
use std::collections::HashMap;

struct CachedSnapshot {
	fingerprint: u64,
	snapshot: GitDiffSnapshot,
}

static SNAPSHOT_CACHE: OnceLock<Mutex<HashMap<String, CachedSnapshot>>> =
	OnceLock::new();

fn snapshot_cache() -> &'static Mutex<HashMap<String, CachedSnapshot>> {
	SNAPSHOT_CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}
```

Rewritten `diff_snapshot` (replaces `git.rs:165-203`):

```rust
pub fn diff_snapshot(folder: &str) -> Result<GitDiffSnapshot, AppError> {
	let status_z = status_porcelain_z_uall(folder)?;
	if status_z.is_empty() {
		return Ok(GitDiffSnapshot::default()); // preserves existing short-circuit
	}

	// Compute the fingerprint BEFORE the diff: if a file changes in between,
	// the new diff gets stored under the old fingerprint and the next poll
	// (new fingerprint) recomputes — stale-safe in that direction.
	let fingerprint = snapshot_fingerprint(folder, &status_z);
	if let Some(hit) = snapshot_cache().lock().unwrap().get(folder) {
		if hit.fingerprint == fingerprint {
			return Ok(hit.snapshot.clone());
		}
	}

	let snapshot = compute_diff_snapshot_uncached(folder)?;
	snapshot_cache().lock().unwrap().insert(
		folder.to_string(),
		CachedSnapshot { fingerprint, snapshot: snapshot.clone() },
	);
	Ok(snapshot)
}
```

Notes:
- Unchanged poll now costs 2 spawns (`status -z`, `rev-parse HEAD`) + lstats, ~5-8 ms vs ~244 ms.
- `diff()` and `diff_stats()` wrappers (`git.rs:157-163`) need no changes and inherit the cache — this makes `get_git_diff_stats`, the profile delete-check, and `service::project::get_diff_stats` cheap too.
- Do not hold the cache lock across the git spawn (lock, check, unlock; compute; lock, insert, unlock) — the sketch above already does this.

### Step 2 — `git.rs`: `add -N` instead of `add -A` (the leak fix)

Replace the body of `stage_all_changes` (`git.rs:220-234`) — or add a new `register_untracked_intent_to_add` and delete the old function — to use intent-to-add, which registers untracked paths in the temp index **without hashing content or writing objects**:

```rust
fn register_untracked_intent_to_add(
	folder: &str,
	tmp_index: &Path,
) -> Result<(), AppError> {
	let output = command_without_windows_console("git")
		.args(["add", "--intent-to-add", "."])
		.current_dir(folder)
		.env("GIT_INDEX_FILE", tmp_index)
		.output()?;

	if !output.status.success() {
		let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
		// When every file in the repo has been deleted, "." matches nothing.
		// There is nothing untracked to register — the worktree diff below
		// still reports the deletions.
		if stderr.contains("did not match any files") {
			return Ok(());
		}
		return Err(AppError::GitError(stderr));
	}
	Ok(())
}
```

Keep `create_temp_index_from_repo` (`git.rs:287-307`) exactly as is: seeding from the real index is still required so tracked-but-now-ignored files stay tracked (covered by the existing test `diff_excludes_tracked_files_that_are_now_ignored`, `git.rs:2674`) and so git knows which paths are untracked. `git add -N .` respects `.gitignore`, so ignored files are still excluded, same as `git add -A` today.

Semantics: `add -N` does not stage deletions, but the worktree diff in Step 3 (no `--cached`) compares HEAD against the worktree directly and reports deletions identically — verified byte-identical output including 50 deletions at benchmark scale.

### Step 3 — `git.rs`: one combined diff invocation instead of two

Replace the two `run_cached_diff` calls (`git.rs:174` and `git.rs:188`) and `run_cached_diff` itself (`git.rs:236-258`) with a single **worktree** diff (no `--cached` — required for Step 2's intent-to-add entries to diff against worktree content) that emits both the shortstat and the patch:

```rust
fn compute_diff_snapshot_uncached(
	folder: &str,
) -> Result<GitDiffSnapshot, AppError> {
	let (_tmp_dir, tmp_index) = create_temp_index_from_repo(folder)?;
	register_untracked_intent_to_add(folder, &tmp_index)?;

	let output = command_without_windows_console("git")
		.args([
			"diff",
			"--no-color",
			"--src-prefix=a/",
			"--dst-prefix=b/",
			"--shortstat",
			"-p",
			"HEAD",
		])
		.current_dir(folder)
		.env("GIT_INDEX_FILE", &tmp_index)
		.output()?;

	if !output.status.success() {
		let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
		if is_no_head_error(&stderr) {
			// Empty repo (no commits): keep today's behavior — empty snapshot.
			return Ok(GitDiffSnapshot::default());
		}
		return Err(AppError::GitError(stderr));
	}

	Ok(split_shortstat_and_patch(&output.stdout))
}

/// git 2.43+ emits `--shortstat -p` output as: shortstat line, blank line,
/// then the patch starting at the first "diff --git" line. Empty diff emits
/// nothing. Split at the first line-start "diff --git " so the returned diff
/// text stays byte-identical to what the old patch-only invocation produced.
fn split_shortstat_and_patch(stdout: &[u8]) -> GitDiffSnapshot {
	let text = String::from_utf8_lossy(stdout);
	let patch_start = if text.starts_with("diff --git ") {
		Some(0)
	} else {
		text.find("\ndiff --git ").map(|pos| pos + 1)
	};

	match patch_start {
		Some(pos) => GitDiffSnapshot {
			diff: text[pos..].to_string(),
			stats: parse_diff_stats(text[..pos].as_bytes()),
		},
		None => GitDiffSnapshot {
			// No patch section (should not happen when status is non-empty,
			// but be defensive): parse stats from whatever was emitted.
			diff: String::new(),
			stats: parse_diff_stats(stdout),
		},
	}
}
```

`parse_diff_stats` (`git.rs:272-285`) and `is_no_head_error` (`git.rs:260-270`) are reused unchanged. Note `parse_diff_stats` finds the line containing `"file"` — safe here because it only ever sees the pre-patch region.

Important: the previous no-HEAD handling returned `String::new()` for diff but still attempted the stats call (`git.rs:181-186`, `195-199`); the combined version handles both at once, preserving the observable result (`GitDiffSnapshot::default()`).

Spawn accounting after Steps 1-3: unchanged poll = 2 spawns; changed poll = 5 spawns (status, rev-parse HEAD, rev-parse --git-path index, add -N, combined diff) but with no duplicate diff and **zero loose-object writes**. Optional micro-optimization (skip unless trivial): fold `rev-parse HEAD` and `rev-parse --git-path index` into one `git rev-parse HEAD --git-path index` call — error handling for empty repos gets fiddly, so this is not required.

### Step 4 — frontend: stop shipping the full diff text to the stats-only consumer

`useGitDiffStats` (`src/features/git/hooks.ts:81-94`) currently fetches the **full snapshot** (diff text + stats, MBs of JSON over IPC every 10 s) and selects `.stats`. Switch it to the existing stats-only command — after Step 1 the backend serves it from the snapshot cache, so this adds no meaningful backend work even when the diff dialog is also polling:

```ts
// hooks.ts — add getGitDiffStats to the "@/generated" import list, then:
export function useGitDiffStats(profileId: string, enabled = true) {
	const { data, refetch } = useQuery({
		queryKey: queryKeys.git.diffStats(profileId),
		queryFn: () => getGitDiffStats({ profileId }),
		enabled,
		staleTime: GIT_DIFF_SNAPSHOT_STALE_MS,
		refetchOnMount: "always",
		refetchInterval: enabled ? GIT_LIGHT_REFRESH_INTERVAL_MS : false,
	});
	useRefreshOnEnable(enabled, refetch);

	return useMemo(() => toGitDiffSummary(data), [data]);
}
```

This is safe because:
- `queryKeys.git.diffStats` already exists (`src/shared/lib/queryKeys.ts:50`) and is already invalidated by every relevant mutation (`hooks.ts:155`, `:208`, `:242`, plus `src/features/projects/hooks.ts:566`) and by the file watcher (`src/features/watcher/fileWatcher.ts:119`).
- `getGitDiffStats` is already generated (`src/generated/commands.ts:205`) and the `get_git_diff_stats` command is registered (`src-tauri/src/lib.rs:101`).
- `SidebarModeSwitch.tsx` needs **no change** — it consumes `useGitDiffStats` and benefits automatically. `GitDiffDialog`'s full-diff view keeps using `useGitDiff`/`useGitDiffFiles` (snapshot query) unchanged.
- Update any frontend tests that assert `useGitDiffStats` populates/reads `queryKeys.git.diff(...)` — check `src/features/git/hooks.test.tsx` and `src/features/projects/hooks.test.tsx` (both reference `queryKeys.git.diffStats` already at `hooks.test.tsx:296` / `hooks.test.tsx:276`).

Do NOT create manual wrappers in `src/api/` and do NOT inline query-key strings (CLAUDE.md rules).

### Step 5 — new Rust tests (colocated in `crates/infra/src/git.rs` `#[cfg(test)]`)

Put new tests in the existing `#[cfg(test)] mod tests` in `git.rs` (helpers `create_temp_git_repo` at `git.rs:2321` and `add_commit` at `git.rs:2343` already build real temp repos) — **not** in `src-tauri/tests/`, because the app crate cannot build in headless CI containers (missing GTK). The global cache is keyed by folder and every test uses a unique temp dir, so parallel tests do not interfere.

Add a loose-object counter helper:

```rust
fn count_loose_objects(dir: &std::path::Path) -> usize {
	let objects = dir.join(".git/objects");
	let mut count = 0;
	for entry in std::fs::read_dir(&objects).into_iter().flatten().flatten() {
		let name = entry.file_name();
		let name = name.to_string_lossy();
		if name == "pack" || name == "info" {
			continue;
		}
		count += std::fs::read_dir(entry.path())
			.map(|d| d.flatten().count())
			.unwrap_or(0);
	}
	count
}
```

Tests to add:
1. `diff_snapshot_writes_no_loose_objects_per_poll` — repo with modified + untracked + deleted files; call `diff_snapshot` twice; assert `count_loose_objects` grew by **at most 1** total (the constant empty blob) and by **0** between call 1 and call 2. This is the regression test for the leak.
2. `diff_snapshot_combined_invocation_reports_stats_and_patch` — modified + staged + deleted + untracked files; assert `snapshot.diff` starts with `"diff --git "` (no shortstat prefix leaked into the patch text), contains each filename, and `snapshot.stats` has the exact expected `files_changed`/`insertions`/`deletions`.
3. `diff_snapshot_cache_detects_content_change_with_unchanged_status` — modify `a.txt`, take snapshot; rewrite `a.txt` with different content **of different length** (avoids any mtime-granularity flake); take snapshot again; assert the second snapshot contains the new content. This guards the content-aware fingerprint (status output alone is identical between the two calls).
4. `diff_snapshot_cache_detects_head_change` — two modified files; snapshot; commit one of them via git CLI (status for the other file is unchanged); snapshot again; assert the committed file is gone from the diff and stats dropped. Guards the HEAD component of the fingerprint.
5. `diff_snapshot_repeated_call_returns_identical_snapshot` — dirty repo, call twice with no edits in between, assert both snapshots equal (cache-hit correctness).
6. `diff_snapshot_when_all_tracked_files_deleted` — delete every tracked file (empty worktree); assert deletions are reported and no error (guards the `add -N .` "pathspec did not match" tolerance in Step 2).
7. `diff_snapshot_reports_rename` — `git mv`-style rename (fs::rename + nothing staged shows as delete+add; also test a staged rename via `git add` of both paths if desired); primarily this exercises `status_z_paths` skipping the rename origin record without panicking.

Existing coverage that must keep passing (do not modify assertions): infra colocated tests `diff_modified_file`/`diff_staged_and_unstaged`/`diff_new_untracked_file`/`diff_excludes_tracked_files_that_are_now_ignored` (`git.rs:~2600-2714`); app-crate integration tests `src-tauri/tests/integration_git.rs` — `diff_snapshot_includes_untracked_files` (:90), `diff_snapshot_clean_repo_returns_empty_snapshot` (:159), `diff_snapshot_matches_diff_and_stats_wrappers` (:195), `diff_snapshot_does_not_mutate_real_index` (:226) — these run on dev machines/full CI only.

Optional perf smoke (recommended, cheap): an `#[ignore]`d test `bench_diff_snapshot_smoke` that builds a repo with a few hundred dirty files, times a cache-miss call vs a cache-hit call with `std::time::Instant`, prints both with `--nocapture`, and asserts hit-time < miss-time / 5. Run manually via `cargo test -p infra --release -- --ignored bench_diff_snapshot --nocapture`.

## Verification

All commands below work in a headless CI container. **Never run plain `cargo build`/`cargo test` without `-p` flags, and never `bun tauri ...`** — the full Tauri app build fails without GTK system libs.

```bash
# 1. Backend: all workspace-crate tests (151 pre-existing + the new ones)
cd /home/user/2code/src-tauri && cargo test -p model -p repo -p service -p infra

# 2. Backend: just the new/changed area, quickly
cd /home/user/2code/src-tauri && cargo test -p infra diff_snapshot
cd /home/user/2code/src-tauri && cargo test -p infra diff_

# 3. Optional perf smoke (release mode; prints cache-miss vs cache-hit timings)
cd /home/user/2code/src-tauri && cargo test -p infra --release -- --ignored bench_diff_snapshot --nocapture

# 4. Frontend: full suite (671 pre-existing tests) — covers hooks.test.tsx,
#    projects/hooks.test.tsx, queryKeys.test.ts after the Step 4 change
cd /home/user/2code && bunx vitest run

# 5. Frontend: targeted
cd /home/user/2code && bunx vitest run src/features/git src/features/projects src/shared
```

On a machine that CAN build the full app (macOS dev machine or GTK-equipped CI):

```bash
# App-crate integration tests exercising diff_snapshot end-to-end through the service layer
cd src-tauri && cargo test --test integration_git

# Manual leak check while the app runs: open a profile, let an agent edit files
# for a few minutes, then in the worktree:
find .git/objects -type f -not -path '*/pack/*' -not -path '*/info/*' | wc -l
# The count must stay flat across 10s polls (pre-fix it grows by ~1 per changed file per poll).
```

What proves each sub-fix:
- **Leak**: new test #1 (`+0` objects between polls; ≤1 ever) — pre-fix it fails with +1 object per dirty file.
- **Cache correctness**: tests #3, #4, #5 — these are the tests most likely to catch a wrong fingerprint design; #3 in particular fails if anyone "simplifies" the fingerprint to a plain status-output hash.
- **Combined-invocation parse**: test #2 plus the existing byte-level equality test `diff_snapshot_matches_diff_and_stats_wrappers` (integration_git.rs:195).
- **Speed**: the `#[ignore]` smoke bench; expect cache-hit ≥5x faster than miss (measured 46x at 750-dirty-file scale).

## Risks & Constraints

CLAUDE.md invariants to respect:
- **Do not create manual API wrappers in `src/api/`** — Step 4 uses the already-generated `getGitDiffStats` binding. No Rust command signatures change, so `src/generated/` needs no regeneration; if you do add/change a command anyway, run `cargo tauri-typegen generate`.
- **Query keys must come from `src/shared/lib/queryKeys.ts`** — Step 4 uses the existing `queryKeys.git.diffStats(profileId)` factory; never inline string arrays.
- **Single-connection DB** (`Arc<Mutex<SqliteConnection>>`) is untouched — `diff_snapshot` runs in `run_blocking` after the DB lookup completes (`handler/project.rs:96-99`); do not move DB access inside the cache lock.
- Handlers stay thin; all new logic lives in `infra::git` (infra layer owns external-process work).
- Do not touch `project.inlang/settings.json`, `src/paraglide/`, or `src-tauri/src/schema.rs`.

Regression risks and mitigations:
- **Stale snapshot via fingerprint collision on stat data**: a file rewritten with the **same size** within the filesystem's mtime resolution produces the same fingerprint. On ext4/APFS (ns resolution) this is negligible; on coarse filesystems (HFS+ 1 s, FAT 2 s) a fast same-size rewrite could serve one stale poll until the next change. This mirrors git's own stat-cache trust model. If deemed unacceptable, add an optional TTL (e.g., force recompute if the cached entry is older than 60 s) — but default it off, since recomputing wastes ~244 ms on the dominant unchanged case. Do NOT drop the lstat component; status-output-only hashing is functionally wrong (see Step 1).
- **`--shortstat -p` output ordering**: verified on git 2.43 that shortstat precedes the patch. `split_shortstat_and_patch` is defensive (falls back to empty diff + whole-output stats parse if no `diff --git` line), and test #2 pins the behavior. If a future/ancient git version orders differently, the split-at-first-`diff --git` logic still yields the correct patch text.
- **Deletions with `add -N`**: intent-to-add does not stage deletions, but the worktree diff against HEAD reports them identically (verified byte-identical with 50 deletions). Test #6 also covers the all-files-deleted `pathspec did not match` edge.
- **Byte-identical diff text**: `GitDiffDialog`'s parser (`parseDiffFiles`) consumes `snapshot.diff`; the split logic must not leak the shortstat line or the separating blank line into the patch. Test #2's `starts_with("diff --git ")` assertion pins this.
- **Memory**: the cache holds one full diff text per polled folder (MBs at large-repo scale). Bounded by the number of profiles the user has open; entries are overwritten in place per folder. If this becomes a concern, evict entries not read for N minutes — not required now.
- **Concurrency**: two simultaneous `diff_snapshot` calls for the same folder (e.g., snapshot poll + stats poll landing together) may both compute on a cache miss; last insert wins and both results are correct. The cache lock is never held across a spawn, so there is no lock-ordering hazard with the DB mutex.
- **Empty repo (no HEAD)**: `rev-parse HEAD` fails → fingerprint hashes `None`; the combined diff fails with a no-HEAD error → `GitDiffSnapshot::default()`, matching today's behavior (`integration_git.rs:125` `diff_empty_repo_returns_empty_string`).
- **Windows**: mechanics are unchanged (`GIT_INDEX_FILE` env, `command_without_windows_console`); `status_z_paths` returns repo-relative slash paths that `Path::join` handles on all platforms.
- **Do not promise a 2x steady-state speedup from the pipeline collapse alone** — measured ~1.02x for the `add -N` + worktree-diff pipeline on warm calls (worktree diff re-reads dirty files: 220.5 ms vs 108.8 ms for the old cached diff). The wall-clock win comes from the fingerprint cache; the `add -N` change is justified by the leak fix (+0 objects/poll) and the 1.43x cold-store improvement.
