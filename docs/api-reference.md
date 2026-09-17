# API Reference

## Tauri Commands

All commands are registered in `src-tauri/src/lib.rs` via `tauri::generate_handler![]`. TypeScript bindings are auto-generated into `src/generated/` by tauri-typegen. Session commands use terminal/session names. Session/profile/git commands are Herdr-backed; see [Herdr integration](herdr-integration.md).

### Project Commands (`handler/project.rs`)

| Command                      | Parameters                                   | Returns                 | Description                                                         |
| ---------------------------- | -------------------------------------------- | ----------------------- | ------------------------------------------------------------------- |
| `create_project_from_folder` | `name: string, folder: string`               | `Project`               | Write a sqlite `projects` row (no Herdr mutate)                     |
| `list_projects`              | —                                            | `ProjectWithProfiles[]` | Load sqlite projects, adopt Herdr checkouts, return live profiles   |
| `update_project`             | `id: string, name?: string, folder?: string` | `Project`               | Update project name or folder                                       |
| `delete_project`             | `id: string`                                 | —                       | Forget the catalog row and retain Herdr worktrees/panes             |
| `get_git_branch`             | `profile_id: string`                         | `string`                | Get current git branch at live Herdr cwd                            |
| `get_git_diff`               | `profile_id: string`                         | `string`                | Get unified diff (staged + unstaged) at live Herdr cwd              |
| `get_git_log`                | `profile_id: string, limit?: number`         | `GitCommit[]`           | Get commit log (default 50) at live Herdr cwd                       |
| `get_commit_diff`            | `profile_id: string, commit_hash: string`    | `string`                | Get diff for a specific commit at live Herdr cwd                    |

`delete_project` does **not** cascade-destroy sqlite profiles/sessions (those tables are DROPped). It deletes the `projects` row and `forget_project_session`s live panes without `pane.close` / `worktree.remove`.

Git `profile_id` is a Herdr `workspace_id`. Paths come from `reconcile_profile_checkout`, not sqlite `profiles.worktree_path`.

### Terminal Commands (`handler/terminal.rs`)

The runtime is Herdr-only `RuntimeRouter`. Session id is live `pane_id` (`wN:pK`); `profile_id` on listed records is `workspace_id`. `TerminalSessionRecord` is a derived GUI DTO from `session.snapshot`, not a sqlite row.

| Command                     | Parameters                                           | Returns               | Description                                        |
| --------------------------- | ---------------------------------------------------- | --------------------- | -------------------------------------------------- |
| `create_terminal_session`   | `meta: TerminalSessionMeta, config: TerminalConfig`  | `string` (session ID) | Herdr `tab.create`; returns `pane_id`              |
| `write_to_terminal`         | `session_id: string, data: string`                   | —                     | Write input to the attached Herdr pane             |
| `resize_terminal`           | `session_id: string, rows: u16, cols: u16`           | —                     | Resize the attached Herdr pane                     |
| `scroll_terminal`           | `session_id`, direction, lines, source               | —                     | Scroll the attached Herdr pane                     |
| `close_terminal_session`    | `session_id: string`                                 | —                     | Herdr `pane.close` (no sqlite mark-closed)         |
| `list_project_sessions`     | `project_id: string`                                 | `TerminalSessionRecord[]` | Live panes for that project's open workspaces |
| `get_session_backend`       | `session_id: string`                                 | `RuntimeBackend`      | Always `Herdr`                                     |
| `attach_terminal_output`    | `session_id, stream_id`                              | —                     | Register the active output sink                    |
| `stream_herdr_output`       | `session_id, stream_id, on_output`                   | —                     | Pump `HerdrTerminalFrame`s over a Tauri channel    |
| `detach_terminal_output`    | `session_id, stream_id`                              | —                     | Detach that `stream_id` only                       |
| `flush_terminal_output`     | `session_id: string`                                 | —                     | Fail-closed on Herdr                               |
| `clear_terminal_output`     | `session_id: string`                                 | —                     | Fail-closed on Herdr                               |

There is no sqlite history restore command. Restore is reattach of a live `pane_id` from `list_project_sessions`. Herdr-down New Tab fail-closes (no Local PTY spawn).

### Profile Commands (`handler/profile.rs`)

| Command          | Parameters                                | Returns   | Description                          |
| ---------------- | ----------------------------------------- | --------- | ------------------------------------ |
| `create_profile` | `project_id: string, branch_name: string` | `Profile` | Herdr `worktree.create` / `workspace.create`; returned `id` is `workspace_id` |
| `delete_profile` | `id: string`                              | —         | Herdr `worktree.remove` / `workspace.close`; primary checkout refused |

### Watcher Commands (`handler/watcher.rs`)

| Command          | Parameters | Returns | Description                                       |
| ---------------- | ---------- | ------- | ------------------------------------------------- |
| `watch_projects` | —          | —       | Watch live Herdr checkout roots (Herdr-down: `projects.folder`) |

### Font Commands (`handler/font.rs`)

| Command             | Parameters | Returns    | Description                                             |
| ------------------- | ---------- | ---------- | ------------------------------------------------------- |
| `list_system_fonts` | —          | `string[]` | List available system fonts (macOS core-text; Linux/Windows fontdb) |

### Sound Commands (`handler/sound.rs`)

| Command              | Parameters     | Returns    | Description                                       |
| -------------------- | -------------- | ---------- | ------------------------------------------------- |
| `list_system_sounds` | —              | `string[]` | List system sounds (platform directories)         |
| `play_system_sound`  | `name: string` | —          | Play a system sound                               |

### Debug Commands (`handler/debug.rs`)

| Command           | Parameters | Returns | Description                              |
| ----------------- | ---------- | ------- | ---------------------------------------- |
| `start_debug_log` | —          | —       | Start streaming tracing logs to frontend |
| `stop_debug_log`  | —          | —       | Stop streaming tracing logs              |

## Tauri Channels And Events

Terminal output uses `attach_terminal_output(sessionId, streamId)` to register the active sink, then `stream_herdr_output` to pump `HerdrTerminalFrame`s over a Tauri IPC channel. `detach_terminal_output` requires the same `streamId`, so stale frontend cleanup cannot remove a newer stream for the same session. Low-volume signals still use `app.emit()` / channels.

| Name             | Payload      | Source                         | Description                            |
| ---------------- | ------------ | ------------------------------ | -------------------------------------- |
| Herdr frame channel | `HerdrTerminalFrame` | `stream_herdr_output` | Terminal frames for a live `pane_id` |
| `watch-event`    | `WatchEvent` | `infra/watcher.rs`             | File system change detected            |
| `debug-log`      | `LogEntry`   | `infra/logger.rs`              | Tracing log entry for debug panel      |

There is no `2code-helper` HTTP sidecar and no `pty-notify` helper endpoint. Agent waiting uses frontend detection plus `play_system_sound`.

## Key Types

### `TerminalSessionMeta`

```typescript
{ profileId: string; title: string }
```

`profileId` is a Herdr `workspace_id`.

### `TerminalConfig`

```typescript
{ shell: string; cwd: string; rows: number; cols: number; startup_commands?: string[] }
```

### `Project`

```typescript
{ id: string; name: string; folder: string; created_at: string; group_id: string | null; sort_order: number; pinned_at: string | null; pinned_order: number | null }
```

### `ProjectWithProfiles`

```typescript
{ id: string; name: string; folder: string; created_at: string; group_id: string | null; sort_order: number; pinned_at: string | null; pinned_order: number | null; profiles: Profile[] }
```

`profiles` is a live Herdr-derived catalog, not sqlite rows.

### `Profile`

Derived GUI DTO. Not a sqlite `profiles` row. `id` is Herdr `workspace_id`. `worktree_path` is the live checkout path (Herdr cwd), not a sqlite column.

```typescript
{ id: string; project_id: string; branch_name: string; worktree_path: string; created_at: string; is_default: boolean; notes: string }
```

### `GitCommit`

```typescript
{ hash: string; full_hash: string; author: GitAuthor; date: string; message: string; files_changed: number; insertions: number; deletions: number }
```

## Query Keys (`shared/lib/queryKeys.ts`)

| Key           | Pattern                                | Used By         |
| ------------- | -------------------------------------- | --------------- |
| Projects list | `["projects"]`                         | `listProjects`  |
| Git branch    | `["git-branch", profileId]`            | `getGitBranch`  |
| Git diff      | `["git-diff", profileId]`              | `getGitDiff`    |
| Git log       | `["git-log", profileId]`               | `getGitLog`     |
| Commit diff   | `["git-commit-diff", profileId, hash]` | `getCommitDiff` |
