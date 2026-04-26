# AGENTS.md — src-tauri/crates/service

## OVERVIEW
Business logic layer. Orchestrates between repo (DB) and infra (OS/IO). No direct Tauri bindings here.

## FILES
| File | Role |
|------|------|
| `project.rs` | Create/update/delete projects; folder validation; config loading via infra; **all git operations** (`list_branches`, `list_remotes`, `list_remote_branches`, `list_tags`, `checkout_branch`, `create_branch`, `delete_branch`, `rename_branch`, `fetch`, `pull`, `push_with_lease`, `merge_ref`, `rebase_onto`, `delete_remote_branch`, `rename_remote_branch`, `get_commit_graph`, `index_status`, `stage_*` / `unstage_*`, `commit_files`, `revert_file_in_commit`, `get_in_progress_op`, `continue_op`, `abort_op`, `get_conflict_state`, `mark_conflict_resolved`, `rewrite_commits`, `amend_head_message`, identity get/set, stash list/push/pop/apply/drop) |
| `profile.rs` | Create profile → git worktree add → run setup_script; delete → teardown_script → worktree remove |
| `pty.rs` | PTY session create/close/restore; session cleanup (`mark_all_open_sessions_closed`); output chunk management |
| `watcher.rs` | File system watcher setup and event routing |
| `filesystem.rs` | File search / read helpers used by the file viewer |
| `lib.rs` | Re-exports |

## KEY PATTERNS

**Profile lifecycle** (most complex operation):
1. Validate project has git repo
2. Generate branch name via `infra::slug` (CJK-aware)
3. `git worktree add ~/.2code/workspace/{profile_id} {branch}`
4. Run `setup_script` from `2code.json` in the worktree dir
5. On delete: run `teardown_script` → `git worktree remove` → delete branch

**Git layer is mostly passthrough**: `service::project` git functions delegate to `infra::git::*` 1:1. The service layer exists so handlers don't reach into infra directly and so future caching / orchestration has a place to live.

**Cancellable git ops**: long-running ops (`fetch`, `pull`, `push_with_lease`, `merge_ref`, `rebase_onto`, `delete_remote_branch`, `rename_remote_branch`) take a `&infra::git::CancelToken`. The handler layer wraps them with `run_cancellable_op` (registers the token under an `op_id`, removes it on completion).

**PTY cleanup**: `mark_all_open_sessions_closed()` runs on both startup (orphan cleanup) and graceful shutdown.

**PTY persistence architecture**: `PersistMsg` enum (`Data`, `Flush`, `Clear`) — background thread per session batches 32KB chunks, flushes every 250ms. `PtyFlushSenders` allows async flush from frontend.

**Scrollback restore**: `strip_alternative_screen()` strips alternate screen buffer content (vim/tmux) by parsing VT100 escape sequences (`ESC [ ? 1047m`) before replaying history. Caps at 10KB to prevent bloat.

**Worktree path**: `~/.2code/workspace/{profile_id}` — hardcoded convention, not configurable.

## WHERE TO LOOK
| Task | Location |
|------|----------|
| Profile worktree path | `profile.rs` — `~/.2code/workspace/` |
| PTY session restore | `pty.rs::restore_pty_session` |
| Script execution | `infra::config::run_script` |
| Branch slug generation | `infra::slug` |
| Add a new git command | `infra::git::cli` or `gix` → add a passthrough in `project.rs` → add a handler in `src-tauri/src/handler/project.rs` → register in `lib.rs` |
