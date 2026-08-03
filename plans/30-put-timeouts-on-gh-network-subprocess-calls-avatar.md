# Put timeouts on gh/network subprocess calls (avatar and PR-status polling)

> On a wedged network/proxy, `gh` subprocesses spawned by the avatar and PR-status paths block forever, so the PR badge and first-load project avatars never settle; add a hard timeout to `gh pr list` and drop the redundant `gh api` avatar probe. | Severity: low | Category: correctness

## Problem

Two functions in `src-tauri/crates/infra/src/git.rs` spawn the `gh` CLI — a **network** call — synchronously via `std::process::Command::output()` with **no timeout**:

1. **Avatar probe** — `github_avatar_url` (`src-tauri/crates/infra/src/git.rs:35-42`) calls the private helper `github_avatar_url_from_api` (`git.rs:44-60`), which runs:

   ```rust
   let output = command_without_windows_console("gh")
       .args(["api", &format!("users/{owner}"), "--jq", ".avatar_url"])
       .output();
   ```

   The result is only a nicety: if the probe fails (or `gh` is not installed), line 41 returns the deterministic fallback `https://avatars.githubusercontent.com/{owner}?v=4` anyway. So a slow/hung `gh api` call can only *delay* a result that has a static, functionally-equivalent fallback.

2. **PR-status lookup** — `pull_request_status_for_branch` (`git.rs:876-926`) runs `gh pr list --head <branch> --state all --json ... --limit 100` via `.output()` at `git.rs:892-906`, again with no timeout.

`gh` has no default request timeout. On a blackholed/wedged network or proxy, TCP connect can block for ~2 minutes and stalled reads can block indefinitely. (Note: interactive-prompt hangs are *not* a real failure mode here — `Command::output()` nulls stdin and `gh` is non-interactive without a TTY. The target scenario is a degraded network.)

**How the hang reaches the UI:**

- `get_git_pull_request_status` (`src-tauri/src/handler/project.rs:304-318`) and `get_project_github_avatar` (`handler/project.rs:420-430`) both wrap these calls in `super::run_blocking` (`handler/mod.rs:17`), i.e. a tauri `spawn_blocking` thread.
- The frontend polls PR status every 2 minutes for the active profile: `src/features/git/hooks.ts:29` (`PR_STATUS_REFRESH_INTERVAL_MS = 2 * 60 * 1_000`), used at `hooks.ts:122` with `retry: false` (`hooks.ts:123`).
- Avatars are fetched once per project by `useProjectAvatar` (`src/features/projects/hooks.ts:86-113`) with only a localStorage cache; on first run (cold cache) every sidebar project triggers the probe.

**Accurate blast radius** (do not overstate): TanStack Query dedupes interval refetches while a fetch is in flight, and the PR-status query is enabled only for the active profile. So hung threads do **not** accumulate one-per-poll — the damage is bounded to one blocked `spawn_blocking` thread per distinct query key. The real defect is that on a degraded network these queries *never settle* (no timeout, `retry: false` never fires because the promise never rejects), so the PR badge and uncached avatars hang indefinitely with no recovery path.

Codebase precedent exists for gh-hang awareness — `src-tauri/src/handler/updater.rs:64-69` (`gh_auth_token`) sets `.env("GH_PROMPT_DISABLED", "1")` — but `git.rs` has no guard at all.

## Evidence & Measurements

No benchmarks (non-perf finding). Concrete code evidence:

- `git.rs:45-47` — `command_without_windows_console("gh").args(["api", ...]).output()`: no timeout, and the result is used only as a nicety before the static fallback at `git.rs:41`. The probe is provably redundant: whatever it returns, line 41's `https://avatars.githubusercontent.com/{owner}?v=4` resolves to the same image (GitHub's username-based avatar endpoint).
- `git.rs:892-906` — `gh pr list ... --limit 100` via `.output()` with no timeout, invoked from a handler on a 2-minute `refetchInterval` (`src/features/git/hooks.ts:122`).
- No `wait_timeout`, kill-timer, or any subprocess timeout mechanism exists anywhere in the repo (grep for `wait_timeout`/`try_wait` comes up empty in `src-tauri/`).
- `pull_request_status` (`git.rs:869-874`) additionally runs `branch()` and `remote_url()` first — both are local git commands and fast; only the `gh` step is a network call.
- Measured impact assessment: real but bounded — one blocked thread per distinct query key, indefinite non-settling PR-status/avatar queries; UX degradation only, no crash or pool starvation.

## Proposed Change

Three edits, all in the `infra` crate (no handler/command signature changes, so **no** `cargo tauri-typegen generate` needed and **no** frontend changes needed).

### Step 1 — Add a reusable `output_with_timeout` helper: new file `src-tauri/crates/infra/src/process.rs`

Std-only implementation (no new dependency; avoids the `wait-timeout` crate). Two subtleties the sketch handles:

- **Pipe-fill deadlock**: with piped stdout/stderr you must drain the pipes concurrently, otherwise a child producing > ~64 KB blocks before exiting (`gh pr list --limit 100 --json ...` can exceed that). Reader threads drain into `Vec<u8>`.
- **Reap on timeout**: kill *and* wait the child so no zombie is left; drop the reader handles rather than joining them on the timeout path (they exit on pipe EOF in the background) so the caller can never block.

```rust
use std::io::Read;
use std::process::{Command, Output, Stdio};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

/// Run `command` to completion, but give up after `timeout`.
///
/// Returns:
/// - `Ok(Some(output))` — the process finished within the deadline
/// - `Ok(None)`         — deadline hit; the child was killed and reaped
/// - `Err(_)`           — spawn failed (e.g. binary not found)
pub fn output_with_timeout(
	command: &mut Command,
	timeout: Duration,
) -> std::io::Result<Option<Output>> {
	let mut child = command
		.stdin(Stdio::null())
		.stdout(Stdio::piped())
		.stderr(Stdio::piped())
		.spawn()?;

	let stdout_reader = spawn_pipe_reader(child.stdout.take());
	let stderr_reader = spawn_pipe_reader(child.stderr.take());

	let deadline = Instant::now() + timeout;
	let status = loop {
		match child.try_wait()? {
			Some(status) => break status,
			None if Instant::now() >= deadline => {
				let _ = child.kill();
				let _ = child.wait(); // reap; readers unblock on pipe EOF
				// Intentionally do NOT join the readers here — never block
				// the caller past the deadline. The detached threads exit
				// on EOF and their buffers are discarded.
				drop(stdout_reader);
				drop(stderr_reader);
				return Ok(None);
			}
			None => std::thread::sleep(Duration::from_millis(25)),
		}
	};

	Ok(Some(Output {
		status,
		stdout: join_reader(stdout_reader),
		stderr: join_reader(stderr_reader),
	}))
}

fn spawn_pipe_reader<R: Read + Send + 'static>(
	pipe: Option<R>,
) -> Option<JoinHandle<Vec<u8>>> {
	pipe.map(|mut pipe| {
		std::thread::spawn(move || {
			let mut buf = Vec::new();
			let _ = pipe.read_to_end(&mut buf);
			buf
		})
	})
}

fn join_reader(handle: Option<JoinHandle<Vec<u8>>>) -> Vec<u8> {
	handle.and_then(|handle| handle.join().ok()).unwrap_or_default()
}
```

Register the module in `src-tauri/crates/infra/src/lib.rs` (currently modules `archive, config, db, filesystem, git, logger, no_window, office, pty, pty_log, shell_init, slug, watcher` — insert `pub mod process;` in alphabetical order after `office`... note the list is alphabetical: place it between `office` and `pty`).

Add unit tests in a `#[cfg(test)] mod tests` at the bottom of `process.rs` (see Verification for the exact cases). This repo colocates tests in `#[cfg(test)]` modules — follow that pattern. Match the repo's hard-tab indentation (rustfmt config uses tabs — copy the style of `git.rs`).

### Step 2 — Delete the redundant `gh api` avatar probe: `src-tauri/crates/infra/src/git.rs:35-60`

Replace `github_avatar_url` with the fallback-only version and delete `github_avatar_url_from_api` entirely:

```rust
pub fn github_avatar_url(folder: &str) -> Option<String> {
	let remote_url = remote_url(folder).ok().flatten()?;
	let (owner, _) = parse_github_owner_and_repo(&remote_url)?;
	Some(format!("https://avatars.githubusercontent.com/{owner}?v=4"))
}
```

Rationale: the probe's result is functionally identical to the constructed URL (GitHub serves the canonical avatar at `avatars.githubusercontent.com/{username}?v=4`), so this removes a subprocess *and* a network dependency for zero functional loss — no timeout wrapper even needed on this path. There are no existing Rust tests covering `github_avatar_url_from_api` (only `parse_github_owner_and_repo` is tested, `git.rs:1757-1785`), and the frontend avatar tests (`src/features/projects/hooks.avatar.test.tsx`) mock the generated `getProjectGithubAvatar` binding, so nothing else needs updating. The callers (`src-tauri/src/handler/project.rs:427`, `src-tauri/crates/service/src/project.rs:361`) are unchanged — same signature `fn(&str) -> Option<String>`.

### Step 3 — Timeout on `gh pr list`: `src-tauri/crates/infra/src/git.rs:876-926`

In `pull_request_status_for_branch`, replace the `.output()` call at `git.rs:892-906` with the timeout wrapper, map timeout to `Ok(None)`, and add the `GH_PROMPT_DISABLED` guard matching `handler/updater.rs:67`:

```rust
use std::time::Duration; // add to the imports at the top of git.rs

/// Hard cap on gh CLI network calls; a hung gh must not wedge
/// spawn_blocking threads or leave frontend queries unsettled.
const GH_COMMAND_TIMEOUT: Duration = Duration::from_secs(10);
```

```rust
	let mut command = command_without_windows_console("gh");
	command
		.args([
			"pr",
			"list",
			"--head",
			branch_name,
			"--state",
			"all",
			"--json",
			"number,title,state,url,isDraft,headRefName,headRepositoryOwner",
			"--limit",
			"100",
		])
		.env("GH_PROMPT_DISABLED", "1")
		.current_dir(folder);

	let output = match crate::process::output_with_timeout(
		&mut command,
		GH_COMMAND_TIMEOUT,
	) {
		Ok(Some(output)) => output,
		// gh hung past the deadline (wedged network/proxy). Treat as
		// "no PR info this tick" — the 2-minute poll retries naturally.
		Ok(None) => return Ok(None),
		Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
			return Err(AppError::GitError("gh CLI not found".into()));
		}
		Err(error) => return Err(AppError::IoError(error)),
	};
```

Keep everything after this point unchanged: the `output.status.success()` check with `is_non_github_pr_lookup_error` short-circuit (`git.rs:916-922`) and `parse_pull_request_list` (`git.rs:924-925`).

Why `Ok(None)` on timeout rather than an error: the frontend hook uses `retry: false` (`hooks.ts:123`), so an error would flash a failure state; `None` means "no PR badge right now" and the next 2-minute tick (`hooks.ts:122`) recovers automatically once the network heals. The query now always settles within ~10 s.

Do **not** wrap the plain `git` invocations (`remote_url`, `branch`, `push`, etc.) — they are local and out of scope for this finding.

## Verification

Container constraints: the full tauri app crate **cannot** be built here (missing GTK system libs) — never run plain `cargo build`/`cargo test` in `src-tauri/`, and never `bun tauri ...`. Always use `-p` flags.

1. **Rust workspace crates build + full test sweep** (151 tests pass before the change; expect the same count plus the new `process.rs` tests):

   ```bash
   cd /home/user/2code/src-tauri && cargo test -p model -p repo -p service -p infra
   ```

2. **New unit tests to add** in `src-tauri/crates/infra/src/process.rs` (`#[cfg(test)]` module; gate the shell-based ones `#[cfg(unix)]` since they use `sh`, which is unavailable on Windows — the CI container is Linux):

   - `completes_within_timeout_returns_output`: `Command::new("sh").args(["-c", "printf hello"])` with a 10 s timeout → `Ok(Some(output))`, `output.status.success()`, `output.stdout == b"hello"`.
   - `captures_stderr`: `sh -c "printf err >&2; exit 3"` → `Ok(Some(output))`, `!output.status.success()`, `output.stderr == b"err"`.
   - `kills_process_on_timeout`: `sh -c "sleep 30"` with a 250 ms timeout → `Ok(None)`, and assert wall-clock elapsed `< Duration::from_secs(5)` (proves it did not wait for the sleep).
   - `large_output_does_not_deadlock`: `sh -c "head -c 1000000 /dev/zero"` (1 MB, well past the ~64 KB pipe buffer) with a 10 s timeout → `Ok(Some(output))`, `output.stdout.len() == 1_000_000` (proves the reader threads prevent pipe-fill deadlock).
   - `spawn_error_propagates`: `Command::new("definitely-not-a-real-binary-2code")` → `Err` with `kind() == ErrorKind::NotFound`.

   Run them specifically with:

   ```bash
   cd /home/user/2code/src-tauri && cargo test -p infra process::
   ```

3. **Existing coverage of the touched area**: the PR-status parsing tests in `git.rs` (`parse_pull_request_list_maps_gh_json` at `git.rs:2008`, `parse_pull_request_list_filters_by_head_owner` at `git.rs:2027`, `parse_pull_request_list_accepts_empty_list` at `git.rs:2041`, plus the `parse_github_owner_and_repo_*` tests at `git.rs:1757-1785`) must all still pass unchanged — they cover the pure logic downstream/upstream of the swapped subprocess call. `cargo test -p infra git::` runs them.

4. **Frontend regression check** (nothing should change — the command signatures and semantics from the frontend's perspective are identical):

   ```bash
   cd /home/user/2code && bunx vitest run src/features/projects/hooks.avatar.test.tsx src/shared/lib/queryKeys.test.ts
   ```

   Optionally the full suite: `bunx vitest run` (671 tests pass before the change).

5. **Manual smoke test** (only on a dev machine with a display, not in this container): `bun tauri dev`, open a project with a GitHub remote → sidebar avatar appears (now instantly, no `gh api` subprocess); open a profile with an open PR → PR badge appears within one poll. Simulate a blackholed network (e.g. `sudo iptables -A OUTPUT -d api.github.com -j DROP`, or point `HTTPS_PROXY` at a non-responsive address) → PR-status query settles to no-badge within ~10 s instead of hanging, and recovers on the next 2-minute tick after restoring the network.

## Risks & Constraints

- **CLAUDE.md invariants respected**: no handler signatures change, so `src/generated/` bindings stay valid and `cargo tauri-typegen generate` is not required (running it is harmless but unnecessary). Do not touch `src/generated/`, `src/paraglide/`, `project.inlang/settings.json`, or `src-tauri/src/schema.rs`. Handlers stay thin — the timeout logic lives in `infra`, per the layered architecture.
- **Formatting**: the repo uses hard tabs in Rust (see any existing file); `just fmt` runs `fama` if available, otherwise match the surrounding style by hand.
- **Avatar URL behavior change**: `github_avatar_url` now always returns `https://avatars.githubusercontent.com/{owner}?v=4` instead of occasionally the canonical `.../u/{id}?v=4` URL from `gh api`. Both resolve to the same image for github.com users, and `parse_github_owner_and_repo` already returns `None` for non-github.com hosts (`git.rs:1686-1688`), so the constructed URL is never emitted for GHES/GitLab remotes. The frontend caches whatever string it gets in localStorage (`useProjectAvatar`, `src/features/projects/hooks.ts:86-113`) with no format assumptions; stale cached `gh api` URLs remain valid.
- **Orgs vs users**: the old probe hit `users/{owner}`, which already failed for org-owned repos and fell through to the constructed URL — so org behavior is unchanged (the username-based avatar endpoint serves org avatars too).
- **Timeout on a slow-but-healthy network**: a `gh pr list` that legitimately takes > 10 s now yields `Ok(None)` (badge briefly absent) instead of eventually succeeding. This is the intended trade-off; 10 s is generous for a JSON list call, and the 2-minute poll self-heals. Keep the constant local and named (`GH_COMMAND_TIMEOUT`) so it is easy to tune.
- **Grandchild processes**: `child.kill()` signals only the direct `gh` process, not any grandchildren. `gh` does not spawn a pager when stdout is a pipe, so in practice the reader threads always see EOF; the timeout path deliberately drops (does not join) the reader handles so even a pathological grandchild holding the pipe open cannot block the caller — worst case a detached thread lingers until EOF.
- **Timeout ≠ error is load-bearing**: mapping timeout to `Ok(None)` (not `Err`) matters because the hook sets `retry: false` — do not "improve" it to an error without also revisiting `src/features/git/hooks.ts:108-125`.
- **Do not over-justify**: the accurate rationale is indefinitely non-settling queries plus one blocked `spawn_blocking` thread per distinct query key. TanStack Query dedupes in-flight interval refetches and the PR-status query runs only for the active profile — threads do *not* accumulate every 2 minutes, and `Command::output()` nulls stdin so interactive-prompt hangs are not a real mode. Frame any commit message/PR description accordingly.
- **Test flakiness**: the `kills_process_on_timeout` assertion uses a generous 5 s bound on a 250 ms timeout to stay robust on loaded CI machines; do not tighten it below ~2 s.
