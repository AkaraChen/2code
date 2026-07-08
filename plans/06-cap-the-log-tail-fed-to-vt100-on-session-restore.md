# Cap the log tail fed to vt100 on session restore

> Session restore reads the entire (uncapped, potentially hundreds-of-MB) PTY output log into memory and replays every byte through vt100 even though only the last 10k lines survive; reading a bounded tail instead makes restore ~40x faster and ~9x lighter on RAM at 200MB logs, with byte-identical output. | Severity: high | Category: performance

## Problem

**What happens today.** When the app starts, every open terminal tab is restored via
`service::pty::restore_session` (`src-tauri/crates/service/src/pty.rs:469-511`). Step 1 of that
function reads the *entire* per-session output log into memory:

- `src-tauri/crates/service/src/pty.rs:489` — `let raw_history = pty_log::read_all(&ctx.output_dir, old_session_id);`
- `src-tauri/crates/infra/src/pty_log.rs:61-63` — `read_all` is a plain `fs::read` of the whole file.
- `src-tauri/crates/infra/src/pty_log.rs:9-12` — the module doc explicitly says: *"There is deliberately **no byte cap**"* — on-disk log size is unbounded for the lifetime of a session.

Step 2 then sanitizes those bytes (`src-tauri/crates/service/src/pty.rs:493` →
`sanitize_history`, lines 166-174), which:

1. Makes a second full-size copy in `strip_alternative_screen` (`pty.rs:75-107` — `Vec::with_capacity(raw.len())`, byte-by-byte copy).
2. Feeds *every* byte to `vt100::Parser::process` (`pty.rs:171-172`).

But the parser is constructed with `VT100_SCROLLBACK = 10000` lines (`pty.rs:58`), so all input
except roughly the final 10k lines is provably wasted work — it scrolls out of the emulator and
never appears in the restored history.

**Why it matters.** A terminal that ran a chatty dev server or coding agent for days accumulates a
multi-hundred-MB log (the persistence thread appends everything; `persist_pty_output`,
`pty.rs:688-742`). On every app start, *each* restored tab pays: a full-file read, a full-size
copy, and a linear vt100 replay — measured at ~17ms/MB with peak transient heap ≈ 2.2x log size
(see measurements below). At 200MB that is ~3.5s and ~440MB RSS spike **per tab**, delaying
scrollback availability at startup. It runs inside `run_blocking` so it doesn't freeze the UI
thread, but the cost and memory spike are real and unbounded.

**Why a tail cut is already safe by design.** `strip_alternative_screen` contains this comment at
`pty.rs:88-90`:

```rust
// The persisted buffer may start mid-alt-screen after 1MB trimming.
// In that case, everything before the first unmatched exit belongs
// to the alternate screen as well.
```

i.e. the sanitizer was written for an era when storage trimmed logs to 1MB (removed when storage
moved off SQLite) and it *already handles a buffer that starts mid-stream / mid-alt-screen*. Only
the trim itself is missing.

## Evidence & Measurements

Verified benchmark of the real algorithm (verbatim copies of the private production fns
`sanitize_history` / `strip_alternative_screen` / `serialize_screen`, plus the real public
`infra::pty_log::read_all`), baseline vs. a seek-to-last-4MB tail read followed by the identical
sanitize. Reproduced verbatim:

> Release profile, Linux container (4 cores, 15GB RAM). Baseline = verbatim copy of production sanitize_history/strip_alternative_screen/serialize_screen (private fns) + real infra::pty_log::read_all; Optimized = seek-to-last-4MB read + identical sanitize. Input: synthetic realistic ANSI logs (colored ~120-col dev-server lines ~170B raw each, CR/erase-line progress updates every 7th line, alt-screen (?1049h/l) sections every 2000 lines in first 60% of stream), rows=40 cols=120, VT100_SCROLLBACK=10000. Best-of-N timings (N=3/2/1 full, 5 tail), peak heap via tracking global allocator. 5MB log: baseline 103.1ms (read 1.0, strip 11.8, vt100 71.9, serialize 17.9), peak heap 50.1MB; tail 85.3ms, peak 48.1MB; 1.2x; outputs byte-identical (1,062,919 bytes). 50MB log: baseline 878.4ms (read 22.6, strip 129.8, vt100 699.3, serialize 17.8), peak 140.6MB; tail 85.6ms, peak 48.6MB; 10.3x; identical (1,063,070 bytes). 200MB log: baseline 3479.4ms (read 88.5, strip 534.4, vt100 2804.0, serialize 18.1), peak 440.1MB; tail 87.3ms, peak 48.1MB; 39.8x; identical (1,063,411 bytes). Scaling: baseline ~17ms/MB linear (vt100 process ~14ms/MB dominates), tail constant ~86ms / ~48MB. Peak heap baseline ≈ 2.2x log size, confirming the 2-3x claim.

Key takeaways:

- **Measured impact:** 40x faster (3479ms → 87ms) and 9x less transient heap (440MB → 48MB) per restored tab at a 200MB log; 10x (878ms → 86ms) at 50MB. Restored scrollback was **byte-identical** (asserted with `assert_eq!`) at all sizes.
- Where the time goes at 200MB: vt100 process 2804ms, strip copy 534ms, `fs::read` 89ms, serialize 18ms. So the cap must happen **at the read** (a `read_tail` seam), not by slicing after `read_all` — that also avoids the 200MB+ read buffer.
- Honesty note: at small logs (5MB) the win is only 1.2x (~18ms); the point is bounding the unbounded case.
- With a 4MB tail (~24k lines at ~170B/line) the mangled first partial line at the byte-cut falls off the 10k-line vt100 scrollback, which is why output is byte-identical.
- The 32KB persist flush buffer means the on-disk tail may lag live output by ≤32KB, but `restore_session` already flushes live sessions first (`flush_output` at `pty.rs:480`), so no change is needed there.

## Proposed Change

Two files change (plus one stale comment and doc touch-ups). No Tauri command signatures change,
so **no `cargo tauri-typegen generate` is needed** and the frontend is untouched.

### Step 1 — `src-tauri/crates/infra/src/pty_log.rs`: add `read_tail`

Add next to `read_all` (keep `read_all` — other callers and tests use it):

```rust
use std::io::{Read, Seek, SeekFrom};

/// Read at most the last `max_bytes` of a session's history.
///
/// Missing file → empty (same semantics as [`read_all`]). If the file is
/// smaller than `max_bytes` the whole file is returned. The cut point is a
/// raw byte offset: the result may start mid-escape-sequence or mid-UTF-8
/// character; callers replaying through a terminal emulator with bounded
/// scrollback (see `service::pty::sanitize_history`) discard that partial
/// first line naturally.
pub fn read_tail(dir: &Path, session_id: &str, max_bytes: u64) -> Vec<u8> {
	let path = session_path(dir, session_id);
	let read = || -> io::Result<Vec<u8>> {
		let mut file = File::open(&path)?;
		let len = file.metadata()?.len();
		if len > max_bytes {
			file.seek(SeekFrom::Start(len - max_bytes))?;
		}
		let mut buf = Vec::with_capacity(len.min(max_bytes) as usize);
		file.read_to_end(&mut buf)?;
		Ok(buf)
	};
	read().unwrap_or_default()
}
```

Notes:
- `File::open` on a missing file errors → `unwrap_or_default()` → empty `Vec`, matching `read_all`'s "missing file is indistinguishable from a session that never produced output" contract (`pty_log.rs:59-63`).
- Update the module doc comment (`pty_log.rs:9-12`): keep the statement that there is no **on-disk** byte cap, but add one sentence that restore reads only a bounded tail via `read_tail` because vt100 scrollback (10k lines) bounds what can survive anyway.

### Step 2 — `src-tauri/crates/service/src/pty.rs`: cap the restore read

Near the existing constants (`pty.rs:58-61`) add:

```rust
/// Floor for the restore tail read. 4MB comfortably covers 10k lines of
/// typical ~170-byte ANSI dev-server output (~24k lines).
const RESTORE_TAIL_MIN_BYTES: u64 = 4 * 1024 * 1024;

/// How many bytes of raw log to feed the vt100 emulator on restore. Only the
/// last `VT100_SCROLLBACK` lines survive sanitize, so anything beyond a
/// generous tail is provably wasted work (measured ~17ms/MB + 2.2x log-size
/// peak heap). ~8 raw bytes per cell keeps the tail covering >10k lines even
/// for very long SGR-heavy lines (e.g. `cat` of a colored file).
fn restore_tail_cap(cols: u16) -> u64 {
	RESTORE_TAIL_MIN_BYTES
		.max(VT100_SCROLLBACK as u64 * u64::from(cols.max(1)) * 8)
}
```

(With the default 120 cols this yields ~9.6MB, i.e. the cols-based term dominates the 4MB floor —
that is fine and intended: wider terminals get a proportionally larger tail.)

Then in `restore_session`, replace the full read at `pty.rs:489`:

```rust
// 1. Read a bounded tail of the old session's log (no DB lock needed).
// Only the last VT100_SCROLLBACK lines survive sanitize_history, so reading
// more than a generous tail is wasted time and memory. The tail may start
// mid-escape/mid-alt-screen; strip_alternative_screen handles an unmatched
// alt-screen *exit* (see its comment), and the one partial first line falls
// off the 10k-line scrollback.
// Known accepted edge (same as the old 1MB-trim behavior): if the log ENDS
// inside an un-exited alt-screen (app killed inside vim) and the cut lands
// after the ?1049h enter, alt-screen content leaks into the restore.
let raw_history = pty_log::read_tail(
	&ctx.output_dir,
	old_session_id,
	restore_tail_cap(config.cols),
);
```

The two `tracing::info!` lines around it (`pty.rs:490,494`) can stay as-is (`raw_bytes` now reports
the tail size, which is the honest number for what was processed).

### Step 3 — fix the stale comment in `strip_alternative_screen`

At `pty.rs:88` change `// The persisted buffer may start mid-alt-screen after 1MB trimming.` to
reference the tail cap instead, e.g. `// The buffer may start mid-alt-screen because restore feeds
only a bounded tail of the log (see restore_tail_cap).` Do not change the logic — lines 84-92
already implement exactly what a tail cut needs.

### Step 4 (recommended, small) — cap `get_history` the same way

`service::pty::get_history` (`pty.rs:432-436`) also uses `read_all` and backs the
`get_pty_session_history` command (`src-tauri/src/handler/pty.rs:80-86`), which ships the **full
raw log over Tauri IPC** to xterm (`src/features/terminal/Terminal.tsx:648`, used to recover
output produced between session create and stream attach). Normally that gap is tiny, but the read
is just as unbounded, and it runs for every tab attach.

Apply the same cap. `get_history` has no `cols` in scope; use a fixed generous constant:

```rust
pub fn get_history(output_dir: &Path, session_id: &str) -> Vec<u8> {
	// Cap what we ship over IPC: xterm's own scrollback is bounded, and a cut
	// mid-sequence costs at most one garbled line at the very top.
	let data = pty_log::read_tail(output_dir, session_id, HISTORY_TAIL_BYTES);
	...
}
```

with `const HISTORY_TAIL_BYTES: u64 = 16 * 1024 * 1024;` (16MB — comfortably above
`restore_tail_cap` for any realistic cols, so behavior only changes for pathological logs).
Note the existing integration test `large_output_is_not_capped`
(`src-tauri/tests/integration_pty_db.rs:311-323`) writes 1.5MB and asserts it reads back in full —
1.5MB < 16MB, so it still passes; optionally rename/re-comment it to "large output below the tail
cap is not trimmed". If you want zero behavior change outside restore, this step can be dropped —
but then leave a comment on `get_history` explaining why it intentionally stays uncapped.

Do **not** implement on-disk rotation/truncation in this change — the read-side cap captures the
whole measured win, and rotation would interact with `SessionLog::clear`, the `ESC[3J` handling,
and the append-only invariants. It can be a follow-up if disk usage (not restore latency) ever
becomes the complaint.

### Step 5 — doc touch-ups

- `src-tauri/crates/infra/src/pty_log.rs` module doc: see Step 1.
- `src-tauri/crates/infra/CLAUDE.md` (table row for `pty_log.rs` says "No byte cap") and the root `/home/user/2code/CLAUDE.md` PTY paragraph ("No byte cap — …"): amend to "no on-disk byte cap; restore/history reads are capped to a bounded tail (`read_tail`)". Keep edits minimal.

### Step 6 — tests (see Verification for the full list)

Add unit tests colocated per repo convention (`#[cfg(test)]` modules):

**`infra/src/pty_log.rs` tests** (follow the existing `tmp()` helper pattern):
- `read_tail_returns_whole_file_when_smaller_than_cap`
- `read_tail_returns_exactly_last_max_bytes_when_larger` (write e.g. 100 bytes, cap 30, assert result == last 30 bytes)
- `read_tail_exact_size_boundary` (file len == cap)
- `read_tail_missing_session_reads_empty`
- `read_tail_zero_cap_reads_empty`

**`service/src/pty.rs` tests** (the sanitize test helpers `strip_ansi` etc. already live there,
`pty.rs:943+`):
- `restore_tail_cap_floor_and_cols_scaling`: assert `restore_tail_cap(80) == max(4MB, 10000*80*8)` and `restore_tail_cap(0) >= RESTORE_TAIL_MIN_BYTES`.
- `sanitize_of_tail_equals_sanitize_of_full_log` (the load-bearing equivalence property, mirroring the verifier's assert): synthesize ~10MB of realistic short ANSI lines (e.g. `format!("\x1b[32mline {i}\x1b[0m\r\n")` repeated), compute `full = sanitize_history(&log, 40, 120)` and `tail = sanitize_history(&log[log.len() - restore_tail_cap(120).min(log.len() as u64) as usize..], 40, 120)`, `assert_eq!(full, tail)`. Runtime ≈ 250ms in release, a bit more in debug — acceptable; keep the log at 10MB, not 200MB.
- (Optional) an alt-screen variant: same equivalence when the log contains `\x1b[?1049h ... \x1b[?1049l` sections that are fully *before* the cut and fully *inside* the tail — both already covered structurally by existing tests `sanitize_alt_screen_truncated_history_drops_prefix_until_exit` (`pty.rs:1115`) and `sanitize_alt_screen_exited` (`pty.rs:1064`), so only add if cheap.

## Verification

**Environment constraint (important):** building the full Tauri app crate fails in CI containers
(missing GTK system libs). NEVER run plain `cargo build` / `cargo test` / `bun tauri ...` there.
The integration tests in `src-tauri/tests/` belong to the app crate and therefore only run on a
real dev machine — which is why all new tests above go in the `infra` and `service` crates.

1. Workspace-crate tests (must all pass; 151 tests pass before this change, plus the new ones after):
   ```bash
   cd /home/user/2code/src-tauri && cargo test -p model -p repo -p service -p infra
   ```
2. Targeted runs while iterating:
   ```bash
   cd /home/user/2code/src-tauri && cargo test -p infra read_tail
   cd /home/user/2code/src-tauri && cargo test -p service sanitize
   cd /home/user/2code/src-tauri && cargo test -p service restore_tail_cap
   ```
3. Existing coverage that guards this area (must stay green):
   - `service/src/pty.rs` sanitize suite (`sanitize_*`, esp. `sanitize_alt_screen_truncated_history_drops_prefix_until_exit` at `pty.rs:1115` — proves the mid-stream start handling the tail cut relies on).
   - `infra/src/pty_log.rs` tests (`append_then_read_roundtrips`, `binary_data_preserved`, ...).
   - On a dev machine only: `src-tauri/tests/integration_pty_db.rs` (history/restore flows; `large_output_is_not_capped` at line 311 — see Step 4 note).
4. Frontend is untouched, but as a smoke check that nothing regenerated/changed on the TS side:
   ```bash
   cd /home/user/2code && bunx vitest run src/features/terminal
   ```
5. Optional perf proof (only if asked to demonstrate the win): a temporary benchmark comparing
   `read_all + sanitize_history` vs `read_tail + sanitize_history` on a synthetic 50MB log —
   expect ~10x (order of 878ms → 86ms in release). Write it as a `#[test] #[ignore]` in the
   service crate and run with `cargo test -p service --release -- --ignored bench_restore_tail`;
   delete it before committing unless the team wants to keep it.
6. Manual check on a dev machine (not possible in the container — no display): run `bun tauri dev`,
   open a terminal, generate lots of output (`yes | head -c 100000000` or a long-running dev
   server), quit, relaunch — scrollback should restore visibly faster and look identical (last
   10k lines).

**Acceptance criteria:**
- `restore_session` never reads more than `restore_tail_cap(cols)` bytes from disk.
- `sanitize_of_tail_equals_sanitize_of_full_log` passes (byte-identical restored scrollback for logs where the tail covers > 10k lines).
- All pre-existing crate tests pass unchanged.

## Risks & Constraints

**CLAUDE.md / repo invariants to respect:**
- Layered architecture: the file/seek mechanics live in `infra::pty_log` (I/O layer); the cap *policy* (constant + `restore_tail_cap`) lives in `service::pty` (business logic). Do not put policy in infra or I/O in service.
- No Tauri command signatures change → do not run `cargo tauri-typegen generate`, do not touch `src/generated/` or `src/api/`.
- Do not touch `src-tauri/src/schema.rs`, migrations, or DB pragmas — this change is file-I/O only, no DB involvement.
- Do not alter the live-output path: PTY bytes must keep flowing as raw `&[u8]` over the per-session IPC `Channel` with no re-chunking/decoding; this change only affects the *restore/history read* seams.
- Do not change the persistence thread (32KB batch / 250ms flush / `PersistMsg::Clear` semantics) — the on-disk format and append-only contract stay exactly as-is.
- Tests colocated in `#[cfg(test)]` modules, matching existing patterns in both files.

**Regression risks and mitigations:**
- *Alt-screen leak at the cut (known, accepted):* if the log ends inside an un-exited alt-screen (app killed while in vim/tmux) AND the tail cut lands after the `?1049h` enter, alt-screen content leaks into the restored scrollback, because `strip_alternative_screen`'s unmatched-exit rule (`pty.rs:84-92`) only fires when a later *exit* appears. The removed 1MB-trim era had exactly this limitation, so this restores previously-accepted behavior. Document it in the code comment (Step 2) — do not try to "fix" it here (it would require scanning the whole log, defeating the point).
- *Cut lands mid-UTF-8 or mid-escape-sequence:* at most the first partial line renders garbled inside vt100, and since the tail covers well over `VT100_SCROLLBACK` lines, that line falls off the scrollback and never reaches the output. Verified byte-identical at 5/50/200MB. The equivalence test (Step 6) locks this in.
- *Very long lines* (e.g. `cat` of a huge base64 blob with no newlines): the `cols * 8` term in `restore_tail_cap` keeps the tail covering > 10k *visual* lines since vt100 wraps at `cols`; a single logical line longer than the whole cap simply restores its last portion — same information loss the 10k-line scrollback already imposes.
- *Behavior change in `get_history` (Step 4):* logs > 16MB now ship only their tail to xterm; the raw replay may start mid-sequence (one garbled top line at worst, and `Terminal.tsx` flushes before fetching so no recent bytes are lost). If this is judged too risky, drop Step 4 — Steps 1-3 alone deliver the measured startup win.
- *`0` / tiny cols:* `cols.max(1)` in `restore_tail_cap` plus the 4MB floor guarantee a sane cap even for degenerate configs.
- Keep `read_all` public and untouched — `pty_log` unit tests and `service` tests still use it, and it remains correct for small files.
