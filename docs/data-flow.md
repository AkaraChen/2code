# Data Flow

## Overview

2code uses a hybrid data flow combining **React's unidirectional data flow** on the frontend with **synchronous command handlers** in the Rust backend. PTY output uses a **streaming event pattern** for real-time terminal updates.

## Primary Data Flows

### 1. Project Creation Flow

```mermaid
sequenceDiagram
    actor User
    participant UI as CreateProjectDialog
    participant Hook as useCreateProject
    participant TQ as TanStack Query
    participant API as projectsApi
    participant Rust as Rust Command
    participant DB as SQLite
    participant FS as File System

    User->>UI: Click "Create Project"
    UI->>Hook: mutate({name, folder})
    Hook->>TQ: useMutation
    TQ->>API: createTemporary(name)
    API->>Rust: invoke("create_project_temporary")

    Rust->>Rust: Generate UUID
    Rust->>Rust: generate_dir_name(name, uuid)
    Rust->>FS: create_dir(temp_dir)
    Rust->>FS: git init

    Rust->>DB: INSERT INTO projects
    DB-->>Rust: Project record

    Rust-->>API: Project
    API-->>Hook: Project
    Hook->>TQ: invalidateQueries(projects)
    TQ-->>UI: onSuccess callback
    UI->>UI: Close dialog, navigate to project
```

### 2. Terminal Session Creation Flow

```mermaid
sequenceDiagram
    actor User
    participant UI as TerminalTabs
    participant Store as terminalStore
    participant Hook as useCreateTerminalTab
    participant API as ptyApi
    participant Rust as Rust PTY
    participant DB as SQLite
    participant Sys as System Shell

    User->>UI: Click "+" (new tab)
    UI->>Store: addTab(projectId, tab)
    UI->>Hook: mutate({projectId, cwd})

    Hook->>API: createSession(projectId, title, shell, cwd, rows, cols)
    API->>Rust: invoke("create_pty_session")

    Rust->>Rust: native_pty_system()
    Rust->>Rust: openpty(PtySize)
    Rust->>Sys: spawn_command(shell, cwd)

    Rust->>DB: INSERT INTO pty_sessions

    Rust->>Rust: std::thread::spawn(read_pty_output)
    Rust-->>API: sessionId

    API-->>Hook: sessionId
    Hook->>Store: setSessionId(projectId, tabId, sessionId)
```

### 3. PTY Output Streaming Flow

```mermaid
sequenceDiagram
    participant Sys as Shell Process
    participant Thread as Reader Thread
    participant Event as Tauri Event
    participant UI as Terminal Component
    participant XTerm as XTerm.js

    loop Continuous Read
        Sys-->>Thread: stdout/stderr bytes
        Thread->>Thread: String::from_utf8_lossy
        Thread->>Event: emit(`pty-output-${id}`, data)
    end

    Event-->>UI: Event listener callback
    UI->>XTerm: term.write(data)
    XTerm->>UI: Render terminal output

    alt Process Exits
        Sys-->>Thread: EOF (read returns 0)
        Thread->>Thread: flush_output_buffer()
        Thread->>DB: Mark session closed
        Thread->>Event: emit(`pty-exit-${id}`)
        Event-->>UI: Show "[Process exited]" message
    end
```

### 4. Database Persistence Flow

```mermaid
sequenceDiagram
    participant UI as Terminal Component
    participant Hook as useEffect
    participant API as ptyApi
    participant Rust as Rust Command
    participant DB as SQLite

    %% Restore on mount
    UI->>Hook: useEffect (mount)
    Hook->>Hook: restoreFrom prop set
    Hook->>API: getHistory(oldSessionId)
    API->>Rust: invoke("get_pty_session_history")
    Rust->>DB: SELECT data FROM pty_output_chunks
    DB-->>Rust: Vec&lt;Vec&lt;u8&gt;&gt;
    Rust-->>API: Vec&lt;u8&gt;
    API-->>Hook: history bytes
    Hook->>XTerm: term.write(historyText)
    Hook->>API: deleteRecord(oldSessionId)

    %% Background persistence during session
    loop Output Buffer Flush (32KB threshold)
        Rust->>Rust: output_buffer reaches FLUSH_THRESHOLD
        Rust->>DB: INSERT INTO pty_output_chunks
        Rust->>DB: Prune if total > 1MB
    end
```

## State Management Patterns

### Frontend State (Zustand)

```
terminalStore: {
  projects: {
    [projectId]: {
      tabs: TerminalTab[]
      activeTabId: string
      visible: boolean
      restore?: { oldSessionId: string }
    }
  }
}
```

### Backend State (Rust)

```rust
// Managed by Tauri
PtySessionMap: Arc<Mutex<HashMap<String, PtySession>>>
DbPool: Arc<Mutex<SqliteConnection>>

// PtySession structure
pub struct PtySession {
    pub master: Box<dyn MasterPty + Send>,
    pub writer: Box<dyn Write + Send>,
    pub child: Box<dyn Child + Send + Sync>,
}
```

## Caching Strategy

| Layer            | Technology      | Purpose                                     |
| ---------------- | --------------- | ------------------------------------------- |
| Server State     | TanStack Query  | Cache project list, invalidate on mutations |
| Terminal Output  | SQLite (chunks) | Persistent scrollback history per session   |
| Session State    | Rust HashMap    | In-memory PTY handles for active sessions   |
| Font Preferences | localStorage    | User font selection persistence             |

## Error Handling Flow

```
Rust Error (AppError)
    ↓
Serialize to string via thiserror
    ↓
Tauri invokes reject with error string
    ↓
Frontend catch block (or TanStack Query onError)
    ↓
Display error toast or fallback UI
```

Key error types:

- `IoError`: Filesystem operations
- `LockError`: Mutex poisoning
- `PtyError`: PTY operations
- `DbError`: Database operations
- `NotFound`: Record not found
