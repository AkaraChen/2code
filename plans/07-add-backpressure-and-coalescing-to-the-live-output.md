# Add backpressure and coalescing to the live-output IPC channel

> The PTY→webview live-output path buffers unboundedly in an in-memory channel (measured +205 MB RSS for a single 200 MB `cat`); replace it with a bounded channel + blocking backpressure and coalesce chunks before IPC send. | Severity: high | Category: memory

## Problem

The live terminal output pipeline is:

```
PTY read thread (std::thread, 4KB reads)          tokio task (per stream)             webview
service/pty.rs::read_pty_output                   handler/pty.rs::stream_pty_output
  └─ emitter.emit_output(bytes)                     └─ receiver.recv().await
       └─ bridge.rs::TauriPtyEmitter::emit_output        └─ on_output.send(chunk)  ──►  xterm.js
            └─ sink.sender.send(bytes.to_vec())               (one IPC msg per ≤4KB chunk)
                 (tokio mpsc UNBOUNDED)
```

Three concrete defects, all in `src-tauri/src/handler/pty.rs` and `src-tauri/src/bridge.rs`:

1. **Unbounded producer→consumer channel.** `attach_pty_output` creates a `tokio::sync::mpsc::unbounded_channel()` (`src-tauri/src/handler/pty.rs:130`); the sink/receiver types are declared unbounded in `src-tauri/src/bridge.rs:13-21` (`mpsc::UnboundedSender<Vec<u8>>` / `mpsc::UnboundedReceiver<Vec<u8>>`). The producer is the PTY read loop (`src-tauri/crates/service/src/pty.rs:611-637`, 4KB buffer at line 594), which calls `emitter.emit_output(&session_id, raw)` at line 631; `TauriPtyEmitter::emit_output` does `sink.sender.send(bytes.to_vec())` (`src-tauri/src/bridge.rs:46-48`) — one heap `Vec` per chunk, no cap, never blocks. A PTY can produce at ~87 MB/s (measured; e.g. `cat` on a large file, runaway log loop). The consumer (`stream_pty_output`, `src-tauri/src/handler/pty.rs:181-185`) drains at whatever rate the webview absorbs IPC messages. Whenever the webview lags — history replay, heavy rendering, minimized-window throttling — the difference accumulates in the channel: RSS grows 1:1 with output volume.

2. **Zero-drain window between attach and stream.** The frontend awaits `attachPtyOutput` (`src/features/terminal/Terminal.tsx:610`) and then fires `streamPtyOutput` **without awaiting** (`Terminal.tsx:615`). The sink is installed and `emit_output` starts queueing the moment attach returns, but nothing drains until the separate `stream_pty_output` invoke actually runs. If the component errors between the two calls, the webview reloads, or `streamPtyOutput` rejects, the sink stays installed in `PtyOutputSinks` and the unbounded queue grows for the *lifetime of the session* (only `emit_exit` at `src-tauri/src/bridge.rs:60-68` or an explicit `detach_pty_output` removes it — and for a terminal app a session lives arbitrarily long).

3. **Chatty IPC.** `stream_pty_output` forwards one IPC `Channel` message per ≤4KB chunk (`src-tauri/src/handler/pty.rs:181-185`). A 100 MB burst is ~25,600 serialized IPC sends when consecutive queued chunks could be concatenated into a few large sends. (Note: measured Rust-side CPU is identical either way — the win, if any, is per-message tauri IPC/webview overhead, which can only be validated in the running app. Treat this as a secondary, low-risk improvement; the bounded channel is the core fix.)

The persistence path is **not** affected: the read loop sends every chunk to the log thread (`src-tauri/crates/service/src/pty.rs:622-629`) *before* calling `emit_output` (line 631), so log completeness is independent of anything we do on the emit side.

## Evidence & Measurements

Code citations (all verified against current source):

- `src-tauri/src/handler/pty.rs:130` — `let (sender, receiver) = mpsc::unbounded_channel();`
- `src-tauri/src/bridge.rs:46-48` — `sinks.get(session_id).is_some_and(|sink| sink.sender.send(bytes.to_vec()).is_err())` (unbounded send from the read thread, one `Vec` copy per chunk)
- `src-tauri/src/handler/pty.rs:181-185` — `while let Some(chunk) = receiver.recv().await { if on_output.send(chunk.as_slice()).is_err() { break; } }` — one IPC send per chunk, no batching
- `src/features/terminal/Terminal.tsx:610-620` — attach awaited, stream fire-and-forget (`void streamPtyOutput({...}).catch(...)`)

Benchmark results (verbatim from the verification run):

Harness: standalone release-build cargo project (deleted after run) replicating production topology byte-for-byte — portable-pty 0.9.0 spawning `sh -c "cat payload"` (200MB base64 text), 4KB read loop copied from service/pty.rs::read_pty_output, emit_output body from bridge.rs (bytes.to_vec() -> tokio 1.52.3 unbounded_channel), stream_pty_output drain loop from handler/pty.rs. Each scenario a separate process; RSS from /proc/self/status. Container: 4 vCPU, 16GB RAM.

1. pty-throughput (producer rate): 200.0 MB in 2.30s = 87.0 MB/s over 141,632 reads (avg chunk 1480 B).
2. baseline-nodrain (attach ran, stream never ran — real code path per Terminal.tsx:610-615): RSS 2.6 -> 208.2 MB (+205.5 MB) in 2.55s; growth 1:1 with produced bytes. After dropping the queued channel, RSS fell to 31.1 MB (allocator kept 28.5 MB) — spike is mostly reclaimable once drained/detached.
3. baseline-slow (unbounded channel, consumer drains at 5ms/msg simulating lagging webview): produced 200.0 MB, consumed 0.5 MB, queued 199.5 MB; RSS 2.6 -> 208.1 MB (+205.5 MB) in 2.5s.
4. bounded-slow (proposed fix: mpsc::channel(1024) ~4MB cap + blocking_send, same 5ms/msg consumer): RSS 2.6 -> 7.8 MB (+5.2 MB), flat over 6s; child stalled by kernel tty backpressure, no data lost. ~40x peak-memory reduction vs baseline; more importantly unbounded -> bounded.
5. coalesce A/B (100MB = 25,600 x 4KB chunks; simulated IPC send = memcpy of payload): per-chunk 25,600 msgs in 0.068-0.074s (1357-1481 MB/s) vs <=256KB-batch 407-663 msgs in 0.072-0.077s (1291-1382 MB/s) — 39-63x fewer messages, ~0% wall-time difference on the Rust side; real IPC/webview serialization cost not measurable headless.

Measured impact: Unbounded channel absorbs full PTY output into RSS at 87 MB/s (+205 MB for one 200MB cat, unbounded worst case); bounded(1024)+blocking_send fix holds RSS flat at +5 MB under identical load with zero data loss.

Key facts to carry into the implementation:

- `blocking_send` on a bounded channel produces *native-terminal semantics*: the read loop stalls, the kernel PTY buffer fills, the child process blocks on `write(2)` — exactly what happens in any terminal when the screen can't keep up. Zero data loss.
- Real PTY read chunks average ~1480 B (not the full 4096), so capacity 1024 messages ≈ 1.5 MB typical, 4 MB hard worst case.
- RSS is mostly returned to the OS after the queue drains/drops, so slow-consumer spikes are transient; the attach-without-stream path is the persistent variant.
- Prefer blocking backpressure over drop-oldest: drop-oldest loses bytes mid-escape-sequence and corrupts the live screen; blocking loses nothing and the log file (written before emit) is complete either way.

## Proposed Change

Strategy: put the new channel plumbing in a **new module in the `infra` crate** (`infra::pty_stream`) so it is unit-testable in CI containers via `cargo test -p infra` (the app crate `src-tauri/src/` cannot be built in containers — missing GTK). `bridge.rs` and `handler/pty.rs` become thin consumers of that module. **No Tauri command signatures change**, so no `cargo tauri-typegen generate` run is needed and zero frontend changes are required.

### Step 1 — `src-tauri/crates/infra/Cargo.toml`: add tokio (sync only)

```toml
[dependencies]
# ... existing deps ...
tokio = { version = "1", features = ["sync"] }
```

The workspace lockfile already pins tokio 1.52.3 (the app crate depends on `tokio = { version = "1", features = ["sync"] }`, see `src-tauri/Cargo.toml:46`), so this adds no new lockfile entry. The `sync` feature alone provides `mpsc::channel`, `blocking_send`, `blocking_recv`, `try_recv`, and `Sender::same_channel` — no runtime features needed in `infra`.

### Step 2 — new file `src-tauri/crates/infra/src/pty_stream.rs`

This module owns the sink/receiver maps (moved from `bridge.rs`), the bounded-channel constants, the backpressure send, and the coalescing drain helper. Register it in `src-tauri/crates/infra/src/lib.rs` (`pub mod pty_stream;`).

```rust
//! Bounded, backpressured live-output channel between the PTY read thread
//! and the per-session IPC stream task.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use tokio::sync::mpsc;

/// Max queued messages between the PTY read thread and the IPC stream task.
/// PTY reads are <=4096 bytes (avg ~1480 B measured), so this bounds the
/// in-flight queue to ~1.5 MB typical / 4 MB worst case per session.
pub const OUTPUT_CHANNEL_CAPACITY: usize = 1024;

/// Max bytes coalesced into a single IPC message by the stream drain loop.
pub const MAX_BATCH_BYTES: usize = 256 * 1024;

pub struct PtyOutputSink {
    pub stream_id: String,
    pub sender: mpsc::Sender<Vec<u8>>,        // NOTE: bounded now
}

pub struct PtyOutputReceiver {
    pub stream_id: String,
    pub receiver: mpsc::Receiver<Vec<u8>>,    // NOTE: bounded now
}

pub type PtyOutputSinks = Arc<Mutex<HashMap<String, PtyOutputSink>>>;
pub type PtyOutputReceivers = Arc<Mutex<HashMap<String, PtyOutputReceiver>>>;

pub fn create_output_sinks() -> PtyOutputSinks {
    Arc::new(Mutex::new(HashMap::new()))
}

pub fn create_output_receivers() -> PtyOutputReceivers {
    Arc::new(Mutex::new(HashMap::new()))
}

/// Create one bounded output channel pair.
pub fn create_output_channel() -> (mpsc::Sender<Vec<u8>>, mpsc::Receiver<Vec<u8>>) {
    mpsc::channel(OUTPUT_CHANNEL_CAPACITY)
}

/// Deliver one PTY chunk to the session's active sink with backpressure.
///
/// MUST be called from a plain OS thread (the PTY read thread), NEVER from
/// inside a tokio runtime — `blocking_send` panics in async context.
///
/// Blocks when the queue is full (native terminal backpressure: the kernel
/// tty buffer then stalls the child). Unblocks with `Err` the moment the
/// receiver is dropped (detach / exit / replaced by a newer attach), at
/// which point the stale sink is pruned.
pub fn send_output(sinks: &PtyOutputSinks, session_id: &str, bytes: &[u8]) {
    // Clone the sender out and RELEASE THE LOCK before any blocking send;
    // holding it would deadlock attach/detach/emit_exit while blocked.
    let sender = {
        let Ok(map) = sinks.lock() else { return };
        map.get(session_id).map(|sink| sink.sender.clone())
    };
    let Some(sender) = sender else { return };

    if sender.blocking_send(bytes.to_vec()).is_err() {
        prune_stale_sink(sinks, session_id, &sender);
    }
}

/// Remove the session's sink only if it is still the same channel we failed
/// to send on. While we were blocked, a new attach may have installed a
/// fresh sink for this session — that one must survive.
pub fn prune_stale_sink(
    sinks: &PtyOutputSinks,
    session_id: &str,
    failed: &mpsc::Sender<Vec<u8>>,
) {
    if let Ok(mut map) = sinks.lock() {
        if map
            .get(session_id)
            .is_some_and(|sink| sink.sender.same_channel(failed))
        {
            map.remove(session_id);
        }
    }
}

/// Coalesce `first` plus any already-queued chunks into `batch`
/// (cleared first), stopping at `max_bytes` or when the queue is empty.
/// Byte order is preserved; concatenation is safe because the frontend
/// (xterm.js) decodes UTF-8 across write boundaries.
pub fn coalesce_chunks(
    batch: &mut Vec<u8>,
    first: Vec<u8>,
    receiver: &mut mpsc::Receiver<Vec<u8>>,
    max_bytes: usize,
) {
    batch.clear();
    batch.extend_from_slice(&first);
    while batch.len() < max_bytes {
        match receiver.try_recv() {
            Ok(next) => batch.extend_from_slice(&next),
            Err(_) => break, // Empty or Disconnected — outer recv() handles both
        }
    }
}
```

Colocate `#[cfg(test)]` tests in the same file (see Verification for the list). Tests must use only `blocking_send` / `blocking_recv` / `try_recv` from plain `std::thread`s so no tokio runtime features are needed.

### Step 3 — `src-tauri/src/bridge.rs`: delegate to `infra::pty_stream`

- Delete the local definitions of `PtyOutputSink`, `PtyOutputReceiver`, `PtyOutputSinks`, `PtyOutputReceivers`, `create_output_sinks`, `create_output_receivers` (currently lines 13-32) and replace with re-exports, so `handler/pty.rs` and `lib.rs` imports keep compiling unchanged:

```rust
pub use infra::pty_stream::{
    create_output_receivers, create_output_sinks, PtyOutputReceiver,
    PtyOutputReceivers, PtyOutputSink, PtyOutputSinks,
};
```

- Rewrite `TauriPtyEmitter::emit_output` (currently `bridge.rs:42-58`) to delegate:

```rust
impl PtyEventEmitter for TauriPtyEmitter {
    fn emit_output(&self, session_id: &str, bytes: &[u8]) -> bool {
        infra::pty_stream::send_output(&self.sinks, session_id, bytes);
        true
    }
    // emit_exit unchanged (bridge.rs:60-68) — it already removes both the
    // sink and receiver, which also unblocks a producer stuck in
    // blocking_send (dropping the receiver fails the send).
}
```

- Remove the now-unused `use tokio::sync::mpsc;` import if nothing else needs it.

### Step 4 — `src-tauri/src/handler/pty.rs`: bounded attach + coalescing stream

- In `attach_pty_output` (line 124), replace line 130:

```rust
// before:
let (sender, receiver) = mpsc::unbounded_channel();
// after:
let (sender, receiver) = infra::pty_stream::create_output_channel();
```

  Drop the `use tokio::sync::mpsc;` import (line 2) if now unused. Everything else in attach stays: `HashMap::insert` replacing an existing entry drops the old sender/receiver, which is exactly what unblocks and prunes a producer stuck on a stale channel.

- In `stream_pty_output`, replace the forward loop (lines 181-185) with a coalescing drain:

```rust
use infra::pty_stream::{coalesce_chunks, MAX_BATCH_BYTES};

let mut batch: Vec<u8> = Vec::with_capacity(MAX_BATCH_BYTES);
while let Some(chunk) = receiver.recv().await {
    coalesce_chunks(&mut batch, chunk, &mut receiver, MAX_BATCH_BYTES);
    if on_output.send(batch.as_slice()).is_err() {
        break;
    }
}
Ok(())
```

  The `Channel<&[u8]>` command signature is unchanged. Under normal interactive load the queue is nearly always empty, so `coalesce_chunks` sends one chunk per message exactly as before; only under bursts does it batch (measured 39-63x fewer messages for a 100 MB burst).

### Step 5 — `src-tauri/crates/service/src/lib.rs`: document the blocking contract

Extend the `PtyEventEmitter` doc comment (lines 11-16):

```rust
/// Trait for emitting PTY events to the frontend.
/// Implemented by the app layer (Tauri bridge).
pub trait PtyEventEmitter: Send + Sync + 'static {
    /// Emit terminal output bytes to the frontend for the given session.
    ///
    /// May BLOCK when the frontend consumer lags (bounded-channel
    /// backpressure). Must only be called from a dedicated OS thread —
    /// never from within a tokio runtime. Today the sole caller is the
    /// PTY read thread (service::pty::read_pty_output).
    fn emit_output(&self, session_id: &str, bytes: &[u8]) -> bool;
    /// Emit session exit signal.
    fn emit_exit(&self, session_id: &str);
}
```

No behavior change in `service` — `read_pty_output` already runs on a plain `std::thread` and already writes each chunk to the persistence channel (`service/pty.rs:622-629`) *before* `emit_output` (line 631), so blocking on emit never delays or loses logged bytes.

### Step 6 — frontend: no changes

`Terminal.tsx` needs no edits. The attach→stream gap (defect 2) is defused rather than eliminated: if `streamPtyOutput` never runs, the queue now caps at `OUTPUT_CHANNEL_CAPACITY` messages (~1.5-4 MB) and the child stalls via kernel tty backpressure — identical to a native terminal whose reader stopped — and self-heals on `detachPtyOutput` (ref cleanup at `Terminal.tsx:684`), on a fresh `attachPtyOutput` (remount replaces the channel), or on session exit (`emit_exit`). This is the intended design, not a leftover bug; note it in the PR description.

### Explicitly rejected alternatives (do not "improve" toward these)

- **Drop-oldest on full**: corrupts the live screen mid-escape-sequence and needs a truncation marker; blocking loses nothing and was measured to hold RSS flat with zero data loss.
- **Eliminating `attach_pty_output` and letting `stream_pty_output` install the sink**: the frontend relies on attach completing *before* it fetches history (`Terminal.tsx:610` awaits attach, then history at 646-649) so no output is missed; a long-running stream command can't signal "sink installed" without a new side channel. Out of scope.
- **Timer-based batching (e.g. wait 5 ms to fill a batch)**: adds latency to interactive keystroke echo. `try_recv`-only draining adds zero latency.

## Verification

All commands below work in CI containers. **Never** run plain `cargo build`/`cargo test` (no `-p`) or any `bun tauri ...` — the full tauri app cannot build here (missing GTK libs).

### New unit tests (in `src-tauri/crates/infra/src/pty_stream.rs`, `#[cfg(test)] mod tests`)

Use only `std::thread` + `blocking_send`/`blocking_recv`/`try_recv` (no `#[tokio::test]`, no runtime):

1. `bounded_channel_applies_backpressure_without_loss` — channel from `create_output_channel()` but with a small capacity (e.g. `mpsc::channel(4)`); spawn a producer thread that `blocking_send`s 100 numbered chunks; main thread sleeps ~50 ms (letting the producer fill and block), then drains with `blocking_recv`; assert all 100 chunks arrive in order and the producer thread joins.
2. `blocked_producer_unblocks_when_receiver_drops` — fill a capacity-1 channel, spawn a thread stuck in `blocking_send`, drop the receiver, assert the thread joins promptly and the send returned `Err`.
3. `send_output_is_noop_without_sink` — empty sinks map; `send_output` returns without panicking or inserting anything.
4. `send_output_prunes_sink_after_receiver_drop` — insert a sink, drop its receiver, call `send_output`; assert the map no longer contains the session.
5. `prune_stale_sink_spares_replacement` — create channel A, insert sink A, keep a clone of sender A, then replace the map entry with sink B (fresh channel); call `prune_stale_sink(&sinks, id, &sender_a)`; assert sink B is still present (`same_channel` guard).
6. `send_output_does_not_hold_lock_while_blocked` — capacity-1 channel, sink installed, queue pre-filled; spawn a thread calling `send_output` (which blocks); after a short sleep assert the main thread can still acquire `sinks.lock()` (e.g. do a `try_lock`-style check by locking with a timeout pattern: spawn another thread that locks and sends a signal); then drop the receiver to release everything.
7. `coalesce_chunks_single_chunk_passthrough` — empty queue: batch equals the first chunk.
8. `coalesce_chunks_concatenates_in_order` — queue 3 chunks, call with a 4th as `first`; batch is the exact concatenation `first ++ q1 ++ q2 ++ q3`.
9. `coalesce_chunks_respects_max_bytes` — queue chunks summing past `max_bytes`; assert the batch stops at/just past the boundary (the loop checks *before* pulling, so the batch may exceed `max_bytes` by at most one chunk ≤4096 B — assert `batch.len() < max_bytes + 4096`) and the remaining chunk is still retrievable via `try_recv`.
10. `coalesce_chunks_handles_disconnected_sender` — drop the sender mid-queue; drain must not panic and must return the queued bytes.

### Commands

```bash
# 1. Full workspace-crate test suite (must stay green; 151 tests pre-change, more after):
cd /home/user/2code/src-tauri && cargo test -p model -p repo -p service -p infra

# 2. Just the new module:
cd /home/user/2code/src-tauri && cargo test -p infra pty_stream

# 3. Frontend regression (Terminal.test.tsx mocks attach/stream/detach — signatures
#    unchanged, so 671 tests must still pass):
cd /home/user/2code && bunx vitest run src/features/terminal
# or the full suite:
cd /home/user/2code && bunx vitest run
```

The app crate (`bridge.rs`, `handler/pty.rs`) cannot be compiled in the container. Keep those diffs minimal and mechanical (they are: one constructor call, one re-export block, one delegation, one drain loop). Type-correctness is guaranteed by mirroring the `infra::pty_stream` signatures, which *are* compiled and tested via `cargo test -p infra`.

### Existing coverage of the area

- `src-tauri/tests/integration_pty_db.rs` — has a `TestPtyEmitter` implementing `PtyEventEmitter` (line 34); it is signature-compatible with the unchanged trait, but it lives in the app crate's `tests/` so it only runs on a dev machine, not in containers.
- `src/features/terminal/Terminal.test.tsx` — mocks `attachPtyOutput`/`streamPtyOutput`/`detachPtyOutput` (lines 127-139); exercises the frontend ordering (attach → stream → history) that the fix preserves.
- Service-crate PTY tests (read-loop helpers, persistence, restore) run via `cargo test -p service` and are unaffected.

### On a dev machine (not CI — requires display/GTK or macOS)

1. `cd src-tauri && cargo check` — confirms the app crate (bridge/handler) compiles.
2. `cargo test` (full, including `integration_pty_db.rs`).
3. `bun tauri dev`, then in a terminal tab:
   - `base64 /dev/urandom | head -c 200000000 > /tmp/big.txt && cat /tmp/big.txt` — watch app RSS (Activity Monitor / `ps`): it must stay roughly flat (was: +200 MB spike). Output must render completely and `Ctrl+C` must remain responsive mid-stream.
   - `yes "$(printf 'x%.0s' {1..200})"` for 10 s, then Ctrl+C — no dropped/garbled screen content, CJK/emoji output (`cat` a UTF-8 heavy file) renders without mojibake (verifies byte-boundary-safe coalescing).
   - Switch tabs / minimize the window during a big `cat`, restore — output resumes, memory flat.
   - Close a tab mid-`cat` (exercises detach-while-producer-blocked) — no hang, session cleans up.
4. Optional (validates the coalescing win that could not be measured headless): add a temporary `tracing::trace!` counter of IPC sends in `stream_pty_output` and compare per-chunk vs batched message counts for a 100 MB `cat`.

## Risks & Constraints

CLAUDE.md invariants that this change must respect (and does):

- **"PTY output sends `&[u8]` over a per-session IPC `Channel`; xterm.js handles UTF-8 decoding across chunk boundaries — no backend boundary splitting."** Coalescing only *concatenates* whole chunks in order; it never splits or decodes bytes, so multibyte sequences stay intact regardless of where batch boundaries fall.
- **`detach_pty_output` must pass the same `streamId` so stale React cleanup cannot remove a newer stream** — the stream_id guards in attach/stream/detach (`handler/pty.rs:170-172, 198-203, 207-211`) are untouched.
- **Generated bindings**: no command signature changes ⇒ no `cargo tauri-typegen generate` needed, `src/generated/` untouched.
- **Layering**: channel mechanics go to `infra` (cross-cutting IO plumbing), handlers stay thin, no business logic added to `handler/` — consistent with the handler/service/repo/infra split.
- Do not touch `project.inlang/settings.json`, `src/paraglide/`, or `src-tauri/src/schema.rs`.

Regression risks and mitigations:

1. **Deadlock if `blocking_send` is called while holding the sinks mutex.** `emit_exit`, `attach_pty_output`, and `detach_pty_output` all take that lock; a producer blocked *inside* the lock would freeze them forever. Mitigation is structural: `send_output` clones the sender out and drops the lock before sending (Step 2), and test 6 pins this.
2. **`blocking_send` panics inside a tokio runtime.** `emit_output` is only called from the PTY read thread (a plain `std::thread`, `service/pty.rs:611-637`) — safe today. The trait doc added in Step 5 makes the constraint explicit so a future caller from async context doesn't reintroduce it silently.
3. **Blocked producer must always be releasable.** Every path that removes the receiver unblocks the producer with `Err`: `detach_pty_output` removes the receiver (handler/pty.rs:206-212), `emit_exit` removes both (bridge.rs:60-68), a re-attach's `HashMap::insert` drops the old pair, and a finished `stream_pty_output` drops its claimed receiver on return. After `Err`, `prune_stale_sink` uses `same_channel` so it never evicts a *newer* sink installed while the producer was blocked.
4. **Child processes now stall when the UI can't keep up.** This is the intended native-terminal semantics (measured: kernel tty buffer absorbs, zero loss), but it is a behavior change: a session whose sink is attached with no drain (frontend bug/reload race) stalls the child until detach/re-attach/exit instead of ballooning RSS. If a hung-child report ever traces here, the escape hatch is capacity tuning, not unbounded again.
5. **Latency**: `coalesce_chunks` uses only `try_recv` (never waits), so interactive echo latency is unchanged; the first chunk after idle is sent immediately.
6. **Do not justify or extend coalescing based on Rust-side CPU** — measured wall-time identical (1357 vs 1291 MB/s). Its only benefit is per-message IPC overhead reduction (25,600 → ~500 messages per 100 MB), which must be validated in the running app (dev-machine step 4). If it causes any rendering anomaly, the bounded channel works standalone: revert Step 4's drain loop to the simple per-chunk forward and keep everything else.
7. **Capacity math is in messages, not bytes** — real chunks average ~1480 B, so 1024 messages ≈ 1.5 MB typical / 4 MB hard cap. If precise byte budgeting is ever needed, switch to a byte-counted semaphore; not required now.
