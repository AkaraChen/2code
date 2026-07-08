# Return PTY history as raw bytes (tauri::ipc::Response) instead of JSON number arrays

> PTY history crosses IPC as a JSON array of numbers (~3.7 chars/byte, ~90 ms webview main-thread time per MB); returning raw bytes makes history delivery 200–600x faster and removes hundreds of MB of transient JS allocations. | Severity: high | Category: performance

## Problem

Both PTY-history commands return `Vec<u8>`, which Tauri serializes through `serde_json` as a **JSON array of numbers**:

- `get_pty_session_history` — `src-tauri/src/handler/pty.rs:78-89` returns `Result<Vec<u8>, AppError>`. The generated binding proves the wire format: `src/generated/commands.ts:119-123` types it `Promise<number[]>`.
- `restore_pty_session` — `src-tauri/src/handler/pty.rs:107-120` returns `RestoreResult` (`src-tauri/crates/model/src/pty.rs:50-55`) whose `history: Vec<u8>` field lands in TypeScript as `history: number[]` (`src/generated/types.ts:156-159`).

Each byte becomes ~3.7 characters of JSON text (`123,`), which the webview must `JSON.parse` into a JS `number[]` (~8 bytes/element on the V8 heap) before the frontend copies it into a `Uint8Array`:

- `src/features/terminal/Terminal.tsx:646-649` — on **every Terminal mount for a live session** (tab open, remount): `const history = await getPtySessionHistory({ sessionId }); replayInitialHistory(new Uint8Array(history));`
- `src/features/terminal/restoration.ts:72-73` — on **every restored tab on every app launch**: `sessionHistory.set(result.newSessionId, new Uint8Array(result.history));`

The payload is unbounded on the live path: the per-session log file has **no byte cap** (`src-tauri/crates/infra/src/pty_log.rs:61-63` — `read_all` is a whole-file `fs::read`; the module doc at `pty_log.rs:9-12` says the no-cap design relies on the vt100 sanitizer, but that sanitizer only runs on the *restore* path). `service::pty::get_history` (`src-tauri/crates/service/src/pty.rs:432-436`) returns the file verbatim. After a long agent session a 32 MB log becomes a ~109 MB JSON string plus a ~270 MB transient `number[]` on the JS heap, blocking the webview main thread for seconds during parse.

The restore path (`service::pty::restore_session`, `src-tauri/crates/service/src/pty.rs:469-511`) is vt100-sanitized to 10k lines (`sanitize_history`, `pty.rs:166-174`), but with SGR sequences that is still commonly 1–5 MB per session — multiplied across all restored tabs at startup.

The **live output path already does this correctly**: `stream_pty_output` (`src-tauri/src/handler/pty.rs:156-187`) uses `Channel<&[u8]>`, which the frontend receives as `ArrayBuffer` (`Terminal.tsx:601-603`). The history path is the only remaining JSON-encoded binary hot path. Tauri's documented mechanism for raw binary command responses is `tauri::ipc::Response::new(bytes)`, which arrives in JS as an `ArrayBuffer`.

## Evidence & Measurements

Verified A/B benchmarks (real `serde_json` on the Rust side, real `JSON.parse` + `Uint8Array` copy on the JS side, realistic ANSI-SGR-colored shell output at ~170 bytes/line, matching real PTY logs), reported verbatim:

> JS side (bunx vitest run, Node/V8 via vitest; real JSON.parse of the serde_json wire format vs ArrayBuffer copy; warmed, 3-200 iters per size): [1 MB log] wire 3.4 MB JSON vs 1 MB raw (3.40x inflation); JSON.parse+new Uint8Array = 90.8 ms vs raw ArrayBuffer copy = 0.161 ms (562x). [8 MB] 27.2 MB wire; 868.7 ms vs 1.384 ms (628x). [32 MB] 108.8 MB wire; 3491.6 ms vs 17.2 ms (203x). [2 MB restore history] 192.3 ms/tab vs 0.346 ms/tab (556x). Rust side (cargo test -p model --release --nocapture, release profile): serde_json::to_vec(Vec<u8>) = 3.5 ms/1 MB, 39.1 ms/8 MB, 167.2 ms/32 MB (wire 3.4x input size); raw-Vec copy measured ~0 ms (memcpy largely optimized out by LLVM — true cost bounded by the 17 ms/32 MB JS-side copy figure). RestoreResult with 2 MB history: serde_json::to_vec = 7.1 ms -> 6.8 MB wire per restored tab. Input data: synthetic ANSI-SGR-colored shell output lines (~170 bytes/line), matching real PTY logs. Both benchmark files deleted after the run.

Measured impact summary: 200–600x faster history delivery. A 32 MB session log today costs ~3.66 s (167 ms Rust serialize + 3.49 s webview JSON.parse, main thread blocked) plus ~380 MB transient JS allocations, vs ~17 ms as raw bytes. Each restored tab with 2 MB scrollback pays ~200 ms at startup vs ~0.4 ms.

Note when writing any follow-up report: the Rust-side raw-copy timing read ~0 ms only because LLVM elided the memcpy; quote the JS-side 17 ms/32 MB copy as the honest raw-path upper bound.

## Proposed Change

Four parts: (1) make `get_pty_session_history` return raw bytes via `tauri::ipc::Response`; (2) split `restore_pty_session` into JSON metadata + a raw-bytes fetch of the sanitized history (a `Response` is raw-only, so metadata and bytes cannot share one command); (3) hand-written typed `invoke` helpers in the terminal feature module (tauri-typegen cannot type `tauri::ipc::Response`); (4) cap history reads with a tail limit, since xterm scrollback is only 5000 lines (`Terminal.tsx:65`).

Design decision for (2): `service::pty::restore_session` does **not** re-persist the sanitized history into the new session's log file (see `crates/service/src/pty.rs:469-511` — it reads the old log, sanitizes, creates the new session, deletes the old record/log, and returns the bytes in-memory). So re-fetching via `get_pty_session_history(newSessionId)` would return only whatever the new PTY has emitted, NOT the sanitized scrollback. Do not go that route. Instead, stash the sanitized bytes in app-managed state keyed by the new session id, and add a dedicated raw-bytes command `take_restored_history` that removes-and-returns them.

### Step 1 — Backend: `get_pty_session_history` returns `tauri::ipc::Response`

File: `src-tauri/src/handler/pty.rs` (currently lines 78-89).

```rust
#[tauri::command]
#[tracing::instrument(skip_all)]
pub async fn get_pty_session_history(
	session_id: String,
	log_dir: State<'_, PtyLogDir>,
) -> Result<tauri::ipc::Response, AppError> {
	let dir = log_dir.0.clone();
	let bytes = super::run_blocking(move || {
		Ok(service::pty::get_history(&dir, &session_id))
	})
	.await?;
	Ok(tauri::ipc::Response::new(bytes))
}
```

`tauri::ipc::Response` implements `IpcResponse`, and `Result<Response, AppError>` is valid because `AppError` already implements `Serialize` (it is the error type of every command). No change needed to `lib.rs` registration for this command (already registered at `src-tauri/src/lib.rs:82`).

### Step 2 — Backend: split restore metadata from history bytes

**2a. Model** — `src-tauri/crates/model/src/pty.rs:50-55`: replace the `history` field with a length so the frontend can skip the second round-trip when empty:

```rust
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoreResult {
	pub new_session_id: String,
	pub history_len: usize,
}
```

**2b. Service** — `src-tauri/crates/service/src/pty.rs`: `restore_session` (lines 469-511) must keep returning the actual bytes to the caller (the app layer stashes them). Introduce a service-level struct so `model::RestoreResult` stays a pure IPC DTO:

```rust
/// Internal result of a restore: the IPC-facing DTO is built by the handler,
/// which stashes `history` for a follow-up raw-bytes fetch.
pub struct RestoredSession {
	pub new_session_id: String,
	pub history: Vec<u8>,
}
```

Change the signature to `pub fn restore_session(...) -> Result<RestoredSession, AppError>` and the final expression to build `RestoredSession { new_session_id, history }`. Remove the now-unused `RestoreResult` import from the `use model::pty::{...}` list at `crates/service/src/pty.rs:14-17`.

**2c. App-layer stash** — `src-tauri/src/bridge.rs`: add managed state next to `PtyOutputSinks` (use a newtype, not a bare alias, so Tauri's type-keyed state cannot collide with another `Arc<Mutex<HashMap<String, Vec<u8>>>>`):

```rust
/// Sanitized scrollback produced by restore_pty_session, held until the
/// frontend fetches it via take_restored_history (raw-bytes IPC).
/// Keyed by NEW session id. Entries are removed on take/close/delete.
#[derive(Clone, Default)]
pub struct RestoredHistories(
	pub Arc<Mutex<HashMap<String, Vec<u8>>>>,
);
```

In `src-tauri/src/lib.rs`, `.manage(crate::bridge::RestoredHistories::default())` alongside the existing `.manage(...)` calls for `PtyOutputSinks`/`PtyOutputReceivers` (search for `create_output_sinks` in `lib.rs` to find the spot).

**2d. Handler** — `src-tauri/src/handler/pty.rs`:

```rust
use crate::bridge::RestoredHistories;

#[tauri::command]
#[tracing::instrument(skip_all)]
pub async fn restore_pty_session(
	app: AppHandle,
	old_session_id: String,
	meta: PtySessionMeta,
	config: PtyConfig,
	stash: State<'_, RestoredHistories>,
) -> Result<RestoreResult, AppError> {
	let ctx = crate::bridge::build_pty_context(&app);
	let restored = super::run_blocking(move || {
		service::pty::restore_session(&ctx, &old_session_id, &meta, &config)
	})
	.await?;

	let history_len = restored.history.len();
	if history_len > 0 {
		stash
			.0
			.lock()
			.map_err(|_| AppError::LockError)?
			.insert(restored.new_session_id.clone(), restored.history);
	}
	Ok(RestoreResult {
		new_session_id: restored.new_session_id,
		history_len,
	})
}

/// Remove-and-return the sanitized scrollback stashed by restore_pty_session.
/// Raw-bytes IPC: the frontend receives an ArrayBuffer. Missing entry → empty.
#[tauri::command]
#[tracing::instrument(skip_all)]
pub fn take_restored_history(
	session_id: String,
	stash: State<'_, RestoredHistories>,
) -> Result<tauri::ipc::Response, AppError> {
	let bytes = stash
		.0
		.lock()
		.map_err(|_| AppError::LockError)?
		.remove(&session_id)
		.unwrap_or_default();
	Ok(tauri::ipc::Response::new(bytes))
}
```

Register `handler::pty::take_restored_history` in `tauri::generate_handler![]` in `src-tauri/src/lib.rs` (next to line 86).

**2e. Leak protection** — if the frontend closes a restoring tab before fetching, `restoration.ts` calls `closePtySession` + `deletePtySessionRecord` on the new id (`restoration.ts:64-70`). Add stash cleanup to both handlers in `src-tauri/src/handler/pty.rs` by adding a `stash: State<'_, RestoredHistories>` parameter and, before delegating, `if let Ok(mut map) = stash.0.lock() { map.remove(&session_id); }`. For `delete_pty_session_record` do the removal before the `run_blocking` closure (clone the session id). `State` parameters are invisible to the frontend, so existing call sites and generated params types are unaffected.

### Step 3 — Frontend: typed raw-bytes helpers in the feature module

tauri-typegen (config: `tauri.conf.json` `plugins.typegen`, output `src/generated/`, gitignored) will either mistype or fail on a `tauri::ipc::Response`-returning command. Do NOT route these two commands through `@/generated`. Create **`src/features/terminal/ptyHistoryIpc.ts`** (new file — feature module, not `src/api/`, which the project forbids):

```ts
import { invoke } from "@tauri-apps/api/core";

/**
 * Raw-bytes IPC for PTY history. These two Rust commands return
 * `tauri::ipc::Response` (raw ArrayBuffer), which tauri-typegen cannot
 * express, so they are hand-typed here instead of in src/generated.
 */
export async function fetchPtySessionHistory(
	sessionId: string,
): Promise<Uint8Array> {
	const buf = await invoke<ArrayBuffer>("get_pty_session_history", {
		sessionId,
	});
	return new Uint8Array(buf);
}

export async function takeRestoredHistory(
	sessionId: string,
): Promise<Uint8Array> {
	const buf = await invoke<ArrayBuffer>("take_restored_history", {
		sessionId,
	});
	return new Uint8Array(buf);
}
```

**`src/features/terminal/Terminal.tsx`:**
- Remove `getPtySessionHistory` from the `@/generated` import block (line 21).
- Add `import { fetchPtySessionHistory } from "./ptyHistoryIpc";`.
- Replace lines 648-649:

```ts
const history = await fetchPtySessionHistory(sessionId);
replayInitialHistory(history);
```

**`src/features/terminal/restoration.ts`:**
- Add `import { takeRestoredHistory } from "./ptyHistoryIpc";`.
- In `runRestore` (lines 45-79), replace the `result.history` block (lines 72-74) with:

```ts
if (result.historyLen > 0) {
	const history = await takeRestoredHistory(result.newSessionId);
	if (history.length > 0) {
		sessionHistory.set(result.newSessionId, history);
	}
}
```

**Ordering is critical:** the `sessionHistory.set(...)` must complete BEFORE `finishRestoringTab(...)` runs (as it does in the sketch above — same position as today). `finishRestoringTab` swaps the tab id, which mounts `Terminal` with the new session id; `Terminal.tsx:640` reads `sessionHistory.get(sessionId)` at mount and, if absent, falls back to fetching the (nearly empty) new session's log — the restored scrollback would be silently lost.

The closed-tab branch (`restoration.ts:64-70`) needs no change: the stash entry is dropped by the `close_pty_session`/`delete_pty_session_record` cleanup from Step 2e.

**Regenerate bindings:** run `cargo tauri-typegen generate` (dev machine). Verify:
- `getPtySessionHistory` either disappears from / is harmlessly mistyped in `src/generated/commands.ts` — nothing imports it anymore (also fine to add both raw commands to `plugins.typegen.excludePatterns` in `tauri.conf.json` if the generator errors on `tauri::ipc::Response`).
- `RestoreResult` in `src/generated/types.ts` becomes `{ newSessionId: string; historyLen: number }`.

If typegen cannot run in the working environment (it may require a full app build; CI containers lack GTK), hand-edit the local **gitignored** copies of `src/generated/commands.ts` and `src/generated/types.ts` to match the shapes above so `tsc` passes, and note in the PR that dev machines must regenerate. (The "do not edit generated files" rule exists because they are regenerated — a stale local copy that breaks the type-check is worse.)

### Step 4 — Cap history reads (independent, do after Steps 1-3)

xterm scrollback is 5000 lines (`Terminal.tsx:65 TERMINAL_SCROLLBACK`), so shipping tens of MB that xterm discards wastes IO even on the raw path.

**4a.** Add to `src-tauri/crates/infra/src/pty_log.rs`:

```rust
/// Read at most the last `max_bytes` of a session's log. When the file is
/// larger, the result additionally drops everything through the first `\n`
/// so replay does not start mid-line / mid-escape-sequence.
/// Missing file → empty, like `read_all`.
pub fn read_tail(dir: &Path, session_id: &str, max_bytes: u64) -> Vec<u8> {
	use std::io::{Read, Seek, SeekFrom};
	let Ok(mut file) = File::open(session_path(dir, session_id)) else {
		return Vec::new();
	};
	let len = file.metadata().map(|m| m.len()).unwrap_or(0);
	let start = len.saturating_sub(max_bytes);
	if file.seek(SeekFrom::Start(start)).is_err() {
		return Vec::new();
	}
	let mut buf = Vec::with_capacity((len - start) as usize);
	if file.read_to_end(&mut buf).is_err() {
		return Vec::new();
	}
	if start > 0 {
		if let Some(pos) = buf.iter().position(|&b| b == b'\n') {
			buf.drain(..=pos);
		}
	}
	buf
}
```

**4b.** In `src-tauri/crates/service/src/pty.rs`, add a constant and use it in `get_history` (lines 432-436):

```rust
/// Tail cap for history replay into a live xterm (scrollback there is 5k
/// lines; ~8 MB of SGR-heavy output is far beyond what xterm retains).
const HISTORY_TAIL_CAP_BYTES: u64 = 8 * 1024 * 1024;

pub fn get_history(output_dir: &Path, session_id: &str) -> Vec<u8> {
	let data =
		pty_log::read_tail(output_dir, session_id, HISTORY_TAIL_CAP_BYTES);
	tracing::info!(target: "pty", %session_id, total_bytes = data.len(), "loaded history from file");
	data
}
```

**4c (recommended).** Also cap the restore path's raw read: in `restore_session` (line 489) replace `pty_log::read_all(&ctx.output_dir, old_session_id)` with `pty_log::read_tail(&ctx.output_dir, old_session_id, RESTORE_TAIL_CAP_BYTES)` (e.g. `16 * 1024 * 1024`) — this bounds vt100 CPU time, and `strip_alternative_screen` already handles a buffer that starts mid-alt-screen (see its comment at `crates/service/src/pty.rs:88-92`).

Update the "no byte cap" doc comment in `pty_log.rs:9-12` and the two CLAUDE.md mentions of "No byte cap" only if you are permitted to touch docs in your task scope; otherwise flag it in the PR description.

### Test updates (required for the suite to pass)

- **`src/test/setup.ts:113-115`** — change the `restorePtySession` mock to `Promise.resolve({ newSessionId: "mock-id", historyLen: 0 })`.
- **`src/features/terminal/Terminal.test.tsx`** — `Terminal.tsx` no longer imports `getPtySessionHistory` from `@/generated`; the tests at lines 131, 207, 215, 281, 293-304 drive that mock. Add `vi.mock("./ptyHistoryIpc", ...)` exposing `fetchPtySessionHistory: vi.fn(() => Promise.resolve(new Uint8Array(0)))` and `takeRestoredHistory: vi.fn(() => Promise.resolve(new Uint8Array(0)))`; re-point the assertions (`getPtySessionHistoryMock`) at `fetchPtySessionHistory`, and make the deferred-resolution test (lines 292-311) resolve a `Uint8Array` instead of `number[]`. Update the `restorePtySession` entry in the file's `@/generated` mock (line 136-138) to the new shape.
- **`src/features/terminal/restoration.test.ts`** — mock shape changes: `restorePtySessionMock.mockResolvedValue({ newSessionId: "new-session", historyLen: 3 })`; add `vi.mock("./ptyHistoryIpc")` with `takeRestoredHistory` resolving `new Uint8Array([1, 2, 3])`; the assertion at line 88 (`sessionHistory.get("new-session")` equals `Uint8Array([1,2,3])`) then still holds. Add a new case: `historyLen: 0` must NOT call `takeRestoredHistory`. The closed-before-finish test (lines 121-144) should resolve `{ newSessionId: "new-session", historyLen: 1 }` and assert `takeRestoredHistory` was not called (frontend defers cleanup to the backend close/delete handlers).
- **Rust** — new `#[cfg(test)]` tests in `crates/infra/src/pty_log.rs` for `read_tail`: (a) cap larger than file → identical to `read_all`; (b) cap smaller → result length ≤ cap and starts after the first `\n` of the tail window; (c) missing session → empty. Optionally a `crates/service` test asserting `get_history` on a log larger than the cap returns ≤ `HISTORY_TAIL_CAP_BYTES`. Follow the existing colocated-test pattern in those files.

## Verification

Environment constraint: **the full Tauri app cannot be built in CI containers** (missing GTK system libs). Never run plain `cargo build` / `cargo test` / `bun tauri ...` there — always use `-p` flags for the workspace crates. The app crate (`handler/pty.rs`, `bridge.rs`, `lib.rs`) can only be compile-checked on a machine with the system deps (macOS dev machine or a desktop-Linux box): `cd src-tauri && cargo check`.

Commands that must pass in any environment:

```bash
# Rust workspace crates (model/repo/service/infra changes + new read_tail tests)
cd /home/user/2code/src-tauri && cargo test -p model -p repo -p service -p infra

# Frontend unit tests (terminal feature covers both changed decode sites)
cd /home/user/2code && bunx vitest run src/features/terminal

# Full frontend suite (671 tests at time of writing)
cd /home/user/2code && bunx vitest run

# Type-check (paraglide is precompiled; do not touch project.inlang or src/paraglide)
cd /home/user/2code && bunx tsc --noEmit
```

Existing tests covering this area: `src/features/terminal/Terminal.test.tsx` (mount → history fetch → agent detection gating on stream readiness), `src/features/terminal/restoration.test.ts` (restore flow, dedupe, cancel-on-close), and the `sanitize_history` / `persist_pty_output` / `pty_log` test suites in `crates/service/src/pty.rs` and `crates/infra/src/pty_log.rs`.

On a dev machine (cannot be done in CI):

1. `cd src-tauri && cargo check` — the handler/bridge/lib changes compile.
2. `cargo tauri-typegen generate` — confirm `RestoreResult` regenerates as `{ newSessionId, historyLen }` and the generator does not choke on `tauri::ipc::Response` (add the two raw commands to `plugins.typegen.excludePatterns` if it does).
3. `bun tauri dev`, then manually:
   - Open a terminal tab, run `yes | head -200000`, switch to another tab and back → scrollback replays instantly; in devtools, confirm the `get_pty_session_history` invoke resolves to an `ArrayBuffer` (log `payload instanceof ArrayBuffer` temporarily or inspect in the network/IPC panel).
   - Quit and relaunch with several tabs holding colored output (e.g. after `ls --color -R /usr`) → every tab's scrollback restores; startup does not freeze.
   - Close a restoring tab immediately at launch → no orphan session; no stashed history leak (add a temporary `tracing::info!` on stash insert/remove if you want to see it drain).
   - Run a TUI (vim/htop), quit it, restart the app → alt-screen content is still excluded from restored scrollback (sanitize path unchanged).
4. Optional micro-benchmark to confirm the win end-to-end: temporarily log `performance.now()` around the `fetchPtySessionHistory` call for a multi-MB session and compare against the pre-change build (expect ms vs seconds at 32 MB per the measurements above).

New test/benchmark to add: the Rust `read_tail` unit tests listed above are required; a vitest benchmark is not required (the A/B numbers are already recorded in this plan), but if you add one, use `bunx vitest bench --run <path>` and delete any scratch data files afterwards.

## Risks & Constraints

- **CLAUDE.md invariants**
  - "Do not create manual API wrappers in `src/api/`" — respected: the hand-written invokes live in `src/features/terminal/ptyHistoryIpc.ts` with a comment explaining why they bypass typegen. Do not move them to `src/api/`.
  - `src/generated/` is gitignored and normally regenerated via `cargo tauri-typegen generate`; only hand-edit the local copy if the generator cannot run in your environment, and say so in the PR.
  - Terminals never unmount (CSS `display: none`); this change must not alter `TerminalLayer` or the mount/park lifecycle — it only changes what the existing mount-time fetch returns.
  - Live PTY output stays on the `Channel<&[u8]>` path untouched; do not reintroduce per-chunk UTF-8 decoding. Raw history bytes are written to xterm exactly as before (identical bytes, different transport), so the overlap-dedup in `flushPendingEventsAfterHistory` (`Terminal.tsx:574-586`) keeps working.
  - Handlers stay thin: the stash insert/remove is state plumbing, not business logic; sanitize/read logic stays in `service`/`infra`.
  - DB is a single `Arc<Mutex<SqliteConnection>>` — none of these changes hold the DB lock; the new stash mutex is held only for a `HashMap` insert/remove.
- **Regression risks**
  - *Restore ordering race*: if `sessionHistory.set` ever moves after `finishRestoringTab`, restored scrollback is silently dropped (Terminal falls back to the new session's near-empty log). The restoration tests should pin this ordering.
  - *Stash leak*: if the frontend crashes between `restore_pty_session` and `take_restored_history`, bytes stay in memory until close/delete/app-exit. Bounded by the vt100 sanitizer (10k lines/session) and cleaned by the Step 2e hooks; acceptable.
  - *Tail cap truncation* (Step 4): cutting a >8 MB log can start replay mid-escape-sequence or inside an alt-screen region. The drop-through-first-`\n` heuristic limits visible garbling to at most the oldest retained region; the pre-change behavior for such logs was a multi-second UI freeze, so this is a strict improvement — but keep Step 4 as a separate commit so it can be reverted independently of the IPC change.
  - *tauri-typegen behavior on `tauri::ipc::Response`* is unverified — check the generator output; use `excludePatterns` as the escape hatch.
  - *Frontend `invoke<ArrayBuffer>` contract*: Tauri 2 delivers raw `Response` payloads as `ArrayBuffer`; confirm at runtime on the dev machine (step 3 of manual verification) before shipping — if a Tauri version quirk delivers a different type, adapt inside `ptyHistoryIpc.ts` only (single seam).
  - *Any other `RestoreResult`/`getPtySessionHistory` consumers*: a repo-wide grep at planning time found only `Terminal.tsx`, `restoration.ts`, their tests, and `src/test/setup.ts` — re-run `rg -n "getPtySessionHistory|RestoreResult|restorePtySession"` before starting in case new call sites appeared.
- **Parallel-work constraint from the environment**: if other agents share the checkout, coordinate before editing the shared files (`handler/pty.rs`, `Terminal.tsx`, `restoration.ts`, `crates/model/src/pty.rs`, `crates/service/src/pty.rs`, `crates/infra/src/pty_log.rs`, `bridge.rs`, `lib.rs`, `src/test/setup.ts`).
