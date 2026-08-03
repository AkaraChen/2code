# Reclaim or dispose parked terminal wrappers — each park leaks a full xterm instance

> Every unmount of a still-open Terminal parks a live, undisposed XTerm (5000-line buffer, DOM renderer subtree, full addon graph) in a hidden body-level container that nothing ever reclaims — memory and document node count grow monotonically. | Severity: medium | Category: memory

## Problem

When a `Terminal` component's React 19 ref cleanup runs while its tab still exists in the terminal store, the wrapper div — containing the live xterm instance, its scrollback buffer (`TERMINAL_SCROLLBACK = 5000`, `src/features/terminal/Terminal.tsx:65`), the DOM renderer's node subtree, and all loaded addons — is appended to a hidden parking container instead of being disposed:

```ts
// src/features/terminal/Terminal.tsx:724-732 (ref cleanup, step 14)
if (stillOpen) {
  // Park wrapper instead of removing — xterm survives React unmount
  getTerminalParkingContainer().appendChild(wrapper);
} else if (typeof term.dispose === "function") {
  term.dispose();
  wrapper.remove();
} else {
  wrapper.remove();
}
```

The parking container (`src/features/terminal/lib/parking.ts:10-27`) is a fixed, off-screen, `inert` div with id `terminal-parking` appended to `document.body`. Its header comment (parking.ts:1-7) says parked terminals "survive provider remounts ... VSCode's setVisible(false) model" — but **the adoption half of that design was never built**:

- `getTerminalParkingContainer` is referenced only at the park site (Terminal.tsx:51 import, Terminal.tsx:726 call), its definition (parking.ts:10), the barrel export (`src/features/terminal/lib/index.ts:13`), and a test mock (`src/features/terminal/Terminal.test.tsx:172`). There is no reclaim path anywhere; `git log --all -S getTerminalParkingContainer` shows exactly one commit ever touched the symbol.
- On remount, the ref callback unconditionally creates a fresh wrapper (`document.createElement("div")`, Terminal.tsx:348) and a fresh `new XTerm({...})` (Terminal.tsx:360-384), then repopulates it from localStorage (`restoreBuffer`, Terminal.tsx:499 calling :102-107) plus IPC history replay (`flushPtyOutput` + `getPtySessionHistory`, Terminal.tsx:646-649).

So every parked instance is pure dead weight, retained forever by the document:

- The park path never calls `term.dispose()`, and `loadAddons()`'s returned `dispose` is a **no-op** (`src/features/terminal/lib/addons.ts:62`), so the parked terminal retains its entire addon graph — including `ImageAddon` image storage and `LigaturesAddon` font caches (addons.ts:33-46).
- `src/main.tsx:38` renders inside `<React.StrictMode>`; React 19 double-invokes ref callbacks in dev, so **every terminal mount in dev parks one full xterm per terminal** (guaranteed 2x terminal memory).
- In production, terminals never unmount in steady state (the `TerminalLayer` CSS-display pattern), but `TerminalLayer` sits under an async boundary — an error-boundary retry or re-suspension above it remounts everything and parks **all** open terminals at once.

Note the cleanup does correctly tear down handlers before parking: it disposes onData/onResize/selection/title/progress disposables and detaches the PTY stream (Terminal.tsx:684, :717-722), so parked terminals are inert — but their memory (buffer, DOM nodes, addon caches) is never freed.

## Evidence & Measurements

No benchmark numbers (memory finding, non-perf). Concrete code evidence:

- **Park without dispose:** Terminal.tsx:724-727 — `if (stillOpen) { getTerminalParkingContainer().appendChild(wrapper); }`; `term.dispose()` only runs on the `stillOpen === false` branch (:727-729).
- **No adoption path:** `grep -rn getTerminalParkingContainer src/` yields only Terminal.tsx:51, Terminal.tsx:726, parking.ts:8/10, lib/index.ts:13, Terminal.test.tsx:172. The mount path (Terminal.tsx:348-389) always constructs a new wrapper and `new XTerm(...)` — parked wrappers are never looked up.
- **Addon retention:** addons.ts:62 — `dispose: () => {}` — the `cleanups` array frees nothing addon-related; only `term.dispose()` (never called on the park path) disposes addons loaded via `terminal.loadAddon(...)`.
- **StrictMode double-invoke:** main.tsx:38 `<React.StrictMode>` with React 19 — dev mounts always run mount → cleanup(park) → mount, leaking one xterm per terminal per mount.
- **Recreate path is already the only exercised path:** remount replays from localStorage (`restoreBuffer`, Terminal.tsx:499) + PTY log history (Terminal.tsx:640-656), with overlap dedup via `getSuffixPrefixOverlapLengthBytes` in `flushPendingEventsAfterHistory` (Terminal.tsx:574-586).

Measured impact: unbounded xterm retention — each park permanently leaks one full XTerm (up to 5000-line buffer, DOM renderer subtree kept in the document, undisposed addon graph incl. ImageAddon/LigaturesAddon). Dev StrictMode leaks one per terminal per mount; production leaks all open terminals per error-boundary retry / re-suspension above TerminalLayer.

Dev repro (for anyone with a display; not runnable in CI containers): run `bun tauri dev`, open a terminal, then in the webview console inspect `document.getElementById("terminal-parking")` — one orphaned `.xterm` wrapper per terminal mount; a heap snapshot shows 2 XTerm instances per open tab.

## Proposed Change

**Chosen fix: option (b) — stop parking; dispose unconditionally.** This is the minimal safe fix: the recreate-from-history path (localStorage buffer + `flushPtyOutput` + `getPtySessionHistory`) is *already* the only path exercised on every remount today, so behavior is identical minus the leak. The alternative (completing the parking design with a sessionId-keyed adoption Map) is a larger change with its own leak hazards (parked entries whose tabs close while parked must themselves be disposed) and is described at the end as an optional follow-up, not part of this plan.

### Step 1 — `src/features/terminal/Terminal.tsx`

1. Remove `getTerminalParkingContainer` from the import list from `"./lib"` (currently at line 51).
2. Replace the tail of the ref cleanup (lines 724-732) so the terminal is always disposed and the wrapper always removed. The `stillOpen` check stays — it still gates buffer/dimension persistence (lines 689-699), which must keep running **before** dispose (SerializeAddon needs the live buffer):

```ts
        // (unchanged above: detachPtyOutput, flushPtyOutput, stillOpen
        //  persistBuffer/persistDimensions, stream-state reset,
        //  unlisteners loop, cleanups loop)

        // Always dispose — remounts recreate from the persisted buffer
        // (restoreBuffer) + PTY log history, which is already the only
        // remount path. dispose() also frees the addon graph
        // (loadAddons()'s own dispose is a no-op).
        term.dispose();
        wrapper.remove();

        termRef.current = null;
        // ...rest unchanged (fitAddonRef/serializeAddonRef/searchAddonRef nulling)
```

   Notes:
   - Drop the `typeof term.dispose === "function"` guard: `term` is a real `XTerm` in production. But see Step 3 — the existing test's `MockTerminal` has no `dispose`, so the mock must gain one (adding `dispose = vi.fn()` to the mock is required either way for the new assertion). If you prefer belt-and-braces, keep the guard; it just must not skip `wrapper.remove()`.
   - Do NOT reorder: `persistBuffer` (line 696) must stay before `term.dispose()`.
   - Everything else in the cleanup (detach with the captured `streamId`, flush, timer/frame cancellation, `unlisteners`/`cleanups` loops) is unchanged.

### Step 2 — delete the parking module

1. Delete `src/features/terminal/lib/parking.ts` (the whole file — it has no other consumers).
2. Remove the barrel export line from `src/features/terminal/lib/index.ts:13`:
   ```ts
   export { getTerminalParkingContainer } from "./parking";
   ```
3. Sanity-check nothing else references it: `grep -rn "getTerminalParkingContainer\|terminal-parking" src/` must return no hits outside test files you are updating.

If a parking test file exists (check with `ls src/features/terminal/lib/*.test.ts* | grep -i parking` / grep for `parking` under `src/features/terminal/lib/`), delete it along with the module.

### Step 3 — `src/features/terminal/Terminal.test.tsx`

1. Remove the mock entry at line 172 (`getTerminalParkingContainer: () => document.body,`) from the `vi.mock("./lib", ...)` factory — Terminal.tsx no longer imports it, and leaving it is harmless but dead.
2. Add `dispose = vi.fn();` to the hoisted `MockTerminal` class (lines 26-102) so the unconditional `term.dispose()` in cleanup works and is assertable.
3. Add a regression test that locks in dispose-on-unmount for a still-open tab (the exact case that used to park). Sketch (adjust store shape if it drifts — current shape verified from `src/features/terminal/store.ts:13-27,54-58`):

```tsx
it("disposes xterm and removes its wrapper on unmount even when the tab is still open", () => {
  useTerminalStore.setState({
    profiles: {
      "profile-1": {
        tabs: [{ id: "session-1", title: "tab" }],
        activeTabId: "session-1",
        counter: 1,
      },
    },
    agentStatuses: {},
    agentCompletions: {},
    sessionProfileIds: { "session-1": "profile-1" },
  });

  const { unmount } = render(
    <Terminal profileId="profile-1" sessionId="session-1" isActive={false} />,
  );
  const terminal = terminalInstances[terminalInstances.length - 1];

  unmount();

  expect(terminal.dispose).toHaveBeenCalledTimes(1);
  // wrapper (the element passed to term.open) must be detached from the document
  expect(terminal.element?.isConnected).toBe(false);
  // and no parking container may exist
  expect(document.getElementById("terminal-parking")).toBeNull();
});
```

   (The mock's `open(element)` stores the wrapper as `this.element`, so `isConnected` checks wrapper removal. `MockTerminalInstance` interface in the hoisted block may need `dispose: Mock` and `element` added for TypeScript.)

4. Optionally add the mirror test for the closed-tab path (empty store → unmount → `dispose` called, wrapper removed) — it covers the previously-existing `else` branch and guards against future reintroduction of branch asymmetry.

### Step 4 — documentation touch-up (only if present)

`src/features/terminal/CLAUDE.md` does not mention parking (verified), so no doc change is required there. Do not touch the root `CLAUDE.md`. If you find stray comments referencing "parking" in `TerminalLayer.tsx` or elsewhere (grep for `parking`), update them to describe the persist-then-recreate model.

### Explicitly out of scope (optional follow-up, do not do here)

Option (a) — completing the parking design: a module-level `Map<sessionId, {wrapper, term, addons}>`; on mount, adopt the parked entry (re-append wrapper, reuse XTerm, re-attach PTY stream with a **new** `streamId`, re-register all handlers, replay only the delta via the existing overlap-trim), and dispose parked entries whose tabs close while parked (otherwise the leak returns through the back door). This would additionally remove remount replay cost, but it is a substantially larger, riskier change; do it as a separate plan if remount latency ever becomes a measured problem.

## Verification

All commands run from the repo root. **Never** run plain `cargo build`/`cargo test` or `bun tauri ...` in CI containers — the full Tauri app cannot build there (missing GTK libs). This change is frontend-only, so no Rust commands are needed at all.

1. Targeted test file (must pass, including the new regression test):
   ```bash
   bunx vitest run src/features/terminal/Terminal.test.tsx
   ```
2. Full frontend suite (671 tests passing before the change; expect the same count plus the new test(s), minus any deleted parking tests):
   ```bash
   bunx vitest run
   ```
3. Static check that parking is fully gone:
   ```bash
   grep -rn "getTerminalParkingContainer\|terminal-parking" src/ && echo "LEFTOVERS" || echo "clean"
   ```
   Expect `clean` (no matches outside possibly your own test asserting `terminal-parking` is null — that string literal in the new test is fine; adjust the grep accordingly or assert via a constant-free selector).
4. TypeScript compiles (the deleted export must not break any import):
   ```bash
   bunx tsc --noEmit
   ```
   (If `tsc --noEmit` trips over unrelated pre-existing issues, at minimum confirm `bunx vitest run` passes, since vitest type-transforms the touched files.)
5. Manual verification (requires a machine with a display — not possible in CI): `bun tauri dev`, open two terminal tabs, switch profiles/routes, force a remount (dev StrictMode does this automatically on first mount). In the webview devtools console: `document.getElementById("terminal-parking")` → `null`; heap snapshot shows exactly one `Terminal` (xterm) instance per open tab. Confirm scrollback still restores after the StrictMode remount (type a command, verify output survives).

Existing coverage of the area: `src/features/terminal/Terminal.test.tsx` (mount/selection/copy behavior around the same ref callback) — it exercises mount + `cleanup()` via testing-library `afterEach`, so any breakage in the cleanup path surfaces there. No benchmark is needed (memory fix; the recreate path's cost is unchanged because it was already the only path).

## Risks & Constraints

- **CLAUDE.md invariant "terminals never unmount / use CSS display, not conditional rendering":** untouched. That invariant covers tab/route switching (TerminalLayer's `display:none` pattern); this change only alters what happens on the *unavoidable* unmount (StrictMode double-invoke, error-boundary retry, suspension above TerminalLayer). Do not "fix" this by conditionally rendering terminals.
- **Behavioral regression risk is minimal by construction:** parked instances were never reused, so dispose-instead-of-park cannot change any user-visible flow. The remount path (localStorage `restoreBuffer` + `flushPtyOutput` + `getPtySessionHistory` with overlap dedup) is byte-for-byte the code that already runs today.
- **Ordering inside cleanup matters:** `persistBuffer` (SerializeAddon serialize) must run before `term.dispose()`; the `streamId`-scoped `detachPtyOutput` must keep using the captured `streamId` so a stale cleanup can't detach a newer stream (existing seam, Terminal.tsx:684). Do not move `term.dispose()` above the `unlisteners`/`cleanups` loops — some cleanups (`attachCustomKeyEventHandler(() => true)`, disposable `.dispose()` calls) touch the live term and should run first, as they do today.
- **Do not rely on `cleanups` to free addons:** `loadAddons()`'s `dispose` is a no-op (addons.ts:62); only `term.dispose()` frees the addon graph. The fix must keep `term.dispose()` unconditional.
- **Test mock coupling:** `Terminal.test.tsx`'s `vi.mock("./lib")` factory must stay in sync with what Terminal.tsx imports from `"./lib"` — remove the `getTerminalParkingContainer` key when the import goes away, and add `dispose` to `MockTerminal` (otherwise the unguarded `term.dispose()` throws in tests).
- **Profile deletion / tab close paths are already safe:** the store update (tab removal) happens before unmount, so cleanup sees `stillOpen === false` and hit the dispose branch even before this change; the new code makes both branches identical in that respect.
- **StrictMode dev cost:** each dev mount now does dispose + full recreate instead of park + full recreate — same recreate cost as today, strictly less memory. No production perf change: production has no double-invoke.
- **Parallel-work constraint from the environment:** this plan is executed in a shared checkout — touch only the files listed in Proposed Change (`Terminal.tsx`, `lib/parking.ts` [delete], `lib/index.ts`, `Terminal.test.tsx`); do not reformat unrelated code.
