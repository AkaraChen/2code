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
| `get_git_diff` | `context_id: string` | `string` | Unified diff (staged + unstaged) via temp git index |
| `get_git_log` | `context_id: string, limit?: number` | `GitCommit[]` | Commit history (default 50) |
| `get_commit_diff` | `context_id: string, commit_hash: string` | `string` | Diff for specific commit |

### PTY Commands (`handler/pty.rs`)

| Command | Parameters | Returns | Description |
|---------|-----------|---------|-------------|
| `create_pty_session` | `meta: PtySessionMeta, config: PtyConfig` | `string` (session ID) | Spawn PTY with shell init injection |
| `write_to_pty` | `session_id: string, data: string` | — | Send input to PTY |
| `resize_pty` | `session_id: string, rows: u16, cols: u16` | — | Resize terminal dimensions |
| `close_pty_session` | `session_id: string` | — | Kill PTY process and mark closed |
| `list_project_sessions` | `project_id: string` | `PtySessionRecord[]` | List all sessions for a project (via profiles join) |
| `get_session_output` | `session_id: string` | `number[]` (bytes) | Fetch raw output BLOB for scrollback restoration |
| `delete_pty_session_record` | `session_id: string` | — | Delete session record and output data |
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
| `send_agent_prompt` | `session_id: string, prompt: string` | — | Send user prompt to active agent session |
| `close_agent_session` | `session_id: string` | — | Shutdown ACP subprocess and mark destroyed |
| `create_agent_session_persistent` | `meta: AgentSessionMeta` | `AgentSessionInfo` | Spawn ACP subprocess, persist session record |
| `reconnect_agent_session` | `session_id: string` | `AgentSessionInfo` | Respawn ACP subprocess for existing session |
| `list_project_agent_sessions` | `project_id: string` | `AgentSessionRecord[]` | List agent sessions for a project |
| `delete_agent_session_record` | `session_id: string` | — | Delete session and all events |
| `list_agent_session_events` | `session_id: string` | `AgentSessionEventRecord[]` | List all events for session (for restoration) |

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
| `agent-event-{id}` | ACP event JSON | `handler/agent.rs` | Agent session update (message chunk, tool call, etc.) |
| `agent-turn-complete-{id}` | `()` | `handler/agent.rs` | Agent finished processing a turn |
| `agent-error-{id}` | `string` (error message) | `handler/agent.rs` | Agent session error |
| `WatchEvent` | `{ project_id: string }` | `service/watcher.rs` via Channel | File system change detected |
| `LogEntry` | `{ timestamp, level, source, message }` | `infra/logger.rs` via Channel | Tracing log entry for debug panel |

## Sidecar HTTP API (`infra/helper.rs`)

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

### `AgentSessionMeta`

```typescript
{ profileId: string; agent: string }
```

### `AgentSessionInfo`

```typescript
{ id: string; agent: string; acp_session_id: string }
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

### `AgentSessionRecord`

```typescript
{ id: string; agent: string; acp_session_id: string; profile_id: string; created_at: number; destroyed_at: number | null; session_init_json: string | null }
```

### `AgentSessionEventRecord`

```typescript
{ id: string; event_index: number; session_id: string; created_at: number; sender: string; payload_json: string; turn_index: number }
```

### `GitCommit`

```typescript
{ hash: string; full_hash: string; author: GitAuthor; date: string; message: string; files_changed: number; insertions: number; deletions: number }
```

### `GitAuthor`

```typescript
{ name: string; email: string }
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

### `SystemFont`

```typescript
{ family: string; is_mono: boolean }
```

### `WatchEvent`

```typescript
{ project_id: string }
```

### `LogEntry`

```typescript
{ timestamp: string; level: string; source: string; message: string }
```

## Query Keys (`shared/lib/queryKeys.ts`)

| Key | Pattern | IPC Command |
|-----|---------|-------------|
| Projects list | `["projects"]` | `listProjects` |
| Git branch | `["git-branch", folder]` | `getGitBranch` |
| Git diff | `["git-diff", profileId]` | `getGitDiff` |
| Git log | `["git-log", profileId]` | `getGitLog` |
| Commit diff | `["git-commit-diff", profileId, hash]` | `getCommitDiff` |
| Agent status | `["agent-status"]` | `listAgentStatus` |
| Agent credentials | `["agent-credentials"]` | `detectCredentials` |

## Context ID Resolution

Git commands (`get_git_diff`, `get_git_log`, `get_commit_diff`) accept a `context_id` parameter that resolves polymorphically via `repo::project::resolve_context_folder()`:

- **Profile ID** → profile's `worktree_path`
- **Project ID** → project's `folder`

This enables git operations to work seamlessly with both regular project folders and profile worktrees.
