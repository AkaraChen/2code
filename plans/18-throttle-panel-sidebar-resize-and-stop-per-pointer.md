# Throttle panel/sidebar resize and stop per-pointermove localStorage writes and full-list re-renders

> Dragging the app sidebar or file-tree panel currently does a full React commit of the entire sidebar/panel plus a synchronous localStorage JSON write on every single pointermove (60–120 Hz); this plan coalesces drag updates to animation frames, drives the sidebar's live width through a CSS custom property outside React, and defers all persistence to drag end. | Severity: medium | Category: performance

## Problem

Two resizable surfaces share `useHorizontalResize` (`src/shared/hooks/useHorizontalResize.ts`), and both do far too much work per pointermove:

1. **No coalescing in the hook.** `useHorizontalResize.ts:53-56` invokes `onChange` synchronously on every `pointermove`:

   ```ts
   function handlePointerMove(event: PointerEvent) {
       const deltaX = event.clientX - startXRef.current;
       applyValue(startValueRef.current + deltaX);
   }
   ```

   There is no `requestAnimationFrame` coalescing, so `onChange` fires at raw pointer-event rate (60–120+ Hz, potentially higher with high-polling-rate mice).

2. **AppSidebar: full sidebar re-render + zustand-persist localStorage write per move.** `src/layout/AppSidebar.tsx:335-342` wires the hook's `onChange` directly to the zustand store's `setWidth`:

   ```ts
   const sidebarWidth = useAppSidebarStore((s) => s.width);
   const setSidebarWidth = useAppSidebarStore((s) => s.setWidth);
   const resize = useHorizontalResize({
       value: sidebarWidth,
       min: APP_SIDEBAR_MIN_WIDTH,
       max: APP_SIDEBAR_MAX_WIDTH,
       onChange: setSidebarWidth,
   });
   ```

   Every move therefore (a) re-renders the **entire** `AppSidebar` — every `ProjectMenuItem`, `ProfileList`, group sections, dialogs — because `AppSidebar` subscribes to `width` and re-injects it as an inline style at `AppSidebar.tsx:513-517`:

   ```tsx
   <SidebarProvider
       className="h-full min-h-0 w-auto shrink-0"
       style={{ "--sidebar-width": `${sidebarWidth}px` } as CSSProperties}
   >
   ```

   and (b) triggers the zustand `persist` middleware (`src/layout/sidebarStore.ts:26-61`, key `app-sidebar-width`), which JSON-serializes and writes to localStorage on **each** `set` — synchronous, disk-backed main-thread I/O.

   The irony: `sidebarStore.ts:63-77` **already** mirrors `width` into a `--sidebar-width` CSS custom property on `document.documentElement` via a store subscription, outside React. But that mirror is currently useless for the sidebar itself, because it is shadowed twice inside the sidebar subtree: by shadcn's `SidebarProvider` default inline `"--sidebar-width": "16rem"` (`src/components/ui/sidebar.tsx:135`, merged with the caller's `style` at lines 133-139) and by AppSidebar's own inline override at 513-517. The React inline style is what actually drives the width today, forcing React into the per-move path.

3. **FileTreePanel: setState + JSON.stringify + localStorage.setItem per move.** `src/features/projects/FileTreePanel.tsx:164-174`:

   ```ts
   const updatePanelWidth = useCallback((width: number) => {
       const nextWidth = clampFileTreePanelWidth(width);
       setPanelWidth(nextWidth);
       writeStoredFileTreePanelWidth(nextWidth);
   }, []);
   ```

   with `writeStoredFileTreePanelWidth` (`FileTreePanel.tsx:153-162`) doing `window.localStorage.setItem(FILE_TREE_PANEL_STORAGE_KEY, JSON.stringify({ state: { panelWidth: width }, version: 2 }))` on every move. The hook is wired at `FileTreePanel.tsx:657-664` (`onChange: setPanelWidth` from `useFileTreePanelWidth`). Each `setPanelWidth` re-renders the whole `FileTreePanel`; a separate finding covers the whole-tree model reset that each such re-render currently triggers, which multiplies this cost.

Net effect: a one-second sidebar drag performs ~120 full-sidebar React commits and ~120 synchronous localStorage JSON writes where 1 of each would do, and render cost scales linearly with project count.

## Evidence & Measurements

Benchmark results (vitest 4.1.8, jsdom, React 19 dev build, node 22; real `AppSidebar` + real `sidebarStore` + real `useHorizontalResize`; `useProjects`/`useProjectGroups` fed via prefilled QueryClient; each pointermove dispatched in its own `act()` to replicate one-task-per-event browser behavior):

1. Baseline drag, 100 projects x 3 profiles: 120 pointermoves -> 121 React commits, total Profiler actualDuration 57613 ms (~480 ms/move), 120 localStorage writes of key `app-sidebar-width`.
2. Baseline drag, 10 projects x 3 profiles: 120 pointermoves -> 121 commits, 6425 ms total (~53.5 ms/move), 120 localStorage writes. Scaling is ~linear in project count. NOTE: jsdom + React dev build inflates absolute render times ~20-100x vs a production WebView; commit and write COUNTS are environment-independent.
3. Optimized per-move work (`documentElement.style.setProperty('--sidebar-width', ...)` only): 50,000 iterations, 305-330 ms total = 0.006 ms/op.
4. Raw `JSON.stringify` + `localStorage.setItem` (`{state:{panelWidth:n},version:2}`): 200,000 iterations = 0.0003-0.0005 ms/op (test localStorage is a Map-backed shim — LOWER BOUND vs real disk-backed WebView localStorage).
5. Real `sidebarStore.setWidth` x120 -> exactly 120 persist localStorage writes (confirms the zustand-persist write-per-set behavior), 1.3-1.9 ms total in-memory.
6. rAF-coalescing prototype: 120 synchronous moves -> 1 apply, final value correct (369).

Interpretation: the dominant measured cost is the per-move full-sidebar React re-render (multiple ms of pure reconciliation per move even after heavy discounting for jsdom/dev-mode — over the 8.3 ms 120 Hz frame budget before browser layout/paint), while the per-move CSS-variable set is ~4 orders of magnitude cheaper. The localStorage write is individually small but pure churn (120 writes/second where 1 suffices). Fix priority is therefore: (a) keep React out of the per-move path for AppSidebar, (b) coalesce to rAF, (c) persist on drag end only.

## Proposed Change

Four files change (plus their two existing test files). The hook gains rAF coalescing and an `onCommit` callback; AppSidebar drives its live width purely through a CSS custom property; both call sites persist only at drag end.

### Step 1 — `src/shared/hooks/useHorizontalResize.ts`: rAF-coalesce pointermove, add `onCommit`

New contract:

- `onChange(value)` — the **live** value. During pointer drags it is coalesced to at most once per animation frame; for keyboard resize (`handleKeyDown`, currently lines 84-109) it still fires immediately, once per keypress (verifier note: coalesce **only** the pointermove path — keyboard must stay immediate).
- `onCommit?(value)` — new optional callback with the final clamped value, fired once when a pointer drag ends (`pointerup`/`pointercancel`), and immediately after `onChange` on each keyboard step (keyboard is low-rate, so committing per keypress is fine and keeps persistence correct for keyboard-only users).
- Keep the existing clamp in `applyValue` (line 41-43) — both this hook and `sidebarStore.setWidth` clamp today; keep both.

Sketch (replace the body; preserve the existing body-cursor/user-select handling and listener wiring at lines 45-73):

```ts
export function useHorizontalResize({
    value, min, max, step = 16, disabled = false, onChange, onCommit,
}: UseHorizontalResizeOptions) {
    const [isDragging, setIsDragging] = useState(false);
    const startXRef = useRef(0);
    const startValueRef = useRef(value);
    const valueRef = useRef(value);
    const lastAppliedRef = useRef(value);
    const onChangeRef = useRef(onChange);
    const onCommitRef = useRef(onCommit);
    const frameRef = useRef<number | null>(null);
    const pendingValueRef = useRef<number | null>(null);

    valueRef.current = value;
    onChangeRef.current = onChange;
    onCommitRef.current = onCommit;

    const applyValue = useCallback((nextValue: number) => {
        const clamped = clampWidth(nextValue, min, max);
        lastAppliedRef.current = clamped;
        onChangeRef.current(clamped);
    }, [max, min]);

    useEffect(() => {
        if (!isDragging) return;
        // ... existing cursor/userSelect save+set ...

        function flushPendingValue() {
            if (frameRef.current !== null) {
                cancelAnimationFrame(frameRef.current);
                frameRef.current = null;
            }
            if (pendingValueRef.current !== null) {
                applyValue(pendingValueRef.current);
                pendingValueRef.current = null;
            }
        }

        function handlePointerMove(event: PointerEvent) {
            pendingValueRef.current =
                startValueRef.current + (event.clientX - startXRef.current);
            if (frameRef.current !== null) return; // frame already scheduled
            frameRef.current = requestAnimationFrame(() => {
                frameRef.current = null;
                if (pendingValueRef.current !== null) {
                    applyValue(pendingValueRef.current);
                    pendingValueRef.current = null;
                }
            });
        }

        function stopDragging() {
            flushPendingValue(); // don't lose the last sub-frame movement
            setIsDragging(false);
            onCommitRef.current?.(lastAppliedRef.current);
        }

        // ... existing addEventListener wiring (pointermove/pointerup/pointercancel) ...
        return () => {
            // existing cleanup PLUS cancel any scheduled frame:
            if (frameRef.current !== null) {
                cancelAnimationFrame(frameRef.current);
                frameRef.current = null;
            }
            pendingValueRef.current = null;
            // ... restore cursor/userSelect, removeEventListener x3 ...
        };
    }, [applyValue, isDragging]);

    const handlePointerDown = useCallback((event: ReactPointerEvent<HTMLElement>) => {
        if (disabled || event.button !== 0) return;
        startXRef.current = event.clientX;
        startValueRef.current = valueRef.current;
        lastAppliedRef.current = valueRef.current; // so a click-without-move commits the current value
        setIsDragging(true);
        event.preventDefault();
    }, [disabled]);

    // handleKeyDown: unchanged structure, but each case becomes:
    //   applyValue(next); onCommitRef.current?.(lastAppliedRef.current); event.preventDefault();
    // (keyboard stays immediate — do NOT route it through rAF)
    ...
}
```

Add `onCommit?: (value: number) => void;` to `UseHorizontalResizeOptions` (line 15-22).

Notes:
- `stopDragging` runs while the drag effect is still mounted, so the flush happens before cleanup cancels anything.
- If the component unmounts mid-drag, cleanup cancels the pending frame and no commit fires — persistence is simply skipped, which matches today's "last written value wins" semantics closely enough.
- Keep the `useMemo` return shape (`isDragging`, `handlePointerDown`, `handleKeyDown`) unchanged so call sites don't need signature changes beyond passing `onCommit`.

### Step 2 — `src/layout/sidebarStore.ts`: rename the mirrored CSS variable and export the sync helper

Because `SidebarProvider` merges its own default `"--sidebar-width": "16rem"` into the wrapper's inline style (`src/components/ui/sidebar.tsx:133-139`), simply deleting AppSidebar's inline style would make the sidebar snap to 16rem — the documentElement variable would stay shadowed. The fix is an indirection through a **new** root-level variable name:

- In `syncSidebarWidth` (`sidebarStore.ts:63-69`), set `--app-sidebar-width` (new name) on `document.documentElement` instead of `--sidebar-width`.
- Rename the function to `syncAppSidebarWidthVar` and **export** it so AppSidebar can call it per frame during drags:

```ts
export function syncAppSidebarWidthVar(width: number) {
    if (typeof document === "undefined") return;
    document.documentElement.style.setProperty(
        "--app-sidebar-width",
        `${clampAppSidebarWidth(width)}px`,
    );
}
```

- Keep the module-load sync (line 71) and the store subscription (lines 73-77) exactly as they are (they now write `--app-sidebar-width`). The subscription still guarantees the variable is correct after any store-driven width change (commit, rehydrate from persist, external set).
- Do **not** change the persist config (`name: "app-sidebar-width"`, `version: 1`, `partialize` at lines 51-59) — the persisted shape is untouched, no migration needed. `setWidth` keeps its clamp (line 33).

Update `src/layout/sidebarStore.test.ts:38-43` to assert `--app-sidebar-width` instead of `--sidebar-width`.

Optionally, in `src/app.css:9-10`, add `--app-sidebar-width: 250px;` next to the existing `--sidebar-width: 250px;` in `:root` as a stylesheet-level fallback (the store sets the inline value at module import, so this is belt-and-braces; the `var()` fallback in Step 3 also covers it). Leave the existing `--sidebar-width: 250px` line alone — grep confirms nothing else in `src/` reads it outside `components/ui/sidebar.tsx`, and removing it is out of scope.

### Step 3 — `src/layout/AppSidebar.tsx`: take React out of the per-move path

1. Replace the per-render inline style at lines 513-517 with a **module-level constant** (defined once, near the top of the file), so the `SidebarProvider` style prop is referentially stable and never depends on React state:

   ```tsx
   const SIDEBAR_PROVIDER_STYLE = {
       "--sidebar-width": "var(--app-sidebar-width, 250px)",
   } as CSSProperties;
   ...
   <SidebarProvider className="h-full min-h-0 w-auto shrink-0" style={SIDEBAR_PROVIDER_STYLE}>
   ```

   This overrides the provider's `16rem` default while resolving through the documentElement variable that `sidebarStore` maintains — the live drag width now reaches the DOM without any React render. (Keep the `CSSProperties` import; it is still used here.)

2. Add a ref for the resize separator (the `role="separator"` div at lines 883-899): `const resizeSeparatorRef = useRef<HTMLDivElement>(null);` and attach `ref={resizeSeparatorRef}`.

3. Rewire the hook at lines 335-342. Keep the `sidebarWidth` selector (still needed for `value` and the rendered `aria-valuenow` at line 889) and `setSidebarWidth`, but split live vs. commit:

   ```ts
   import { ..., syncAppSidebarWidthVar } from "./sidebarStore"; // adjust existing import at top

   const handleLiveResize = useCallback((width: number) => {
       syncAppSidebarWidthVar(width);
       // Keep a11y state live during pointer drags without a React render
       // (verifier note 4: aria-valuenow at AppSidebar.tsx:889 would otherwise
       // go stale for the duration of the drag):
       resizeSeparatorRef.current?.setAttribute("aria-valuenow", String(width));
   }, []);

   const resize = useHorizontalResize({
       value: sidebarWidth,
       min: APP_SIDEBAR_MIN_WIDTH,
       max: APP_SIDEBAR_MAX_WIDTH,
       onChange: handleLiveResize,
       onCommit: setSidebarWidth,
   });
   ```

   Behavior during a pointer drag: per frame, one `setProperty` + one `setAttribute` — zero React work. On `pointerup`, one `setWidth` -> one store update -> one persist localStorage write -> one AppSidebar render (which reconciles `aria-valuenow` to the committed value; the imperative `setAttribute` and the rendered value converge, and React's VDOM diff will not fight the attribute because the rendered value actually changed). Keyboard resize commits per keypress, so the store, CSS var (via the subscription), and `aria-valuenow` all stay in sync for keyboard users with no extra code.

   Note the hook's `value` prop stays at the pre-drag width for the whole drag (the store no longer updates per move) — this is correct because the hook computes drag positions from `startValueRef`, captured at pointerdown.

   `resize.isDragging` usage at line 893 is unaffected (still two renders per drag: start and end).

### Step 4 — `src/features/projects/FileTreePanel.tsx`: persist on commit only

FileTreePanel's width is plain local `useState` driving a framer-motion `animate={{ width: ... }}` (line 1122), and there is no pre-existing CSS-var mirror — per verifier note 5, accept rAF-coalesced `setState` here (the whole-tree model reset per re-render is a separate finding; once that is fixed, per-frame renders of this panel are cheap). The change here is only: stop writing localStorage per move.

Split `useFileTreePanelWidth` (lines 164-174):

```ts
function useFileTreePanelWidth() {
    const [panelWidth, setPanelWidth] = useState(readStoredFileTreePanelWidth);
    const updatePanelWidth = useCallback((width: number) => {
        setPanelWidth(clampFileTreePanelWidth(width));
    }, []);
    const persistPanelWidth = useCallback((width: number) => {
        writeStoredFileTreePanelWidth(clampFileTreePanelWidth(width));
    }, []);
    return [panelWidth, updatePanelWidth, persistPanelWidth] as const;
}
```

And at the call site (lines 657-664):

```ts
const [panelWidth, setPanelWidth, persistPanelWidth] = useFileTreePanelWidth();
const resize = useHorizontalResize({
    value: panelWidth,
    min: FILE_TREE_PANEL_MIN_WIDTH,
    max: FILE_TREE_PANEL_MAX_WIDTH,
    disabled: !isOpen,
    onChange: setPanelWidth,
    onCommit: persistPanelWidth,
});
```

Keep `writeStoredFileTreePanelWidth` (lines 153-162) and its `{ state: { panelWidth }, version: 2 }` payload exactly as-is so `readStoredFileTreePanelWidth` (lines 136-151) keeps round-tripping. `aria-valuenow` at line 1244 reads `panelWidth` state, which now updates per frame — still correct. The `resize.isDragging ? { duration: 0 } : ...` transition guard at line 1124 is unchanged.

### Step 5 — update existing hook tests

`src/shared/hooks/useHorizontalResize.test.ts` currently asserts synchronous per-move `onChange` (lines 92-100: dispatch `pointermove`, expect `onChange` immediately). With rAF coalescing these assertions need frames flushed. Recommended: stub rAF deterministically in this file (vitest jsdom provides rAF, but timing-based flushing is flaky):

```ts
let rafQueue: FrameRequestCallback[];
beforeEach(() => {
    rafQueue = [];
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => rafQueue.push(cb));
    vi.stubGlobal("cancelAnimationFrame", (id: number) => { rafQueue[id - 1] = () => {}; });
});
afterEach(() => vi.unstubAllGlobals());
function flushFrames() { const q = rafQueue; rafQueue = []; for (const cb of q) cb(performance.now()); }
```

(A simple push-based queue where `cancelAnimationFrame` is a no-op-out is sufficient here; ids can be `rafQueue.length` returned from the stub.) Then update the pointer-drag test to `dispatch move -> flushFrames() inside act -> expect onChange`. Keyboard tests (lines 20-65) must pass **unchanged** except for additionally observing `onCommit` if you pass one — keyboard is not coalesced.

Add new hook tests:
- multiple `pointermove` dispatches with **no** frame flush -> `onChange` not called; one `flushFrames()` -> `onChange` called exactly once with the value from the **last** move (clamped);
- `pointermove` then `pointerup` before any frame -> `onChange` called once (flush-on-stop) and `onCommit` called exactly once with the final clamped value;
- full drag (down, N moves + flushes, up) -> `onCommit` called exactly once, with the last applied value;
- keyboard `ArrowRight` -> `onChange` then `onCommit` both called immediately with the same value;
- pointerdown + pointerup with no move -> `onCommit` fires with the starting value (harmless idempotent commit).

## Verification

All commands run from `/home/user/2code`. Do **not** run `bun tauri dev/build` or plain `cargo build`/`cargo test` (full Tauri build fails in this container — missing GTK libs); no Rust code changes in this plan anyway.

1. **Targeted tests** (existing coverage of the touched area):
   ```bash
   bunx vitest run src/shared/hooks/useHorizontalResize.test.ts src/layout/sidebarStore.test.ts
   ```
   Both files exist today and must pass after the updates described in Steps 2 and 5.

2. **Full frontend suite** (baseline: 671 tests pass):
   ```bash
   bunx vitest run
   ```
   Watch for any other test that renders `AppSidebar` or `FileTreePanel` and simulates drags — if one exists and relies on synchronous per-move `onChange`, apply the same rAF-stub pattern there.

3. **Typecheck**:
   ```bash
   bunx tsc --noEmit
   ```
   (Do not run `bun run build` — it re-runs the paraglide compile; `src/paraglide/` and `project.inlang/` must not be touched.)

4. **New regression test for write/commit counts** (the heart of this finding). Add a test (either extend `src/layout/sidebarStore.test.ts` or, better, a new integration-ish test colocated with the hook) that proves the per-drag counts:
   - Spy on `Storage.prototype.setItem` (or `window.localStorage.setItem`) filtered to key `app-sidebar-width`.
   - Render a minimal component using `useHorizontalResize` wired like AppSidebar (`onChange: syncAppSidebarWidthVar`, `onCommit: useAppSidebarStore.getState().setWidth`), dispatch `pointerdown` + 120 `pointermove`s (rAF stubbed) + `pointerup`.
   - Assert: exactly **1** persist write to `app-sidebar-width` for the whole drag (vs. 120 before), and `document.documentElement.style.getPropertyValue("--app-sidebar-width")` equals the final clamped width, and `useAppSidebarStore.getState().width` equals the committed value.
   - Same pattern for FileTreePanel is optional (heavier to mount); the hook-level `onCommit`-once test from Step 5 plus a unit test that `persistPanelWidth`-style wiring writes key `file-tree-panel` once per drag is sufficient if you extract nothing — counting `setItem` calls for key `file-tree-panel` while driving the hook with `onChange`/`onCommit` stubs mirrors it adequately.

5. **Optional benchmark** (mirrors the verifier's methodology, environment-independent counts): a `bunx vitest run` test rendering the real `AppSidebar` inside a React `<Profiler>` with a prefilled QueryClient (mock `useProjects`/`useProjectGroups` data), dispatching 120 pointermoves in separate `act()` calls: assert commit count during the drag is ≤ 3 (pointerdown `isDragging` render + pointerup commit render) instead of 121, and `app-sidebar-width` writes == 1. Delete or keep as a permanent guard per repo test-suite conventions. `bunx vitest bench --run` is also available if a timing benchmark is desired, but the count assertions are the stable signal.

6. **Manual smoke test** (on a dev machine with a display, not in CI): `bun tauri dev`; drag the sidebar edge — width must track the pointer smoothly (via the CSS var), project list must not flicker/re-render per move (verify with React DevTools Profiler), release must persist (reload app, width restored). Same for the file-tree panel in a project view. Also verify: keyboard resize (focus separator, Arrow keys/Home/End) still moves in steps and persists immediately; sidebar collapse/expand (`isCollapsed`) still works; width restored from a previous session applies on startup (the module-load `syncAppSidebarWidthVar` + persist rehydration path).

## Risks & Constraints

- **CSS variable shadowing is the trap.** `SidebarProvider` always merges `"--sidebar-width": "16rem"` into its wrapper's inline style (`src/components/ui/sidebar.tsx:135`). AppSidebar must keep *some* inline `--sidebar-width` on the provider — the plan's constant `var(--app-sidebar-width, 250px)` — otherwise the sidebar jumps to 16rem. Do not "simplify" by deleting the style prop entirely, and do not edit `src/components/ui/sidebar.tsx` (CLAUDE.md: shadcn/ui primitives — don't reshape them for one caller).
- **Persist rehydration:** zustand `persist` rehydrates asynchronously-ish at store creation; the existing module-load `syncSidebarWidth(...)` call (line 71) plus the subscription (lines 73-77) already handle the initial + rehydrated value. Keep both when renaming; if the subscription's width-changed guard (`state.width !== prevState.width`) is removed, the CSS var stops updating on rehydrate.
- **Double clamping is intentional.** `useHorizontalResize.applyValue` clamps and `sidebarStore.setWidth` clamps (sidebarStore.ts:33), and `FileTreePanel` clamps in `updatePanelWidth`/`persistPanelWidth`. Keep all of them (verifier note 6) — the hook's commit value must already be clamped so `aria-valuenow` and the CSS var never show out-of-range values.
- **Keyboard path must remain immediate** (no rAF) or arrow-key resizing will feel laggy and existing keyboard tests break; it must also commit, or keyboard-only resizes would never persist.
- **A11y:** `aria-valuenow` (AppSidebar.tsx:889, FileTreePanel.tsx:1244) must stay truthful. AppSidebar uses the imperative `setAttribute` during drags + rendered value on commit; FileTreePanel's state-driven value updates per frame. If the imperative update is skipped, the value is stale only *during* an active mouse drag — acceptable fallback, but the plan includes the ref update so don't drop it silently.
- **Mid-drag unmount / route change:** commit is skipped by design (cleanup cancels the pending frame). The stored width then remains the pre-drag value. This matches a "cancelled" drag; do not try to commit from the effect cleanup (it would fire on every `isDragging` toggle).
- **Do not change persisted storage shapes**: sidebar persist key `app-sidebar-width` v1 partialize (sidebarStore.ts:51-59) and file-tree key `file-tree-panel` `{ state: { panelWidth }, version: 2 }` (FileTreePanel.tsx:153-162) must round-trip with the existing readers; users' saved widths must survive the upgrade.
- **CLAUDE.md invariants:** generated code (`src/generated/`, `src/paraglide/`) untouched; no new manual IPC wrappers; no Rust changes; terminal-related invariants unaffected. `src/layout/CLAUDE.md`: don't break sidebar keyboard navigation/focus management — this plan touches only the resize separator's handlers, not the arrow-key nav at AppSidebar's `handleKeyDown` for menu items.
- **Interaction with sibling findings:** another plan addresses FileTreePanel's whole-tree model reset per re-render, and another addresses memoizing the sidebar project list. This plan is independent and safe to land before or after them; landing this one first removes the per-pointermove *trigger* for those costs, but they still fire on legitimate renders, so don't drop either.
- **Test flakiness risk:** rAF-based tests must stub `requestAnimationFrame` (Step 5) rather than await real frames; vitest jsdom's rAF timing is not deterministic.
