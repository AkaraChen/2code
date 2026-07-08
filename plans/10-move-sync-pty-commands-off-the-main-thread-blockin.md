# Move sync PTY commands off the main thread (blocking PTY/DB/flush I/O per keystroke, resize, and mount)

> A PTY child that stops reading stdin can permanently freeze the entire UI event loop (and all other terminals) via a sync `write_to_pty`; sync `resize_pty`/`close_pty_session` transfer any DB-mutex hold 1:1 into main-thread stalls. | Severity: high | Category: performance

## Problem

Tauri 2 executes non-`async` `#[tauri::command]` functions **inline on the event-loop (main) thread** inside the webview IPC handler (verified in tauri-macros 2.x `wrapper.rs`: `ExecutionContext::Blocking` → kind `"sync"` runs inline; wry's `ipc_handler` is a non-`Send` `Box<dyn Fn(Request<String>)>` on the event loop; tauri 2.11.2 `src/ipc/protocol.rs::handle_ipc_message` contains no spawn). Several hot PTY commands in this app are sync and do blocking I/O:

- **`write_to_pty`** — `src-tauri/src/handler/pty.rs:27-35` is a sync command; it calls `infra::pty::write_to_pty` (`src-tauri/crates/infra/src/pty.rs:243-263`), which holds the **global sessions map mutex** (`sessions.lock()` at pty.rs:248) across `writer.write_all(data)` + `writer.flush()` on the PTY master fd. It fires on **every keystroke and paste** (`term.onData` → `writeToPty` at `src/features/terminal/Terminal.tsx:666-673`). If the child stops reading stdin (stopped process, Ctrl+S, `sleep`-style tool) the kernel PTY buffer fills after ~18KB and `write_all` blocks **forever inside kernel `n_tty_write` on the main thread while holding the global sessions mutex** — freezing the whole UI and blocking every other session's writes/resizes/closes. Measured: SIGKILLing the wedged child does **not** wake the blocked write; only draining the slave or tearing down the master does. `close_pty_session` cannot recover it because it needs the same mutex.
- **`resize_pty`** — `src-tauri/src/handler/pty.rs:37-52` is sync; after the (cheap) PTY ioctl it acquires the **single global DB mutex** (`db.lock()` at pty.rs:48) and runs a SQLite UPDATE + WAL I/O (`repo::pty::update_dimensions`, pty.rs:49) on the main thread. Measured 1.06ms mean / 4.2ms p99 / 8.5ms max per UPDATE (`synchronous=FULL`), and — worse — `db.lock()` waits transfer **1:1** into main-thread stalls: any blocking-pool task holding the DB lock (git/filesystem handlers can hold it for seconds) stalls the UI for the full remaining hold. Note: the frontend already debounces resizes 75ms trailing (`src/features/terminal/lib/resizeScheduler.ts:4`, `RESIZE_DEBOUNCE_MS = 75`), so this is not "dozens per second", but each firing calls `resizePty` **twice** (`Terminal.tsx:674-676` `term.onResize` fires during `fit()`, then the scheduler callback at `Terminal.tsx:526` fires again with the same dims).
- **`close_pty_session`** — `src-tauri/src/handler/pty.rs:54-62` is sync; `infra::pty::close_session` (`src-tauri/crates/infra/src/pty.rs:289-299`) does `child.kill()` + `child.wait()` **while holding the sessions map mutex**, plus a DB write (`repo::pty::mark_closed` via `service::pty::close_session`, `src-tauri/crates/service/src/pty.rs:408-421`) — all on the main thread.
- **`flush_pty_output`** — `src-tauri/src/handler/pty.rs:216-223` is sync and can block up to `PERSIST_FLUSH_TIMEOUT = 1s` (`src-tauri/crates/service/src/pty.rs:61`, `flush_output` at :515-531 waits on `done_rx.recv_timeout`). The frontend awaits it on every terminal mount (`Terminal.tsx:647`) and fires it on every cleanup (`Terminal.tsx:687`). Measured round-trips are actually fast (p99 ~4ms even under a 6.4MB/s output flood), so this is a **hygiene** fix (a tail-latency/timeout bound on the main thread), not a steady-state win.
- **`clear_pty_output`** — `src-tauri/src/handler/pty.rs:225-233` is sync and can truncate a log file on the main thread (`service::pty::clear_output`, service/pty.rs:533-552).
- **`play_system_sound`** — `src-tauri/src/handler/sound.rs:45-48` is sync; on Linux it recursively walks all XDG sound dirs per invocation (`find_linux_sound_file`, sound.rs:211-251) and spawns a player process; it is triggered by agent-status transitions during normal use. (Unmeasured in the container; macOS path is stat + `afplay` spawn, ~1ms class. Low priority.)

Other handlers in the same file already use the `super::run_blocking` pattern (`src-tauri/src/handler/mod.rs:17-29`, wraps `tauri::async_runtime::spawn_blocking`) — e.g. `create_pty_session` at handler/pty.rs:13-25. The sync ones above are the exceptions. `attach_pty_output` (handler/pty.rs:122-154) and `detach_pty_output` (:189-214) are also sync but only touch in-memory maps with short-held locks — **leave them as-is**.

## Evidence & Measurements

Verbatim benchmark results (release build, real PTYs via portable-pty, file-backed WAL SQLite via `infra::db::init_db` in a tempdir; harness was a temporary integration test in `src-tauri/crates/service/tests/`, since deleted; `cargo test -p service --release -- --test-threads=1 --nocapture`; Linux 6.18.5 container):

- **[A] resize_pty DB write** (`repo::pty::update_dimensions`, 1000 calls after 50 warmup, `PRAGMA synchronous=2/FULL`): mean=1.061ms p50=784us p99=4.245ms max=8.55ms. (dev profile: mean=1.78ms p50=1.77ms p99=3.69ms.)
- **[B] flush_output round-trip**, 200 calls each: idle session p50=71us p99=4.09ms max=4.25ms; under `yes` flood (log grew 12,839,076 bytes in ~2s, ~6.4MB/s through the 4KB-read + persist pipeline) p50=34us p99=3.34ms max=3.56ms — never near the 1s timeout.
- **[C] write_to_pty per keystroke** (cat child, 5000 writes): mean=559ns p50=540ns p99=698ns max=17us.
- **[D] blocking hazard** (child `sleep 300` never reads stdin): kernel accepted exactly 18,432 bytes of newline-terminated input before `write_all` blocked; healthy session B's 1-byte write still blocked after 1s = true; B's write completed only after force-draining the slave, elapsed 1.008s = full mutex hold. Dev-run /proc thread-stack dump confirmed the blocked thread sat in kernel `n_tty_write` and SIGKILL of the child did NOT wake it (stayed blocked >5min until process killed).
- **[E] DB mutex contention**: main-thread-style `db.lock()` waited 252.1ms behind a thread holding the lock for 300ms (acquired 50ms in) — 1:1 stall transfer.

Interpretation: the fix is justified by **[D] + [E]** (unbounded main-thread freeze and 1:1 stall transfer), not by steady-state cost — [B]/[C] show the happy paths are sub-microsecond-to-0.1ms. Do not claim throughput improvements.

## Proposed Change

Two independent pieces: (1) restructure the PTY write path in `infra` so no command ever blocks on the PTY fd and the sessions map mutex is never held across blocking I/O; (2) make the remaining offending commands async via the existing `super::run_blocking` pattern. Plus a small optional frontend dedupe.

Design decision for `write_to_pty` (important): do **not** simply route it through `spawn_blocking`. Keystroke writes must stay FIFO — separate `spawn_blocking` tasks can be picked up by different pool threads and race, transposing input bytes. Instead give each session a dedicated writer thread fed by an `std::sync::mpsc` channel: the command stays **sync** (so it executes inline, in IPC arrival order, preserving FIFO) but becomes non-blocking — it only locks the map briefly, clones the sender, and enqueues. A wedged session then blocks only its own writer thread, never the UI and never other sessions.

### Step 1 — `src-tauri/crates/infra/src/pty.rs`: per-session writer thread

1a. Change `PtySession` (lines 13-17) to hold an input sender instead of the writer:

```rust
pub struct PtySession {
    pub master: Box<dyn MasterPty + Send>,
    pub input_tx: std::sync::mpsc::Sender<Vec<u8>>,
    pub child: Box<dyn portable_pty::Child + Send + Sync>,
}
```

1b. In `create_session` (the `take_writer()` block at lines 100-114), after taking the writer, spawn a detached writer thread and store the sender:

```rust
let mut writer = pair
    .master
    .take_writer()
    .map_err(|e| AppError::PtyError(e.to_string()))?;

let (input_tx, input_rx) = std::sync::mpsc::channel::<Vec<u8>>();
let writer_session_id = options.session_id.to_string();
std::thread::spawn(move || {
    while let Ok(data) = input_rx.recv() {
        if let Err(e) = writer.write_all(&data).and_then(|_| writer.flush()) {
            tracing::warn!(target: "pty", session_id = %writer_session_id, error = %e, "input writer: write failed, stopping");
            break; // receiver drops; subsequent sends fail and surface as errors
        }
    }
});

let session = PtySession { master: pair.master, input_tx, child };
```

Do not register these threads in `PtyReadThreads` — that tracker exists to guarantee persistence flush on exit (pty.rs:20-22); writer threads have nothing to flush and exit naturally when the channel disconnects (session removed from map → `input_tx` dropped) or when the process exits.

1c. Rewrite `write_to_pty` (lines 243-263) to enqueue without holding the map lock across I/O:

```rust
pub fn write_to_pty(
    sessions: &PtySessionMap,
    session_id: &str,
    data: &[u8],
) -> Result<(), AppError> {
    let tx = {
        let map = sessions.lock().map_err(|_| AppError::LockError)?;
        map.get(session_id)
            .ok_or_else(|| {
                AppError::PtyError(format!("Session not found: {}", session_id))
            })?
            .input_tx
            .clone()
    }; // map lock released before send
    tx.send(data.to_vec()).map_err(|_| {
        AppError::PtyError(format!("Session input closed: {}", session_id))
    })
}
```

Signature is unchanged, so the caller in `service::pty::create_session` (startup-commands injection, `src-tauri/crates/service/src/pty.rs:350-354`) and the existing test `write_to_nonexistent_session_returns_error` (infra/pty.rs:321-328) keep working. Note `get_mut` becomes `get`.

1d. Rework `close_session` (lines 289-299) and `close_all_sessions` (lines 301-308) so `child.kill()`/`child.wait()` happen **outside** the map lock, and so closing never needs anything a wedged writer holds:

```rust
pub fn close_session(
    sessions: &PtySessionMap,
    session_id: &str,
) -> Result<(), AppError> {
    let session = {
        let mut map = sessions.lock().map_err(|_| AppError::LockError)?;
        map.remove(session_id)
    };
    if let Some(mut session) = session {
        let _ = session.child.kill();
        let _ = session.child.wait();
        // drop(session) closes the master and input_tx here
    }
    Ok(())
}

pub fn close_all_sessions(sessions: &PtySessionMap) {
    let drained: Vec<(String, PtySession)> = match sessions.lock() {
        Ok(mut map) => map.drain().collect(),
        Err(_) => return,
    };
    for (_, mut session) in drained {
        let _ = session.child.kill();
        let _ = session.child.wait();
    }
}
```

Known residual (accepted, document in a code comment): a writer thread blocked in kernel `n_tty_write` may not wake even after `close_session` drops the master (portable-pty's writer holds its own dup of the master fd, and measurement showed child SIGKILL does not wake it). Worst case is one leaked OS thread + its queued bytes per wedged session until process exit — bounded and invisible to the user, versus today's permanent whole-app freeze. Verify actual wake behavior once on a dev machine (see Verification).

### Step 2 — `src-tauri/src/handler/pty.rs`: async-ify the remaining blockers

Follow the existing `create_pty_session` pattern (handler/pty.rs:13-25). `State<'_, T>` cannot move into the closure — clone the inner `Arc` first via `.inner().clone()`. All these already return `Result`, which Tauri requires for async commands with `State`.

2a. `resize_pty` (lines 37-52): keep the ioctl inline (it is a cheap, non-blocking `TIOCSWINSZ`, and inline execution preserves ordering), but move the DB UPDATE off the main thread as fire-and-forget:

```rust
#[tauri::command]
#[tracing::instrument(skip_all)]
pub fn resize_pty(
    sessions: State<'_, PtySessionMap>,
    db: State<'_, DbPool>,
    session_id: String,
    rows: u16,
    cols: u16,
) -> Result<(), AppError> {
    session::resize_pty(&sessions, &session_id, rows, cols)?;

    let db = db.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        if let Ok(mut conn) = db.lock() {
            repo::pty::update_dimensions(&mut conn, &session_id, cols, rows);
        }
    });

    Ok(())
}
```

Fire-and-forget is safe: `update_dimensions` (`src-tauri/crates/repo/src/pty.rs:64-89`) already logs-and-swallows failures and returns `()`, and the value is only cosmetic restore metadata. (Do NOT make the whole command async: two in-flight async resizes could apply ioctls out of order and leave the wrong final size; inline-sync + offloaded DB write keeps ioctl ordering and removes the main-thread DB hazard, which is the measured problem — [A] and [E].)

2b. `close_pty_session` (lines 54-62) → async + `run_blocking`:

```rust
#[tauri::command]
#[tracing::instrument(skip_all)]
pub async fn close_pty_session(
    db: State<'_, DbPool>,
    sessions: State<'_, PtySessionMap>,
    session_id: String,
) -> Result<(), AppError> {
    let db = db.inner().clone();
    let sessions = sessions.inner().clone();
    super::run_blocking(move || {
        service::pty::close_session(&db, &sessions, &session_id)
    })
    .await
}
```

2c. `flush_pty_output` (lines 216-223) → async + `run_blocking` (hygiene; caps the mount-path main-thread exposure at ~0 instead of a 1s timeout bound):

```rust
#[tauri::command]
#[tracing::instrument(skip_all)]
pub async fn flush_pty_output(
    session_id: String,
    state: State<'_, PtyFlushSenders>,
) -> Result<(), AppError> {
    let senders = state.inner().clone();
    super::run_blocking(move || {
        service::pty::flush_output(&senders, &session_id)
    })
    .await
}
```

2d. `clear_pty_output` (lines 225-233) → same treatment (clone `log_dir.0` and the `PtyFlushSenders` Arc into the closure, call `service::pty::clear_output`).

2e. `write_to_pty` (lines 27-35): **leave the handler sync** — after Step 1 it is a µs-class enqueue, and staying sync preserves keystroke FIFO order (see design decision above). No handler change needed.

No changes to `service::pty::close_session`, `flush_output`, or `clear_output` bodies; no changes to the output path (`attach_pty_output` / `stream_pty_output` / `detach_pty_output` / persistence thread).

### Step 3 — `src-tauri/src/handler/sound.rs`: `play_system_sound` off the main thread

`play_system_sound` (lines 45-48) returns `Result<(), String>`, so it can't use `super::run_blocking` (which is `AppError`-typed). Inline the equivalent:

```rust
#[tauri::command]
pub async fn play_system_sound(name: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || play_sound_name(&name))
        .await
        .map_err(|e| format!("Sound task failed: {e}"))?
}
```

Optionally do the same for `list_system_sounds` (lines 14-17) — its first invocation walks sound dirs before the `OnceLock` caches (sound.rs:12, 19-43) — but it is called once from settings UI, so this is truly optional.

### Step 4 (optional, frontend) — dedupe the double `resizePty` per fit

In `src/features/terminal/Terminal.tsx`, each geometry change currently invokes `resizePty` twice with identical dims (`term.onResize` at :674-676 fires during `fit()`, then the scheduler callback at :526; the font-settle refit at :508-519 has the same duplication). Inside the ref-callback closure, add:

```ts
let lastSentResize: { rows: number; cols: number } | null = null;
const sendResize = (rows: number, cols: number) => {
  if (lastSentResize?.rows === rows && lastSentResize?.cols === cols) return;
  lastSentResize = { rows, cols };
  resizePty({ sessionId, rows, cols });
};
```

and replace the raw `resizePty({ sessionId, rows: term.rows, cols: term.cols })` calls at lines 504, 514, 518, 526 and 675 with `sendResize(...)`. This halves resize IPC/DB traffic; behavior is otherwise identical (the "forced" call at :518 is correctly skipped only when those exact dims were already sent).

### Step 5 — bindings

Command names, parameters, and return types are all unchanged, so `src/generated/` bindings are unaffected (`invoke` is promise-based regardless of sync/async on the Rust side). Running `cargo tauri-typegen generate` is not required for this change; if you run it anyway on a dev machine, expect a no-op diff. No `lib.rs` registration changes (`src-tauri/src/lib.rs:76` list is untouched).

## Verification

Environment constraint: the app crate (`code`) does **not** build in CI containers (missing GTK). Never run plain `cargo build`/`cargo test`/`cargo check` without `-p` flags, and never `bun tauri ...` in the container. Handler-layer changes (Steps 2-3) and `src-tauri/tests/pty_test.rs` can only be compile-checked/run on a dev machine.

Container-verifiable:

```bash
cd /home/user/2code/src-tauri && cargo test -p model -p repo -p service -p infra
```

Baseline is 151 passing tests; all must still pass (notably `infra::pty::tests::write_to_nonexistent_session_returns_error`, `close_nonexistent_session_is_ok`, and the `service::pty` persistence tests, which exercise the unchanged flush pipeline).

New tests to add in `src-tauri/crates/infra/src/pty.rs` `#[cfg(test)]` (guard with `#[cfg(unix)]`; real PTYs work in the container):

1. **`wedged_session_does_not_block_map_or_other_sessions`** — regression test for the core freeze. Create session A with `shell: "sleep 300"` (child never reads stdin; `ShellInjection::None`) and session B with `shell: "cat"`. Call `write_to_pty(A, 64KB of b"x\n")` — must return `Ok` in well under 100ms (it only enqueues; the writer thread is what wedges after ~18KB). Then assert `write_to_pty(B, b"hi")` returns quickly and `sessions.lock()` is immediately acquirable. Finally assert `close_session(&sessions, A)` returns within ~1s (SIGKILL of `sleep` + `wait` succeed; the wedged writer thread must not be on close's critical path). Before this change, the B-write/close steps deadlock-block — this test would hang.
2. **`writes_preserve_fifo_order`** — create a `cat` session, call `write_to_pty` 26 times with `b"a"`..`b"z"`, read from `master.try_clone_reader()` (session must be fetched-then-released, or take the reader at creation) until 26+ bytes arrive, and assert `abcdefghijklmnopqrstuvwxyz` appears as an in-order subsequence of the output (tty echo preserves order).
3. **`write_after_writer_thread_death_returns_error`** — create a session, `close_session` it, keep a pre-close clone of nothing (session is gone from map) — simpler: assert post-close `write_to_pty` returns the "Session not found" error (existing behavior). Additionally, to cover the send-error branch, create a session, extract `input_tx`... (if awkward, a direct unit test on the channel-disconnect path is sufficient: drop the receiver and assert `tx.send` maps to `AppError::PtyError("Session input closed...")` via the function under test with a hand-built map entry — or skip and rely on branch 1).

Useful trick if a test needs to deterministically **unblock** a wedged writer: read the pts path from `/proc/<child_pid>/fd/0` and drain it from a helper thread.

Frontend (container-verifiable):

```bash
cd /home/user/2code && bunx vitest run src/features/terminal
```

All existing terminal tests must pass (671 total frontend tests baseline). If Step 4 is implemented, extend `src/features/terminal/Terminal.test.tsx` (or a new colocated test) to mock `resizePty` and assert only one IPC call per unique dims.

Dev-machine (manual, required before merging):

1. `cd src-tauri && cargo check` (full workspace incl. app crate), then `bun tauri dev`.
2. Smoke: type in a terminal (input echoes, ordering correct incl. fast typing/IME), paste a large block, resize the window (dims persist across restart), close tabs, agent-notification sound still plays.
3. **The headline repro**: in terminal 1 run `sleep 300`, then paste >18KB of text into it. Before the fix: entire app freezes permanently. After: UI stays responsive, terminal 2 keeps working, and closing terminal 1's tab succeeds. While there, observe whether the wedged writer thread exits after close (log line "input writer: write failed" or thread count) to confirm/deny the master-drop-wakes-writer question from Step 1d.

## Risks & Constraints

- **CLAUDE.md invariants**: DB is a single `Arc<Mutex<SqliteConnection>>` — the fire-and-forget resize UPDATE must acquire/release it fast (it does: one UPDATE) and never hold it across other work. Handlers stay thin (all logic changes are in `infra`). Do not touch `src/generated/` or `src-tauri/src/schema.rs`. Do not modify the PTY **output** path (per-session IPC `Channel<&[u8]>`, persistence thread, `pty_log`) — this plan only touches the input/resize/close/flush command paths. Terminals' CSS-display persistence and the `attach/detach` stream_id discipline are untouched.
- **Keystroke ordering** is the main regression risk of naive fixes; the per-session writer thread + sync enqueue design exists specifically to keep FIFO. If a reviewer swaps `write_to_pty` to `async` + `spawn_blocking`, ordering is no longer guaranteed — don't.
- **Error-reporting semantics change slightly** for `write_to_pty`: fd write errors are now reported asynchronously (writer thread logs; the *next* write returns `Err("Session input closed")`) instead of synchronously on the failing call. The frontend only `consola.warn`s these (`Terminal.tsx:667-672`), so no UX change.
- **Unbounded input queue**: a wedged session buffers enqueued input in memory. Bounded in practice by what a user types/pastes; if paranoid, cap the channel by tracking queued bytes and dropping past a few MB — not required.
- **Leaked writer thread per wedged session** until process exit if dropping the master does not wake the blocked kernel write (measurement suggests it may not). Bounded, invisible, and strictly better than today's permanent UI freeze. `close_session` and `close_all_sessions` never depend on the writer thread.
- **`close_all_sessions` on exit**: kill/wait now happens after releasing the map lock; app-exit path (`mark_all_closed` + `join_all_read_threads`) is unaffected because read/persist threads are tracked separately (`PtyReadThreads`, infra/pty.rs:20-22).
- **Resize persistence is now best-effort async**: a crash in the milliseconds after a resize could lose the last dims row update — cosmetic only (restore geometry), same tolerance as the existing swallow-errors `update_dimensions`.
- **Do not oversell**: flush_pty_output p99 is ~4ms and write_to_pty happy path is 559ns — this change removes a freeze/stall *hazard*; steady-state latency is unchanged (spawn_blocking adds tens-of-µs dispatch to close/flush, which is fine).
- **`cargo tauri-typegen generate` / full builds cannot run in CI containers** (GTK missing); dev-machine verification is mandatory for the handler and sound changes.
