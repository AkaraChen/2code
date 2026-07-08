# Bound parseDiffFiles cache by bytes, not entry count — it can retain hundreds of MB of diff text

> The module-level parsed-diff cache in `src/features/git/patchFiles.ts` caps at 20 *entries* with no size awareness, so a user with a multi-MB working-tree diff can pin 200MB–1GB of heap for the whole app session; bound it by bytes and skip caching very large diffs. | Severity: medium | Category: memory

## Problem

`src/features/git/patchFiles.ts` keeps a module-level LRU cache of parsed diffs:

- `src/features/git/patchFiles.ts:8-9` — `const PARSED_DIFF_CACHE_LIMIT = 20; const parsedDiffFilesCache = new Map<string, FileDiffMetadata[]>();`
- `src/features/git/patchFiles.ts:31` — the cache **key is the entire raw diff string** (`parsedDiffFilesCache.get(diff)`).
- `src/features/git/patchFiles.ts:39` — the **value is the fully parsed `FileDiffMetadata[]`**, which embeds all hunk content (measured at ~1.5x the raw text size on top of the string).
- `src/features/git/patchFiles.ts:41-46` — eviction is **count-based only**: when `size > 20`, evict one oldest entry. There is no byte accounting, no per-entry size limit, and no lifecycle tie-in — entries outlive TanStack's query `gcTime`, profile deletion, and dialog close.

Why this bites in practice:

- Working-tree diffs refetch aggressively: `useGitDiff` at `src/features/git/hooks.ts:42-51` uses `refetchOnMount: "always"` plus `refetchInterval: GIT_LIGHT_REFRESH_INTERVAL_MS` (10s). Every save that changes the diff produces a **new distinct string**, i.e. a new cache key. Commit diffs across profiles (`useCommitDiff`, `hooks.ts:74-79`) add more keys.
- So a user editing a repo with a large dirty diff (lockfile churn, generated code: 5–20MB of diff text) steadily fills all 20 slots with distinct multi-MB strings **plus** their parsed structures — measured at ~2.56x the raw text per entry — and holds them until app exit.
- The cache's real benefit is narrow. Both call sites already `useMemo` on the diff string (`useGitDiffFiles` at `src/features/git/hooks.ts:257-260`, `useCommitDiffFiles` at `hooks.ts:262-265`), and TanStack structural sharing keeps the string reference-stable across refetches with identical content. The module cache only helps across **component remounts** (dialog reopen).
- Worse, the largest cached entries are exactly the ones the UI refuses to render: `GIT_DIFF_LARGE_FILE_LINE_THRESHOLD = 2000` (`src/features/git/utils.ts:3`, asserted at `src/features/git/utils.test.ts:268-269`) triggers `LargeDiffGuardrail` in `src/features/git/components/GitDiffPane.tsx:80,232,425-426`. Retention without benefit.

## Evidence & Measurements

Benchmark results (verbatim, from the verification pass; bun/JSC, same engine family as Tauri's WebKit WebViews):

> Harness: bun 1.3.11 (JavaScriptCore) running a TS script importing the real src/features/git/patchFiles.ts and @pierre/diffs 1.2.10 from project node_modules; heap measured via bun:jsc heapStats().heapSize after 2x Bun.gc(true). Synthetic unified diffs: 5MB each, 50 files, realistic hunk structure (3 ctx/10 del/20 add per hunk). RETENTION (real implementation, churn of 30 distinct 5MB diffs simulating working-tree snapshots): heap before 3.1MB -> after full GC 259.4MB => 256.4MB retained by the 20-entry cache (12.8MB per entry). OVERHEAD DECOMPOSITION: raw 5MB string = +5.1MB heap; its parsed FileDiffMetadata[] = +7.6MB on top (parsed ~1.5x raw). PARSE COST (cache-miss cost the fix re-incurs): parsePatchFiles on 5MB diff, n=8 fresh diffs after warmup: median 51.9ms (min 49.1, max 68.4); typical 50KB diff, n=50: 0.56ms/op. A/B FIX PROTOTYPE (byte-bounded LRU, 32MB key-byte budget + skip entries >8MB, reimplemented in bench file, identical 30-diff churn): 76.2MB retained (6 entries kept) vs 256.4MB baseline = 3.4x reduction; hit path unchanged at 1.0us/op over 1000 repeat lookups of a 100KB diff.

Key takeaways for the implementation:

- Real retention per entry ≈ **2.56x `diff.length`** (string + parsed value). A budget that sums only key lengths under-counts by ~2.5x — the prototype's "32MB" key-byte budget actually retained 76MB. Size the budget accordingly (see below).
- Re-parse cost is ~10ms/MB (52ms median for a 5MB diff, 0.56ms for a typical 50KB diff), off any hot path — cheap insurance against pinning hundreds of MB.
- Cache hit path is ~1µs; keep small-diff caching for the dialog-reopen case.
- Note: `diff.length` counts UTF-16 code units; ASCII diffs are 1 byte/char in JSC, CJK content 2 bytes/char — `diff.length` undercounts non-ASCII bytes, which is fine for a heuristic budget.

## Proposed Change

Single file to modify: `src/features/git/patchFiles.ts`. One test file to extend: `src/features/git/patchFiles.test.ts`. No Rust, no generated bindings, no i18n changes.

### Step 1 — Replace the count-only cap with a byte-aware, size-skipping LRU

Rewrite the caching portion of `src/features/git/patchFiles.ts` (keep `collectPatchFiles` and the `parsePatchFiles` call exactly as-is):

```typescript
import type { FileDiffMetadata } from "@pierre/diffs";
import { parsePatchFiles } from "@pierre/diffs";

interface PatchWithFiles {
	files: FileDiffMetadata[];
}

const PARSED_DIFF_CACHE_LIMIT = 20;
// Real retained heap per entry is ~2.56x diff.length (measured: 5MB ASCII
// string = 5.1MB heap + 7.6MB parsed FileDiffMetadata[]). Budgets below are in
// diff.length units, so effective retention is ~2.5x these numbers:
// 8MB total-length budget ≈ ~20MB max retained heap.
export const PARSED_DIFF_CACHE_MAX_ENTRY_LENGTH = 1024 * 1024; // 1MB: don't cache larger diffs
export const PARSED_DIFF_CACHE_TOTAL_LENGTH_BUDGET = 8 * 1024 * 1024; // 8MB summed key length

const parsedDiffFilesCache = new Map<string, FileDiffMetadata[]>();
let cachedTotalLength = 0;

function collectPatchFiles(patches: readonly PatchWithFiles[]) {
	// ... unchanged (current lines 11-28) ...
}

export function parseDiffFiles(diff: string) {
	const cached = parsedDiffFilesCache.get(diff);
	if (cached) {
		// Refresh LRU position.
		parsedDiffFilesCache.delete(diff);
		parsedDiffFilesCache.set(diff, cached);
		return cached;
	}

	const files = collectPatchFiles(parsePatchFiles(diff));

	// Large diffs: re-parsing costs ~10ms/MB (one-time, off any hot path),
	// while caching pins ~2.5x the text size for the whole app session — and
	// the GitDiffPane 2000-changed-line guardrail suppresses rendering these
	// anyway. Skip the cache entirely.
	if (diff.length > PARSED_DIFF_CACHE_MAX_ENTRY_LENGTH) {
		return files;
	}

	parsedDiffFilesCache.set(diff, files);
	cachedTotalLength += diff.length;

	// Evict oldest entries until both the entry-count cap and the byte budget
	// are satisfied. (Map preserves insertion order; the LRU refresh above
	// keeps recently-used entries at the tail.)
	while (
		parsedDiffFilesCache.size > PARSED_DIFF_CACHE_LIMIT ||
		cachedTotalLength > PARSED_DIFF_CACHE_TOTAL_LENGTH_BUDGET
	) {
		const oldestKey = parsedDiffFilesCache.keys().next().value;
		if (oldestKey === undefined) break;
		parsedDiffFilesCache.delete(oldestKey);
		cachedTotalLength -= oldestKey.length;
	}

	return files;
}
```

Implementation notes (do not skip these):

- **The `while` loop cannot evict the just-inserted entry into a bad state**: since any cached entry has `length <= PARSED_DIFF_CACHE_MAX_ENTRY_LENGTH` (1MB) and the budget is 8MB, a single entry can never exceed the budget on its own, so the loop always terminates with at least the newest entry present. Keep the invariant `PARSED_DIFF_CACHE_MAX_ENTRY_LENGTH <= PARSED_DIFF_CACHE_TOTAL_LENGTH_BUDGET` if you tune the numbers.
- **Bookkeeping invariant**: `cachedTotalLength` must equal the sum of `key.length` over all map entries. The only mutations are the insert (`+= diff.length`) and the eviction (`-= oldestKey.length`). The LRU-refresh path on hit (delete + re-set of the same key) does not change the sum — do not add accounting there.
- **Export the two new constants** (as sketched) so tests can build inputs relative to them instead of hardcoding sizes.
- Do NOT change the function's signature or return-reference semantics for small diffs — `useGitDiffFiles`/`useCommitDiffFiles` (`src/features/git/hooks.ts:257-265`) rely on `parseDiffFiles` and need no changes.

### Step 2 — Extend `src/features/git/patchFiles.test.ts`

Keep the existing test (same-reference on repeat call for a small patch, lines 14-22) — it must still pass. Add:

1. **Large diffs are not cached**: build a syntactically valid unified diff whose text length exceeds `PARSED_DIFF_CACHE_MAX_ENTRY_LENGTH` (e.g. one file, one hunk with enough repeated `+`-lines of a long padded string; reuse the header shape of the existing `patch` fixture). Assert `parseDiffFiles(big)` twice returns **different** array references (`expect(second).not.toBe(first)`) but `toEqual` content, and that a small diff cached *before* the large call is still cached *after* it (same reference — proves the large diff neither entered the cache nor evicted others).
2. **Byte budget evicts oldest**: generate distinct valid diffs each just under `PARSED_DIFF_CACHE_MAX_ENTRY_LENGTH` (e.g. ~0.9MB, vary a comment line to make keys distinct). Parse diff A, then parse enough of the others that summed lengths exceed `PARSED_DIFF_CACHE_TOTAL_LENGTH_BUDGET` (10 x 0.9MB > 8MB). Assert re-parsing A returns a **new** reference (it was evicted by bytes well before the 20-entry cap), and re-parsing the most recent diff returns the **same** reference (still cached).
3. **Entry cap still enforced**: parse 21 distinct tiny diffs; assert the first was evicted (new reference on re-parse) and the 21st is still cached (same reference).

Caveat for test authoring: the module-level cache persists across tests in the file. Make every fixture in the new tests unique (embed the test name or a counter into a diff line) so tests don't interact, and don't rely on cache emptiness at test start. Generating ~10MB of fixture strings is fine for vitest; construct them with `"+" + "x".repeat(200) + i` style hunk lines wrapped in a correct `@@` header (line counts in the `@@ -a,b +c,d @@` header must match the body or `parsePatchFiles` may drop the hunk — mirror the existing fixture's structure and verify `files` is non-empty in each test).

### Explicitly out of scope (considered, not chosen)

- Keying by hash+length instead of the full string: halves retention but adds a hashing dependency/complexity; the byte budget + skip threshold already caps worst-case retention at ~20MB.
- Clearing the cache on git-UI unmount: complementary but touches component lifecycles across `GitDiffDialog.tsx`; not needed once retention is hard-capped.

## Verification

All commands from the repo root `/home/user/2code`. Do **not** run plain `cargo build`/`cargo test` or `bun tauri ...` — the full Tauri app does not build in CI containers (missing GTK libs). This change is frontend-only; no Rust verification is needed beyond noting nothing under `src-tauri/` changed.

1. Targeted tests (existing + new):
   ```bash
   bunx vitest run src/features/git/patchFiles.test.ts
   ```
   The pre-existing test "reuses parsed file metadata for the same patch text" must still pass unchanged.
2. Full frontend suite (671 tests passed pre-change; expect that count plus your new tests):
   ```bash
   bunx vitest run
   ```
   Pay attention to `src/features/git/hooks.test.tsx`, `src/features/git/utils.test.ts`, and `src/features/git/gitDiffReducer.test.ts` — they exercise the surrounding area.
3. Type check:
   ```bash
   bunx tsc --noEmit
   ```
4. Optional retention benchmark (proves the memory claim end-to-end): write a throwaway bun script in the scratch directory (NOT in the repo) that imports the real `./src/features/git/patchFiles.ts`, churns 30 distinct synthetic ~5MB diffs through `parseDiffFiles`, then measures heap via `bun:jsc`'s `heapStats().heapSize` after two `Bun.gc(true)` calls. Pre-fix baseline retained ~256MB; post-fix the same churn must retain roughly the baseline heap (all 5MB diffs exceed the 1MB skip threshold, so nothing is cached — expect < ~10MB delta). Run with `bun <script>.ts`; delete the script afterwards.

## Risks & Constraints

- **Behavioral regression risk — dialog reopen re-parse**: diffs larger than 1MB are no longer cached, so reopening the git dialog re-parses them (~10ms/MB, so ≤ ~20ms for a 2MB diff, ~52ms for 5MB — one-time, during dialog open, and such diffs mostly hit the `LargeDiffGuardrail` render suppression anyway). Diffs ≤ 1MB keep the exact previous behavior (~1µs hit path). This trade-off is the point of the fix; do not "optimize" it away by raising the skip threshold above a few MB.
- **Reference identity**: some components may rely on `parseDiffFiles` returning a stable array reference for memoization. That guarantee already only held while an entry stayed in the 20-slot cache, and the `useMemo` in `hooks.ts:257-265` preserves per-mount stability regardless. Cross-remount stability is lost only for >1MB diffs — acceptable, but keep it in mind if a snapshot test somewhere compares references.
- **Bookkeeping drift**: if `cachedTotalLength` desyncs from the map (e.g. someone later adds a delete path without decrementing), eviction becomes over- or under-aggressive. Keep all mutations of the map inside `parseDiffFiles` and colocated with the counter updates; the new tests in Step 2 catch gross drift.
- **CLAUDE.md invariants**: no Tauri commands change, so do NOT run `cargo tauri-typegen generate`; do not touch `src/generated/`, `src/paraglide/`, or `project.inlang/settings.json`; no i18n strings are involved. Frontend-only change confined to `src/features/git/patchFiles.ts` + its test.
- **Engine caveat**: measurements are from bun/JSC, which matches Tauri's WKWebView/WebKitGTK engine family; absolute numbers on V8 differ slightly but the retention mechanism (Map strongly holding key strings + parsed values) is engine-independent.
- **Do not** move this cache into TanStack Query `select`/`gcTime` machinery as an "alternative fix" — the hooks intentionally separate the raw-diff query from parsing, and `useSuspenseQuery` + structural sharing already dedupes identical refetch results; the module cache exists solely for remount reuse of small diffs.
