# Stop FileTreePanel from resetting the whole tree model on every render

> `resetFileTreeModel` (a documented coarse whole-tree rebuild) fires on every FileTreePanel commit — every file click, resize pointermove, and watcher burst — costing ~23ms per event at 10k paths; a `combine` option on one useQueries hook makes it fire only when path data actually changes (~35x). | Severity: high | Category: performance

## Problem

`useFileTreeExpandedChildPaths` (`src/features/projects/hooks.ts:318-331`) calls TanStack `useQueries` **without a `combine` option**:

```ts
export function useFileTreeExpandedChildPaths(
	profileId: string,
	parentPaths: readonly string[],
	enabled = true,
) {
	return useQueries({
		queries: parentPaths.map((parentPath) => ({
			queryKey: queryKeys.fs.treeChildren(profileId, parentPath),
			queryFn: () => listFileTreeChildPaths({ profileId, parentPath }),
			enabled: !!profileId && enabled,
			staleTime: FILE_TREE_STALE_TIME_MS,
		})),
	});
}
```

In `@tanstack/react-query` 5.101.0 (the installed version), `useQueries` without `combine` returns `getCombinedResult(trackResult())`, and `QueriesObserver.getOptimisticResult` builds the result via `matches.map(...)` — a **brand-new array on every render** (see `node_modules/@tanstack/query-core/build/modern/queriesObserver.js:116-131`; the no-`combine` branch of `#combineResult` returns the fresh `input` array as-is). Structural sharing via `replaceEqualDeep` only happens **with** a `combine` function (same file, `#combineResult`, `this.#combinedResult = replaceEqualDeep(this.#combinedResult, combine(input))`).

Consequence chain in `src/features/projects/FileTreePanel.tsx`:

1. `expandedChildPathResults` (line 675-679) is a new array reference every render — even when `expandedPaths` is `[]` (a fresh `[]` each render).
2. `treePaths` useMemo (line 686-695) depends on `expandedChildPathResults` → recomputes every render.
3. `modelPaths` useMemo (line 700-703) depends on `treePaths` → re-runs `buildModelPaths` every render, which includes `paths.sort(compareFileTreePaths)` (line 249) — an Intl.Collator sort over every visible path. `existingPathSet`/`filePathSet` (lines 704-719) also rebuild.
4. The reset effect (lines 854-867) guards only by **reference equality** (`lastResetModelPathsRef.current === modelPaths`, line 857), so it calls `resetFileTreeModel(model, modelPaths, expandedPaths)` (line 863 → `model.resetPaths(...)`, lines 402-413) on **every commit**.

`@pierre/trees` documents `resetPaths` as "intentionally a coarse whole-tree reset" (`node_modules/@pierre/trees/dist/model/FileTreeController.js:661-665`): it rebuilds the path store, clears item-handle caches, rebuilds the visible projection, and emits — forcing the `FileTree` view component to re-render too.

FileTreePanel re-renders (and therefore pays this full cost) on:
- every selection click — the reducer's `"select"` action always produces a new `selectedPaths` array (`FileTreePanel.tsx:339-340`), dispatched from `onSelectionChange` (line 826-827);
- every panel-resize pointermove — `setPanelWidth` state via `useHorizontalResize` (lines 657-664);
- every draft-create / context-menu action (same reducer);
- every time any expanded directory's query data or git status changes — the file watcher invalidates the whole `fs-tree` prefix per profile (`src/features/watcher/fileWatcher.ts:124-127`), refetching all expanded directories.

With a few thousand visible paths and many expanded dirs, basic interactions (clicking a file, dragging the resize handle) each do a full O(n log n) sort plus a whole-tree model rebuild.

## Evidence & Measurements

Verified measurements (vitest 4.1.8 + jsdom + bun, dev profile; benchmarks ran against the real production modules and were deleted afterward):

> Environment: vitest 4.1.8 + jsdom + bun, dev profile (absolute times indicative; pure-JS costs comparable to WebView). All benchmarks against real production modules; benchmark file deleted after run.
>
> A) Real FileTreePanel + real hooks/react-query (mocked: @/generated IPC, @pierre/trees/react view; resetPaths recorded via mock), 20 expanded dirs, modelPaths=10,100:
> - 1 selection click (no data change): 1 resetPaths call with all 10,100 paths.
> - 30 selection changes: 30 resetPaths calls; wall 240.1ms = 8.00ms/commit (Profiler total 216.4ms) — resetPaths itself mocked to zero cost.
> - 30 resize keydowns on separator: 30 resetPaths calls; wall 243.1ms = 8.10ms/commit (Profiler 210.3ms).
>
> B) A/B, 200 unrelated re-renders, 10k paths in cache, real useQueries both sides:
> - Baseline (real useFileTreeExpandedChildPaths, no combine): treePathsComputes=200, modelPathsComputes=200, resets=200; 781.9ms total = 3.910ms/render.
> - Fixed (combine flattening + replaceEqualDeep sharing): treePathsComputes=0, modelPathsComputes=0, resets=0; 127.8ms = 0.639ms/render → 6.1x faster memo chain, resets eliminated.
>
> C) REAL @pierre/trees FileTree.resetPaths (same options as production useFileTree), warmed, time-boxed loops:
> - 1,000 paths (5 expanded dirs): 1.41ms/call (300 iters)
> - 10,000 paths (20 expanded dirs): 14.77ms/call (34 iters)
> - 50,000 paths (100 expanded dirs): 68.20ms/call (10 iters)
>
> D) buildModelPaths pipeline (verbatim replica, real compareFileTreePaths Intl.Collator, 200 git entries):
> - 1,000 paths: 0.280ms/call (1787 iters)
> - 10,000 paths: 3.070ms/call (163 iters)
> - 50,000 paths: 25.179ms/call (21 iters)
>
> Combined real per-event waste at 10k paths: ~8ms (memo chain + panel re-render) + ~14.8ms (real resetPaths) ≈ ~23ms per selection click / resize pointermove / watcher-invalidated commit, vs ~0.6ms after fix.

Key confirmations:
- `resetPaths` fires 1:1 with every commit (30/30 interactions), passing all 10,100 paths, with zero data changes.
- The bug is unconditional: even with zero expanded dirs, `useQueries([])` returns a fresh `[]` each render, so `resetFileTreeModel` runs on every commit regardless of tree size.
- `resetPaths` also `#emit()`s on every call, forcing the real `FileTree` view component to re-render/rebuild its projection — an additional unmeasured production cost on top of the ~23ms measured.

## Proposed Change

The core fix is small: give the hook a `combine` option that flattens the per-query data into one `string[]`. TanStack caches the combined result and applies `replaceEqualDeep` to it, so the returned reference is stable across renders when the underlying data hasn't changed. Once that array is stable, `treePaths`/`modelPaths` memoize correctly (their other inputs — `rootChildPaths` from `useQuery` data, `gitStatus` memo over stable query data, `draftCreate?.path` — are already reference-stable), and the existing reference-equality guard in the reset effect works as intended.

### Step 1 — `src/features/projects/hooks.ts`: add `combine` to `useFileTreeExpandedChildPaths`

Hoist the combine function to module scope (a stable function reference lets TanStack skip recombination entirely; an inline closure would still be correct — `replaceEqualDeep` keeps the returned reference stable — but recombines every render):

```ts
function combineFileTreeChildPathResults(
	results: { data: string[] | undefined }[],
): string[] {
	return results.flatMap((result) => result.data ?? []);
}

export function useFileTreeExpandedChildPaths(
	profileId: string,
	parentPaths: readonly string[],
	enabled = true,
): string[] {
	return useQueries({
		queries: parentPaths.map((parentPath) => ({
			queryKey: queryKeys.fs.treeChildren(profileId, parentPath),
			queryFn: () => listFileTreeChildPaths({ profileId, parentPath }),
			enabled: !!profileId && enabled,
			staleTime: FILE_TREE_STALE_TIME_MS,
		})),
		combine: combineFileTreeChildPathResults,
	});
}
```

Notes:
- Match the actual TypeScript signature TanStack infers for `combine` (it receives `UseQueryResult<string[], Error>[]` — adjust the parameter type accordingly; the sketch above shows the minimal shape). Let inference do the work if possible: `combine: (results) => results.flatMap((r) => r.data ?? [])` hoisted with an explicit results type.
- `flatMap` preserves per-query order, which matches the current iteration order in the panel (results in `parentPaths` order), so tree content is identical.
- The return type of the hook changes from `UseQueryResult<string[]>[]` to `string[]`. This is intentional and is the semantic version of the hook the panel actually needs. TanStack's `#combineResult` recombines only when the underlying results change, the query hashes change, or the combine reference changes — with a module-scope function, all three are stable across unrelated renders.

### Step 2 — `src/features/projects/FileTreePanel.tsx`: adapt `treePaths` to the flat array

Current code (lines 675-695):

```ts
const expandedChildPathResults = useFileTreeExpandedChildPaths(
	profileId,
	expandedPaths,
	isOpen && isActive
);
...
const treePaths = useMemo(
	() => {
		const paths = rootChildPaths ? [...rootChildPaths] : [];
		for (const result of expandedChildPathResults) {
			if (result.data) paths.push(...result.data);
		}
		return paths;
	},
	[expandedChildPathResults, rootChildPaths]
);
```

Replace with (rename the variable to reflect the new shape):

```ts
const expandedChildPaths = useFileTreeExpandedChildPaths(
	profileId,
	expandedPaths,
	isOpen && isActive
);
...
const treePaths = useMemo(
	() => {
		const paths = rootChildPaths ? [...rootChildPaths] : [];
		for (const path of expandedChildPaths) {
			paths.push(path);
		}
		return paths;
	},
	[expandedChildPaths, rootChildPaths]
);
```

Use a `for...of` push loop (not `paths.push(...expandedChildPaths)`) — spreading a 50k-element array as call arguments can approach engine argument-count limits; the loop is safe at any size.

No other panel changes are required for correctness: `modelPaths` (line 700-703), `existingPathSet` (704-707), `filePathSet` (708-719) all key off `treePaths`/`gitStatus` and become stable automatically, which makes the reset effect's existing reference guard (lines 854-867) hold. Keep the `draftCreate?.path` and `gitStatus` inputs in the memo chain exactly as they are.

### Step 3 (optional, defense-in-depth) — content-equality guard in the reset effect

The combine fix alone is sufficient (verified: 0 resets across 200 unrelated re-renders). If you want the reset effect to be robust against future regressions that reintroduce an unstable `modelPaths` reference, add a cheap content check in the effect (lines 854-867):

```ts
function areSameStringArrays(
	a: readonly string[] | null,
	b: readonly string[],
) {
	if (a === b) return true;
	if (!a || a.length !== b.length) return false;
	for (let i = 0; i < a.length; i += 1) {
		if (a[i] !== b[i]) return false;
	}
	return true;
}

useEffect(() => {
	if (
		lastResetModelRef.current === model &&
		areSameStringArrays(lastResetModelPathsRef.current, modelPaths) &&
		areSameStringArrays(lastResetExpandedPathsRef.current, expandedPaths)
	) {
		return;
	}
	resetFileTreeModel(model, modelPaths, expandedPaths);
	lastResetModelRef.current = model;
	lastResetModelPathsRef.current = modelPaths;
	lastResetExpandedPathsRef.current = expandedPaths;
}, [expandedPaths, model, modelPaths]);
```

The `a === b` fast path keeps this O(1) in the common (post-fix) case. Do NOT rely on this guard *instead of* the combine fix — without the combine fix the memo chain (Intl.Collator sort etc., ~3-4ms/render at 10k paths) still burns on every render even if the reset is skipped.

### Step 4 — update the test mock in `src/features/projects/FileTreePanel.test.tsx`

The existing mock (lines 215-220) returns per-query result objects:

```ts
useFileTreeExpandedChildPaths: vi.fn(
	(_profileId: string, parentPaths: readonly string[]) =>
		parentPaths.map((parentPath) => ({
			data: expandedChildPathsRef.current.get(parentPath),
		})),
),
```

It must return the new flat shape or the panel tests will fail. Additionally, to make the mock reference-stable like the real (fixed) hook — which matters for the new regression test in Step 5 — cache the last value and return it when contents are unchanged:

```ts
useFileTreeExpandedChildPaths: vi.fn(
	(_profileId: string, parentPaths: readonly string[]) => {
		const next = parentPaths.flatMap(
			(parentPath) => expandedChildPathsRef.current.get(parentPath) ?? [],
		);
		const prev = lastExpandedChildPathsRef.current;
		if (
			prev &&
			prev.length === next.length &&
			prev.every((path, i) => path === next[i])
		) {
			return prev;
		}
		lastExpandedChildPathsRef.current = next;
		return next;
	},
),
```

where `lastExpandedChildPathsRef` is added to the existing `vi.hoisted(() => ({ ... }))` block (lines 30-79) as `lastExpandedChildPathsRef: { current: null as readonly string[] | null }`, and cleared in the `beforeEach` (around line 335-345, next to `expandedChildPathsRef.current.clear()`).

Existing assertions on call shape (`toHaveBeenLastCalledWith(profileId, ["src/"], true)` at lines 399 and 466) still pass — arguments are unchanged, only the return value shape changes. Assertions on `resetPathsMock` (e.g. lines 406-409, 473-476) assert the paths/expansion arguments, which are unchanged.

### Step 5 — add regression tests

**Panel-level (in `FileTreePanel.test.tsx`)** — the behavior that actually matters: after the tree has settled, unrelated commits must not reset the model. Using the existing harness (mocked `@pierre/trees/react` FileTree exposes `useFileTreeOptionsRef.current.onSelectionChange`; `resetPathsMock` records resets):

1. Render the panel with some `treePaths` via `useFileTreeChildPaths` mock; `await waitFor` until `resetPathsMock` has been called (initial reset).
2. Record `resetPathsMock.mock.calls.length`.
3. Inside `act(...)`, invoke `useFileTreeOptionsRef.current.onSelectionChange(["src/index.ts"])` (this dispatches the `"select"` reducer action, forcing a re-render); do it twice.
4. Assert `resetPathsMock.mock.calls.length` has not increased. (Before this fix, each selection commit adds exactly one call.)

**Hook-level (in `hooks.test.tsx`)** — pins the reference-stability contract of the fixed hook using real react-query (this file already mocks `@/generated` with `vi.importActual` spread and has `createQueryClient`/`createWrapperWithClient` helpers, lines 37-79):

1. Create a `QueryClient`, seed it: `queryClient.setQueryData(queryKeys.fs.treeChildren("profile-1", "src/"), ["src/a.ts", "src/b.ts"])` (avoids needing the IPC mock to resolve).
2. `renderHook(() => useFileTreeExpandedChildPaths("profile-1", parentPaths), { wrapper })` with a constant `parentPaths = ["src/"]`.
3. Assert the result equals `["src/a.ts", "src/b.ts"]`.
4. `rerender()` twice; assert the returned array is the **same reference** (`toBe`) as before.
5. Optionally: update the cache with `setQueryData` to a new value inside `act`, and assert the hook returns the new flattened content.

## Verification

All commands run from the repo root. Reminder: the full Tauri build fails in CI containers (missing GTK libs) — never run plain `cargo build`/`cargo test` or `bun tauri ...`. This change is frontend-only; no Rust or generated-bindings changes are involved.

1. **Targeted tests** (must pass, including the two new regression tests):
   ```bash
   bunx vitest run src/features/projects/FileTreePanel.test.tsx src/features/projects/hooks.test.tsx
   ```
2. **Full frontend suite** (671 tests passed pre-change; expect that plus the new tests):
   ```bash
   bunx vitest run
   ```
3. **Type check** (the hook's return type changed; make sure no other consumer breaks — a repo-wide grep confirms `useFileTreeExpandedChildPaths` is only consumed by `FileTreePanel.tsx` and mocked in `FileTreePanel.test.tsx`):
   ```bash
   bunx tsc --noEmit
   ```
   (If `bunx tsc --noEmit` trips over generated/paraglide config nuances, use the project's build-time check pieces instead — but do NOT run `bun run build`'s paraglide compile step against `project.inlang`; paraglide output is already compiled and must not be touched.)
4. **Optional perf spot-check** (temporary file in scratch space, delete afterward): a `bunx vitest bench --run <scratch-file>` benchmark that seeds a QueryClient with ~20 expanded-dir queries totaling ~10k paths, renders the real hook, and counts recomputations of a `useMemo` keyed on its return across 200 unrelated re-renders. Expected: 0 recomputations (baseline before fix: 200), matching measurement B above. Do not commit benchmark files.

Existing coverage of this area: `FileTreePanel.test.tsx` covers expansion → `resetPathsMock` call shape (lines ~389-476), draft-create, context menu, drag/drop, and git status propagation; `hooks.test.tsx` covers other project hooks with real react-query. The behavior-critical assertions to watch are the `resetPathsMock.toHaveBeenCalledWith([...paths], { initialExpandedPaths: [...] })` ones — the fix must not change *what* gets passed to `resetPaths`, only *how often* it is called.

## Risks & Constraints

- **CLAUDE.md invariants**: do not create manual IPC wrappers (`src/api/`); `src/generated/` and `src/paraglide/` are generated and must not be edited; `project.inlang/settings.json` must not be touched. This change touches neither.
- **Ordering must be preserved**: `resetPaths` receives `modelPaths` which is sorted by `compareFileTreePaths` inside `buildModelPaths` (FileTreePanel.tsx:249), so final order is insensitive to concat order — but keep `flatMap` order anyway so `treePaths`-derived sets and any future consumers see the same sequence as today.
- **Loading/error states**: the current panel code only ever reads `result.data` from the per-query results (FileTreePanel.tsx:689-691); `isLoading`/`error` of expanded-children queries are ignored today (root-level errors come from `useFileTreeChildPaths`, line 668-670). The `combine` flattening therefore loses no information the panel uses. If a future feature needs per-directory loading states, it should add a second hook rather than un-combining this one.
- **Type-shape ripple**: the hook's return type changes (`UseQueryResult<string[]>[]` → `string[]`). Only `FileTreePanel.tsx` and its test mock consume it (verified by grep); update both together or `bunx vitest run` / `tsc` will fail.
- **replaceEqualDeep cost**: TanStack deep-compares the newly combined array against the previous one whenever it recombines (i.e., when underlying results actually change). At 10k strings this is cheap (measured 0.64ms/render including the whole memo chain) and only paid on real data changes with the module-scope combine function.
- **Behavioral equivalence on real changes**: when a watcher burst invalidates `fs-tree` (fileWatcher.ts:124-127) and any directory's children actually change, the combined array gets a new reference, `treePaths`/`modelPaths` recompute, and the reset effect fires exactly as before — the fix must not (and does not) suppress legitimate resets. The panel-level regression test plus the existing "loads direct children when a directory is expanded" test (line 389) together pin both directions.
- **Do not "fix" this by memoizing in the component with a JSON.stringify key or by removing the reset effect** — the effect is the mechanism that pushes new paths into the imperative `@pierre/trees` model (`model.resetPaths`), and `restoreModelRef` (FileTreePanel.tsx:741-744) relies on `modelPathsRef` staying in sync with it.
- **Draft-create flow**: `draftCreate?.path` feeds `modelPaths` (line 701) — creating a draft still must trigger exactly one reset (new `modelPaths` content). The reducer produces a new state, `modelPaths` recomputes with the draft path, reference changes, effect fires. Unchanged by this fix; covered by existing draft-create tests in `FileTreePanel.test.tsx`.
