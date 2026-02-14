# Data Flow

## Primary Flow: Creating a Terminal Tab

```mermaid
sequenceDiagram
    participant User
    participant UI as TerminalTabs
    participant Hook as useCreateTerminalTab
    participant IPC as Tauri IPC
    participant Handler as handler::pty
    participant Bridge as bridge.rs
    participant Service as service::pty
    participant Infra as infra::pty
    participant DB as SQLite
    participant PTY as PTY Process

    User->>UI: Click "New Tab"
    UI->>Hook: mutate({ profileId, cwd })
    Hook->>IPC: createPtySession({ meta, config })
    IPC->>Handler: create_pty_session()
    Handler->>Bridge: build_pty_context()
    Bridge->>Service: create_session(ctx, meta, config)
    Service->>Service: Load init_script from 2code.json
    Service->>Infra: create_init_dir(scripts)
    Infra-->>Service: ZDOTDIR temp path
    Service->>Infra: spawn(shell, cwd, env, size)
    Infra->>PTY: Fork PTY process
    Infra-->>Service: (master_fd, child_pid)
    Service->>DB: Insert pty_sessions + pty_session_output records
    Service->>Service: Start read thread
    Service->>Service: Start persistence thread
    Service-->>Handler: session_id
    Handler-->>IPC: session_id
    IPC-->>Hook: session_id
    Hook->>Hook: store.addTab(profileId, sessionId)
    Hook-->>UI: Re-render with new tab

    loop PTY Output Stream
        PTY->>Infra: Read 4KB chunk
        Infra->>Infra: UTF-8 boundary check
        Infra->>IPC: emit pty-output-{id}
        IPC->>UI: xterm.write(data)
        Infra->>DB: Append to BLOB (via mpsc)
    end
```

## Session Restoration on App Start

```mermaid
sequenceDiagram
    participant App as main.tsx
    participant Layer as TerminalLayer
    participant State as state.ts
    participant Query as QueryObserver
    participant IPC as Tauri IPC
    participant Service as service::pty
    participant DB as SQLite
    participant VT as vt100 Parser

    App->>Layer: Render (Suspense boundary)
    Layer->>State: use(restorationPromise)
    Note over State: Promise created at module load

    State->>Query: Observe queryKeys.projects.all
    Query-->>State: Projects data available

    State->>State: Clean stale profiles from store

    loop For each project
        State->>IPC: listProjectSessions(projectId)
        IPC->>Service: list_project_sessions()
        Service->>DB: Query sessions via profiles join
        DB-->>State: Vec of PtySessionRecord
    end

    loop For each session (max 3 concurrent)
        State->>IPC: restorePtySession(oldId, meta, config)
        IPC->>Service: restore_session()
        Service->>DB: Read raw output BLOB
        Service->>VT: Parse through vt100 (10K scrollback)
        VT-->>Service: Sanitized SGR text
        Service->>Service: Trim trailing empty lines
        Service->>Service: Create new PTY session
        Service->>DB: Delete old session record
        Service-->>State: RestoreResult { newSessionId, history }
    end

    State->>State: Store history in sessionHistory Map
    State->>State: Add tabs to Zustand store
    State-->>Layer: Promise resolves
    Layer->>Layer: Render all terminal containers
    Layer->>Layer: xterm.write(sessionHistory.get(id))
```

## File Watcher to Git Diff Refresh

```mermaid
sequenceDiagram
    participant FS as File System
    participant Watcher as infra::watcher
    participant Service as service::watcher
    participant Channel as Tauri Channel
    participant FW as fileWatcher.ts
    participant QC as QueryClient
    participant Git as useGitDiffFiles

    Note over Service: Polls DB every 3s for project list
    Note over Service: Reconciles watchers (add new, remove deleted)

    FS->>Watcher: File change event
    Watcher->>Service: Debounce 500ms per project
    Service->>Service: Filter: skip .git internals
    Service->>Channel: WatchEvent { project_id }
    Channel->>FW: onmessage callback
    FW->>QC: invalidateQueries(["git-diff"])
    FW->>QC: invalidateQueries(["git-log"])
    QC->>Git: Refetch active queries
    Git->>Git: UI updates with new diff
```

## Notification Pipeline

```mermaid
sequenceDiagram
    participant Shell as PTY Shell
    participant Helper as 2code-helper
    participant Axum as Axum Server
    participant Store as Tauri plugin-store
    participant Sound as afplay
    participant Event as Tauri Event
    participant ZStore as Zustand Store
    participant UI as Terminal Tab UI

    Shell->>Shell: Command completes
    Shell->>Helper: $_2CODE_HELPER notify
    Note over Helper: Reads $_2CODE_HELPER_URL<br/>and $_2CODE_SESSION_ID

    Helper->>Axum: GET /notify?session_id={sid}
    Axum->>Store: Read notification settings
    Store-->>Axum: { enabled, sound }

    alt Notifications enabled
        Axum->>Sound: afplay /System/Library/Sounds/{sound}.aiff
        Axum->>Event: emit pty-notify { session_id }
        Event->>ZStore: markNotified(sessionId)
        ZStore->>UI: Green dot on tab + sidebar
    end

    Axum-->>Helper: { played: true/false }

    Note over UI: User focuses the tab
    UI->>ZStore: markRead(sessionId)
    ZStore->>UI: Green dot removed
```

## State Management

### Zustand Stores (Client State)

| Store | File | Persistence | Purpose |
|-------|------|-------------|---------|
| `terminalStore` | `features/terminal/store.ts` | None (rebuilt from DB) | Terminal tabs per profile, notification dots |
| `terminalSettingsStore` | `features/settings/stores/terminalSettingsStore.ts` | localStorage | Font family, font size, terminal themes |
| `themeStore` | `features/settings/stores/themeStore.ts` | localStorage | Accent color, border radius |
| `notificationStore` | `features/settings/stores/notificationStore.ts` | Tauri plugin-store | Sound name, enabled flag |
| `debugStore` | `features/debug/debugStore.ts` | localStorage (partial) | Debug mode toggle, panel state |
| `debugLogStore` | `features/debug/debugLogStore.ts` | None | Log buffer (max 500 entries) |
| `topBarStore` | `features/topbar/store.ts` | localStorage | Active controls, per-control options |

**Module-level side effects:**
- `terminalStore` registers `pty-notify` event listener at import time
- `terminalSettingsStore` syncs `--chakra-fonts-mono` CSS variable via subscription
- `themeStore` syncs `--chakra-radii-l1/l2/l3` CSS variables via subscription

### TanStack Query (Server State)

```typescript
queryKeys = {
  projects: { all: ["projects"] },
  git: {
    branch: (folder) => ["git-branch", folder],
    diff:   (profileId) => ["git-diff", profileId],
    log:    (profileId) => ["git-log", profileId],
    commitDiff: (profileId, hash) => ["git-commit-diff", profileId, hash]
  },
  agent: {
    status:      () => ["agent-status"],
    credentials: () => ["agent-credentials"]
  }
}
```

**Query defaults:** `staleTime: 30s`, `refetchOnWindowFocus: false`, `retry: 1`

**Invalidation patterns:**
- Project/profile mutations → invalidate `queryKeys.projects.all`
- File watcher events → invalidate all `git-diff` and `git-log` queries (prefix match)
- Agent install → invalidate `queryKeys.agent.status()`
