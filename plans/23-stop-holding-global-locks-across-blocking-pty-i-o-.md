# Stop holding global locks across blocking PTY I/O in sync commands

> One wedged terminal (paste into a Ctrl+Z'd/non-reading session) blocks writes, resizes, and close for ALL terminals — permanently — because the single global PTY map mutex is held across a blocking kernel write; fix by giving each session its own writer lock and moving the blocking PTY commands onto the blocking pool. | Severity: high | Category: correctness

## Problem

All live PTY sessions are stored in one global map guarded by one mutex:

- `src-tauri/crates/infra/src/pty.rs:13-19` — `PtySession { master, writer: Box<dyn Write + Send>, child }` and `pub type PtySessionMap = Arc<Mutex<HashMap<String, PtySession>>>`.

`write_to_pty` holds that global mutex for the entire duration of the write:

- `src-tauri/crates/infra/src/pty.rs:243-263` — `let mut map = sessions.lock()...` at line 248, then `session.writer.write_all(data)` (253-256) and `session.writer.flush()` (257-260) while the map guard is still alive.

A write to a PTY master blocks in the kernel when the tty input queue is full (~4KB queue; writes >4-64KB reliably fill it) and the foreground process is not reading stdin — e.g. the user pastes a large clipboard into a session whose shell/program is stopped (Ctrl+Z), sitting at a debugger breakpoint, or otherwise not draining input. While that write is blocked **inside the kernel**, the one mutex guarding every session is held, so:

- `write_to_pty` for every *other* healthy terminal blocks (line 248).
- `resize_pty` blocks (`src-tauri/crates/infra/src/pty.rs:265-287`, lock at 271).
- `close_session` blocks (`src-tauri/crates/infra/src/pty.rs:289-299`, lock at 293) — the app cannot even kill the offending child, because killing it requires the same lock.
- `close_all_sessions` (`src-tauri/crates/infra/src/pty.rs:301-308`), called on app exit from `src-tauri/src/lib.rs:160`, hangs shutdown.

Empirically (see Evidence) this deadlock is **unrecoverable**: even SIGKILLing the wedged child does not wake a write blocked in `n_tty_write` while master-side fds remain open, so under the current code the global lock is held forever and every PTY command in the app deadlocks permanently.

Compounding problem — these commands run synchronously on Tauri's command-dispatch thread. Unlike `create_pty_session` / `restore_pty_session` / `list_project_sessions` / `get_pty_session_history` / `delete_pty_session_record`, which all use `super::run_blocking` (`src-tauri/src/handler/mod.rs:17-29`), the following are plain sync `pub fn` commands in `src-tauri/src/handler/pty.rs`:

- `write_to_pty` — lines 27-35 (potentially unbounded kernel block, as above).
- `resize_pty` — lines 37-52; additionally takes the **global DB mutex** synchronously at line 48 (`db.lock()`), so a resize during any long-running DB operation stalls the dispatch thread too.
- `close_pty_session` — lines 54-62; does `child.kill()` + `child.wait()` under the map lock (~200ms measured for a stopped child) plus a DB lock inside `service::pty::close_session` (`src-tauri/crates/service/src/pty.rs:408-421`).
- `flush_pty_output` — lines 216-223; delegates to `service::pty::flush_output` (`src-tauri/crates/service/src/pty.rs:515-531`) which blocks up to `PERSIST_FLUSH_TIMEOUT = 1s` on `done_rx.recv_timeout` (constant at `src-tauri/crates/service/src/pty.rs:61`, wait at 525-528). The frontend calls this on **every terminal attach and teardown** (`src/features/terminal/Terminal.tsx:647` and `:687`).
- `clear_pty_output` — lines 225-233.

## Evidence & Measurements

Verified benchmark results (real `infra::pty` sessions, reproduced against production code):

> Setup: real infra::pty sessions (sh on portable_pty PTYs, Linux, dev profile — timings measure blocking semantics, not CPU throughput; dev vs release irrelevant at these magnitudes). Wedge = shell runs `kill -STOP $$` so it stops reading stdin; 256KiB payload (4096 x 64B ':' lines) fills the ~4KB kernel tty input queue and blocks the writer. BASELINE (production write_to_pty/close_session, one global mutex): uncontended write_to_pty(healthy) p50 0.94µs, max 42µs (200 iters). With one wedged session: write_to_pty(stuck, 256KiB) confirmed still blocked at t=2s; write_to_pty(healthy, 6B) stalled 2.115s; close_session(stuck) stalled 2.115s — both released only when SIGCONT was sent externally at t=2s, i.e. stall duration is unbounded (~2,250,000x the uncontended p50). OPTIMIZED (suggested fix reimplemented in harness: writer moved to per-session Arc<Mutex<Box<dyn Write+Send>>>, map locked only to clone the Arc; same real PTYs, same wedge): write(healthy) while other session wedged p50 0.96µs, max 51µs (200 iters, zero stall); close_session(wedged) 201ms and the rest of the app unaffected. EXTRA empirical finding: after SIGKILLing the wedged child, the blocked master write NEVER returns (kernel stack pinned in n_tty_write 7+ min) — under baseline the global lock is therefore held forever (permanent whole-app PTY deadlock, unrecoverable). flush_output (production service::pty::flush_output, persist-thread mimic of the real 250ms recv_timeout loop): p50 29.4µs, p99 56.8µs, max 240µs over 2000 iters when responsive; 500.3ms when persist thread is mid-500ms blocking I/O at flush time; 1.0002s (full PERSIST_FLUSH_TIMEOUT) when unresponsive.

Measured impact summary: one wedged terminal blocks writes/close for ALL terminals behind the global mutex — 2.115s measured stall, unbounded in general, permanent if the child is killed — vs 0.9µs uncontended. The per-session writer lock keeps other sessions at 0.96µs p50 and lets `close_session` of the wedged session complete in ~201ms.

## Proposed Change

Two independent parts. Part 1 (per-session writer lock) is the correctness fix; Part 2 (async handlers) is cheap insurance for the measured 0.5-1s tails and stops blocking work from running on Tauri's dispatch thread.

### Part 1 — `src-tauri/crates/infra/src/pty.rs`: per-session writer lock; never block while holding the map lock

**1a. Change the `PtySession` struct (lines 13-17):**

```rust
pub struct PtySession {
	pub master: Box<dyn MasterPty + Send>,
	pub writer: Arc<Mutex<Box<dyn Write + Send>>>,
	pub child: Box<dyn portable_pty::Child + Send + Sync>,
}
```

**1b. In `create_session` (currently lines 100-109), wrap the writer:**

```rust
let writer = pair
	.master
	.take_writer()
	.map_err(|e| AppError::PtyError(e.to_string()))?;

let session = PtySession {
	master: pair.master,
	writer: Arc::new(Mutex::new(writer)),
	child,
};
```

**1c. Rewrite `write_to_pty` (lines 243-263)** — lock the map only long enough to clone the `Arc`, drop the map guard, then write under the per-session lock. A wedged session then blocks only itself, and `close_session` can still run:

```rust
pub fn write_to_pty(
	sessions: &PtySessionMap,
	session_id: &str,
	data: &[u8],
) -> Result<(), AppError> {
	let writer = {
		let map = sessions.lock().map_err(|_| AppError::LockError)?;
		map.get(session_id)
			.ok_or_else(|| {
				AppError::PtyError(format!("Session not found: {}", session_id))
			})?
			.writer
			.clone()
	}; // global map lock released here, before any I/O

	let mut writer = writer.lock().map_err(|_| AppError::LockError)?;
	writer
		.write_all(data)
		.map_err(|e| AppError::PtyError(e.to_string()))?;
	writer
		.flush()
		.map_err(|e| AppError::PtyError(e.to_string()))?;
	Ok(())
}
```

Note `map.get(...)` replaces `map.get_mut(...)` — mutable access to the map entry is no longer needed.

Lock-ordering rule to preserve: always map lock → writer lock; nothing may acquire the map lock while holding a writer lock. The code above is the only place both are touched.

**1d. Rewrite `close_session` (lines 289-299)** so `child.kill()`/`child.wait()` (measured ~200ms for a SIGSTOPped child) happen *outside* the map lock:

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
	}
	Ok(())
}
```

**1e. Rewrite `close_all_sessions` (lines 301-308)** the same way — drain under the lock, kill/wait after releasing it:

```rust
pub fn close_all_sessions(sessions: &PtySessionMap) {
	let drained: Vec<PtySession> = match sessions.lock() {
		Ok(mut map) => map.drain().map(|(_, s)| s).collect(),
		Err(_) => return,
	};
	for mut session in drained {
		let _ = session.child.kill();
		let _ = session.child.wait();
	}
}
```

**1f. Leave `resize_pty` (lines 265-287) internals as-is.** `master.resize` is a `TIOCSWINSZ` ioctl — it does not block on the tty buffer, so holding the map lock briefly is fine. (Its problem is the sync handler + DB lock; fixed in Part 2.)

No other code constructs or destructures `PtySession` — verified by grep: the only field accesses are inside `infra/pty.rs` itself. `service::pty` only calls the public functions (`create_session` at service/pty.rs:294, `write_to_pty` at :350, `close_session` at :321/:372/:385/:413), whose signatures do not change.

**Known accepted limitation (document in a code comment on `write_to_pty`):** killing the child does NOT wake a write already blocked in the kernel's `n_tty_write` while any master-side fd is open (verified empirically — 7+ minutes pinned). Under this fix, a wedged write leaks its thread and its `Arc`'d writer fd until the process exits; further writes to that *same* session will queue behind its writer mutex (each occupying a blocking-pool thread after Part 2). This is a bounded, per-wedged-session leak and the rest of the app stays fully functional — a deliberate trade against the current whole-app permanent deadlock. Optional future hardening (out of scope, do NOT attempt without its own plan): set `O_NONBLOCK` on the writer fd and loop on `poll` with a per-session shutdown flag checked on `WouldBlock`, so `close_session` can cancel an in-flight write.

### Part 2 — `src-tauri/src/handler/pty.rs`: convert the five sync PTY commands to `async` + `run_blocking`

Match the existing pattern used by `create_pty_session` (handler/pty.rs:15-25). All the managed-state types are `Arc`s (`PtySessionMap`, `DbPool`, `PtyFlushSenders`) or `Clone` (`PtyLogDir` — see `src-tauri/crates/service/src/pty.rs:36-37`), so clone them into the closure:

```rust
#[tauri::command]
#[tracing::instrument(skip_all)]
pub async fn write_to_pty(
	sessions: State<'_, PtySessionMap>,
	session_id: String,
	data: String,
) -> Result<(), AppError> {
	let sessions = sessions.inner().clone();
	super::run_blocking(move || {
		session::write_to_pty(&sessions, &session_id, data.as_bytes())
	})
	.await
}

#[tauri::command]
#[tracing::instrument(skip_all)]
pub async fn resize_pty(
	sessions: State<'_, PtySessionMap>,
	db: State<'_, DbPool>,
	session_id: String,
	rows: u16,
	cols: u16,
) -> Result<(), AppError> {
	let sessions = sessions.inner().clone();
	let db = db.inner().clone();
	super::run_blocking(move || {
		session::resize_pty(&sessions, &session_id, rows, cols)?;
		let conn = &mut *db.lock().map_err(|_| AppError::LockError)?;
		repo::pty::update_dimensions(conn, &session_id, cols, rows);
		Ok(())
	})
	.await
}

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

#[tauri::command]
#[tracing::instrument(skip_all)]
pub async fn clear_pty_output(
	session_id: String,
	log_dir: State<'_, PtyLogDir>,
	state: State<'_, PtyFlushSenders>,
) -> Result<(), AppError> {
	let dir = log_dir.0.clone();
	let senders = state.inner().clone();
	super::run_blocking(move || {
		service::pty::clear_output(&dir, &senders, &session_id)
	})
	.await
}
```

Leave `attach_pty_output` / `detach_pty_output` sync — they only do fast in-memory map operations.

No changes to `src-tauri/src/lib.rs` registration are needed (sync→async commands register identically in `tauri::generate_handler![]`, lines 76-85).

### Part 3 — regenerate TypeScript bindings

Run `cargo tauri-typegen generate` from the repo root (per CLAUDE.md). Command names, parameters, and return types are unchanged — generated `src/generated/commands.ts` wrappers were already `async` (Tauri `invoke` always returns a Promise), so the frontend (`src/features/terminal/Terminal.tsx`, `TerminalTabs.tsx`) needs **no changes**. If typegen cannot run in the environment (it may require the full Tauri toolchain), that is acceptable: `src/generated/` is gitignored and the generated signatures are provably identical — note this in the PR description.

### Part 4 — new integration test in `src-tauri/crates/infra/tests/pty_wedge.rs`

Linux-only regression test proving a wedged session no longer blocks others (harness pattern verified to work in this container; `portable_pty` is a regular dep of `infra` so it's available to test targets):

```rust
#![cfg(target_os = "linux")]

use std::io::Read;
use std::time::{Duration, Instant};

use infra::pty::{self, CreateSessionOptions};
use infra::shell_init::ShellInjection;

fn spawn_session(sessions: &pty::PtySessionMap, id: &str) {
	let reader = pty::create_session(
		sessions,
		CreateSessionOptions {
			session_id: id,
			shell: "sh",
			cwd: "/tmp",
			rows: 24,
			cols: 80,
			injection: &ShellInjection::None,
		},
	)
	.expect("create session");
	// Drain output in a detached thread, or echo back-pressure re-wedges the shell.
	std::thread::spawn(move || {
		let mut reader = reader;
		let mut buf = [0u8; 4096];
		while matches!(reader.read(&mut buf), Ok(n) if n > 0) {}
	});
}

fn child_pid(sessions: &pty::PtySessionMap, id: &str) -> u32 {
	sessions.lock().unwrap()[id].child.process_id().expect("pid")
}

fn wait_for_stopped(pid: u32) {
	let deadline = Instant::now() + Duration::from_secs(5);
	loop {
		let stat = std::fs::read_to_string(format!("/proc/{pid}/stat"))
			.unwrap_or_default();
		// state is the field after the closing paren of comm
		if stat.rsplit(')').next().unwrap_or("").trim().starts_with('T') {
			return;
		}
		assert!(Instant::now() < deadline, "shell never stopped");
		std::thread::sleep(Duration::from_millis(20));
	}
}

#[test]
fn wedged_session_does_not_block_other_sessions_or_close() {
	let sessions = pty::create_session_map();
	spawn_session(&sessions, "stuck");
	spawn_session(&sessions, "healthy");

	// Wedge: shell stops itself and stops draining the kernel tty input queue.
	pty::write_to_pty(&sessions, "stuck", b"kill -STOP $$\n").unwrap();
	wait_for_stopped(child_pid(&sessions, "stuck"));

	// 256KiB of ':' builtin lines (no fork) fills the ~4KB input queue and
	// blocks the writer in the kernel. Detached thread — NEVER join it: the
	// write never returns after the child is killed (verified kernel behavior).
	let payload: Vec<u8> = std::iter::repeat_with(|| {
		let mut line = vec![b':'; 63];
		line.push(b'\n');
		line
	})
	.take(4096)
	.flatten()
	.collect();
	let s = sessions.clone();
	std::thread::spawn(move || {
		let _ = pty::write_to_pty(&s, "stuck", &payload);
	});
	std::thread::sleep(Duration::from_millis(300)); // let the write block

	// A healthy session must not stall behind the wedged one.
	let t = Instant::now();
	pty::write_to_pty(&sessions, "healthy", b"true\n").unwrap();
	assert!(
		t.elapsed() < Duration::from_millis(500),
		"healthy write stalled {:?} behind wedged session",
		t.elapsed()
	);

	// Closing the wedged session must succeed. Measured ~201ms (kill+wait on
	// a stopped process) — do NOT assert <100ms.
	let t = Instant::now();
	pty::close_session(&sessions, "stuck").unwrap();
	assert!(
		t.elapsed() < Duration::from_secs(2),
		"close_session stalled {:?}",
		t.elapsed()
	);

	pty::close_session(&sessions, "healthy").unwrap();
}
```

Under the pre-fix code this test hangs at the healthy write / times out; under the fix it passes in well under a second (plus ~200ms for the close). Note the test intentionally leaks one blocked writer thread — that is the documented accepted limitation; the test process exits normally regardless.

## Verification

All commands run from the repo. **Never run plain `cargo build`/`cargo test` without `-p` flags and never `bun tauri ...`** — the full Tauri app build fails in CI containers (missing GTK system libs).

1. Workspace crates build + full existing suite (151 tests pre-change) plus the new test:
   ```
   cd /home/user/2code/src-tauri && cargo test -p model -p repo -p service -p infra
   ```
   Existing coverage of the touched area that must stay green:
   - `infra::pty` unit tests (`write_to_nonexistent_session_returns_error`, `resize_nonexistent_session_returns_error`, `close_nonexistent_session_is_ok`, `close_all_on_empty_map_no_panic`, etc. — `src-tauri/crates/infra/src/pty.rs:310-436`)
   - `service::pty` tests (persist thread, flush, history sanitization — `src-tauri/crates/service/src/pty.rs:744-1301`)

2. New regression test specifically:
   ```
   cd /home/user/2code/src-tauri && cargo test -p infra --test pty_wedge
   ```
   Optionally demonstrate it catches the bug: run it once with only Part 2 applied (Part 1 reverted) and confirm it fails/hangs on the healthy-write assertion.

3. The app crate (with the handler changes) cannot be compiled in the container (GTK). To type-check the handler edits as far as possible without the app build, rely on review plus the fact that the converted handlers are byte-for-byte the same pattern as the adjacent, already-compiling `create_pty_session`/`list_project_sessions`. On a dev machine with GTK/macOS, verify with `cargo check` in `src-tauri` and a manual smoke test: open two terminals, run `kill -STOP $$` in one, paste a large clipboard into it, confirm the second terminal still accepts input and the wedged tab can be closed.

4. Frontend sanity (no frontend code changes expected; bindings signatures unchanged):
   ```
   cd /home/user/2code && bunx vitest run src/features/terminal
   ```

5. Regenerate bindings where the toolchain allows: `cargo tauri-typegen generate`; diff of `src/generated/commands.ts` should be empty or trivially equivalent.

## Risks & Constraints

- **CLAUDE.md invariants respected:** handlers stay thin (state extraction + delegation only); no business logic added to `handler/`; DB remains single-connection `Arc<Mutex<SqliteConnection>>` with short-held locks (the resize handler's DB lock now at least runs on the blocking pool); `src/generated/` and `src-tauri/src/schema.rs` untouched by hand; no changes to the PTY output-streaming path (per-session IPC `Channel`, `&[u8]` chunks) or to the terminal CSS display/persistence model.
- **Lock ordering:** the only nested acquisition is map lock → writer lock inside `write_to_pty`, and the map guard is dropped before the writer lock is taken. Never add code that takes the map lock while holding a writer lock, and never move `child.kill()`/`wait()` or any I/O back under the map lock.
- **Accepted bounded leak (document, don't "fix" casually):** a write already blocked in the kernel survives child kill (verified: `n_tty_write` never returns while master fds are open). Post-fix, that leaks one blocking-pool thread + one writer fd per wedged session until app exit, and subsequent writes to the same wedged session each pin another blocking-pool thread on the writer mutex (tokio's blocking pool defaults to 512 threads, so this is tolerable but worth a `tracing::warn!`-level comment). The alternative (O_NONBLOCK + poll + shutdown flag) is real work with its own failure modes — out of scope here.
- **Write ordering:** per-session ordering is still guaranteed for sequential callers (the writer mutex serializes). Concurrent `write_to_pty` calls to the same session were never ordered deterministically (the global mutex also just serialized them arbitrarily), so no behavior change.
- **`close_session` semantics change slightly:** the session is removed from the map *before* kill/wait completes, so a concurrent `write_to_pty` racing a close may now get "Session not found" a few hundred ms earlier than before. This is benign (the frontend already treats late writes to closed sessions as best-effort — `Terminal.tsx:667` catches errors).
- **Sync→async command conversion:** Tauri handles both; the generated TS API is identical. The only observable difference is that these commands no longer execute inline on the dispatch thread — which is the point. `create_session`'s internal `write_to_pty` for startup commands (`service/pty.rs:350`) already runs inside `run_blocking` via its handler, unaffected.
- **Test flakiness guard:** the wedge test is `#[cfg(target_os = "linux")]` (uses `/proc`); keep thresholds generous (500ms healthy-write, 2s close — measured 0.96µs and 201ms respectively), spawn a drain thread per session reader (echo back-pressure otherwise re-wedges the shell), and never join the blocked writer thread.
