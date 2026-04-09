# AGENTS.md — src-tauri/crates/service

## OVERVIEW
Business logic layer. Orchestrates between repo (DB) and infra (OS/IO). No direct Tauri bindings here.

## FILES
| File | Role |
|------|------|
| `project.rs` | Create/update/delete projects; folder validation; config loading via infra |
| `profile.rs` | Create profile → git worktree add → run setup_script; delete → teardown_script → worktree remove |
| `pty.rs` | PTY session create/close/restore; session cleanup (`mark_all_open_sessions_closed`); output chunk management |
| `watcher.rs` | File system watcher setup and event routing |
| `debug.rs` | Debug log session management |
| `lib.rs` | Re-exports |

## KEY PATTERNS

**Profile lifecycle** (most complex operation):
1. Validate project has git repo
2. Generate branch name via `infra::slug` (CJK-aware)
3. `git worktree add ~/.2code/workspace/{profile_id} {branch}` 
4. Run `setup_script` from `2code.json` in the worktree dir
5. On delete: run `teardown_script` → `git worktree remove` → delete branch

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
