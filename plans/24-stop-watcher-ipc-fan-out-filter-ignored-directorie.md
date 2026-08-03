# Stop watcher IPC fan-out: filter ignored directories and coalesce events per watch target on the backend

> A 10,000-file build burst (npm install / cargo build) currently produces 10,000 JSON-serialized Tauri IPC messages and ~940 ms of backend coordinator CPU, and starves frontend query invalidation until the burst ends; per-target coalescing + ignored-dir filtering reduces this to ~1 message and ~1 ms. | Severity: medium | Category: performance

## Problem

The file watcher pipeline has four compounding defects, all in
`src-tauri/crates/service/src/watcher.rs` and `src/features/watcher/fileWatcher.ts`:

1. **Only `.git` is filtered; every other directory is forwarded.**
   Each watch target is watched recursively (`watcher.rs:155`,
   `w.watch(path, RecursiveMode::Recursive)`), and the only path filter is at
   `watcher.rs:253`:
   ```rust
   .filter(|path| !path.components().any(|c| c.as_os_str() == ".git"))
   ```
   `node_modules/`, `target/`, `dist/`, `.venv/`, `build/` etc. all pass
   through, so builds and dependency installs — which by far dominate FS event
   volume in a dev workspace — generate the full event stream.

2. **The backend debounce is keyed per *path*, so bursts of distinct paths never coalesce.**
   `watch_event_debounce_key` (`watcher.rs:237-244`) keys on
   `project_id:profile_id:path`. The debounce at `watcher.rs:71-78` is
   leading-edge per key: a burst touching 10k *distinct* files matches 10k
   distinct keys, every one passes `should_send`, and every one triggers its own
   `sender.send(event)` (`watcher.rs:86`) — one JSON-serialized Tauri
   `Channel<WatchEvent>` IPC message each (see `TauriWatchSender` in
   `src-tauri/src/bridge.rs:72-78`). IPC volume is O(changed files), not
   O(watch targets).

3. **`prune_debounce_cache` runs on EVERY event and is the dominant CPU cost.**
   `watcher.rs:70` calls `prune_debounce_cache` per received event. Once the
   map hits `MAX_DEBOUNCE_KEYS = 1024` during a burst, each subsequent event
   pays a full `retain` over 1024 entries + clone-all-keys-to-`Vec` + sort
   (`watcher.rs:213-235`) ≈ 87 µs/event. The 1024-key cap also silently
   *breaks* debouncing during bursts: >1024 distinct paths evicts the oldest
   keys, allowing repeated re-sends for the same path.

4. **The frontend trailing timer is reset on every message → invalidation starvation.**
   `src/features/watcher/fileWatcher.ts:166-180`: `channel.onmessage` pushes to
   an unbounded `pendingEvents` array and clears + re-arms the 1 s
   `invalidateTimer` on *every* message. During a sustained build the timer
   never fires, so git-diff/fs-tree query invalidation is starved until the
   build finishes, then the entire unbounded backlog is processed at once.

Secondary (optional-polish) issues, confirmed but cheap:
- `reconcile_watchers` takes the global DB mutex and runs a full
  `list_all_with_profiles` query every 3 s forever (`watcher.rs:61-63`,
  `:103-115`), even when idle. Two small queries — real but low cost.
- One `notify::recommended_watcher` per watch target = one inotify instance per
  target on Linux (default limit 128 instances), and recursive inotify adds one
  watch *per directory* (limit ~128k watches on this box). Large `node_modules`
  trees across project + profile worktrees can exhaust the watch budget and
  silently break watching. Note: event-level filtering (fix #1) does NOT reduce
  the inotify watch count — that would require non-recursive watching with a
  directory walker (e.g. the `ignore` crate). Treat as documented limitation /
  follow-up, not part of this change.

## Evidence & Measurements

Verified benchmark results (Rust, `--release`, 4-core Linux container):

> BENCH A (end-to-end, real `service::watcher::start` coordinator + real notify watcher + in-memory SQLite with real project row; 100 dirs x 100 files = 10,000 files written under node_modules/ in the watched root): burst write wall time 137ms; IPC messages forwarded by the real coordinator = 10,000 (10,000 of them for node_modules paths — proving node_modules is not filtered); time until forwarded count stabilized = 941ms (coordinator drains ~7x slower than the burst); per-target coalescing at a 500ms tick would have sent <=2 messages for the same burst.
>
> BENCH B (A/B, 10,000 synthetic events with distinct paths on one watch target, simulated 300ms burst, 2 warm-up + 10 measured iterations): CURRENT per-event prune+leading-edge-debounce = 871.1ms per 10k-event burst (87.1 us/event), 10,000 sends; COALESCED per-target = 1.14ms per burst (0.11 us/event), 1 send. CPU speedup 762x, IPC message reduction 10,000x.
>
> System limits verified: fs.inotify.max_user_watches=129,984, max_user_instances=128.

Measured impact: 10,000-file build burst → 10,000 IPC messages + ~940 ms backend
coordinator CPU today; per-target coalescing measured at 1 send and 1.14 ms
(762x CPU, 10,000x fewer IPC messages).

Frontend starvation is confirmed by code reading (`fileWatcher.ts:170-179`
clears + resets the 1 s trailing timer on every message); the backend
measurement proves the 10k-message flood that drives it.

## Proposed Change

Two files change: `src-tauri/crates/service/src/watcher.rs` (core) and
`src/features/watcher/fileWatcher.ts` (starvation guard). **No IPC contract
change**: `WatchEvent` (`src-tauri/crates/model/src/watcher.rs`) already has
`path: Option<String>`, and `fileWatcher.ts` already treats `path == null` as
"many files changed → broad per-profile invalidation" (see
`addFileInvalidation` and the `paths.has(null)` branch). No typegen regen, no
handler/bridge changes, no migration.

### Step 1 — Filter well-known ignored directories in `watch_event_for_notify_event`

In `src-tauri/crates/service/src/watcher.rs`, replace the `.git`-only filter at
line 253 with a shared helper and constant:

```rust
/// Directory names whose contents never affect git diff / fs-tree queries.
/// Matched as exact path components anywhere in the event path.
const IGNORED_DIR_COMPONENTS: &[&str] = &[
    ".git",
    "node_modules",
    "target",
    "dist",
    "build",
    ".venv",
    ".next",
    "__pycache__",
];

fn is_ignored_path(path: &Path) -> bool {
    path.components().any(|component| {
        IGNORED_DIR_COMPONENTS
            .iter()
            .any(|dir| component.as_os_str() == *dir)
    })
}
```

and in `watch_event_for_notify_event`:

```rust
let paths = event
    .paths
    .iter()
    .filter(|path| !is_ignored_path(path))
    .collect::<Vec<_>>();
```

Note the tradeoff: `target`, `dist`, `build` are matched as *any* component, so
a source directory literally named `build/` in a watched repo would stop
producing file-level events. That is acceptable here — these names are
overwhelmingly build outputs, they are still covered by git-status invalidation
when the user's own tracked files change elsewhere, and the same names are the
ones flooding IPC today. Do NOT try to parse `.gitignore` (the `ignore` crate)
in this change; the static list is what was benchmarked and keeps the diff
small. Leave a comment pointing at the `ignore` crate as the future upgrade if
per-repo accuracy is ever needed.

### Step 2 — Replace per-path leading-edge debounce with per-target coalescing

Delete the per-path machinery and replace it with a small, testable coalescer
keyed by watch target (`project_id` + `profile_id`). Design constraints from
the verified benchmark:

- Flushing rides the existing `rx.recv_timeout(RECV_TIMEOUT)` loop
  (`RECV_TIMEOUT = 100ms`) — **no new thread**. The timeout tick doubles as the
  flush tick when the channel is idle.
- Keep leading-edge behavior for the common single-file-save case: the first
  event for a quiet target is sent immediately (preserves today's snappy diff
  refresh). Subsequent events within `DEBOUNCE_DURATION` (500 ms) accumulate
  and flush as at most one aggregated event per target per window.
- Aggregated event carries `path: Some(p)` only when exactly one distinct
  relative path accumulated; otherwise `path: None` (frontend already handles
  this as broad invalidation).
- State size is O(watch targets), so `MAX_DEBOUNCE_KEYS`, `prune_debounce_cache`
  and `watch_event_debounce_key` are all **deleted** (with their tests, see
  Step 4). Stale `last_sent` entries for removed targets are dropped during the
  flush pass (entries older than a few debounce windows) — bounded by target
  count, so cost is trivial.

Sketch (private to `watcher.rs`; exact naming up to the implementer, but keep
it a plain struct with `Instant`-parameterized methods so unit tests can drive
time deterministically):

```rust
#[derive(Default)]
struct TargetCoalescer {
    /// target key -> last time an event was sent for this target
    last_sent: HashMap<String, Instant>,
    /// target key -> event accumulated since last send (path merged)
    pending: HashMap<String, WatchEvent>,
}

fn target_key(event: &WatchEvent) -> String {
    format!(
        "{}:{}",
        event.project_id,
        event.profile_id.as_deref().unwrap_or("")
    )
}

impl TargetCoalescer {
    /// Offer an incoming event. Returns Some(event) if it should be sent
    /// immediately (leading edge), None if it was queued for a later flush.
    fn offer(&mut self, event: WatchEvent, now: Instant) -> Option<WatchEvent> {
        let key = target_key(&event);
        let quiet = self
            .last_sent
            .get(&key)
            .map(|t| now.duration_since(*t) >= DEBOUNCE_DURATION)
            .unwrap_or(true);
        if quiet && !self.pending.contains_key(&key) {
            self.last_sent.insert(key, now);
            return Some(event);
        }
        // Merge: keep path only while every accumulated event agrees on it.
        self.pending
            .entry(key)
            .and_modify(|pending| {
                if pending.path != event.path {
                    pending.path = None;
                }
            })
            .or_insert(event);
        None
    }

    /// Flush pending targets whose debounce window elapsed.
    /// Call on every loop iteration (recv or timeout).
    fn flush_due(&mut self, now: Instant) -> Vec<WatchEvent> {
        let due: Vec<String> = self
            .pending
            .keys()
            .filter(|key| {
                self.last_sent
                    .get(*key)
                    .map(|t| now.duration_since(*t) >= DEBOUNCE_DURATION)
                    .unwrap_or(true)
            })
            .cloned()
            .collect();
        let mut flushed = Vec::with_capacity(due.len());
        for key in due {
            if let Some(event) = self.pending.remove(&key) {
                self.last_sent.insert(key, now);
                flushed.push(event);
            }
        }
        // Cheap GC: drop last_sent entries idle for several windows
        // (bounded by number of watch targets, not paths).
        self.last_sent
            .retain(|_, t| now.duration_since(*t) < DEBOUNCE_DURATION * 4);
        flushed
    }
}
```

Rewire `run_coordinator` (`watcher.rs:44-96`):

```rust
let mut coalescer = TargetCoalescer::default();

loop {
    if shutdown.load(Ordering::Relaxed) { break; }

    if last_poll.elapsed() >= DB_POLL_INTERVAL {
        last_poll = Instant::now();
        reconcile_watchers(&db, &tx, &mut watchers);
    }

    match rx.recv_timeout(RECV_TIMEOUT) {
        Ok(event) => {
            let now = Instant::now();
            if let Some(event) = coalescer.offer(event, now) {
                tracing::trace!(target: "watcher", project_id = %event.project_id, profile_id = ?event.profile_id, path = ?event.path, "file changed");
                if !sender.send(event) { break; }
            }
        }
        Err(mpsc::RecvTimeoutError::Timeout) => {}
        Err(mpsc::RecvTimeoutError::Disconnected) => break,
    }

    // Flush tick — runs after every recv AND every 100ms timeout,
    // so pending events are delivered at most DEBOUNCE_DURATION + RECV_TIMEOUT late.
    for event in coalescer.flush_due(Instant::now()) {
        if !sender.send(event) { return; }
    }
}
```

Behavioral consequences (intended):
- Single file save on a quiet target: sent immediately, exactly as today.
- 10k-file burst on one target: 1 leading-edge send + ~1 coalesced send per
  500 ms window with `path = None` — O(targets) IPC instead of O(files).
- Per-event CPU: HashMap lookup + insert; the per-event
  retain/clone/sort of `prune_debounce_cache` is gone entirely (pruning moved
  to `flush_due` and bounded by target count).

Delete: `MAX_DEBOUNCE_KEYS` (`watcher.rs:19`), `last_event` map
(`watcher.rs:53`), `prune_debounce_cache` (`watcher.rs:213-235`),
`watch_event_debounce_key` (`watcher.rs:237-244`).

### Step 3 — Frontend: stop resetting the trailing timer on every message

In `src/features/watcher/fileWatcher.ts:166-180`, change `channel.onmessage`
from "clear + re-arm" (starvable) to "arm once, flush on schedule":

```typescript
channel.onmessage = (event) => {
    pendingEvents.push(event);
    // Backend already coalesces per watch target; this timer only batches
    // the handful of per-target messages that arrive within a window.
    // Do NOT reset an armed timer — resetting starves invalidation during
    // sustained bursts.
    if (invalidateTimer !== null) return;

    invalidateTimer = window.setTimeout(() => {
        invalidateTimer = null;
        const events = pendingEvents.splice(0);
        invalidateChangedEvents(events);
    }, INVALIDATION_DEBOUNCE_MS);
};
```

This guarantees a flush at most `INVALIDATION_DEBOUNCE_MS` (1 s) after the
first pending event, regardless of burst duration, and `pendingEvents` is now
bounded in practice by (targets × messages per window) because of Step 2.

### Step 4 — Update colocated Rust tests

In the `#[cfg(test)]` module of `watcher.rs` (lines 302-454):

- **Delete** `prune_debounce_cache_removes_expired_entries_and_bounds_size`
  (`watcher.rs:417-438`) — the function it tests is gone.
- **Keep unchanged**: the three `watcher_targets_*` tests and
  `relative_event_path_is_root_relative`.
- **Add** (all deterministic, driven by explicit `Instant`s — no sleeps):
  - `ignored_dirs_are_filtered_from_notify_events`: build a `WatchTarget` and a
    `notify::Event` with paths under `node_modules/`, `target/`, `dist/`,
    `.venv/`, and assert `watch_event_for_notify_event` returns `None`; a mixed
    event (one `src/main.rs` + one `node_modules/x.js`) returns
    `Some` with `path == Some("src/main.rs")`.
  - `coalescer_sends_first_event_immediately`: `offer` on a fresh coalescer
    returns `Some` with the original path.
  - `coalescer_accumulates_burst_into_one_event_with_none_path`: after a
    leading-edge send, `offer` N events with distinct paths within the window →
    all return `None`; `flush_due(now + DEBOUNCE_DURATION)` returns exactly one
    event with `path == None`.
  - `coalescer_preserves_single_path_when_burst_touches_one_file`: repeated
    events for the *same* path coalesce to one flushed event with
    `path == Some(that_path)`.
  - `coalescer_keys_by_target_not_path`: events for two different
    project/profile pairs flush as two events.
  - `coalescer_flush_is_bounded_and_prunes_last_sent`: after flushing, advance
    `now` by `DEBOUNCE_DURATION * 4` and verify `last_sent` no longer grows
    (assert via a follow-up `offer` returning `Some`, i.e. leading-edge again —
    keep fields private; test observable behavior, not map internals, unless
    you choose `pub(crate)` fields for assertion convenience).
- **Optional but recommended** (this is the end-to-end proof; keep thresholds
  generous to avoid flakes): an integration-style test in the same module using
  `tempfile` + a real in-memory SQLite DB + a recording
  `WatchEventSender` (struct wrapping `Arc<Mutex<Vec<WatchEvent>>>`):
  1. `SqliteConnection::establish(":memory:")`, run embedded migrations
     (`diesel_migrations` is already a dev-dependency of the `service` crate),
     insert one project row whose `folder` is a `tempfile::tempdir()` path.
  2. `service::watcher::start(Box::new(recorder), db, shutdown_flag)`.
  3. Sleep ~4 s (one `DB_POLL_INTERVAL` + margin) for the watcher to attach,
     then write ~200 files under `<root>/node_modules/…` and ~5 files under
     `<root>/src/…`; sleep ~2 s; set the shutdown flag.
  4. Assert: no recorded event resolves to a `node_modules` path, and total
     recorded events ≤ 5 (leading edge + a couple of coalesced flushes),
     versus ~205 today. If CI timing proves flaky, mark `#[ignore]` and note it
     as a manual check — the deterministic coalescer tests above are the
     required coverage.

### Step 5 — Frontend test update

`src/features/watcher/fileWatcher.test.ts` already loads the module with
`vi.useFakeTimers()` and drives `channel.onmessage` directly. Add one test:

- `flushes invalidation during a sustained burst instead of starving`: send an
  event, advance timers by 500 ms, send another event (previously this reset
  the timer), advance by 500 ms more → assert `invalidateQueriesMock` was
  called (timer fired 1 s after the FIRST event). Then verify a second batch:
  events arriving after the flush arm a new timer.

Check whether any existing test in that file asserts the old reset-on-message
behavior (e.g. expects no invalidation after repeated events + partial timer
advances) and update its expectations to the new fixed-window semantics.

### Explicitly out of scope (do not do in this change)

- Switching to the `ignore` crate / gitignore parsing.
- Non-recursive watching to reduce the inotify watch budget (document as
  follow-up; note it in a code comment near `RecursiveMode::Recursive`).
- Changing `reconcile_watchers`' 3 s DB poll — verified real but cheap
  (two small queries). If trivial while you're there, an acceptable micro-polish
  is skipping the rebuild loop when the sorted target key set is unchanged, but
  do not restructure the polling.
- Any change to `WatchEvent`'s shape, the `watch_projects` command, `bridge.rs`,
  or generated bindings.

## Verification

All commands from repo root. **Never** run plain `cargo build`/`cargo test`
(full Tauri app build fails in this container — missing GTK libs) and never
`bun tauri ...`.

1. Rust unit tests (the changed crate, then the whole workspace set):
   ```bash
   cd /home/user/2code/src-tauri && cargo test -p service watcher
   cd /home/user/2code/src-tauri && cargo test -p model -p repo -p service -p infra
   ```
   Baseline before the change: the second command builds and passes with 151
   tests. After the change: the deleted `prune_debounce_cache` test is gone,
   the new coalescer/filter tests pass, and all pre-existing `watcher_targets_*`
   and `relative_event_path` tests still pass unmodified.

2. Frontend tests:
   ```bash
   cd /home/user/2code && bunx vitest run src/features/watcher
   cd /home/user/2code && bunx vitest run
   ```
   Baseline: 671 tests pass. After: the new starvation test passes and no other
   suite regresses.

3. Performance proof (recreates the verified benchmark; module-level, no app
   launch): if you add the optional end-to-end recording-sender test from
   Step 4, it directly asserts the O(files) → O(targets) reduction (≤5 events
   for a ~205-file burst, zero from `node_modules`). Alternatively, a
   throwaway `--release` benchmark in the scratchpad driving
   `TargetCoalescer::offer`/`flush_due` with 10,000 distinct-path events should
   show ~1 send and ~1 ms CPU vs. the pre-change 10,000 sends / ~871 ms
   (Bench B numbers above). Delete any throwaway files afterwards.

4. Manual smoke (only on a machine where the app runs; not possible in this
   container): `bun tauri dev`, open a project, save a single file → git diff
   panel refreshes essentially immediately (leading edge preserved); run
   `npm install` in the worktree → diff panel refreshes within ~1-2 s of the
   burst *starting* (not after it ends), and the dev console shows a handful of
   watch events instead of thousands.

## Risks & Constraints

- **CLAUDE.md invariants**: DB is a single connection behind
  `Arc<Mutex<SqliteConnection>>` — the change must not add DB access to the hot
  event path (the coalescer is pure in-memory; `reconcile_watchers` remains the
  only DB user). No manual edits to `schema.rs` or `src/generated/`; no
  typegen run needed since no command signatures change. Service crate has no
  Tauri bindings — keep the coalescer in `service::watcher`, behind the
  existing `WatchEventSender` trait.
- **Latency regression risk (bounded, intended)**: after a leading-edge send,
  further changes to the same target are delayed up to
  `DEBOUNCE_DURATION + RECV_TIMEOUT` ≈ 600 ms, then up to 1 s more by the
  frontend batcher. That matches today's *effective* latency for a quiet-target
  single save (immediate) and dramatically improves burst latency (today:
  starved until burst end). Keep `DEBOUNCE_DURATION` at 500 ms — do not tune it
  up without re-checking the single-save UX.
- **Coarser invalidation**: coalesced events carry `path: None`, which
  triggers broad per-profile invalidation of `fs-file`/`fs-file-preview` caches
  instead of exact-path invalidation. This is the pre-existing contract
  (`fileWatcher.ts` `paths.has(null)` branch) and only kicks in for multi-file
  bursts, where broad invalidation is semantically correct anyway.
- **False-positive directory filtering**: a real source directory named
  `build`/`dist`/`target` in a user's repo will no longer emit file-level watch
  events. Mitigated by: git-status/diff invalidation still fires when any
  non-ignored path in the same target changes; the list is a named constant so
  it is trivially adjustable. Do not add broader names (e.g. `out`, `tmp`)
  without evidence.
- **Ordering/duplication semantics**: the coalescer may reorder an accumulated
  event after later leading-edge events for other targets. Consumers only use
  events for cache invalidation (idempotent, order-insensitive) — verified in
  `invalidateChangedEvents` — so this is safe.
- **Flaky integration test risk**: the optional real-notify test depends on
  watcher attach timing (3 s DB poll) and platform notify backends. Use
  generous sleeps and loose assertions, or `#[ignore]` it; the deterministic
  coalescer unit tests are the required coverage.
- **Frontend timer semantics change**: fixed-window flush means a lone event
  now waits the full 1 s before invalidation (previously also 1 s — unchanged),
  but a *second* event arriving at 900 ms no longer extends the wait — it rides
  the same flush. No consumer depends on the old reset behavior; confirm via
  the existing `fileWatcher.test.ts` expectations when updating them.
- **Parallel-agent constraint for the implementer's environment**: build the
  full app locally (`bun tauri dev`) only outside CI containers; in this
  container, verification is limited to the `-p`-scoped cargo tests and vitest
  as listed above.
