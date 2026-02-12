# API Reference

## Overview

2code uses Tauri's IPC system for frontend-backend communication. All commands are defined as `#[tauri::command]` functions in the handler layer and exposed to the frontend as typed async functions via auto-generated bindings in `src/generated/`.

## IPC Communication Pattern

```typescript
// Frontend: Import auto-generated typed function
import { listProjects } from "@/generated";
const projects = await listProjects();

// Backend: Handler delegates to service layer
#[tauri::command]
pub fn list_projects(state: State<'_, DbPool>) -> Result<Vec<ProjectWithProfiles>, AppError> {
    let conn = &mut *state.lock().map_err(|_| AppError::LockError)?;
    crate::service::project::list(conn)
}
```

Bindings are regenerated with `cargo tauri-typegen generate` after changing Rust command signatures.

## Project Commands (`handler/project.rs`)

| Command                      | Parameters                     | Return Type                | Description                                                  |
| ---------------------------- | ------------------------------ | -------------------------- | ------------------------------------------------------------ |
| `create_project_temporary`   | `name: Option<String>`         | `Project`                  | Create project in temp dir with `git init` + default profile |
| `create_project_from_folder` | `name: String, folder: String` | `Project`                  | Import existing folder as project + default profile          |
| `list_projects`              | _(none)_                       | `Vec<ProjectWithProfiles>` | List all projects with their profiles                        |
| `update_project`             | `id, name?, folder?`           | `Project`                  | Update project metadata                                      |
| `delete_project`             | `id: String`                   | `()`                       | Delete project (cascades to profiles, sessions)              |

### Git Subcommands (also in `handler/project.rs`)

| Command           | Parameters                                | Return Type      | Description                        |
| ----------------- | ----------------------------------------- | ---------------- | ---------------------------------- |
| `get_git_branch`  | `folder: String`                          | `String`         | Current branch name for a folder   |
| `get_git_diff`    | `profile_id: String`                      | `String`         | Working tree diff (unified format) |
| `get_git_log`     | `profile_id: String, limit?: u32`         | `Vec<GitCommit>` | Commit history (default limit: 50) |
| `get_commit_diff` | `profile_id: String, commit_hash: String` | `String`         | Diff for a specific commit         |

Git commands resolve the working directory through the profile's `worktree_path` (for worktree profiles) or the project's `folder` (for default profiles).

### Types

```typescript
interface Project {
    id: string;          // UUID
    name: string;
    folder: string;      // Absolute path
    created_at: string;  // ISO timestamp
}

interface ProjectWithProfiles {
    id: string;
    name: string;
    folder: string;
    created_at: string;
    profiles: Profile[];
}

interface GitCommit {
    hash: string;          // Short hash (7 chars)
    full_hash: string;     // Full SHA-1
    author: GitAuthor;
    date: string;          // ISO 8601
    message: string;
    files_changed: number;
    insertions: number;
    deletions: number;
}

interface GitAuthor {
    name: string;
    email: string;
}
```

## Profile Commands (`handler/profile.rs`)

| Command          | Parameters                                | Return Type | Description                                          |
| ---------------- | ----------------------------------------- | ----------- | ---------------------------------------------------- |
| `create_profile` | `project_id: String, branch_name: String` | `Profile`   | Create git worktree + branch + run setup scripts     |
| `delete_profile` | `id: String`                              | `()`        | Run teardown scripts, remove worktree, delete branch |

### Types

```typescript
interface Profile {
    id: string;            // UUID
    project_id: string;
    branch_name: string;   // Sanitized (CJK → pinyin, special chars stripped)
    worktree_path: string; // ~/.2code/workspace/{id} (or project folder for defaults)
    created_at: string;
    is_default: boolean;   // true for the auto-created project profile
}
```

### Side Effects

- **Create**: `git worktree add -b {branch} {path}`, run `setup_script` from `2code.json`
- **Delete**: Run `teardown_script`, `git worktree remove --force`, `git branch -D`

## PTY Commands (`handler/pty.rs`)

| Command                     | Parameters                                 | Return Type             | Description                            |
| --------------------------- | ------------------------------------------ | ----------------------- | -------------------------------------- |
| `create_pty_session`        | `meta: PtySessionMeta, config: PtyConfig`  | `String`                | Spawn shell process, return session ID |
| `write_to_pty`              | `session_id: String, data: String`         | `()`                    | Send user input to PTY                 |
| `resize_pty`                | `session_id: String, rows: u16, cols: u16` | `()`                    | Resize terminal dimensions             |
| `close_pty_session`         | `session_id: String`                       | `()`                    | Kill process, mark closed in DB        |
| `list_project_sessions`     | `project_id: String`                       | `Vec<PtySessionRecord>` | List all sessions for a project        |
| `get_pty_session_history`   | `session_id: String`                       | `Vec<u8>`               | Get scrollback history (raw bytes)     |
| `delete_pty_session_record` | `session_id: String`                       | `()`                    | Delete session and output chunks       |

### Types

```typescript
interface PtySessionMeta {
    profile_id: string;   // Profile this session belongs to
    title: string;
}

interface PtyConfig {
    shell: string;    // e.g. "/bin/zsh"
    cwd: string;      // Working directory
    rows: number;
    cols: number;
}

interface PtySessionRecord {
    id: string;
    profile_id: string;
    title: string;
    shell: string;
    cwd: string;
    created_at: string;
    closed_at: string | null;
}
```

## Utility Commands

| Command              | Handler file       | Parameters     | Return Type       | Description                                          |
| -------------------- | ------------------ | -------------- | ----------------- | ---------------------------------------------------- |
| `list_system_fonts`  | `handler/font.rs`  | _(none)_       | `Vec<SystemFont>` | List system fonts (macOS only, via core-text)        |
| `list_system_sounds` | `handler/sound.rs` | _(none)_       | `Vec<String>`     | List system sounds (macOS, `/System/Library/Sounds`) |
| `play_system_sound`  | `handler/sound.rs` | `name: String` | `()`              | Play a system sound (macOS only, via `afplay`)       |

### Types

```typescript
interface SystemFont {
    family: string;
    is_mono: boolean;
}
```

## File Watcher Command (`handler/watcher.rs`)

| Command          | Parameters                      | Return Type | Description                                        |
| ---------------- | ------------------------------- | ----------- | -------------------------------------------------- |
| `watch_projects` | `on_event: Channel<WatchEvent>` | `()`        | Start watching all project directories for changes |

Uses Tauri's `Channel` for push-based streaming (not request/response). The backend spawns a coordinator thread that:

- Polls the DB every 3s to reconcile watchers with current project list
- Creates `notify::Watcher` instances per project folder (recursive)
- Filters out `.git/` internal file changes
- Debounces events per project (500ms)

```typescript
interface WatchEvent {
    project_id: string;
}
```

## Debug Commands (`handler/debug.rs`)

| Command           | Parameters                    | Return Type | Description                          |
| ----------------- | ----------------------------- | ----------- | ------------------------------------ |
| `start_debug_log` | `on_event: Channel<LogEntry>` | `()`        | Start forwarding Rust tracing events |
| `stop_debug_log`  | _(none)_                      | `()`        | Stop forwarding, detach channel      |

```typescript
interface LogEntry {
    timestamp: number;   // Unix millis
    level: string;       // "ERROR", "WARN", "INFO"
    source: string;      // tracing target (e.g. "pty", "watcher")
    message: string;
}
```

## Event-Driven Communication

PTY output uses Tauri's event system for real-time streaming (not request/response):

```typescript
// Frontend: Listen for PTY output
const unlisten = await listen<string>(`pty-output-${sessionId}`, (event) => {
    term.write(event.payload);
});

// Frontend: Listen for process exit
const unlistenExit = await listen(`pty-exit-${sessionId}`, () => {
    term.write("\r\n\x1b[90m[Process exited]\x1b[0m\r\n");
});
```

```rust
// Backend: Emit output from reader thread (service/pty.rs)
app.emit(&format!("pty-output-{}", session_id), text.as_ref())?;
app.emit(&format!("pty-exit-{}", session_id), ())?;
```

## Error Handling

All commands return `Result<T, AppError>`. Errors are serialized to strings via a custom `Serialize` impl:

```rust
#[derive(Error, Debug)]
pub enum AppError {
    IoError(#[from] std::io::Error),
    LockError,
    PtyError(String),
    DbError(String),
    NotFound(String),
    GitError(String),
}
```

Frontend receives errors as rejected promises. TanStack Query hooks surface them via `error` state; mutations can handle them in `onError` callbacks.

## Command Registration (`lib.rs`)

All 22 commands are registered in a single `tauri::generate_handler![]` macro call:

```rust
tauri::generate_handler![
    handler::pty::create_pty_session,
    handler::pty::write_to_pty,
    handler::pty::resize_pty,
    handler::pty::close_pty_session,
    handler::pty::list_project_sessions,
    handler::pty::get_pty_session_history,
    handler::pty::delete_pty_session_record,
    handler::project::create_project_temporary,
    handler::project::create_project_from_folder,
    handler::project::list_projects,
    handler::project::update_project,
    handler::project::delete_project,
    handler::project::get_git_branch,
    handler::project::get_git_diff,
    handler::project::get_git_log,
    handler::project::get_commit_diff,
    handler::font::list_system_fonts,
    handler::sound::list_system_sounds,
    handler::sound::play_system_sound,
    handler::profile::create_profile,
    handler::profile::delete_profile,
    handler::watcher::watch_projects,
    handler::debug::start_debug_log,
    handler::debug::stop_debug_log,
]
```
