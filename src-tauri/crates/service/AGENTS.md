# AGENTS.md — src-tauri/crates/service

## OVERVIEW
Business logic layer. Orchestrates between repo (DB) and infra (OS/IO). No direct Tauri bindings here.

## FILES
| File | Role |
|------|------|
| `project.rs` | Create/update/delete projects; folder validation; config loading via infra |
| `profile.rs` | Create profile via Herdr `worktree.create` / `workspace.create`; delete via `worktree.remove` / `workspace.close` |
| `runtime.rs` | Herdr-only RuntimeRouter (create/list/close/write/resize/restore) |
| `runtime/herdr.rs` | Herdr adapter: pane_id sessions, frame stream, snapshot list |
| `watcher.rs` | File system watcher setup and event routing |
| `debug.rs` | Debug log session management |
| `lib.rs` | Re-exports |

## KEY PATTERNS

**Profile lifecycle** (most complex operation):
1. Validate project has git repo
2. Generate branch name via `infra::slug` (CJK-aware)
3. Resolve worktree base from project `2code.json` `worktree_dir`, then global default, then `~/.2code/workspace`
4. `git worktree add {base}/{project}-{branch}-{short_profile_id} {branch}`
5. Run `setup_script` from `2code.json` in the worktree dir
6. On delete: run `teardown_script` → `git worktree remove` → delete branch

**Herdr sessions**: create/list/close/write/resize go through `RuntimeRouter` (Herdr-only). Restore reattaches a live `pane_id`. There is no Local portable-pty spawn or sqlite `pty_sessions` scrollback.

**Worktree path**: Project `2code.json` `worktree_dir` wins, then the global Settings default, then `~/.2code/workspace`. Relative paths and `~` are resolved before `git worktree add`.

## WHERE TO LOOK

| Task | Location |
|------|----------|
| Profile worktree path | `profile.rs` — `resolve_worktree_base` + `build_worktree_dir_name` |
| Herdr session restore | `runtime/herdr.rs` — reattach live `pane_id` |
| Script execution | `infra::config::run_script` |
| Branch slug generation | `infra::slug` |
