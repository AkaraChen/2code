# API Reference

## Tauri Commands

All commands are registered in `src-tauri/src/lib.rs` via `tauri::generate_handler![]`. TypeScript bindings are auto-generated into `src/generated/` by tauri-typegen.

### Project Commands (`handler/project.rs`)

| Command                      | Parameters                                   | Returns                 | Description                                                         |
| ---------------------------- | -------------------------------------------- | ----------------------- | ------------------------------------------------------------------- |
| `create_project_from_folder` | `name: string, folder: string`               | `Project`               | Create project from existing folder                                 |
| `list_projects`              | —                                            | `ProjectWithProfiles[]` | List all projects with their profiles                               |
| `update_project`             | `id: string, name?: string, folder?: string` | `Project`               | Update project name or folder                                       |
| `delete_project`             | `id: string`                                 | —                       | Delete project and cascade to profiles/sessions                     |
| `get_git_branch`             | `folder: string`                             | `string`                | Get current git branch for a folder                                 |
| `get_git_diff`               | `profile_id: string`                         | `string`                | Get unified diff (staged + unstaged) for a profile's context folder |
| `get_git_log`                | `profile_id: string, limit?: number`         | `GitCommit[]`           | Get commit log (default 50) for a profile's context folder          |
| `get_commit_diff`            | `profile_id: string, commit_hash: string`    | `string`                | Get diff for a specific commit                                      |

### PTY Commands (`handler/pty.rs`)

| Command                     | Parameters                                 | Returns               | Description                                        |
| --------------------------- | ------------------------------------------ | --------------------- | -------------------------------------------------- |
| `create_pty_session`        | `meta: PtySessionMeta, config: PtyConfig`  | `string` (session ID) | Create PTY session with shell, cwd, rows, cols     |
| `write_to_pty`              | `session_id: string, data: string`         | —                     | Write input data to PTY                            |
| `resize_pty`                | `session_id: string, rows: u16, cols: u16` | —                     | Resize PTY terminal                                |
| `close_pty_session`         | `session_id: string`                       | —                     | Close PTY session and mark closed in DB            |
| `list_project_sessions`     | `project_id: string`                       | `PtySessionRecord[]`  | List all sessions for a project (including closed) |
| `get_pty_session_history`   | `session_id: string`                       | `Vec<u8>`             | Get concatenated output chunks for session         |
| `delete_pty_session_record` | `session_id: string`                       | —                     | Delete session record and its output chunks        |

### Profile Commands (`handler/profile.rs`)

| Command          | Parameters                                | Returns   | Description                          |
| ---------------- | ----------------------------------------- | --------- | ------------------------------------ |
| `create_profile` | `project_id: string, branch_name: string` | `Profile` | Create git worktree profile          |
| `delete_profile` | `id: string`                              | —         | Delete profile, worktree, and branch |

### Watcher Commands (`handler/watcher.rs`)

| Command          | Parameters | Returns | Description                                       |
| ---------------- | ---------- | ------- | ------------------------------------------------- |
| `watch_projects` | —          | —       | Start file system watcher for all project folders |

### Font Commands (`handler/font.rs`)

| Command             | Parameters | Returns    | Description                                             |
| ------------------- | ---------- | ---------- | ------------------------------------------------------- |
| `list_system_fonts` | —          | `string[]` | List available system fonts (macOS only, via core-text) |

### Sound Commands (`handler/sound.rs`)

| Command              | Parameters     | Returns    | Description                                       |
| -------------------- | -------------- | ---------- | ------------------------------------------------- |
| `list_system_sounds` | —              | `string[]` | List system sounds from `/System/Library/Sounds/` |
| `play_system_sound`  | `name: string` | —          | Play a system sound via `afplay`                  |

### Debug Commands (`handler/debug.rs`)

| Command           | Parameters | Returns | Description                              |
| ----------------- | ---------- | ------- | ---------------------------------------- |
| `start_debug_log` | —          | —       | Start streaming tracing logs to frontend |
| `stop_debug_log`  | —          | —       | Stop streaming tracing logs              |

## Tauri Events

Events emitted from backend to frontend via `app.emit()`.

| Event             | Payload               | Source                           | Description                            |
| ----------------- | --------------------- | -------------------------------- | -------------------------------------- |
| `pty-output-{id}` | `string` (UTF-8 text) | `service/pty.rs` reader thread   | Terminal output for a specific session |
| `pty-exit-{id}`   | `()`                  | `service/pty.rs` reader thread   | Session exited (EOF or error)          |
| `pty-notify`      | `string` (session ID) | `infra/helper.rs` notify handler | Notification triggered from shell      |
| `watch-event`     | `WatchEvent`          | `infra/watcher.rs`               | File system change detected            |
| `debug-log`       | `LogEntry`            | `infra/logger.rs`                | Tracing log entry for debug panel      |

## Sidecar HTTP API (`infra/helper.rs`)

Internal HTTP server on `127.0.0.1:{ephemeral_port}`. Only accessible from PTY child processes via env vars.

| Endpoint  | Method | Parameters                     | Response           | Description                                      |
| --------- | ------ | ------------------------------ | ------------------ | ------------------------------------------------ |
| `/notify` | GET    | `?session_id={sid}` (optional) | `{"played": bool}` | Play notification sound, emit `pty-notify` event |
| `/health` | GET    | —                              | `"ok"`             | Health check                                     |

## Key Types

### `PtySessionMeta`

```typescript
{ profileId: string; title: string }
```

### `PtyConfig`

```typescript
{ shell: string; cwd: string; rows: number; cols: number }
```

### `Project`

```typescript
{ id: string; name: string; folder: string; created_at: string }
```

### `ProjectWithProfiles`

```typescript
{ id: string; name: string; folder: string; created_at: string; profiles: Profile[] }
```

### `Profile`

```typescript
{ id: string; project_id: string; branch_name: string; worktree_path: string; created_at: string; is_default: boolean }
```

### `GitCommit`

```typescript
{ hash: string; short_hash: string; subject: string; body: string; author: GitAuthor; date: string; files_changed: number; insertions: number; deletions: number }
```

## Query Keys (`shared/lib/queryKeys.ts`)

| Key           | Pattern                                | Used By         |
| ------------- | -------------------------------------- | --------------- |
| Projects list | `["projects"]`                         | `listProjects`  |
| Git branch    | `["git-branch", folder]`               | `getGitBranch`  |
| Git diff      | `["git-diff", profileId]`              | `getGitDiff`    |
| Git log       | `["git-log", profileId]`               | `getGitLog`     |
| Commit diff   | `["git-commit-diff", profileId, hash]` | `getCommitDiff` |
