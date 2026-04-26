# AGENTS.md — src-tauri/src/handler

## OVERVIEW
Tauri IPC entry points. Thin delegation layer — no business logic here.

## FILES
| File | Commands |
|------|----------|
| `mod.rs` | `tauri::generate_handler![]` registration; `run_blocking` helper for `spawn_blocking` |
| `debug.rs` | `start_debug_log`, `stop_debug_log` |
| `font.rs` | `list_system_fonts` (macOS only) |
| `sound.rs` | `list_system_sounds`, `play_system_sound` (macOS only) |
| `watcher.rs` | `watch_projects` |
| `filesystem.rs` | File search / read commands for the file viewer |
| `topbar.rs` | Top-bar app commands |
| `profile.rs` | `create_profile`, `delete_profile` |
| `pty.rs` | `create_pty_session`, `write_to_pty`, `resize_pty`, `close_pty_session`, `list_project_sessions`, `get_pty_session_history`, `delete_pty_session_record`, `flush_pty_output`, `restore_pty_session` |
| `project.rs` | ~68 commands. Project CRUD: `create_project_temporary`, `create_project_from_folder`, `list_projects`, `update_project`, `delete_project`, `get_project_config`, `save_project_config`. Plus all git commands (see below) |

### Git commands (in `project.rs`)

Reads:
`is_git_repo`, `get_git_branch`, `get_git_diff`, `get_git_diff_stats`, `get_git_log`, `get_commit_diff`, `get_git_index_status`, `get_git_file_patch`, `get_git_file_diff_sides`, `get_commit_files`, `get_commit_file_diff_sides`, `get_commit_graph`, `list_git_branches`, `list_git_remotes`, `list_git_remote_branches`, `list_git_tags`, `list_git_stashes`, `get_in_progress_op`, `get_conflict_state`, `get_git_identity`, `get_ahead_count`.

Writes (non-cancellable):
`init_git_repo`, `add_git_remote`, `stage_git_files`, `unstage_git_files`, `stage_git_hunk`, `unstage_git_hunk`, `stage_git_lines`, `unstage_git_lines`, `commit_git_files`, `revert_file_in_commit`, `checkout_git_branch`, `create_git_branch`, `delete_git_branch`, `rename_git_branch`, `set_git_identity_cmd`, `unset_git_identity_cmd`, `mark_conflict_resolved`, `continue_in_progress_op`, `abort_in_progress_op`, `git_stash_push` / `pop` / `apply` / `drop`, rewrite engine commands.

Writes (cancellable, take an `op_id`):
`git_fetch`, `git_pull`, `git_push_with_lease`, `git_merge_ref`, `git_rebase_onto`, `git_delete_remote_branch`, `git_rename_remote_branch`, plus `cancel_git_operation` to abort by `op_id`.

## PATTERN

**Standard handler**:
```rust
#[tauri::command]
pub async fn my_command(
    profile_id: String,
    state: State<'_, DbPool>,
) -> Result<ReturnType, AppError> {
    let folder = resolve_folder(state.inner(), profile_id).await?;
    super::run_blocking(move || service::project::do_thing(&folder)).await
}
```

The two-phase pattern (resolve folder while holding the SQLite mutex, then drop it before doing slow git/IO work) is mandatory — long-held locks deadlock the rest of the app.

**Cancellable handler** (long-running git ops):
```rust
#[tauri::command]
pub async fn git_my_op(
    profile_id: String,
    op_id: String,
    state: State<'_, DbPool>,
    tokens: State<'_, GitCancelTokens>,
) -> Result<(), AppError> {
    let folder = resolve_folder(state.inner(), profile_id).await?;
    run_cancellable_op(op_id, tokens.inner(), move |token| {
        service::project::my_op(&folder, &token)
    }).await
}
```

`run_cancellable_op` registers the token under `op_id`, runs the op inside `spawn_blocking`, removes the token afterward. Frontend gets the `op_id` back via `newOpId()` in hooks; calling `cancel_git_operation(op_id)` flips the atomic and the next `run_cancellable` poll bails.

**After adding a command**: register it in `lib.rs` `tauri::generate_handler![]` and run `cargo tauri-typegen generate`. (Until typegen is wired, hand-write the binding in `src/features/git/changesTabBindings.ts`.)

## ANTI-PATTERNS
- DB queries or git operations directly in handler — use service layer
- Holding `conn` lock longer than one service call (use the resolve-then-drop pattern in `resolve_folder`)
- Adding a long-running git op without the cancel-token pattern — UI will appear hung with no way out
- Skipping arg validation in `infra` — handlers receive raw `String`s from JS; the validators in `infra::git::cli` and `branches.rs` are the defense layer
