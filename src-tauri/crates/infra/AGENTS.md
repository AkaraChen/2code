# AGENTS.md — src-tauri/crates/infra

## OVERVIEW
Cross-cutting infrastructure. All I/O, OS interaction, and external process management lives here.

## FILES

### Top-level

| File | Role |
|------|------|
| `db.rs` | SQLite init + WAL pragma + `embed_migrations!()` auto-run on startup |
| `pty.rs` | PTY session lifecycle: spawn shell, 4KB read loop, UTF-8 boundary detection, 1MB cap with oldest-chunk pruning |
| `shell_init.rs` | ZDOTDIR-based shell init injection — sets `_2CODE_HELPER`, `_2CODE_HELPER_URL`, `_2CODE_SESSION_ID` env vars |
| `helper.rs` | Axum HTTP server (sidecar endpoint) — receives `/notify?session_id=` → plays sound + emits `pty-notify` event |
| `config.rs` | Load `2code.json` from project root + execute `setup_script`/`teardown_script` via `sh -c` |
| `logger.rs` | Debug log capture + `start_debug_log`/`stop_debug_log` implementation |
| `slug.rs` | CJK-aware slug generation using `pinyin` crate — for profile worktree directory/branch names |
| `watcher.rs` | `notify` crate file system watcher → emits `watch-event` Tauri events |

### `git/` submodule

Git is split across many files since the revamp. Reads use `gix` (gitoxide); writes shell out to the `git` CLI.

| File | Role |
|------|------|
| `git/mod.rs` | Module declarations + re-exports |
| `git/backend.rs` | `GitBackend` trait + `CliBackend` + `GixBackend`; `default_backend()` picks the right one per op |
| `git/cli.rs` | Shell-out write paths: stage/unstage/commit (whole-file + per-hunk + per-line), patch parsing, file diff sides, fetch, pull, push (with-lease + raw force), merge, rebase, delete-remote-branch, rename-remote-branch (push-then-drop), worktree add/remove, etc. |
| `git/gix.rs` | Read paths via `gix`: log walk, branch lookup, ahead/behind count |
| `git/branches.rs` | `for-each-ref`-based branch / remote / remote-branch / tag listing; create / checkout / delete / rename for local branches |
| `git/graph.rs` | Lane-assigned commit graph computation; emits `edges_up` + `edges_down` per row for the frontend canvas |
| `git/stash.rs` | Stash list / push / pop / apply / drop |
| `git/inprogress.rs` | Detects in-progress merge / rebase / cherry-pick / revert via `.git/MERGE_HEAD` etc.; conflict listing; `mark_conflict_resolved` writes the resolved blob and stages it |
| `git/rewrite.rs` | History-rewrite engine: reword, squash, drop, set identity. Drives `git rebase -i` programmatically via `GIT_SEQUENCE_EDITOR` + `GIT_EDITOR` |
| `git/identity.rs` | Per-project / per-profile committer identity overrides; layered config lookup |
| `git/cancel.rs` | `CancelToken` (`Arc<AtomicBool>`) + `run_cancellable()` for long-running commands; polled in a tight loop while the child process runs |
| `git/audit.rs` | Structured audit logging for every git op via `tracing` (target = `git_audit`) |
| `git/watcher.rs` | `.git/` watcher with debounce + circuit breaker; emits Tauri events that the frontend turns into query invalidations |

## KEY NOTES
- **`find_utf8_boundary`** in `pty.rs` — DO NOT remove; prevents splitting multibyte chars when flushing 4KB chunks
- **`helper.rs`** runs an Axum server in a background thread; port stored in env var passed to PTY shells
- **`slug.rs`** is well-tested; handles CJK → pinyin romanization (don't simplify)
- **`db.rs`** uses WAL journal mode + `foreign_keys=ON` — don't change pragmas without testing
- **`git/cli.rs`** validates every user-provided arg (`validate_branch_name`, `validate_commit_hash`, `validate_remote_token`, `validate_revspec`) before passing to `git` to defend against argv injection (`--upload-pack=evil` etc.). Add a validator for any new argument-position string
- **`git/branches.rs::list_remote_branches`** skips `<remote>/HEAD` symref entries — those are pointers, not branches the user thinks of as distinct rows
- **`git/cli.rs::rename_remote_branch`** pushes the new ref *first*, then deletes the old. Reversing the order would lose work if the second push raced and failed
- **`gix` is pinned to 0.82** with `default-features = false` + explicit `sha1` feature. Without `sha1`, `gix-hash`'s `Kind` enum has zero variants and matches become non-exhaustive on rustc ≥ 1.94
- **`git/gix.rs`**: `SignatureRef::time` is `&str` (raw header) in gix 0.82; call `.time()?.seconds` to parse — don't access `.time.seconds` directly

## WHERE TO LOOK
| Task | Location |
|------|----------|
| PTY output chunk size | `pty.rs` — 4KB read, 32KB flush buffer, 1MB cap |
| Shell env injection | `shell_init.rs` |
| Add a git command | `git/cli.rs` (write) or `git/gix.rs` (read); validate inputs; export from `git/mod.rs` |
| Add a long-running cancellable git op | wrap with `super::cancel::run_cancellable(cmd, token)` (see `fetch` / `pull` / `merge_ref` / `rebase_onto` for the pattern) |
| Notification flow | `helper.rs` → service layer |
