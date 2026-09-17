# AGENTS.md — src-tauri/crates/service

## OVERVIEW
Business logic layer. Orchestrates between repo (DB) and infra (OS/IO). No direct Tauri bindings here.

## FILES
| File | Role |
|------|------|
| `project.rs` | Create/update/delete projects; GUI list adopts Herdr checkouts then live-reads profiles |
| `profile.rs` | Create profile via Herdr `worktree.create` / `workspace.create`; delete via `worktree.remove` / `workspace.close` |
| `runtime.rs` | Herdr-only RuntimeRouter (create/list/close/write/resize/restore) |
| `runtime/herdr.rs` | Herdr adapter: pane_id sessions, frame stream, snapshot list |
| `watcher.rs` | File system watcher setup and event routing |
| `lib.rs` | Re-exports |

## KEY PATTERNS

**Profile lifecycle** (most complex operation):
1. Load the sqlite `projects` row (folder + config). Herdr must be up
2. Generate branch name via `infra::slug` (CJK-aware)
3. Resolve worktree base from project `2code.json` `worktree_dir`, then global default, then `~/.2code/workspace`
4. Git New Profile: Herdr `worktree.create` at that path (parent `workspace_id` from live `worktree.list`). Returned `id` is `workspace_id`
5. Non-git New Profile: Herdr `workspace.create --cwd` (the project folder)
6. Run `setup_script` from `2code.json` in the checkout dir
7. On delete: `teardown_script` → Herdr `worktree.remove` (linked git) then 2code `git branch -D`, or `workspace.close` (non-git extras). Primary checkout is refused. No `git worktree remove` fallback

**Herdr sessions**: create/list/close/write/resize go through `RuntimeRouter` (Herdr-only). Restore reattaches a live `pane_id`. There is no Local spawn or sqlite session scrollback.

**Worktree path**: Project `2code.json` `worktree_dir` wins, then the global Settings default, then `~/.2code/workspace`. Relative paths and `~` are resolved before Herdr `worktree.create`. Git / file-tree cwd comes from `reconcile_profile_checkout`, not sqlite `profiles.worktree_path`.

## WHERE TO LOOK

| Task | Location |
|------|----------|
| Profile create/delete | `profile.rs` — `create_with_runtime` / `delete_with_runtime` |
| Profile worktree path | `profile.rs` — `resolve_worktree_base` + `build_worktree_dir_name`; live cwd via `project.rs::reconcile_profile_checkout` |
| Launch/adopt checkouts | `project.rs` — `adopt_existing_checkouts` (GUI list); `list_with_runtime` (watcher live read) |
| Herdr session restore | `runtime/herdr.rs` — reattach live `pane_id` |
| Script execution | `infra::config::run_script` |
| Branch slug generation | `infra::slug` |
