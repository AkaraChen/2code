# Batch debug log ingestion and fix duplicate React keys in the log viewer

> Debug-mode log ingestion burns ~1.73 ms of main-thread time per log line even with the panel closed (immer O(cap) finalize per entry) and ~8.9 ms per line with the dialog open; the log list also uses ms-precision timestamps as React keys, producing duplicate keys. | Severity: medium | Category: performance

## Problem

When debug mode is on (persisted in localStorage via `debugStore`, so once toggled it stays on across restarts — `src/features/debug/debugStore.ts:42-48`), every backend `LogEntry` arriving over the Tauri IPC channel triggers a full store update:

- `src/features/debug/debugStore.ts:21-23` — `channel.onmessage = (entry) => useDebugLogStore.getState().addLog(entry)`: one store `set()` per log line, completely unbatched.
- `src/features/debug/debugLogStore.ts:13-25` — `useDebugLogStore` is an **immer**-middleware zustand store. `addLog` (lines 16-22) does `state.logs.push(entry)` plus a `splice` cap at `MAX_LOGS = 1000`. Immer's finalize/autofreeze walks the entire 1000-element array on *every* `set()`, making each log line O(capacity) — measured at ~1.73 ms per entry at steady state, **even when nothing subscribes** (panel closed).
- `src/features/debug/DebugLogDialog.tsx` — when the dialog is open, each entry additionally:
  - re-runs the O(n) filter memo over all logs (`DebugLogDialog.tsx:69-78`),
  - re-renders the full non-virtualized list container mapping up to 1000 rows (`DebugLogDialog.tsx:131-134`),
  - re-runs the autoscroll effect (`DebugLogDialog.tsx:92-96`).

**Correctness bug:** `DebugLogDialog.tsx:131-133` renders `<LogRow key={entry.timestamp} ... />`. Timestamps are millisecond-precision — the backend computes them with `as_millis` (`src-tauri/crates/infra/src/logger.rs:135-138`). Two log events in the same millisecond (common for paired `info!` calls) produce **duplicate React keys**, causing React "Encountered two children with the same key" errors and potentially dropped or mis-reconciled rows.

At app scale: a PTY-heavy session emitting even 50 log lines/s burns ~87 ms/s of main-thread time with the panel *closed*, and a 100-entry burst with the dialog open costs ~900 ms of jank.

## Evidence & Measurements

Verified benchmark results (vitest bench --run, jsdom, bun/node, dev profile — vitest has no release mode; real production modules imported via `@/` aliases):

> Group 1 — ingestion of 1000 entries at steady-state 1000-entry cap, panel CLOSED (no subscribers), mean per op: (a) CURRENT per-entry addLog via immer store: 1732.42 ms (10 samples) = ~1.73 ms PER LOG ENTRY; (b) PROPOSED batched flush into the same immer store via setState producer (10 batches of 100): 23.35 ms (74x faster); (c) PROPOSED per-entry plain zustand store, no immer: 2.16 ms (~800x faster — immer autofreeze/finalize dominates); (d) PROPOSED batched plain store (10x100): 0.29 ms (~5984x faster). Group 2 — real DebugLogDialog rendered open with 1000 rows, 20 entries per op: CURRENT per-entry (one act/render per entry, modeling one IPC message per macrotask): 178.95 ms per 20 entries = ~8.9 ms per entry; PROPOSED batched (one render per 20-entry batch): 14.57 ms per op — 12.28x faster. Duplicate-key: vitest run test rendering two entries with identical ms timestamp asserted React 'same key' console.error fired — PASSED.

Key takeaway for the implementation: **the dominant cost is immer, not the array copy itself** (~800x difference between immer and a plain store doing concat/slice). Dropping immer captures most of the panel-closed win; batching additionally gives the ~12x render win when the dialog is open.

## Proposed Change

Three coordinated changes: (1) rewrite `debugLogStore` as a plain (non-immer) zustand store with a batch `addLogs` API and a monotonically increasing `id` stamped on each entry; (2) buffer channel messages in a module-level array and flush on a 100 ms timer (one store update per batch); (3) use `entry.id` as the React key and flush on dialog open.

### Step 1 — Rewrite `src/features/debug/debugLogStore.ts` (plain store + batching + ids)

Replace the whole file with a plain `create` store (drop the `immer` middleware import entirely) plus module-level buffering helpers:

```ts
import { create } from "zustand";
import type { LogEntry } from "@/generated/types";

const MAX_LOGS = 1000;
const FLUSH_INTERVAL_MS = 100;

/** LogEntry stamped with a unique, monotonically increasing id (stable React key). */
export interface DebugLogEntry extends LogEntry {
	id: number;
}

interface DebugLogStore {
	logs: DebugLogEntry[];
	addLog: (entry: LogEntry) => void;
	addLogs: (entries: LogEntry[]) => void;
	clear: () => void;
}

let nextId = 0;

export const useDebugLogStore = create<DebugLogStore>()((set) => ({
	logs: [],
	addLogs: (entries) => {
		if (entries.length === 0) return;
		set((state) => {
			const stamped = entries.map((e) => ({ ...e, id: nextId++ }));
			const merged = state.logs.concat(stamped);
			return {
				logs: merged.length > MAX_LOGS ? merged.slice(-MAX_LOGS) : merged,
			};
		});
	},
	// Single-entry convenience wrapper (kept for tests / direct callers).
	addLog: (entry) => useDebugLogStore.getState().addLogs([entry]),
	clear: () => {
		pendingBuffer.length = 0; // drop buffered entries too, or they resurrect on next flush
		set({ logs: [] });
	},
}));

// ---- Batched ingestion (module-level, no React involvement) ----

const pendingBuffer: LogEntry[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;

/** Called once per IPC channel message. O(1); no store update. */
export function enqueueDebugLog(entry: LogEntry) {
	pendingBuffer.push(entry);
	// Bound buffer memory: entries beyond cap would be sliced away anyway.
	if (pendingBuffer.length > MAX_LOGS) {
		pendingBuffer.splice(0, pendingBuffer.length - MAX_LOGS);
	}
	if (flushTimer === null) {
		flushTimer = setTimeout(flushDebugLogs, FLUSH_INTERVAL_MS);
	}
}

/** Flush buffered entries into the store as ONE update. Safe to call any time. */
export function flushDebugLogs() {
	if (flushTimer !== null) {
		clearTimeout(flushTimer);
		flushTimer = null;
	}
	if (pendingBuffer.length === 0) return;
	const batch = pendingBuffer.splice(0, pendingBuffer.length);
	useDebugLogStore.getState().addLogs(batch);
}
```

Notes:
- `setTimeout` (not `requestAnimationFrame`): rAF throttles/pauses when the window is hidden, and `setTimeout` is trivially testable with `vi.useFakeTimers()`.
- The self-reference in `addLog` via `useDebugLogStore.getState()` avoids duplicating the concat/slice logic; alternatively hoist a shared `appendEntries(set, entries)` helper — either is fine.
- Do NOT re-add the immer middleware here — the store update must be a plain concat/slice; that is where ~800x of the win comes from.
- `nextId` is a plain module-level counter; it only needs uniqueness within one app run (logs are not persisted).

### Step 2 — `src/features/debug/debugStore.ts` (route channel through the buffer, flush on teardown)

Current lines 18-30 (`syncDebugChannel`). Change the channel handler to enqueue instead of calling `addLog`, and flush pending entries when the channel is torn down:

```ts
import { enqueueDebugLog, flushDebugLogs } from "./debugLogStore";
// (replace the current `import { useDebugLogStore } from "./debugLogStore";` —
//  after this change debugStore.ts no longer needs the store object itself)

function syncDebugChannel(enabled: boolean) {
	if (enabled && !activeChannel) {
		const channel = new Channel<LogEntry>();
		channel.onmessage = (entry) => {
			enqueueDebugLog(entry);
		};
		activeChannel = channel;
		startDebugLog({ onEvent: channel });
	} else if (!enabled && activeChannel) {
		stopDebugLog();
		activeChannel = null;
		flushDebugLogs(); // don't strand the last <=100ms of entries in the buffer
	}
}
```

Everything else in `debugStore.ts` (persist config, `togglePanel`, the `subscribe` at lines 52-54) stays as-is.

### Step 3 — `src/features/debug/DebugLogDialog.tsx` (stable keys + flush on open)

1. **Key fix** (lines 131-133): change

   ```tsx
   filtered.map((entry) => (
   	<LogRow key={entry.timestamp} entry={entry} />
   ))
   ```

   to

   ```tsx
   filtered.map((entry) => (
   	<LogRow key={entry.id} entry={entry} />
   ))
   ```

   The store selector `useDebugLogStore((s) => s.logs)` (line 63) now yields `DebugLogEntry[]`; `LogRow`'s prop type can stay `{ entry: LogEntry }` (a `DebugLogEntry` is assignable to it) — no other changes to `LogRow` or `formatTime` needed since `timestamp` is still present and still used for display.

2. **Flush on open**: `DebugLogContent` mounts only when the dialog opens (it lives inside `DialogContent`). Add a mount effect so the view is never up to 100 ms stale on open:

   ```tsx
   import { flushDebugLogs, useDebugLogStore } from "./debugLogStore";
   // inside DebugLogContent:
   useEffect(() => {
   	flushDebugLogs();
   }, []);
   ```

### Step 4 — Update existing tests

**`src/features/debug/debugLogStore.test.ts`:**
- `addLog` still exists, so the per-entry tests keep working, with one exception: the `"preserves all log fields"` test (lines 86-95) uses `expect(getState().logs[0]).toEqual(entry)` — entries now carry an extra `id` field, so change to `toMatchObject(entry)`.
- `resetStore()` (lines 11-13) should call `useDebugLogStore.getState().clear()` instead of raw `setState({ logs: [] })` so the pending buffer is also reset between tests.
- Add new tests (see Verification).

**`src/features/debug/debugStore.test.ts`:**
- The `"routes channel messages to debugLogStore via onmessage"` test (lines 88-114) assumes synchronous forwarding. After batching, insert a flush before the assertions:

  ```ts
  import { flushDebugLogs, useDebugLogStore } from "./debugLogStore";
  // ...
  channel.onmessage!(entry);
  flushDebugLogs();
  const logs = useDebugLogStore.getState().logs;
  expect(logs).toHaveLength(1);
  expect(logs[0]).toMatchObject(entry); // toEqual would fail on the added id
  ```
- `resetStore()` (lines 10-15) similarly should use `useDebugLogStore.getState().clear()` for the log store.

### Explicit non-goals

- Virtualizing the 1000-row list is NOT in scope (batching already reduces open-dialog cost 12x; virtualization can be a follow-up).
- No backend/Rust changes. `logger.rs` keeps ms timestamps — the frontend id makes them irrelevant for keying.
- No changes to `src/generated/` (gitignored, auto-generated) — `LogEntry` stays as-is; the `id` is a frontend-only decoration.

## Verification

All commands from the repo root (`/home/user/2code`). Do NOT run plain `cargo build` / `cargo test` or `bun tauri ...` — the full Tauri app does not build in CI containers (missing GTK libs). No Rust code changes here, so no cargo step is needed at all.

1. **Type check + affected tests:**
   ```bash
   cd /home/user/2code && bunx tsc --noEmit
   cd /home/user/2code && bunx vitest run src/features/debug
   ```
2. **Full frontend suite** (baseline before this change: 671 tests passing):
   ```bash
   cd /home/user/2code && bunx vitest run
   ```

**Existing coverage of this area:** `src/features/debug/debugLogStore.test.ts` (append order, MAX_LOGS trimming at 1000/1001/1050, clear semantics) and `src/features/debug/debugStore.test.ts` (channel start/stop, onmessage routing). Both must still pass with the updates described in Step 4 — the trimming edge-case tests (exactly 1000 no trim; 1001 trims one; multiple overflows) are the regression net for the concat/slice rewrite.

**New tests to add** (in `debugLogStore.test.ts` unless noted):

- *Unique ids for same-ms timestamps* (the correctness bug):
  ```ts
  it("assigns distinct ids to entries with identical timestamps", () => {
  	getState().addLogs([makeEntry(5), makeEntry(5)]);
  	const [a, b] = getState().logs;
  	expect(a.id).not.toBe(b.id);
  	expect(b.id).toBeGreaterThan(a.id);
  });
  ```
- *Batching coalesces store updates*: subscribe a counter via `useDebugLogStore.subscribe`, `enqueueDebugLog` 5 entries, assert 0 notifications, then `flushDebugLogs()`, assert exactly 1 notification and 5 logs in order.
- *Timer-driven flush*: with `vi.useFakeTimers()`, enqueue 3 entries, assert logs empty, `vi.advanceTimersByTime(100)`, assert 3 logs present; `vi.useRealTimers()` in cleanup.
- *`clear` drops pending buffer*: enqueue 2 entries, `clear()`, `flushDebugLogs()`, assert logs stay empty.
- *Batch cap*: `addLogs` with 1500 entries yields exactly 1000, keeping the newest (`logs[0]` is entry 500).
- *(Optional, component-level)* Render two entries with the same ms timestamp through `DebugLogContent` and assert React does NOT emit the "Encountered two children with the same key" `console.error` (spy on `console.error`). The verifier confirmed this error fires with the current `key={entry.timestamp}` code, so this test locks in the fix.

**Optional performance proof** (this is how the finding was measured; useful to confirm the win, then delete the file): create a temporary `*.bench.ts` under the scratch dir or `src/features/debug/`, import the real store, and compare (a) 1000x per-entry `addLog` at steady-state 1000 cap vs (b) 10x `addLogs` batches of 100. Run with `bunx vitest bench --run <path>`. Expected: batched plain-store path around ~0.3 ms per 1000 entries vs the old immer per-entry path's ~1732 ms. **Delete the bench file afterwards** — do not commit it.

## Risks & Constraints

- **Losing immer's autofreeze**: the old store deep-froze `logs`; the plain store does not. Consumers must treat `logs` as read-only. Current consumers are safe: `DebugLogDialog` only reads/filters/maps (`DebugLogDialog.tsx:63,69-78,131-134`), and nothing else in `src/` subscribes to `useDebugLogStore` (verified by grep — only the dialog, `debugStore`, and the two test files reference it). Do not add mutation of `state.logs` elsewhere.
- **Immer MapSet note in CLAUDE.md** applies to the *terminal* store, not this one — removing immer from `debugLogStore` does not interact with `enableMapSet()`.
- **Up to 100 ms display latency** for new log lines. Mitigated by the flush-on-dialog-open effect (Step 3.2) and flush-on-disable (Step 2). This is a debug tool; 100 ms is imperceptible for a tailing log view.
- **Ordering**: `enqueueDebugLog` + single-consumer `flushDebugLogs` preserve arrival order (channel `onmessage` is serialized on the main thread). The existing "maintains insertion order" test guards this.
- **Test brittleness around timers**: any test that enqueues without flushing could leak a pending `setTimeout` into the next test. `resetStore()` calling `clear()` (which empties the buffer) plus `flushDebugLogs()`'s timer-clearing behavior handles this; alternatively call `flushDebugLogs()` in `beforeEach`.
- **Do not touch**: `src/generated/` (gitignored bindings — regenerate only via `cargo tauri-typegen generate`, unnecessary here since no Rust command changes), `src/paraglide/` and `project.inlang/settings.json` (a pre-existing 1-line working-tree modification in `project.inlang/settings.json` is unrelated — leave it alone), `src-tauri/src/schema.rs`.
- **CLAUDE.md invariants unaffected but nearby**: terminals' CSS display show/hide and the PTY `Channel<&[u8]>` output path are untouched — this change is confined to the *debug log* channel (`startDebugLog`/`stopDebugLog`), which is a separate `Channel<LogEntry>`.
- **HMR edge case (dev only)**: module-level `nextId`/buffer reset on hot reload of `debugLogStore.ts`; ids restart at 0 while old stamped entries persist in the store, which could theoretically collide keys after an HMR cycle. If paranoid, seed `nextId` from `Date.now()` — but plain 0-seeded is what the store reset semantics already imply and is acceptable for a dev-only tool.
