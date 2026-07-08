# Stop polling the full git diff snapshot for sidebar stats and gate git polling on profile visibility

> The +N/-N sidebar badge and hidden background profiles poll the ENTIRE working-tree diff (multi-MB at agent scale) over IPC every 10 seconds; switch the badge to a tiny stats-only command and gate all sidebar git polling on profile visibility. | Severity: high | Category: performance

## Problem

The sidebar's git counters and the sidebar git panel are driven by `getGitDiffSnapshot`, whose payload is the **entire working-tree diff text plus stats** (`GitDiffSnapshot { diff: String, stats: GitDiffStats }`, `src-tauri/crates/model/src/project.rs:108-112`). Three compounding issues:

1. **The stats badge polls the full diff.** `useGitDiffStats` (`src/features/git/hooks.ts:81-94`) registers under `queryKeys.git.diff(profileId)` with `queryFn: getGitDiffSnapshot`, `select: (snapshot) => snapshot.stats`, `refetchOnMount: "always"`, and `refetchInterval: GIT_LIGHT_REFRESH_INTERVAL_MS` (10s, `src/shared/lib/queryRefresh.ts:1`). Its only consumer is `SidebarModeSwitch` (`src/features/projects/SidebarModeSwitch.tsx:34`), which renders three integers (`+N`/`-N`/files). `useGitDiff` (`hooks.ts:42-51`) shares the same key/queryFn with the same 10s interval and `refetchOnMount: "always"` (which defeats the 30s `staleTime` on every remount). Net effect: the active profile re-fetches the full diff every 10s forever — a git subprocess pipeline (4 subprocesses including `git add -A` into a temp index, `src-tauri/crates/infra/src/git.rs:165-203`), multi-MB JSON IPC serialization, a webview main-thread `JSON.parse`, and a TanStack structural-sharing deep compare — even when nothing changed, and even though the file watcher already invalidates `git.diff` on real changes (`src/features/watcher/fileWatcher.ts:117` with 1s debounce at `fileWatcher.ts:174-179`).

2. **Hidden profiles keep polling.** `TerminalLayer` keeps a `ProfileLayout` mounted with `display: none` for every profile with open terminals (`src/features/terminal/TerminalLayer.tsx:84-114`). `ProfileLayout` holds per-profile `sidebarMode` state (`src/features/projects/ProfileLayout.tsx:25`), so a hidden profile left in git mode keeps `SidebarGitPanel` mounted. `SidebarGitPanel` has no `isActive` prop: its `useGitDiffFiles(profileId)` (`src/features/git/components/SidebarGitPanel.tsx:57`) goes through `useGitDiff`, a `useSuspenseQuery` (cannot be disabled) with an unconditional 10s `refetchInterval`, and `useGitAheadCount(profileId)` (`SidebarGitPanel.tsx:66`) defaults `enabled = true` (`hooks.ts:96-106`) — so every hidden profile in git-sidebar mode runs a full `git diff` + `git rev-list` poll every 10s in the background, forever. Note `ProfileLayout` already receives `isActive` from `TerminalLayer` (`TerminalLayer.tsx:102`) and passes it to `ProfileSidebar` (`ProfileLayout.tsx:70`), but `ProfileSidebar` does **not** forward it to `SidebarGitPanel` (`src/features/projects/ProfileSidebar.tsx:131-138`) — a one-prop thread-through.

3. **Dead query key.** `queryKeys.git.diffStats` (`src/shared/lib/queryKeys.ts:50-51`) is invalidated in 6 production call sites — `src/features/git/hooks.ts:155,208,242`, `src/features/projects/hooks.ts:349,566`, `src/features/watcher/fileWatcher.ts:19,119` — but **no query ever registers under it**. All those invalidations are silent no-ops and a trap for future readers. Meanwhile the backend command that should back it, `get_git_diff_stats` (`src-tauri/src/handler/project.rs:103-115`, registered in `src-tauri/src/lib.rs:101`, generated binding `getGitDiffStats` in `src/generated/commands.ts:205-209`), is never called by the frontend — and its implementation `infra::git::diff_stats` (`src-tauri/crates/infra/src/git.rs:161-163`) calls `diff_snapshot(folder)?.stats`, i.e. it computes the full diff text anyway and throws it away.

## Evidence & Measurements

Benchmarks (verbatim from verification, real code, warmed, time-budgeted loops):

RUST (real infra::git::diff_snapshot, release profile, Linux container, temp repos; warmed, time-budgeted loops >=3s):
- Agent-scale dirty tree (base: 200 tracked files x 400 lines; 150 files rewritten + 50 untracked; resulting diff 8.06 MB, 200 files, +80000/-60000):
  - A current diff_snapshot: 131-136 ms/call
  - B stats-only untracked-aware temp-index variant (suggested fix, verified identical stats): 58-60 ms/call (2.2x faster)
  - serde_json::to_string of payload (IPC serialize side): 6.6-7.4 ms (full snapshot) vs 0.00011 ms (stats-only) — ~65,000x
- Small-scale dirty tree (10 modified files, 0.46 MB diff): A 19.5 ms/call, B 10.2 ms/call.

FRONTEND (vitest run, jsdom/node V8; real @tanstack/react-query 5.101 QueryClient + query-core replaceEqualDeep; payloads: realistic unified-diff strings serialized to 2.15 MB and 8.83 MB JSON vs 58 B stats-only; warmed, >=300 ms budgets):
- JSON.parse (IPC deserialize proxy): 2.60 ms (2 MB) / 9.47 ms (8.8 MB) vs 0.00037 ms (stats) — ~7,000x / ~25,600x
- JSON.stringify: 6.97 / 30.06 ms vs 0.00027 ms
- fresh parse + replaceEqualDeep on identical-content data (verified structural sharing returns old reference): 2.66 / 10.91 ms vs 0.00068 ms
- End-to-end QueryClient steady-state refetch tick (seeded cache, refetch with identical-content fresh payload): 3.82 ms (2 MB) / 60.24 ms (8.8 MB) vs 0.011 ms (stats-only) — ~350x / ~5,500x per tick per poller.

Combined per 10s tick per poller at 8 MB diff: ~131 ms backend + ~7 ms serde + ~10-60 ms webview main thread, vs ~58 ms backend + ~0 ms IPC/frontend for the stats-only fix, and 0 for visibility-gated hidden pollers.

Important calibration from the verifier:
- The backend win from the stats split is only 2.2x (58 vs 131 ms at 8 MB), because `git add -A` into the temp index (re-hashing every dirty file) dominates, not the full-text diff. The 3-4 orders-of-magnitude wins are in serde serialize, IPC payload, `JSON.parse`, and TanStack structural sharing. Biggest levers in order: (a) visibility gating (drops hidden-profile cost to zero), (b) stats-only command for the badge, (c) the `git add -A` cost itself is a separate backend concern (see `plans/24-*` coordination note below; do not tackle it here).
- Clean-repo polls are already cheap: `has_any_changes` (`git.rs:205-218`) short-circuits `diff_snapshot` to one subprocess. The waste is specifically the dirty-worktree steady state — exactly the agent workflow this app targets.
- The DB mutex is locked only briefly per poll (worktree path lookup inside `run_blocking`, `handler/project.rs:96-99`), not held across git execution — do not cite mutex contention as motivation.
- Frontend numbers were measured in node/jsdom V8; the macOS webview is JSC — same order of magnitude, absolute numbers may differ.

## Proposed Change

Five steps. No IPC signature changes — `get_git_diff_stats` already exists, is registered, and has a generated binding, so **`cargo tauri-typegen generate` is NOT needed** and `src/generated/` must not be touched.

### Step 1 — Backend: make `infra::git::diff_stats` stats-only (skip the full-text diff pass)

File: `src-tauri/crates/infra/src/git.rs` (currently lines 161-163):

```rust
pub fn diff_stats(folder: &str) -> Result<GitDiffStats, AppError> {
	Ok(diff_snapshot(folder)?.stats)
}
```

Replace with a variant that runs the same untracked-aware temp-index pipeline but only the `--shortstat` pass. All the pieces already exist in this file (`has_any_changes` :205, `create_temp_index_from_repo` :288, `stage_all_changes` :220, `run_cached_diff(folder, tmp_index, /*shortstat=*/true)` :236, `parse_diff_stats` :272, `is_no_head_error` :260):

```rust
/// Stats-only variant of `diff_snapshot`: same untracked-aware temp-index
/// pipeline, but skips producing the full diff text. Do NOT replace with a
/// naive `git diff --shortstat HEAD` — that misses untracked files.
pub fn diff_stats(folder: &str) -> Result<GitDiffStats, AppError> {
	if !has_any_changes(folder)? {
		return Ok(GitDiffStats::default());
	}

	let (_tmp_dir, tmp_index) = create_temp_index_from_repo(folder)?;
	stage_all_changes(folder, &tmp_index)?;

	let stats_output = run_cached_diff(folder, &tmp_index, true)?;
	if stats_output.status.success() {
		Ok(parse_diff_stats(&stats_output.stdout))
	} else {
		let stderr = String::from_utf8_lossy(&stats_output.stderr)
			.trim()
			.to_string();
		if is_no_head_error(&stderr) {
			Ok(GitDiffStats::default())
		} else {
			Err(AppError::GitError(stderr))
		}
	}
}
```

This mirrors `diff_snapshot`'s error handling exactly (including the no-HEAD → default-stats case at `git.rs:188-200`). The verifier benchmarked this exact shape and confirmed stats identical to `diff_snapshot` at both small and agent scale. Leave `diff` (`git.rs:157-159`) and `diff_snapshot` untouched; the handler `get_git_diff_stats` (`handler/project.rs:103-115`) needs no change.

Add a parity test in the existing `#[cfg(test)]` module of `git.rs` (temp-repo helpers `create_temp_git_repo` / `add_commit` already exist; see existing test `diff_excludes_tracked_files_that_are_now_ignored` around `git.rs:2674` for the style — it already calls `diff_stats`):

```rust
#[test]
fn diff_stats_matches_snapshot_stats_including_untracked() {
	let dir = create_temp_git_repo();
	add_commit(&dir, "a.txt", "line1\nline2\n", "Init");
	std::fs::write(dir.join("a.txt"), "line1 changed\n").unwrap(); // modify tracked
	std::fs::write(dir.join("new.txt"), "brand new\nfile\n").unwrap(); // untracked

	let folder = dir.to_string_lossy().to_string();
	let stats = diff_stats(&folder).unwrap();
	let snapshot = diff_snapshot(&folder).unwrap();
	let _ = std::fs::remove_dir_all(&dir);

	assert_eq!(stats, snapshot.stats);
	assert_eq!(stats.files_changed, 2); // untracked file must be counted
	assert!(stats.insertions >= 3);
}
```

### Step 2 — Frontend: point `useGitDiffStats` at the stats-only command under `queryKeys.git.diffStats`

File: `src/features/git/hooks.ts` (lines 81-94). Change the query key, queryFn, and drop `select` and `refetchOnMount: "always"`:

```ts
import { getGitDiffStats /* add to existing @/generated import block */ } from "@/generated";

export function useGitDiffStats(profileId: string, enabled = true) {
	const { data, refetch } = useQuery({
		queryKey: queryKeys.git.diffStats(profileId),
		queryFn: () => getGitDiffStats({ profileId }),
		enabled,
		staleTime: GIT_DIFF_SNAPSHOT_STALE_MS,
		refetchInterval: enabled ? GIT_LIGHT_REFRESH_INTERVAL_MS : false,
	});
	useRefreshOnEnable(enabled, refetch);

	return useMemo(() => toGitDiffSummary(data), [data]);
}
```

Notes:
- `getGitDiffStats` returns `GitDiffStats` directly, so `toGitDiffSummary(data)` still works unchanged (`hooks.ts:53-61`).
- Dropping `refetchOnMount: "always"` is safe: TanStack's default (`true`) still refetches on mount when data is older than `staleTime` (30s); `"always"` only added refetches of *fresh* data. The watcher invalidation (`fileWatcher.ts:119`) plus the 6 existing `diffStats` invalidations are the change signal — and this change makes all 6 of them meaningful for the first time.
- `SidebarModeSwitch` already gates with `isActive` (`SidebarModeSwitch.tsx:34`, fed from `ProjectTopBar.tsx:199` ← `ProfileLayout.tsx:57`), so only the active profile's badge polls — and now it polls a 58-byte payload instead of the full diff.

### Step 3 — Frontend: gate the full-snapshot query (`useGitDiff` / `useGitDiffFiles`) on visibility

File: `src/features/git/hooks.ts`. `useGitDiff` is a `useSuspenseQuery`, which **ignores `enabled`** — gating must go through `refetchInterval` (and dropping `refetchOnMount: "always"`). Add an `isVisible` parameter (default `true` so `GitDiffContent` is unaffected):

```ts
function useGitDiff(profileId: string, isVisible = true) {
	return useSuspenseQuery({
		queryKey: queryKeys.git.diff(profileId),
		queryFn: () => getGitDiffSnapshot({ profileId }),
		select: (snapshot) => snapshot.diff,
		staleTime: GIT_DIFF_SNAPSHOT_STALE_MS,
		refetchInterval: isVisible ? GIT_LIGHT_REFRESH_INTERVAL_MS : false,
	});
}

export function useGitDiffFiles(profileId: string, isVisible = true) {
	const { data: diff } = useGitDiff(profileId, isVisible);
	return useMemo(() => parseDiffFiles(diff), [diff]);
}
```

(`useGitDiffFiles` is at `hooks.ts:257-260`.) Consumers:
- `GitDiffContent.tsx:87` — no change needed: it is mounted only while `GitDiffDialog` is open (Base UI `Dialog open={isOpen}` unmounts `DialogContent` when closed, `src/features/git/GitDiffDialog.tsx:81-113`), so the default `isVisible = true` is correct there.
- `SidebarGitPanel` — see Step 4.

A hidden `SidebarGitPanel` will still perform **one** suspense fetch on first mount (unavoidable with `useSuspenseQuery`), but no recurring poll; watcher invalidations mark it stale and the default `refetchOnMount`/stale handling refreshes it when it becomes relevant. Converting `useGitDiff` to a plain `useQuery` to also avoid the initial hidden fetch is a bigger refactor (Suspense fallbacks are relied on by `AsyncBoundary` wrappers in `ProfileSidebar.tsx:83` and `GitDiffDialog.tsx:97`) — out of scope here.

### Step 4 — Frontend: thread `isActive` into `SidebarGitPanel` and gate its two pollers

File: `src/features/projects/ProfileSidebar.tsx` (lines 131-138) — forward the prop it already receives (`isActive`, line 109), combined with `isOpen` (a closed-but-mounted git sidebar renders width-0 via `SidebarAltPanel` and should not poll either):

```tsx
{mode === "git" && (
	<SidebarAltPanel isOpen={isOpen}>
		<SidebarGitPanel
			profileId={profile.id}
			worktreePath={profile.worktree_path}
			isActive={Boolean(isActive) && isOpen}
		/>
	</SidebarAltPanel>
)}
```

This matches the existing convention one block up: `FileTreePanel` gets `isActive={isActive && isFilesMode}` (`ProfileSidebar.tsx:126`).

File: `src/features/git/components/SidebarGitPanel.tsx`:

```ts
interface SidebarGitPanelProps {
	profileId: string;
	worktreePath: string;
	isActive?: boolean;
}

export default function SidebarGitPanel({
	profileId,
	worktreePath,
	isActive = false,
}: SidebarGitPanelProps) {
	// ...
	const changesFiles = useGitDiffFiles(profileId, isActive);   // line 57
	// ...
	const aheadCount = useGitAheadCount(profileId, isActive);    // line 66
```

`useGitAheadCount` already supports `enabled` (`hooks.ts:96-106`) and already has `useRefreshOnEnable`, so reactivating the profile refetches immediately. `useGitDiffFiles` gets the new `isVisible` gating from Step 3; on reactivation the watcher-invalidated (or >30s-stale) snapshot refetches via default mount/stale behavior, and the resumed 10s interval fires as fallback.

### Step 5 — Frontend (small, from merged duplicate finding): mark commit diffs immutable

File: `src/features/git/hooks.ts` (lines 74-79). A commit's diff never changes; stop refetching it on every dialog remount:

```ts
function useCommitDiff(profileId: string, commitHash: string) {
	return useSuspenseQuery({
		queryKey: queryKeys.git.commitDiff(profileId, commitHash),
		queryFn: () => getCommitDiff({ profileId, commitHash }),
		staleTime: Number.POSITIVE_INFINITY,
	});
}
```

### Step 6 — Update existing tests

File: `src/features/git/hooks.test.tsx` — several assertions encode the old behavior and must be updated (add a `getGitDiffStatsMock` alongside the existing `getGitDiffSnapshotMock` in the `vi.hoisted`/`vi.mock("@/generated")` block at lines 18-41):

- `"keeps full diff snapshots on the fast fallback refresh"` (line 78): drop/replace the `expect(options?.refetchOnMount).toBe("always")` assertion (line 100) — after Step 3 it is unset. Keep the interval/staleTime assertions.
- `"keeps visible diff stats on the shared snapshot refresh"` (line 173): rewrite — mock `getGitDiffStatsMock.mockResolvedValue({ files_changed: 1, insertions: 2, deletions: 3 })`, assert the summary result unchanged, and read runtime options from `queryKeys.git.diffStats("profile-1")` instead of `queryKeys.git.diff`; drop the `refetchOnMount: "always"` assertion. Rename to something like `"polls lightweight diff stats under the diff-stats key"`.
- `"refetches diff stats when an enabled-gated profile reactivates"` (line 227): seed `queryClient.setQueryData(queryKeys.git.diffStats("profile-1"), {...stats})` and assert on `getGitDiffStatsMock` instead of `getGitDiffSnapshotMock`.
- Add new tests:
  - `useGitDiffFiles("profile-1", false)` → runtime options on `queryKeys.git.diff` have `refetchInterval === false`; with `true` (or default) → `GIT_LIGHT_REFRESH_INTERVAL_MS`.
  - `useGitDiffStats` never calls `getGitDiffSnapshotMock` (guards against regressing to the fat payload).
  - The existing mutation test (line 269) already asserts `diffStats` invalidation — it now guards a live query; leave as-is.

## Verification

All commands from repo root unless noted. **Do not run plain `cargo build`/`cargo test` (full Tauri app build fails without GTK system libs) and never run `bun tauri ...`.**

1. Rust — workspace crates only:
   ```bash
   cd /home/user/2code/src-tauri && cargo test -p model -p repo -p service -p infra
   ```
   Baseline before this change: 151 tests pass. After: all pass plus the new `diff_stats_matches_snapshot_stats_including_untracked`. The existing `diff_excludes_tracked_files_that_are_now_ignored` test (calls `diff_stats` on a tracked-then-ignored tree, `git.rs:~2674`) must still pass — it exercises the temp-index seeding path of the new implementation.
   Targeted run: `cargo test -p infra diff_stats`.

2. Frontend unit tests:
   ```bash
   cd /home/user/2code && bunx vitest run src/features/git
   ```
   and then the full suite (`bunx vitest run`) — baseline 671 tests pass; expect the updated + new tests to pass with no unrelated failures.

3. Typecheck (no full build needed):
   ```bash
   cd /home/user/2code && bunx tsc --noEmit
   ```

4. Behavioral spot-checks encoded as assertions (already covered by the tests above, listed for the reviewer):
   - `useGitDiffStats` registers under `["git-diff-stats", id]` and calls `getGitDiffStats`, never `getGitDiffSnapshot`.
   - `useGitDiffFiles(id, false)` has `refetchInterval: false` on the `["git-diff", id]` query.
   - The 6 pre-existing `diffStats` invalidations (git/hooks.ts:155,208,242; projects/hooks.ts:349,566; watcher/fileWatcher.ts:19,119) now hit a registered query (the commit-mutation test asserts the invalidation call; the stats test asserts the registration).

5. Optional micro-benchmark (delete afterwards; keep out of git): a `*.bench.ts` under the scratchpad dir comparing `JSON.parse` + `replaceEqualDeep` of an 8 MB snapshot payload vs the 58 B stats payload via `bunx vitest bench --run <file>` reproduces the ~350x-5,500x per-tick numbers above. Not required for acceptance.

6. Manual QA on a dev machine (not possible in CI container): `bun tauri dev`, open a project with a large dirty worktree, leave profile A in git-sidebar mode, switch to profile B, and confirm via `Cmd+Shift+D` debug panel / backend tracing that no `get_git_diff_snapshot` calls fire for profile A while hidden; confirm the badge still updates within ~1s of a file save (watcher) and at most 10s otherwise; open the diff dialog and confirm full diff still streams and updates.

## Risks & Constraints

- **Do not touch `src/generated/`** (gitignored, auto-generated). No typegen run is needed: no Rust command signatures change — only the internal implementation of `infra::git::diff_stats` and frontend hooks.
- **Stats parity is the correctness risk.** The stats-only path MUST keep the untracked-aware temp-index pipeline (`has_any_changes` → `create_temp_index_from_repo` → `stage_all_changes` → `run_cached_diff(.., true)`); a naive `git diff --shortstat HEAD` silently misses untracked files and the badge would disagree with the diff dialog. The parity test in Step 1 is the guard. Also replicate the `is_no_head_error` → default-stats fallback for repos with no commits yet.
- **Two backend calls when both badge and diff view are visible.** Previously stats piggybacked on the shared `git.diff` cache entry; now an open diff panel + badge means one `diff_snapshot` + one `diff_stats` call per cycle. Both short-circuit on clean trees; on dirty trees this is still strictly cheaper on the webview main thread and roughly cost-neutral on the backend vs. today's duplicate observers. The dominant backend cost (`git add -A` re-hashing, `git.rs:220-234`) is a separate finding — coordinate with `plans/24-*` (watcher/backend) if it lands; do not restructure the temp-index pipeline here.
- **Staleness windows change.** Dropping `refetchOnMount: "always"` means a remount within the 30s `staleTime` shows cached data instead of forcing a refetch. That is intended (the watcher invalidates on real changes within ~1s), but git operations performed outside the worktree's watched files could in principle be reflected up to 10s late (visible poll) instead of instantly on remount. The 10s `refetchInterval` on visible queries is deliberately kept as the fallback signal — do not remove it.
- **Hidden `SidebarGitPanel` still does one initial suspense fetch** on first mount (a `useSuspenseQuery` cannot be disabled). Accepted; the recurring poll is what's eliminated. Do not convert to conditional rendering of the panel to avoid this — and never conditionally render anything inside the terminal area: **terminals must stay mounted with CSS `display:none`** (CLAUDE.md invariant; `TerminalLayer.tsx` structure must not change).
- **Query keys must come from `queryKeys.ts`** (shared/lib CLAUDE.md invariant) — `queryKeys.git.diffStats` already exists (`queryKeys.ts:50-51`); no new keys or namespaces are needed.
- **`useRefreshOnEnable` semantics** (`hooks.ts:31-40`): its `refetch()` fires even while the query was disabled-then-enabled; keep it on both `useGitDiffStats` and `useGitAheadCount` so re-activating a profile updates the badge/ahead count immediately instead of waiting for the next interval tick.
- **Backend layering**: the change to `diff_stats` stays in `infra` (`crates/infra/src/git.rs`); handlers remain thin (existing `get_git_diff_stats` handler unchanged). Note `service::project::get_diff_stats` (`crates/service/src/project.rs:223-229`) also wraps `infra::git::diff_stats` and benefits automatically — verify its callers (used by profile delete-risk checks) still pass tests via the `-p service` run.
- **Container limitation**: the full Tauri app cannot be built or launched in CI containers (missing GTK, no display). All automated verification must be the `-p`-scoped cargo tests + vitest + tsc listed above; the manual QA step runs only on a real dev machine.
