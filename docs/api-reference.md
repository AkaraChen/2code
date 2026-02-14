# API Reference

All commands are registered in `src-tauri/src/lib.rs` via `tauri::generate_handler![]`. TypeScript bindings are auto-generated into `src/generated/` by tauri-typegen.

## Tauri Commands

### Project Commands (`handler/project.rs`)

| Command | Parameters | Returns | Description |
|---------|-----------|---------|-------------|
| `create_project_temporary` | `name?: string` | `Project` | Create project in system temp directory with git init |
| `create_project_from_folder` | `name: string, folder: string` | `Project` | Import existing folder as project |
| `list_projects` | — | `ProjectWithProfiles[]` | List all projects with nested profiles |
| `update_project` | `id: string, name?: string, folder?: string` | `Project` | Update project name or folder |
| `delete_project` | `id: string` | — | Delete project (cascades to profiles, sessions, output) |
| `get_git_branch` | `folder: string` | `string` | Get current git branch name |
| `get_git_diff` | `profile_id: string` | `string` | Unified diff (staged + unstaged) via temp git index |
| `get_git_log` | `profile_id: string, limit?: number` | `GitCommit[]` | Commit history (default 50) |
| `get_commit_diff` | `profile_id: string, commit_hash: string` | `string` | Diff for specific commit |

### PTY Commands (`handler/pty.rs`)

| Command | Parameters | Returns | Description |
|---------|-----------|---------|-------------|
| `create_pty_session` | `meta: PtySessionMeta, config: PtyConfig` | `string` (session ID) | Spawn PTY with shell init injection |
| `write_to_pty` | `session_id: string, data: string` | — | Send input to PTY |
| `resize_pty` | `session_id: string, rows: u16, cols: u16` | — | Resize terminal dimensions |
| `close_pty_session` | `session_id: string` | — | Kill PTY process and mark closed |
| `list_project_sessions` | `project_id: string` | `PtySessionRecord[]` | List all sessions for a project (via profiles join) |
| `get_pty_session_history` | `session_id: string` | `Vec<u8>` | Fetch raw output BLOB for scrollback restoration |
| `delete_pty_session_record` | `session_id: string` | — | Delete session record and output data |
| `restore_pty_session` | `old_session_id: string, meta: PtySessionMeta, config: PtyConfig` | `RestoreResult` | Atomically restore: read history, vt100 sanitize, create new session, delete old |
| `flush_pty_output` | `session_id: string` | — | Force persistence thread flush (best-effort) |

### Profile Commands (`handler/profile.rs`)

| Command | Parameters | Returns | Description |
|---------|-----------|---------|-------------|
| `create_profile` | `project_id: string, branch_name: string` | `Profile` | Create git worktree profile with setup script |
| `delete_profile` | `id: string` | — | Teardown script → worktree remove → branch delete |

### Agent Commands (`handler/agent.rs`)

| Command | Parameters | Returns | Description |
|---------|-----------|---------|-------------|
| `list_agent_status` | — | `AgentStatusInfo[]` | List all agents with native + ACP install status |
| `install_agent` | `agent: string` | — | Install ACP bridge for agent (async, blocking pool) |
| `detect_credentials` | — | `CredentialInfo` | Scan for Anthropic/OpenAI API keys |

### Watcher Commands (`handler/watcher.rs`)

| Command | Parameters | Returns | Description |
|---------|-----------|---------|-------------|
| `watch_projects` | `on_event: Channel<WatchEvent>` | — | Start file system watcher for all project folders |

### Font Commands (`handler/font.rs`)

| Command | Parameters | Returns | Description |
|---------|-----------|---------|-------------|
| `list_system_fonts` | — | `SystemFont[]` | List system fonts with monospace detection (macOS only) |

### Sound Commands (`handler/sound.rs`)

| Command | Parameters | Returns | Description |
|---------|-----------|---------|-------------|
| `list_system_sounds` | — | `string[]` | List `/System/Library/Sounds/` entries (macOS only) |
| `play_system_sound` | `name: string` | — | Play sound via `afplay` (macOS only) |

### Debug Commands (`handler/debug.rs`)

| Command | Parameters | Returns | Description |
|---------|-----------|---------|-------------|
| `start_debug_log` | `on_event: Channel<LogEntry>` | — | Stream tracing logs to frontend |
| `stop_debug_log` | — | — | Detach log stream |

## Tauri Events

Events emitted from backend to frontend via `app.emit()` or Tauri `Channel`.

| Event | Payload | Source | Description |
|-------|---------|--------|-------------|
| `pty-output-{id}` | `string` (UTF-8 text) | `service/pty.rs` reader thread | Terminal output for a specific session |
| `pty-exit-{id}` | `()` | `service/pty.rs` reader thread | Session exited (EOF or error) |
| `pty-notify` | `string` (session ID) | `infra/helper.rs` notify handler | Notification triggered from shell via sidecar |
| `WatchEvent` | `{ project_id: string }` | `service/watcher.rs` via Channel | File system change detected |
| `LogEntry` | `{ timestamp, level, target, message }` | `infra/logger.rs` via Channel | Tracing log entry for debug panel |

## Sidecar HTTP API (`src-tauri/src/helper.rs`)

Internal HTTP server on `127.0.0.1:{ephemeral_port}`. Only accessible from PTY child processes via env vars.

| Endpoint | Method | Parameters | Response | Description |
|----------|--------|-----------|----------|-------------|
| `/notify` | GET | `?session_id={sid}` | `{"played": bool}` | Read settings, play sound, emit `pty-notify` event |
| `/health` | GET | — | `"ok"` | Health check |

## Key Types

### `PtySessionMeta`

```typescript
{ profileId: string; title: string }
```

### `PtyConfig`

```typescript
{ shell: string; cwd: string; rows: number; cols: number }
```

### `RestoreResult`

```typescript
{ sessionId: string; history: number[] /* Uint8Array */ }
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

### `PtySessionRecord`

```typescript
{ id: string; profile_id: string; title: string; shell: string; cwd: string; created_at: string; closed_at: string | null; cols: number; rows: number }
```

### `GitCommit`

```typescript
{ hash: string; short_hash: string; subject: string; body: string; author: GitAuthor; date: string; files_changed: number; insertions: number; deletions: number }
```

### `AgentStatusInfo`

```typescript
{ id: string; display_name: string; native_required: boolean; native_installed: boolean; native_version: string | null; acp_installed: boolean; acp_version: string | null; ready: boolean }
```

### `CredentialInfo`

```typescript
{ anthropic: CredentialEntry | null; openai: CredentialEntry | null }
```

### `CredentialEntry`

```typescript
{ source: string; provider: string; auth_type: string; key_preview: string }
```

## Query Keys (`shared/lib/queryKeys.ts`)

| Key | Pattern | Used By |
|-----|---------|---------|
| Projects list | `["projects"]` | `listProjects` |
| Git branch | `["git-branch", folder]` | `getGitBranch` |
| Git diff | `["git-diff", profileId]` | `getGitDiff` |
| Git log | `["git-log", profileId]` | `getGitLog` |
| Commit diff | `["git-commit-diff", profileId, hash]` | `getCommitDiff` |
| Agent status | `["agent-status"]` | `listAgentStatus` |
| Agent credentials | `["agent-credentials"]` | `detectCredentials` |
