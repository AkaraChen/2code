# Data Flow

## Overview

2code uses a hybrid data flow combining **React's unidirectional data flow** on the frontend with **layered command handlers** in the Rust backend. PTY output uses a **streaming event pattern** for real-time terminal updates. File watching and debug logging use **Tauri Channels** for push-based communication. All IPC calls use auto-generated typed bindings from `src/generated/`.

## Primary Data Flows

### 1. Project Creation Flow

```mermaid
sequenceDiagram
    actor User
    participant UI as CreateProjectDialog
    participant Hook as useCreateProject
    participant TQ as TanStack Query
    participant Gen as generated/commands.ts
    participant Handler as handler/project.rs
    participant Service as service/project.rs
    participant Repo as repo/project.rs + repo/profile.rs
    participant Infra as infra/git.rs
    participant DB as SQLite

    User->>UI: Click "Create Project"
    UI->>Hook: mutate({name, folder})
    Hook->>TQ: useMutation
    TQ->>Gen: createProjectTemporary({name})
    Gen->>Handler: invoke("create_project_temporary")

    Handler->>Handler: Lock DbPool mutex
    Handler->>Service: create_temporary(conn, name)
    Service->>Service: Generate UUID + dir name (CJK → pinyin)
    Service->>Infra: fs::create_dir_all + git::init
    Service->>Repo: project::insert(conn, id, name, folder)
    Repo->>DB: INSERT INTO projects
    Service->>Repo: profile::insert_default(conn, defaultProfileId, projectId, folder)
    Repo->>DB: INSERT INTO profiles (is_default = true)
    DB-->>Repo: Project record

    Repo-->>Service: Project
    Service-->>Handler: Project
    Handler-->>Gen: Project
    Gen-->>Hook: Project
    Hook->>TQ: invalidateQueries(["projects"])
    TQ-->>UI: onSuccess → navigate to project
```

### 2. Terminal Session Lifecycle

```mermaid
sequenceDiagram
    actor User
    participant UI as TerminalTabs
    participant Store as terminalStore
    participant Gen as generated/commands.ts
    participant Handler as handler/pty.rs
    participant Service as service/pty.rs
    participant Infra as infra/pty.rs
    participant DB as SQLite
    participant Shell as System Shell

    User->>UI: Click "+" (new tab)
    UI->>Gen: createPtySession({meta, config})
    Gen->>Handler: invoke("create_pty_session")

    Handler->>Service: create_session(app, sessions, meta, config)
    Service->>Infra: create_session(sessions, shell, cwd, rows, cols)
    Infra->>Infra: native_pty_system().openpty()
    Infra->>Shell: spawn_command(shell, cwd)
    Infra->>Infra: Store PtySession in HashMap

    Service->>DB: INSERT INTO pty_sessions (profile_id)
    Service->>Service: spawn reader thread
    Service->>Service: spawn persistence thread

    Service-->>Handler: sessionId
    Handler-->>Gen: sessionId
    Gen-->>UI: sessionId
    UI->>Store: addTab(contextId, sessionId, title)
```

### 3. PTY Output Streaming (Dual-Thread)

```mermaid
sequenceDiagram
    participant Shell as Shell Process
    participant Reader as Reader Thread
    participant UTF8 as UTF-8 Boundary Detection
    participant Event as Tauri Event Bus
    participant Persist as Persistence Thread
    participant DB as SQLite
    participant Term as Terminal Component
    participant XTerm as xterm.js

    loop Continuous Read (4KB buffer)
        Shell-->>Reader: stdout/stderr bytes
        Reader->>Persist: mpsc::send(raw bytes)
        Reader->>UTF8: find_utf8_boundary(bytes)
        UTF8-->>Reader: valid boundary position
        Reader->>Event: emit("pty-output-{id}", text)
        Event-->>Term: listen callback
        Term->>XTerm: term.write(data)
    end

    loop Buffer Flush (32KB threshold)
        Persist->>Persist: buffer.extend(data)
        alt buffer >= 32KB
            Persist->>DB: INSERT INTO pty_output_chunks
            alt total > 1MB
                Persist->>DB: DELETE oldest chunks (pruning)
            end
        end
    end

    Shell-->>Reader: EOF (process exit)
    Reader->>Persist: drop(tx) → channel closed
    Persist->>DB: Flush remaining buffer
    Reader->>DB: Mark session closed
    Reader->>Event: emit("pty-exit-{id}")
    Event-->>Term: Show "[Process exited]"
```

### 4. Session Restoration on App Start

```mermaid
sequenceDiagram
    participant App as App Startup
    participant Hook as useRestoreTerminals
    participant Gen as generated/commands.ts
    participant Backend as Rust Backend
    participant DB as SQLite
    participant Store as terminalStore
    participant Term as Terminal Component

    App->>Backend: mark_all_open_sessions_closed()
    Backend->>DB: UPDATE pty_sessions SET closed_at = NOW()

    App->>Hook: useRestoreTerminals(projects)
    Hook->>Gen: listProjectSessions(projectId) × N projects
    Gen->>Backend: invoke per project
    Backend->>DB: SELECT * FROM pty_sessions WHERE profile_id IN (project profiles)

    loop For each old session
        Hook->>Gen: createPtySession({meta, config})
        Gen->>Backend: Create new PTY session
        Backend-->>Hook: newSessionId
        Hook->>Store: addTab(contextId, newSessionId, title, restoreFrom=oldId)
    end

    Term->>Gen: getPtySessionHistory({sessionId: oldId})
    Gen->>Backend: invoke
    Backend->>DB: SELECT data FROM pty_output_chunks WHERE session_id = ?
    Backend-->>Term: history bytes
    Term->>XTerm: term.write(decoded history)
    Term->>Gen: deletePtySessionRecord({sessionId: oldId})
    Term->>Store: clearRestore(contextId, sessionId)
```

### 5. Profile Creation (Git Worktree)

```mermaid
sequenceDiagram
    participant UI as CreateProfileDialog
    participant Gen as generated/commands.ts
    participant Handler as handler/profile.rs
    participant Service as service/profile.rs
    participant Repo as repo/profile.rs
    participant Git as infra/git.rs
    participant Config as infra/config.rs
    participant DB as SQLite
    participant FS as File System

    UI->>Gen: createProfile({projectId, branchName})
    Gen->>Handler: invoke("create_profile")
    Handler->>Service: create(conn, projectId, branchName)

    Service->>Service: sanitize_branch_name (CJK → pinyin, preserve /)
    Service->>Repo: get_project_folder(conn, projectId)
    Repo->>DB: SELECT folder FROM projects WHERE id = ?

    Service->>Service: resolve_worktree_base (~/.2code/workspace)
    Service->>Git: worktree_add(project_folder, branch, worktree_path)
    Git->>FS: git worktree add -b {branch} {path}

    Service->>Repo: insert(conn, id, projectId, branchName, worktreePath)
    Repo->>DB: INSERT INTO profiles

    Service->>Config: load_project_config(project_folder)
    Config->>FS: Read 2code.json
    Service->>Config: execute_scripts(setup_script, worktree_path)
    Config->>FS: sh -c "{script}" in worktree dir

    Service-->>Handler: Profile
    Handler-->>UI: Profile
```

### 6. File Watcher System

```mermaid
sequenceDiagram
    participant Frontend as useFileWatcher
    participant Channel as Tauri Channel
    participant Coord as Coordinator Thread
    participant Notify as notify::Watcher (per project)
    participant DB as SQLite
    participant FS as File System
    participant TQ as TanStack Query

    Frontend->>Channel: watchProjects(onEvent: Channel<WatchEvent>)
    Channel->>Coord: spawn coordinator thread

    loop Every 3s (DB poll)
        Coord->>DB: SELECT * FROM projects
        Coord->>Coord: Reconcile watchers (add new, remove deleted)
        Coord->>Notify: watch(project.folder, Recursive)
    end

    FS-->>Notify: File modify/create/remove event
    Notify->>Coord: mpsc::send(projectId, path)
    Note over Coord: Skip .git/ internal files
    Note over Coord: Debounce 500ms per project

    Coord->>Channel: send(WatchEvent{projectId})
    Channel-->>Frontend: onEvent callback
    Frontend->>TQ: invalidateQueries(["git-branch", ...])
    Frontend->>TQ: invalidateQueries(["git-diff", ...])
    Frontend->>TQ: invalidateQueries(["git-log", ...])
```

### 7. Debug Log Streaming

```mermaid
sequenceDiagram
    participant UI as DebugFloat
    participant Hook as useDebugLogger
    participant Gen as generated/commands.ts
    participant Handler as handler/debug.rs
    participant Handle as ChannelLayerHandle
    participant Layer as ChannelLayer (tracing)
    participant Forwarder as Forwarder Thread
    participant Channel as Tauri Channel
    participant Store as debugLogStore

    UI->>UI: User toggles debug (Cmd+Shift+D)
    Hook->>Gen: startDebugLog(onEvent: Channel<LogEntry>)
    Gen->>Handler: invoke("start_debug_log")
    Handler->>Handle: attach(channel)
    Handle->>Handle: Set mpsc::Sender in Arc<Mutex>
    Handle->>Forwarder: spawn forwarder thread

    loop Rust code emits tracing events
        Layer->>Layer: on_event (filter: INFO and above)
        Layer->>Forwarder: mpsc::send(LogEntry)
        Forwarder->>Channel: channel.send(LogEntry)
        Channel-->>Hook: onEvent callback
        Hook->>Store: addLog(entry)
        Store-->>UI: DebugLogDialog re-renders
    end

    UI->>Gen: stopDebugLog()
    Handler->>Handle: detach()
    Handle->>Handle: Drop sender → forwarder exits
```

## State Management Patterns

### Frontend State (Zustand)

```
terminalStore: {
  projects: {
    [contextId]: {           // contextId = profileId (default or worktree)
      tabs: TerminalTab[]    // {id, title, restoreFrom?}
      activeTabId: string
      counter: number
    }
  }
}
```

### Backend State (Rust)

```rust
// Managed by Tauri as application state
PtySessionMap: Arc<Mutex<HashMap<String, PtySession>>>
DbPool: Arc<Mutex<SqliteConnection>>
WatcherShutdownFlag: Arc<AtomicBool>
ChannelLayerHandle: { tx: Arc<Mutex<Option<mpsc::Sender<LogEntry>>>> }

// PtySession holds the live PTY connection
pub struct PtySession {
    pub master: Box<dyn MasterPty + Send>,
    pub writer: Box<dyn Write + Send>,
    pub child: Box<dyn Child + Send + Sync>,
}
```

## Caching Strategy

| Layer            | Technology                | Strategy                                                                          |
| ---------------- | ------------------------- | --------------------------------------------------------------------------------- |
| Server State     | TanStack Query            | staleTime: 30s, retry: 1, invalidate on mutations and file changes                |
| Terminal Output  | SQLite chunks             | 32KB flush threshold, 1MB cap with oldest-chunk pruning                           |
| Session State    | Rust HashMap              | In-memory for active PTY handles, DB for persistence                              |
| Font/Theme Prefs | Zustand + localStorage    | Persist middleware, immediate writes                                              |
| Query Keys       | `shared/lib/queryKeys.ts` | Hierarchical: `["projects"]`, `["git-branch", folder]`, `["git-diff", profileId]` |

## Error Handling Flow

```
Rust Error (AppError enum)
    ↓ thiserror #[error("...")]
Serialize to string via custom Serialize impl
    ↓ Tauri IPC
Frontend catch block (TanStack Query onError / Promise.catch)
    ↓
Display error toast via Chakra UI Toaster
```

Error variants: `IoError`, `LockError`, `PtyError`, `DbError`, `NotFound`, `GitError`

## App Lifecycle

### Startup

1. Initialize `tracing_subscriber` with console output + `ChannelLayer` for debug forwarding
2. Create `PtySessionMap` and `WatcherShutdownFlag`
3. Register Tauri plugins: `opener`, `dialog`, `notification`
4. `setup`: Initialize SQLite database (`init_db`), run embedded migrations
5. `setup`: Mark orphaned PTY sessions as closed (`mark_all_open_sessions_closed`)
6. Register all 22 command handlers

### Shutdown (`RunEvent::Exit`)

1. Signal watcher thread to stop via `WatcherShutdownFlag`
2. Mark all open PTY sessions as closed in DB
3. Kill all active PTY child processes (`close_all_sessions`)
