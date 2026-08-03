# TitleDebouncer is a trailing debounce — sustained sub-75ms title updates starve tab titles and detector input

> A TUI that rewrites its OSC title faster than every 75 ms resets the debounce timer forever, freezing the tab title and feeding the agent-status detector a permanently stale `oscTitle` — for Claude, whose only "working" rule is title-based, this can misreport `running` as `idle` for the whole burst. | Severity: low | Category: correctness

## Problem

`TitleDebouncer` (src/features/terminal/lib/titleDebounce.ts) claims to be a coalescing throttle — its header comment says *"Matches ghostty's 75ms coalesce window"* and the class doc promises *"only listener notifications wait"*. What `set()` actually implements is a **trailing debounce**:

```ts
// src/features/terminal/lib/titleDebounce.ts:18-28
set(nextTitle: string | null): void {
    if (this.title === nextTitle) return;
    this.title = nextTitle;
    if (this.timerId !== null) {
        clearTimeout(this.timerId);      // <-- kills the pending flush
    }
    this.timerId = setTimeout(() => {    // <-- and restarts the full 75ms wait
        this.timerId = null;
        this.flush();
    }, TITLE_COALESCE_MS);
}
```

Every *distinct* title clears the pending timer and schedules a fresh 75 ms timeout. There is no leading edge and no max-wait. A TUI that emits a distinct title more often than every 75 ms (spinner frames at 50–60 ms are common) resets the timer forever, so `flush()` never runs while the churn lasts.

Why that matters — the flush callback in `Terminal.tsx` is load-bearing in two ways:

```ts
// src/features/terminal/Terminal.tsx:542-551
titleDebouncer.subscribe(() => {
    const title = titleDebouncer.value;
    latestTitle = title;                               // (a) sole writer of latestTitle
    if (title) {
        useTerminalStore.
        getState().
        updateTabTitle(profileId, sessionId, title);   // (b) tab title in store
    }
    scheduleAgentDetection();
});
```

1. **Detector starvation.** `latestTitle` (declared at Terminal.tsx:253) is assigned *only* inside this subscriber (plus a reset to `null` on `pty-exit` at Terminal.tsx:624 — there is no other write). `runAgentDetectionNow()` reads it as the detector's `oscTitle` input at Terminal.tsx:310. Detection keeps running after every output write (`term.write(output, scheduleAgentDetection)` at Terminal.tsx:564), but it evaluates a stale title for the entire burst.
2. **Frozen tab title.** `updateTabTitle` (Terminal.tsx:546-548) never fires during the burst, so the tab label in `terminalStore` stays stale.

Downstream impact on the detector is worse for Claude than a mere lag: `src/features/terminal/detector/rules/claude.ts` has **no screen-based "working" rule** — `osc_title_working` (braille-spinner match on `osc_title`, priority 1100, claude.ts:7) is the *only* running signal, and the idle-priority `live_prompt_box` rule can match the visible prompt box while Claude is working. A starved title therefore flips the status dot to `idle` for the whole churn period. Agent *identification* is also title-keyed: `inferAgents` in `detector/engine.ts:130-144` inspects `oscTitle` (including the `"action required"` inference at engine.ts:137 and the spinner regex at engine.ts:144).

Severity stays low because common braille spinners tick at ~80 ms (above the window) so nominal spinners do flush, waiting/blocked detection is mostly screen-based, and recovery is 75 ms after churn stops. The practical damage is a wrong running/idle dot, delayed agent inference, and a frozen tab title during rapid-retitle periods.

## Evidence & Measurements

No benchmark applies (correctness finding, not perf). Concrete code evidence:

- `src/features/terminal/lib/titleDebounce.ts:21-27` — `clearTimeout(this.timerId)` followed by a fresh `setTimeout(..., TITLE_COALESCE_MS)` on every distinct `set()`. Only identical titles early-return (line 19). No leading edge, no max-wait ⇒ sustained sub-75 ms distinct titles ⇒ `flush()` never fires.
- `src/features/terminal/Terminal.tsx:253` declares `latestTitle`; grep confirms its only assignments are line 544 (inside the debounced subscriber) and line 624 (`pty-exit` reset). Line 310 feeds it to `agentDetector.detect({ ..., oscTitle: latestTitle, ... })`.
- `src/features/terminal/detector/rules/claude.ts:7` — `defineRule("osc_title_working", "working", 1100, "osc_title", ...)` is Claude's sole working signal (no screen-region working rule exists in that manifest).
- `src/features/terminal/detector/engine.ts:130-144` — `inferAgents` keys agent identification off `oscTitle`.
- Test gap: `src/features/terminal/Terminal.test.tsx:186-198` mocks `TitleDebouncer` with a **synchronous** class (flushes immediately on `set`), so no existing test exercises the real timer behavior; `titleDebounce.ts` has no unit test at all.

Trace of the bug with the current code: titles arrive at t = 0, 50, 100, 150, … ms. Each `set()` cancels the pending timer and schedules a new one 75 ms out; the timer's deadline is always 75 ms past the *latest* set, which is always pushed back before it fires. `flush()` runs only 75 ms after the *last* title of the burst.

## Proposed Change

### Step 1 (the fix): convert `set()` from trailing debounce to throttle-with-trailing-flush

File: `src/features/terminal/lib/titleDebounce.ts`

Keep the identical-title early return (line 19 — do not touch it; it's what stops same-title re-emits from spamming). Then, instead of clearing and rescheduling, **only schedule a timer when none is pending**:

```ts
set(nextTitle: string | null): void {
    if (this.title === nextTitle) return;
    this.title = nextTitle;
    if (this.timerId !== null) return; // flush already scheduled — coalesce into it
    this.timerId = setTimeout(() => {
        this.timerId = null;
        this.flush();
    }, TITLE_COALESCE_MS);
}
```

Semantics after the change: the first distinct title in a quiet period opens a 75 ms window; further distinct titles inside the window update `this.title` (so `value` stays fresh, as today) but do not reschedule; the flush fires at the window edge and listeners read the latest value via `titleDebouncer.value`. This guarantees **max 75 ms notification staleness** while preserving the anti-flicker coalescing. No changes needed to `flush()`, `subscribe()`, or `dispose()` (dispose at lines 43-49 already cancels a pending timer correctly under the new scheme).

Also update the header comment (lines 1-6) — it currently describes the intended behavior, which the code now actually implements; reword to something like: *"Coalesced title-change notification (throttle with trailing flush). The underlying value updates immediately so `value` reads the latest; listener notification is deferred at most TITLE_COALESCE_MS after the first change in a burst. Matches ghostty's 75ms coalesce window."*

### Step 2 (complementary hardening, recommended): keep the detector's title input fresh independent of the flush

File: `src/features/terminal/Terminal.tsx`

Assign `latestTitle` in the raw `onTitleChange` handler so the detector never depends on flush timing at all:

```ts
// Terminal.tsx:538-540, currently:
const titleDisposable = term.onTitleChange((title) => {
    titleDebouncer.set(title);
});
// change to:
const titleDisposable = term.onTitleChange((title) => {
    latestTitle = title;
    titleDebouncer.set(title);
});
```

Leave the subscriber at lines 542-551 exactly as-is: it still assigns `latestTitle` (harmless, same value or a benign refresh after `pty-exit` reset — see Risks), still drives `updateTabTitle`, and still calls `scheduleAgentDetection()`. Do **not** instead make `runAgentDetectionNow` read `titleDebouncer.value` directly — that would break the `pty-exit` reset at Terminal.tsx:624 (`latestTitle = null`), which intentionally clears the detector's title without touching the debouncer, and it also risks a TDZ-shaped ordering hazard since `runAgentDetectionNow` (line 304) is defined before `titleDebouncer` (line 536).

With Step 2, detector staleness is zero even during churn; Step 1 is still required for the tab title (`updateTabTitle`) and for the flush-driven `scheduleAgentDetection` cadence.

### Step 3: add the missing unit test

New file: `src/features/terminal/lib/titleDebounce.test.ts` (colocated, matching `terminalStorage.test.ts` / `agentNotification.test.ts` in the same directory). Use vitest fake timers:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TitleDebouncer } from "./titleDebounce";

describe("TitleDebouncer", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it("updates value immediately but defers notification by 75ms", () => {
        const d = new TitleDebouncer();
        const flushes: Array<string | null> = [];
        d.subscribe(() => flushes.push(d.value));
        d.set("a");
        expect(d.value).toBe("a");
        expect(flushes).toEqual([]);
        vi.advanceTimersByTime(75);
        expect(flushes).toEqual(["a"]);
        d.dispose();
    });

    it("ignores identical titles", () => {
        const d = new TitleDebouncer();
        const listener = vi.fn();
        d.subscribe(listener);
        d.set("a");
        vi.advanceTimersByTime(75);
        d.set("a"); // no change — must not schedule
        vi.advanceTimersByTime(200);
        expect(listener).toHaveBeenCalledTimes(1);
        d.dispose();
    });

    it("flushes at ~75ms cadence under sustained 50ms distinct-title churn (regression)", () => {
        const d = new TitleDebouncer();
        const flushes: Array<string | null> = [];
        d.subscribe(() => flushes.push(d.value));
        for (let i = 0; i < 20; i++) {
            d.set(`title-${i}`);        // distinct title every 50ms
            vi.advanceTimersByTime(50); // total simulated time: 1000ms
        }
        // Throttle semantics: window opens at t=0, flushes at 75 with the
        // then-latest title, next set (t=100) opens the next window, flush at
        // 175, ... => flushes at 75, 175, ..., 975 = 10 flushes.
        // Old (buggy) trailing debounce: 0 flushes — timer reset by every set,
        // first flush would land at 1025ms, after the loop ends.
        expect(flushes.length).toBe(10);
        expect(flushes[0]).toBe("title-1"); // latest value at the 75ms edge
        expect(flushes.at(-1)).toBe("title-19");
        d.dispose();
    });

    it("dispose cancels a pending flush", () => {
        const d = new TitleDebouncer();
        const listener = vi.fn();
        d.subscribe(listener);
        d.set("a");
        d.dispose();
        vi.advanceTimersByTime(200);
        expect(listener).not.toHaveBeenCalled();
    });
});
```

(If the exact flush count/values differ by one when you run it, trace the window edges rather than loosening to `toBeGreaterThan(0)` — the count is deterministic under fake timers and the strong assertion is what makes this a regression test for the debounce-vs-throttle distinction.)

### Step 4: nothing else

- `src/features/terminal/Terminal.test.tsx:186-198` mocks `TitleDebouncer` with a synchronous stand-in; the public interface (`value`, `set`, `subscribe`, `dispose`) is unchanged, so the mock stays valid. Do not modify it.
- `TitleDebouncer` is exported via `src/features/terminal/lib/index.ts:25` and consumed only by `Terminal.tsx` — no other call sites to audit.
- No Rust/backend changes; no i18n changes; no generated-bindings changes.

## Verification

All commands from the repo root. **Do not** run plain `cargo build`/`cargo test` or `bun tauri ...` — the full Tauri app does not build in CI containers (missing GTK libs), and this change is frontend-only anyway.

1. New unit test (fails on the old code's churn case, passes after Step 1):
   ```bash
   cd /home/user/2code && bunx vitest run src/features/terminal/lib/titleDebounce.test.ts
   ```
2. Existing coverage of the touched area — the terminal component test (uses the synchronous mock, guards the subscribe/updateTabTitle wiring) and detector tests (guard the `oscTitle` rules this fix un-starves):
   ```bash
   cd /home/user/2code && bunx vitest run src/features/terminal
   ```
3. Full frontend suite (671 tests passing before this change; expect 671 + the new titleDebounce tests after):
   ```bash
   cd /home/user/2code && bunx vitest run
   ```
4. Typecheck:
   ```bash
   cd /home/user/2code && bunx tsc -p tsconfig.json --noEmit
   ```

Manual sanity check (only where the app can actually launch — not in CI containers): run a TUI that retitles rapidly (e.g. Claude Code mid-generation) and confirm the tab title updates during the burst and the status dot shows running while the braille-spinner title is active, flipping to idle only after work stops.

## Risks & Constraints

- **Do not remove the `this.title === nextTitle` guard** (titleDebounce.ts:19). It is what keeps same-title re-emits from spamming timers/flushes; the bug is solely the clear/reschedule pair at lines 21-27.
- **Behavioral shift, intended:** notifications now fire up to 75 ms after the *first* change in a burst rather than 75 ms after the *last*. During a burst, listeners fire every ~75 ms with the then-latest value instead of once at the end. `updateTabTitle` is an idempotent store write and `scheduleAgentDetection` is already self-throttled (Terminal.tsx:329-343: it no-ops when a timer is pending and rate-limits via `lastAgentDetectionAt`), so the extra flushes are cheap. Flicker protection is preserved because intermediate titles inside a window are still skipped.
- **`pty-exit` reset interplay (Step 2):** the exit handler sets `latestTitle = null` (Terminal.tsx:624) without clearing the debouncer. A flush already pending at exit time can re-assign the old title via the subscriber (line 544) up to 75 ms later — this race exists today and is not widened by this change; with Step 1 the pending window is at most 75 ms old. If you want to close it entirely, that is a separate change (e.g. `titleDebouncer.set(null)` on exit) — out of scope here.
- **CLAUDE.md invariants to respect** (root CLAUDE.md and src/features/terminal/CLAUDE.md): terminals must never be conditionally rendered (CSS `display` only) — this plan does not touch rendering; do not edit `src/generated/` or `src/paraglide/`; do not touch `project.inlang/settings.json`; keep detector rules one-agent-per-manifest — this plan does not modify `detector/rules/`.
- **Regression risk is low and localized:** two files touched (`titleDebounce.ts` semantics, one-line addition in `Terminal.tsx`'s `onTitleChange`), one new test file. The Terminal.test.tsx mock isolates component tests from the timing change, and detector tests are input-level and unaffected.
- Timer type stays `ReturnType<typeof setTimeout>` — do not switch to `window.setTimeout`/number, since the class is also constructed in jsdom tests.
