# Data Flow

## Primary Flow: Creating a Terminal Tab

```mermaid
sequenceDiagram
    participant User
    participant UI as TerminalTabs
    participant Hook as useCreateTab
    participant Registry as sessionRegistry
    participant IPC as Tauri IPC
    participant Handler as handler::pty
    participant Bridge as bridge.rs
    participant Service as service::pty
    participant Infra as infra::pty
    participant DB as SQLite
    participant PTY as PTY Process

    User->>UI: Click "New Terminal"
    UI->>Hook: mutate({ type: "terminal", profileId })
    Hook->>Hook: TerminalTabSession.create(profileId, cwd)
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
    Service->>Service: Start read thread (4KB chunks)
    Service->>Service: Start persistence thread (32KB flush buffer)
    Service-->>Handler: session_id
    Handler-->>IPC: session_id
    IPC-->>Hook: session_id
    Hook->>Registry: Register TerminalTabSession
    Hook->>Hook: useTabStore.addTab(profileId, tab)
    Hook-->>UI: Re-render with new tab

    loop PTY Output Stream
        PTY->>Infra: Read 4KB chunk
        Infra->>Infra: UTF-8 boundary check (find_utf8_boundary)
        Infra->>IPC: emit pty-output-{id}
        IPC->>UI: xterm.write(data)
        Infra->>DB: Append to BLOB (via mpsc, 32KB flush)
    end
```

## Agent Tab Creation and Messaging

```mermaid
sequenceDiagram
    participant User
    participant UI as AgentChat
    participant Hook as useCreateTab
    participant Session as AgentTabSession
    participant IPC as Tauri IPC
    participant Handler as handler::agent
    participant Agent as agent::runtime
    participant ACP as ACP Subprocess
    participant DB as SQLite
    participant Store as useAgentStore

    User->>UI: Click "New Agent" (via AgentMenu)
    UI->>Hook: mutate({ type: "agent", profileId })
    Hook->>Session: AgentTabSession.create(profileId, agent)
    Session->>IPC: createAgentSessionPersistent({ meta })
    IPC->>Handler: create_agent_session_persistent()
    Handler->>Agent: AcpStdioAdapter::spawn(binary, args)
    Agent->>ACP: Start subprocess (stdin/stdout JSON-RPC)
    Agent-->>Handler: AgentSessionInfo { id, acp_session_id }
    Handler->>DB: Insert agent_sessions record
    Handler-->>Session: AgentSessionInfo
    Session->>Session: registerListeners() for Tauri events
    Session->>Store: initSession(sessionId)

    User->>UI: Type prompt in ChatInput
    UI->>Store: addUserMessage(sessionId, prompt)
    UI->>IPC: sendAgentPrompt({ sessionId, prompt })
    IPC->>Handler: send_agent_prompt()
    Handler->>Agent: adapter.notify("session/sendPrompt", { prompt })
    Agent->>ACP: JSON-RPC notification

    loop Streaming Response
        ACP->>Agent: JSON-RPC notification (session/update)
        Agent->>IPC: emit agent-event-{id}
        IPC->>Session: Tauri event listener
        Session->>Store: handleAgentEvent(sessionId, event)
        Note over Store: ts-pattern match on event type:<br/>agent_message_chunk, agent_thought_chunk,<br/>tool_call, tool_call_update, plan
        Store->>UI: Re-render streaming content
    end

    ACP->>Agent: Turn complete notification
    Agent->>IPC: emit agent-turn-complete-{id}
    IPC->>Session: Tauri event listener
    Session->>Store: handleTurnComplete(sessionId)
    Session->>DB: Persist events to agent_session_events
```

## Session Restoration on App Start

```mermaid
sequenceDiagram
    participant App as main.tsx
    participant Layer as TerminalLayer
    participant Restore as restore.ts
    participant Query as QueryObserver
    participant IPC as Tauri IPC
    participant DB as SQLite
    participant Registry as sessionRegistry
    participant Store as useTabStore

    App->>Layer: Render (Suspense boundary)
    Layer->>Restore: use(restorationPromise)
    Note over Restore: Promise created at module load

    Restore->>Query: Observe queryKeys.projects.all
    Query-->>Restore: Projects data available

    Restore->>Store: removeStaleProfiles()

    loop For each project
        Restore->>IPC: listProjectSessions(projectId)
        IPC-->>Restore: PtySessionRecord[]
        Restore->>IPC: listProjectAgentSessions(projectId)
        IPC-->>Restore: AgentSessionRecord[]
    end

    loop For each PTY session
        Restore->>Registry: Create TerminalTabSession (lazy, no PTY spawn)
        Restore->>Store: addTab(profileId, terminalTab)
    end

    loop For each agent session
        Restore->>Registry: Create AgentTabSession (lazy, no reconnect yet)
        Restore->>Store: addTab(profileId, agentTab)
    end

    Restore-->>Layer: Promise resolves
    Layer->>Layer: Render all profile containers

    Note over Layer: When user focuses an agent tab:
    Layer->>Registry: AgentTabSession.reconnect()
    Registry->>IPC: reconnectAgentSession(sessionId)
    IPC->>DB: Load agent_session_events
    Registry->>Store: restoreFromEvents(events)
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
    participant Git as useGitDiff

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
    participant ZStore as useTabStore
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
| `useTabStore` | `features/tabs/store.ts` | None (rebuilt from DB) | Tab collections per profile, active tab, notification dots |
| `useAgentStore` | `features/agent/store.ts` | None | Agent session state (turns, streaming chunks, errors) per session |
| `terminalSettingsStore` | `features/settings/stores/terminalSettingsStore.ts` | localStorage (`"font-settings"`) | Font family, font size, dark/light terminal themes, sync toggle |
| `themeStore` | `features/settings/stores/themeStore.ts` | localStorage (`"theme-settings"`) | Accent color, border radius |
| `notificationStore` | `features/settings/stores/notificationStore.ts` | Tauri plugin-store (`settings.json`) | Sound name, enabled flag |
| `debugStore` | `features/debug/debugStore.ts` | localStorage (`"debug-settings"`, partial) | Debug mode toggle, panel state |
| `debugLogStore` | `features/debug/debugLogStore.ts` | None | Log buffer (max 1000 entries) |
| `topBarStore` | `features/topbar/store.ts` | localStorage (`"topbar-settings"`) | Active controls, per-control options |

**Module-level side effects:**
- `useTabStore` registers `pty-notify` event listener at import time
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

### Cross-cutting Data Flows

1. **PTY notifications**: Tauri `pty-notify` event → `useTabStore.markNotified(sessionId)` → `useProfileHasNotification` selector → green dots in `ProfileItem` and `TerminalTabs`
2. **Tab restore**: module-level `restorationPromise` (from `QueryObserver`) → `populateTabs()` → fills `sessionRegistry` and `useTabStore` → `TerminalLayer` suspends on this promise
3. **File watching**: `fileWatcher.ts` side-effect import in `main.tsx` → invalidates git queries on file change
4. **Theme propagation**: `useThemeStore.borderRadius` → CSS variables `--chakra-radii-l1/l2/l3`. `useThemeStore.accentColor` → Chakra `colorPalette` prop. `useTerminalSettingsStore.fontFamily` → CSS variable `--chakra-fonts-mono`
5. **Agent events**: Tauri events `agent-event-{id}`, `agent-turn-complete-{id}`, `agent-error-{id}` → `useAgentStore` actions → `AgentChat` re-renders via Zustand subscription
