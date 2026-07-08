# Cap and time-flush the rAF-gated live output buffer; detection stalls while window is hidden

> Live PTY output buffers unboundedly (~350 MB/hour at 100 KB/s) while the window is minimized, agent-waiting sound/OS-notification go silent exactly when they matter, and window restore triggers one giant blocking xterm parse | Severity: high | Category: memory

## Problem

All live PTY output in `src/features/terminal/Terminal.tsx` is queued into an in-memory array and flushed **only** from `requestAnimationFrame`:

- `Terminal.tsx:245-246` declares `const liveOutputBuffer: Uint8Array[] = []` and `let liveOutputFrame: number | null = null` inside the terminal ref callback.
- `Terminal.tsx:567-572` — `writeLiveOutput(output)` pushes every IPC chunk into `liveOutputBuffer` and, if no frame is pending, schedules `window.requestAnimationFrame(flushLiveOutputBuffer)`. That rAF is the *only* flush trigger; there is no `visibilitychange` handling, no timeout fallback, and no byte cap anywhere in `src/features/terminal/`.
- `Terminal.tsx:559-565` — `flushLiveOutputBuffer()` concatenates the entire backlog via `concatBytes` (`src/features/terminal/overlap.ts:29-40`) and issues a **single** `term.write(output, scheduleAgentDetection)` call (`Terminal.tsx:564`).

In a Tauri webview (WKWebView / WebView2 / WebKitGTK), `requestAnimationFrame` stops firing when the window is minimized or fully occluded. That produces three concrete failures:

1. **Unbounded memory growth while hidden.** The backend PTY read loop emits every 4 KB chunk with no backpressure (`src-tauri/crates/service/src/pty.rs:594` — `let mut buf = [0u8; 4096];`, and the loop below it forwards every read to `emitter.emit_output`). A verbose build producing ~100 KB/s accumulates ~350 MB per hour in `liveOutputBuffer` while the window stays hidden, transiently **doubled** by `concatBytes` allocating one contiguous copy at flush time.

2. **Agent-status detection freezes exactly when it matters.** `scheduleAgentDetection` is reachable only downstream of the rAF flush: the `term.write` completion callback (`Terminal.tsx:564`), the title debouncer (`Terminal.tsx:542-551`), and the progress addon (`Terminal.tsx:552-555`) — the latter two fire only when xterm *parses* OSC sequences, i.e. also only after a flush. The single independent trigger (`Terminal.tsx:185-194`, `runAgentDetectionNowRef.current?.()` on tab activation) fires on activation only. So while the window is hidden, `publishAgentStatus` (`Terminal.tsx:278-302`) never runs, which means the waiting-agent sound (`playWaitingSound`, `Terminal.tsx:260-269`) and the OS notification never fire. The notification predicate `shouldNotifyAgentWaiting` requires `!windowFocused` (`src/features/terminal/lib/agentNotification.ts:16-28`, specifically line 26) — the feature exists *for* the hidden/unfocused case and is dead exactly then. (The existing `HIDDEN_DETECTION_MULTIPLIER` at `Terminal.tsx:70` shows detection is intended to keep running for non-visible terminals, just at a slower cadence.)

3. **Multi-second UI freeze on restore.** On window restore, the first rAF flush concatenates the entire backlog and passes it to xterm as one chunk. xterm's `WriteBuffer` time-slices only *between* queued write chunks (its 12 ms deadline is checked after each full chunk parse — see `node_modules/@xterm/xterm/src/common/input/WriteBuffer.ts:295`), so a single hundreds-of-MB chunk is parsed in one synchronous pass, freezing the UI.

Related but non-broken: the `pty-exit` handler (`Terminal.tsx:621-633`) also routes its `[Process exited]` message through `writeLiveOutput` (line 627), so that visual message lags while hidden — but `publishAgentStatus(null, null)` on line 626 is *not* rAF-gated, so the status reset itself works.

## Evidence & Measurements

No benchmark numbers exist for this finding (memory/behavioral, not throughput). Concrete code evidence:

- `src/features/terminal/Terminal.tsx:567-572` — the only flush scheduler is `window.requestAnimationFrame`; `grep -rn "visibilitychange\|document.hidden" src/features/terminal/` returns nothing, and no byte cap exists on `liveOutputBuffer`.
- `src/features/terminal/Terminal.tsx:559-565` — whole backlog concatenated into one `term.write` call.
- `src/features/terminal/Terminal.tsx:564` + `:542-555` + `:185-194` — every path into `scheduleAgentDetection`/`runAgentDetectionNow` except tab-activation is downstream of the rAF flush.
- `src/features/terminal/lib/agentNotification.ts:26` — `!windowFocused` gate: the OS notification is specifically for the unfocused/hidden window case.
- `src-tauri/crates/service/src/pty.rs:594` and the `loop { reader.read(&mut buf) ... emitter.emit_output(&session_id, raw) }` below it — backend emits every 4 KB chunk with no backpressure or cap.
- `node_modules/@xterm/xterm/src/common/input/WriteBuffer.ts:295` — xterm checks its 12 ms write deadline only between chunks; a single concatenated chunk defeats its time slicing.
- Estimated impact (from verification): ~350 MB buffered per hour hidden at 100 KB/s output, transiently doubled at flush; total agent-waiting sound/notification blackout while minimized; single blocking parse of the entire backlog on restore.

## Proposed Change

Extract the live-output queueing into a new, unit-testable module with three behaviors: (a) a **timeout fallback flush** independent of rAF, (b) a **byte cap** with oldest-whole-chunk dropping plus a terminal-reset notice on overflow, and (c) **bounded write slices** so xterm's own time slicing works. Then wire it into `Terminal.tsx`.

Everything stays on the **bytes** path (`Uint8Array` in, `Uint8Array` out) — no per-chunk UTF-8 decoding (terminal CLAUDE.md anti-pattern). The overflow notice is ASCII we generate ourselves (encoding our own string is fine; the prohibition is on *decoding* PTY chunks).

### Step 1 — New file `src/features/terminal/lib/liveOutputQueue.ts`

```ts
import { concatBytes } from "../overlap";

export const LIVE_OUTPUT_MAX_BUFFERED_BYTES = 8 * 1024 * 1024; // 8 MiB
export const LIVE_OUTPUT_FALLBACK_FLUSH_MS = 50;
export const LIVE_OUTPUT_MAX_WRITE_CHUNK_BYTES = 512 * 1024; // 512 KiB

export interface LiveOutputQueueOptions {
  /** Wraps term.write(data, onDone). */
  write: (data: Uint8Array, onDone?: () => void) => void;
  /** Called once per flush, after the LAST slice finishes parsing
   *  (i.e. scheduleAgentDetection). */
  onFlushed?: () => void;
  maxBufferedBytes?: number;
  maxWriteChunkBytes?: number;
  fallbackFlushMs?: number;
  // Injectable schedulers so tests never depend on real rAF/timers.
  requestFrame?: (cb: FrameRequestCallback) => number;
  cancelFrame?: (id: number) => void;
  setTimer?: (cb: () => void, ms: number) => number;
  clearTimer?: (id: number) => void;
}

export class LiveOutputQueue {
  private chunks: Uint8Array[] = [];
  private bufferedBytes = 0;
  private droppedBytes = 0;
  private frameId: number | null = null;
  private timerId: number | null = null;
  private disposed = false;
  // ... store resolved options with defaults in constructor;
  // default requestFrame/cancelFrame/setTimer/clearTimer to the
  // window.* equivalents (bind them: window.setTimeout.bind(window)).

  push(chunk: Uint8Array): void {
    if (this.disposed || chunk.length === 0) return;
    this.chunks.push(chunk);
    this.bufferedBytes += chunk.length;
    // Cap: drop OLDEST whole chunks (never split a chunk — backend
    // chunk size is fixed at 4 KiB, crates/service/src/pty.rs:594).
    while (
      this.bufferedBytes > this.maxBufferedBytes &&
      this.chunks.length > 1 // always keep the newest chunk
    ) {
      const dropped = this.chunks.shift()!;
      this.bufferedBytes -= dropped.length;
      this.droppedBytes += dropped.length;
    }
    this.scheduleFlush();
  }

  private scheduleFlush(): void {
    // Arm BOTH a frame and a fallback timer; whichever fires first
    // flushes and cancels the other. The timer covers minimized /
    // occluded windows where rAF never fires.
    if (this.frameId === null) {
      this.frameId = this.requestFrame(() => {
        this.frameId = null;
        this.flushNow();
      });
    }
    if (this.timerId === null) {
      this.timerId = this.setTimer(() => {
        this.timerId = null;
        this.flushNow();
      }, this.fallbackFlushMs);
    }
  }

  /** Flush everything pending in bounded slices. Safe to call directly
   *  (e.g. from a visibilitychange handler). */
  flushNow(): void {
    this.cancelScheduled();
    if (this.disposed || this.chunks.length === 0) return;

    const pending = this.chunks;
    this.chunks = [];
    this.bufferedBytes = 0;

    if (this.droppedBytes > 0) {
      const kib = Math.ceil(this.droppedBytes / 1024);
      this.droppedBytes = 0;
      // Dropped bytes may have bisected escape sequences — emit an SGR
      // reset first so the terminal is not left in a garbled mode, then
      // a dim notice line. ASCII only; generated by us, not decoded PTY data.
      pending.unshift(
        new TextEncoder().encode(
          `\x1b[0m\r\n\x1b[90m[2code: dropped ${kib} KiB of output while the window was hidden]\x1b[0m\r\n`,
        ),
      );
    }

    // Group chunks into slices of <= maxWriteChunkBytes, cutting ONLY at
    // chunk boundaries (a single oversized chunk becomes its own slice).
    const slices: Uint8Array[] = [];
    let current: Uint8Array[] = [];
    let currentBytes = 0;
    for (const chunk of pending) {
      if (currentBytes > 0 && currentBytes + chunk.length > this.maxWriteChunkBytes) {
        slices.push(concatBytes(current));
        current = [];
        currentBytes = 0;
      }
      current.push(chunk);
      currentBytes += chunk.length;
    }
    if (currentBytes > 0) slices.push(concatBytes(current));

    // Multiple term.write calls let xterm's WriteBuffer time-slice
    // between them; run onFlushed only after the LAST slice parses.
    for (let i = 0; i < slices.length; i++) {
      const isLast = i === slices.length - 1;
      this.write(slices[i], isLast ? this.onFlushed : undefined);
    }
  }

  private cancelScheduled(): void {
    if (this.frameId !== null) { this.cancelFrame(this.frameId); this.frameId = null; }
    if (this.timerId !== null) { this.clearTimer(this.timerId); this.timerId = null; }
  }

  dispose(): void {
    this.disposed = true;
    this.cancelScheduled();
    this.chunks = [];
    this.bufferedBytes = 0;
    this.droppedBytes = 0;
  }
}
```

Implementation notes for the sketch:
- `while (... this.chunks.length > 1)`: keeping at least the newest chunk guarantees `push` never leaves the queue empty (a chunk larger than the cap would otherwise self-evict). Since backend chunks are ≤4 KiB and the only frontend-synthesized chunks (exit message, history remainder) are small or one-off, this is a safety guard, not a hot path.
- Dropping is deliberately lossy: the on-disk pty log (`{app_data_dir}/pty_logs/{session_id}.log`) plus the 5000-line xterm scrollback (`TERMINAL_SCROLLBACK`, `Terminal.tsx:65`) already bound what a user can ever see — dropped backlog is scrollback the user could not have scrolled to anyway, and full history is recoverable from the log on session restore.
- Do NOT flush from inside `push()` when the cap is hit — always go through the scheduler, so a hidden window still coalesces into ≤1 flush per (throttled) timer tick.
- Background/hidden pages throttle `setTimeout` to ≥1 s in webviews. That is acceptable: it bounds hidden-state buffering to ~1 s of output per flush cycle, and the inactive-terminal detection interval is already 2 s (`AGENT_DETECTION_INTERVAL_MS * HIDDEN_DETECTION_MULTIPLIER`, `Terminal.tsx:69-70`). The 8 MiB cap remains the hard backstop for cases where timers are fully suspended (e.g. macOS App Nap).

### Step 2 — Export from the lib barrel

Add to `src/features/terminal/lib/index.ts`:

```ts
export {
  LiveOutputQueue,
  LIVE_OUTPUT_MAX_BUFFERED_BYTES,
  LIVE_OUTPUT_FALLBACK_FLUSH_MS,
  LIVE_OUTPUT_MAX_WRITE_CHUNK_BYTES,
} from "./liveOutputQueue";
```

### Step 3 — Wire into `src/features/terminal/Terminal.tsx`

All edits are inside the `terminalRef` callback:

1. **Delete** the buffer state at lines 245-246 (`const liveOutputBuffer: Uint8Array[] = []` and `let liveOutputFrame: number | null = null`).

2. **Replace** `flushLiveOutputBuffer` / `writeLiveOutput` (lines 559-572) with a queue instance. Place it where the old functions were (after `term` is created at line 360 and after `scheduleAgentDetection` is defined at line 329 — the current location, just before `flushPendingEventsAfterHistory`, satisfies both):

```ts
const liveOutput = new LiveOutputQueue({
  write: (data, onDone) => term.write(data, onDone),
  onFlushed: scheduleAgentDetection,
});
function writeLiveOutput(output: Uint8Array) {
  if (disposed) return;
  liveOutput.push(output);
}
```

Keeping the `writeLiveOutput` wrapper name minimizes churn at the three call sites: `Terminal.tsx:584` (`flushPendingEventsAfterHistory` remainder), `:608` (output channel `onmessage`), `:627` (pty-exit message).

3. **Optional but recommended** — immediate catch-up on window restore (complements the throttled fallback timer so the backlog and detection resume the instant the window is visible again, instead of up to ~1 s later):

```ts
const onVisibilityChange = () => {
  if (!document.hidden) {
    liveOutput.flushNow();
    scheduleAgentDetection();
  }
};
document.addEventListener("visibilitychange", onVisibilityChange);
cleanups.push(() =>
  document.removeEventListener("visibilitychange", onVisibilityChange),
);
```

4. **Cleanup** (ref cleanup function, lines 701-712): replace

```ts
liveOutputBuffer.length = 0;
if (liveOutputFrame !== null) {
  window.cancelAnimationFrame(liveOutputFrame);
  liveOutputFrame = null;
}
```

with `liveOutput.dispose();` — this must cancel both the pending rAF **and** the fallback timer (the queue's `dispose()` does both).

No backend (Rust) changes. No changes to `overlap.ts` (its `concatBytes` is reused as-is), no changes to generated bindings, no i18n changes (the overflow notice is terminal output, not UI copy — keep it English/ASCII).

### Step 4 — New unit tests `src/features/terminal/lib/liveOutputQueue.test.ts`

Use injected schedulers (no fake timers needed). Cover:

1. **rAF path**: pushed chunks flush as one `write` when the injected frame callback fires; `onFlushed` passed as the write callback.
2. **Fallback path**: with a `requestFrame` that never invokes its callback (simulating a hidden window), the injected timer callback fires and flushes; detection callback (`onFlushed`) still delivered — this is the regression test for the detection stall.
3. **Whichever-first cancels the other**: after the frame fires, the fallback timer was cancelled (assert `clearTimer` called with the armed id), and vice versa; no double flush.
4. **Byte cap**: with `maxBufferedBytes: 8192` and `requestFrame`/`setTimer` withheld, pushing three 4096-byte chunks drops the oldest whole chunk; on flush, output starts with `\x1b[0m` + a notice containing `dropped 4 KiB`, followed by exactly the two surviving chunks' bytes (assert boundaries — chunks dropped whole, never split).
5. **Slicing**: with `maxWriteChunkBytes: 8192`, pushing five 4096-byte chunks and flushing produces three `write` calls (8192, 8192, 4096 bytes), cut at chunk boundaries, with the `onDone` callback only on the **last** call.
6. **Oversized single chunk**: one 10 000-byte chunk with `maxWriteChunkBytes: 8192` is written as a single 10 000-byte slice (never split).
7. **dispose()**: cancels armed frame + timer, clears the buffer; subsequent `push`/`flushNow` are no-ops (no `write` calls).
8. **Empty push**: `push(new Uint8Array(0))` schedules nothing.

### Step 5 — Regenerate nothing, format

No Rust commands changed, so no `cargo tauri-typegen generate`. Run the formatter if configured (`just fmt`) or match existing file style (tabs in `lib/`, per surrounding files).

## Verification

Full Tauri builds fail in CI containers (missing GTK) — do **not** run `bun tauri dev/build` or bare `cargo build`/`cargo test`. All verification is module-level:

```bash
# New unit tests for the queue
cd /home/user/2code && bunx vitest run src/features/terminal/lib/liveOutputQueue.test.ts

# Existing tests covering the touched integration surface (must stay green):
bunx vitest run src/features/terminal/Terminal.test.tsx        # incl. "keeps pending agent detection until the stream is ready" and waiting-status tests
bunx vitest run src/features/terminal/overlap.test.ts          # concatBytes reuse
bunx vitest run src/features/terminal/lib/agentNotification.test.ts

# Whole frontend suite (671 tests pass pre-change; expect 671 + new queue tests)
bunx vitest run

# Type check
bunx tsc --noEmit

# Rust is untouched, but confirm no accidental backend edits:
cd /home/user/2code/src-tauri && cargo test -p model -p repo -p service -p infra   # 151 tests, must still pass
```

Notes for `Terminal.test.tsx`: it renders the real component with a mocked `XTerm` whose `write(_data, cb)` invokes `cb` synchronously, and it relies on rAF-driven flushing indirectly via `waitFor`. jsdom under vitest provides `requestAnimationFrame`, so the default schedulers work; if any existing test becomes flaky because the 50 ms fallback timer now also fires, the fix is to assert via `waitFor` (already the pattern there), not to change product timings. Add one integration-level test in `Terminal.test.tsx` if cheap: stub `window.requestAnimationFrame` to a no-op returning an id, emit output through the mocked channel, and assert `term.write` still receives the bytes (proves the fallback path end-to-end through the component).

Optional micro-benchmark (only if you want numbers in the PR): `bunx vitest bench --run` on a temporary bench comparing one `term.write`-sized 64 MiB concat vs. 512 KiB slices — but the correctness tests above are the required proof; the original finding carries no benchmark baseline.

Manual verification (outside CI, on a dev machine with a display): run the app, start `yes | head -c 100000000` in a terminal tab, minimize the window for a minute, check memory stays flat and the terminal is responsive immediately on restore; run a coding agent, minimize, and confirm the waiting sound/OS notification now fires while minimized.

## Risks & Constraints

- **CLAUDE.md invariants (repo root + `src/features/terminal/CLAUDE.md`):**
  - *No per-chunk UTF-8 decoding on the live output path* — the queue must handle `Uint8Array` only. The overflow notice is generated ASCII (encoded, not decoded), which is compliant. Never convert PTY chunks to strings.
  - *Terminals never unmount / CSS display only* — this change does not touch mounting; keep it that way. Note `display:none` terminals in a *visible* window still get rAF (rAF is per-window, not per-element), so inactive-tab behavior is unchanged; only the hidden-window case gains the timer path.
  - *Do not edit `src/generated/` or `src/paraglide/`* — nothing here requires either.
- **Overflow drops can bisect escape sequences.** A dropped chunk boundary may cut an SGR/OSC/DCS sequence, leaving the parser mid-sequence when the surviving bytes arrive. The prepended `\x1b[0m` reset mitigates color/attribute bleed but cannot fix e.g. a half-consumed DCS. This is accepted: overflow only happens after ≥8 MiB of unseen hidden-window output, the on-disk pty log retains the true history, and a restore replays clean history. If garbling in this edge proves annoying, the follow-up is `term.clear()` + replay of the tail — do not block this fix on it.
- **Ordering invariant.** All writes to xterm must stay in arrival order. The queue preserves order because `flushNow` drains synchronously and xterm's own `WriteBuffer` queues slices FIFO. Do not introduce any async gap between slice writes.
- **`onFlushed` on last slice only.** Calling `scheduleAgentDetection` per slice would spam the detector during a large replay; the existing throttle (`AGENT_DETECTION_INTERVAL_MS`) would absorb it, but keep the last-slice contract anyway to match current semantics (one detection per flush).
- **Timer throttling is a feature, not a bug.** Hidden pages clamp `setTimeout` to ≥1 s; do not try to defeat it (e.g. with Web Workers or audio hacks). One flush per second while hidden bounds memory to ~100 KB per cycle at typical output rates and is fast enough for the 2 s hidden detection cadence.
- **Dispose must cancel the fallback timer.** The old cleanup (lines 704-708) only cancelled the rAF; a leaked fallback timer would call `term.write` on a disposed terminal. The queue's `dispose()` and the `disposed` flag guard this — verify with test 7.
- **Exit-message path.** `pty-exit` (`Terminal.tsx:621-633`) still routes through the queue; with the fallback timer the `[Process exited]` line now appears within ~1 s even while hidden (previously: never, until restore). `publishAgentStatus(null, null)` there was never gated and must remain outside the queue.
- **Regression watch list:** the two agent-detection tests in `Terminal.test.tsx` (lines ~277 and ~292), select-to-copy tests (they don't touch the output path but share the ref callback), and `TerminalPreview`/restore flows (they use `sessionHistory` + `replayInitialHistory`, which intentionally bypasses the queue for the initial history write at `Terminal.tsx:594` — do not route history through the queue; only the *remainder* at line 584 goes through `writeLiveOutput`, as today).
