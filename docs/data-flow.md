# Data Flow

## IPC Request Lifecycle

All frontend-to-backend communication uses Tauri IPC via auto-generated bindings in `src/generated/`.

```mermaid
sequenceDiagram
    participant C as React Component
    participant TQ as TanStack Query
    participant Gen as Generated Bindings
    participant H as Handler (Rust)
    participant S as Service (Rust)
    participant R as Repo (Rust)
    participant DB as SQLite

    C->>TQ: useQuery / useMutation
    TQ->>Gen: invoke command
    Gen->>H: Tauri IPC
    H->>H: Extract State, acquire DB lock
    H->>S: Delegate to service
    S->>R: Database operations
    R->>DB: Diesel query
    DB-->>R: Result
    R-->>S: Domain objects
    S-->>H: Result<T, AppError>
    H-->>Gen: Serialized response
    Gen-->>TQ: Typed result
    TQ-->>C: Re-render with data
```

## PTY Session Lifecycle

### Creation

1. Frontend calls `createPtySession({ meta, config })` via TanStack Query mutation
2. Handler delegates to `service::pty::create_session()`
3. Service loads project config (`2code.json`) for init scripts
4. Service prepares ZDOTDIR temp directory with shell init script
5. Service reads helper HTTP server state (port + sidecar path)
6. `infra::pty::create_session()` spawns PTY with env vars:
   - `TERM=xterm-256color`
   - `_2CODE_HELPER_URL=http://127.0.0.1:{port}`
   - `_2CODE_HELPER={sidecar_path}`
   - `_2CODE_SESSION_ID={session_id}`
   - `ZDOTDIR={init_dir}` (for shell init injection)
7. Session record inserted into `pty_sessions` table
8. Background reader thread spawned for output streaming

### Output Streaming

```mermaid
sequenceDiagram
    participant PTY as PTY Process
    participant RT as Reader Thread
    participant PT as Persist Thread
    participant FE as Frontend (xterm.js)
    participant DB as SQLite

    loop Every 4KB read
        PTY->>RT: Raw bytes
        RT->>RT: UTF-8 boundary detection
        RT->>FE: emit("pty-output-{id}", text)
        RT->>PT: mpsc channel (raw bytes)
    end

    loop Buffer >= 32KB
        PT->>DB: Insert output chunk
        PT->>PT: Prune if > 1MB total
    end

    PTY->>RT: EOF / Error
    RT->>PT: Drop channel (signal flush)
    PT->>DB: Flush remaining buffer
    RT->>DB: Mark session closed
    RT->>FE: emit("pty-exit-{id}")
```

Key details:
- Reader thread reads 4KB chunks from PTY
- UTF-8 boundary detection (`find_utf8_boundary`) prevents partial character output to frontend
- Persistence runs on a separate thread via mpsc channel (non-blocking)
- 32KB flush threshold for DB writes
- 1MB cap per session with oldest-chunk pruning

### Session Restoration (App Startup)

```mermaid
sequenceDiagram
    participant Store as Terminal Store
    participant QO as QueryObserver
    participant BE as Backend
    participant DB as SQLite

    Note over BE: mark_all_open_sessions_closed()
    QO->>BE: listProjects()
    BE-->>QO: ProjectWithProfiles[]
    QO->>Store: removeStaleProfiles()

    loop For each project
        Store->>BE: listProjectSessions(projectId)
        BE-->>Store: PtySessionRecord[]
    end

    loop For each old session
        Store->>BE: createPtySession(same metadata)
        BE-->>Store: newSessionId
        Store->>Store: addTab(profileId, newSessionId, title, restoreFrom=oldId)
    end

    Note over Store: Terminal component fetches history from old session,<br/>writes to xterm, then deletes old record
```

This runs once at startup via a module-level `QueryObserver` subscription in `features/terminal/store.ts`.

## Notification Pipeline

```mermaid
sequenceDiagram
    participant Shell as User Shell
    participant CLI as 2code-helper
    participant HTTP as Axum Server
    participant Store as Tauri Plugin Store
    participant App as Tauri App
    participant FE as Frontend Store

    Shell->>CLI: $_2CODE_HELPER notify
    CLI->>CLI: Read $_2CODE_HELPER_URL, $_2CODE_SESSION_ID
    CLI->>HTTP: GET /notify?session_id={sid}
    HTTP->>Store: Read notification-settings
    Store-->>HTTP: {enabled, sound}

    alt Notifications enabled
        HTTP->>HTTP: afplay /System/Library/Sounds/{sound}.aiff
        HTTP->>App: app.emit("pty-notify", session_id)
        HTTP-->>CLI: {played: true}
        App->>FE: listen("pty-notify")
        FE->>FE: markNotified(sessionId)
        Note over FE: Green dot on terminal tab + sidebar profile
    else Notifications disabled
        HTTP-->>CLI: {played: false}
        CLI->>CLI: exit(1)
    end
```

Clearing notifications:
- `setActiveTab(profileId, tabId)` → `notifiedTabs.delete(tabId)`
- `closeTab(profileId, tabId)` → `notifiedTabs.delete(tabId)`

## Git Operations & Context ID Resolution

Git operations accept a `profileId` that resolves polymorphically:

```mermaid
sequenceDiagram
    participant FE as Frontend
    participant S as Service
    participant R as Repo

    FE->>S: get_git_diff(profileId)
    S->>R: resolve_context_folder(profileId)

    alt Profile found
        R-->>S: profile.worktree_path
    else Fallback to project
        R-->>S: project.folder
    end

    S->>S: Execute git diff in resolved folder
    S-->>FE: Diff string
```

## File System Watching

The `watch_projects` command starts a background watcher thread using the `notify` crate. It watches all project folders and emits `watch-event` Tauri events on file changes. The frontend `fileWatcher.ts` module subscribes and invalidates relevant TanStack Query cache entries.

## Profile System (Git Worktrees)

### Creation Flow

1. Frontend calls `createProfile(projectId, branchName)`
2. Service sanitizes branch name (CJK → pinyin via `slug.rs`)
3. Service runs `git worktree add ~/.2code/workspace/{profile_id} -b {branch}`
4. Profile record inserted into `profiles` table
5. If `2code.json` has `setup_script`, execute in worktree directory

### Deletion Flow

1. If `2code.json` has `teardown_script`, execute in worktree directory
2. Run `git worktree remove` and `git branch -D`
3. Delete profile record from DB (cascades to sessions)
