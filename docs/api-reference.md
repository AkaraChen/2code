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
pub fn list_projects(state: State<'_, DbPool>) -> Result<Vec<Project>, AppError> {
    let conn = &mut *state.lock().map_err(|_| AppError::LockError)?;
    crate::service::project::list(conn)
}
```

Bindings are regenerated with `cargo tauri-typegen generate` after changing Rust command signatures.

## Project Commands

| Command                      | Frontend Function                         | Return Type | Description                                            |
| ---------------------------- | ----------------------------------------- | ----------- | ------------------------------------------------------ |
| `create_project_temporary`   | `createProjectTemporary({name?})`         | `Project`   | Create project in temp dir with `git init`             |
| `create_project_from_folder` | `createProjectFromFolder({name, folder})` | `Project`   | Import existing folder as project                      |
| `list_projects`              | `listProjects()`                          | `Project[]` | List all projects                                      |
| `get_project`                | `getProject({id})`                        | `Project`   | Get single project by ID                               |
| `update_project`             | `updateProject({id, name?, folder?})`     | `Project`   | Update project metadata                                |
| `delete_project`             | `deleteProject({id})`                     | `void`      | Delete project record (cascades to sessions, profiles) |

### Types

```typescript
interface Project {
    id: string;          // UUID
    name: string;
    folder: string;      // Absolute path
    created_at: string;  // ISO timestamp
}
```

## Git Commands

| Command           | Frontend Function                        | Return Type   | Description                        |
| ----------------- | ---------------------------------------- | ------------- | ---------------------------------- |
| `get_git_branch`  | `getGitBranch({folder})`                 | `string`      | Current branch name for a folder   |
| `get_git_diff`    | `getGitDiff({contextId})`                | `string`      | Working tree diff (unified format) |
| `get_git_log`     | `getGitLog({contextId, limit?})`         | `GitCommit[]` | Commit history (default limit: 50) |
| `get_commit_diff` | `getCommitDiff({contextId, commitHash})` | `string`      | Diff for a specific commit         |

`contextId` is polymorphic: can be a project ID or profile ID. Backend resolves via `resolve_context_folder()` (tries profile worktree first, falls back to project folder).

### Types

```typescript
interface GitCommit {
    hash: string;          // Short hash
    full_hash: string;     // Full SHA
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

## Profile Commands

| Command          | Frontend Function                        | Return Type | Description                                          |
| ---------------- | ---------------------------------------- | ----------- | ---------------------------------------------------- |
| `create_profile` | `createProfile({projectId, branchName})` | `Profile`   | Create git worktree + branch                         |
| `list_profiles`  | `listProfiles({projectId})`              | `Profile[]` | List profiles for a project                          |
| `get_profile`    | `getProfile({id})`                       | `Profile`   | Get single profile by ID                             |
| `update_profile` | `updateProfile({id, branchName?})`       | `Profile`   | Update profile metadata                              |
| `delete_profile` | `deleteProfile({id})`                    | `void`      | Remove worktree, delete branch, run teardown scripts |

### Types

```typescript
interface Profile {
    id: string;            // UUID
    project_id: string;
    branch_name: string;   // Sanitized (CJK → pinyin)
    worktree_path: string; // ~/.2code/workspace/{id}
    created_at: string;
}
```

### Side Effects

- **Create**: `git worktree add -b {branch} {path}`, run `setup_script` from `2code.json`
- **Delete**: Run `teardown_script`, `git worktree remove`, `git branch -D`

## PTY Commands

| Command                     | Frontend Function                     | Return Type          | Description                            |
| --------------------------- | ------------------------------------- | -------------------- | -------------------------------------- |
| `create_pty_session`        | `createPtySession({meta, config})`    | `string`             | Spawn shell process, return session ID |
| `write_to_pty`              | `writeToPty({sessionId, data})`       | `void`               | Send user input to PTY                 |
| `resize_pty`                | `resizePty({sessionId, rows, cols})`  | `void`               | Resize terminal dimensions             |
| `close_pty_session`         | `closePtySession({sessionId})`        | `void`               | Kill process, mark closed in DB        |
| `list_active_sessions`      | `listActiveSessions({projectId})`     | `PtySessionRecord[]` | List all sessions for a project        |
| `get_pty_session_history`   | `getPtySessionHistory({sessionId})`   | `number[]`           | Get scrollback history (UTF-8 bytes)   |
| `delete_pty_session_record` | `deletePtySessionRecord({sessionId})` | `void`               | Delete session and output chunks       |

### Types

```typescript
interface PtySessionMeta {
    projectId: string;
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
    project_id: string;
    title: string;
    shell: string;
    cwd: string;
    created_at: string;
    closed_at?: string | null;
}
```

## Utility Commands

| Command              | Frontend Function         | Return Type    | Description                                               |
| -------------------- | ------------------------- | -------------- | --------------------------------------------------------- |
| `list_system_fonts`  | `listSystemFonts()`       | `SystemFont[]` | List system fonts (macOS only, via core-text)             |
| `list_system_sounds` | `listSystemSounds()`      | `string[]`     | List system sounds (macOS only, `/System/Library/Sounds`) |
| `play_system_sound`  | `playSystemSound({name})` | `void`         | Play a system sound (macOS only, via `afplay`)            |

### Types

```typescript
interface SystemFont {
    family: string;
    is_mono: boolean;
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
// Backend: Emit output from reader thread
app.emit(&format!("pty-output-{}", session_id), text.as_ref())?;
app.emit(&format!("pty-exit-{}", session_id), ())?;
```

## Error Handling

All commands return `Result<T, AppError>`. Errors are serialized to strings via a custom `Serialize` impl:

```rust
#[derive(Error, Debug)]
pub enum AppError {
    #[error("IO error: {0}")]
    IoError(#[from] std::io::Error),
    #[error("Lock error: failed to acquire lock")]
    LockError,
    #[error("PTY error: {0}")]
    PtyError(String),
    #[error("Database error: {0}")]
    DbError(String),
    #[error("Not found: {0}")]
    NotFound(String),
    #[error("Git error: {0}")]
    GitError(String),
}
```

Frontend receives errors as rejected promises. TanStack Query hooks surface them via `error` state; mutations can handle them in `onError` callbacks.
