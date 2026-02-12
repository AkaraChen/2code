# Data Flow

## Overview

2code uses a hybrid data flow combining **React's unidirectional data flow** on the frontend with **layered command handlers** in the Rust backend. PTY output uses a **streaming event pattern** for real-time terminal updates. All IPC calls use auto-generated typed bindings from `src/generated/`.

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
    participant Repo as repo/project.rs
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
    Service->>Repo: insert(conn, id, name, folder)
    Repo->>DB: INSERT INTO projects
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

    Service->>DB: INSERT INTO pty_sessions
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

    App->>Hook: useRestoreTerminals(projects, profiles)
    Hook->>Gen: listActiveSessions(projectId) × N projects
    Gen->>Backend: invoke per project
    Backend->>DB: SELECT * FROM pty_sessions WHERE project_id = ?

    loop For each old session
        Hook->>Hook: Resolve contextId (worktree → profile, else → project)
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
    Term->>Store: clearRestore(projectId, sessionId)
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

## State Management Patterns

### Frontend State (Zustand)

```
terminalStore: {
  projects: {
    [contextId]: {           // contextId = projectId OR profileId
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

// PtySession holds the live PTY connection
pub struct PtySession {
    pub master: Box<dyn MasterPty + Send>,
    pub writer: Box<dyn Write + Send>,
    pub child: Box<dyn Child + Send + Sync>,
}
```

## Caching Strategy

| Layer            | Technology             | Strategy                                                                           |
| ---------------- | ---------------------- | ---------------------------------------------------------------------------------- |
| Server State     | TanStack Query         | staleTime: 30s, retry: 1, invalidate on mutations                                  |
| Terminal Output  | SQLite chunks          | 32KB flush threshold, 1MB cap with oldest-chunk pruning                            |
| Session State    | Rust HashMap           | In-memory for active PTY handles, DB for persistence                               |
| Font/Theme Prefs | Zustand + localStorage | Persist middleware, immediate writes                                               |
| Query Keys       | `lib/queryKeys.ts`     | Hierarchical: `["projects"]`, `["profiles", projectId]`, `["git-diff", contextId]` |

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
