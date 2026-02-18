# Terminal System

The terminal system is the core feature of 2code — it manages PTY (pseudo-terminal) sessions with persistent scrollback, shell initialization, and output streaming.

## PTY Session Lifecycle

### 1. Creation

**Backend** (`service::pty::create_session`):

1. Load `2code.json` from project folder for `init_script`
2. Build default init scripts (notify hook, claude wrapper, PATH prepend)
3. Create ZDOTDIR temp directory with `.zshenv` (see [Shell Initialization](#shell-initialization))
4. Read helper HTTP server state (port + sidecar binary path)
5. Spawn PTY via `portable-pty` with environment:
   - `TERM=xterm-256color`
   - `ZDOTDIR={temp_init_dir}`
   - `_2CODE_HELPER_URL`, `_2CODE_HELPER`, `_2CODE_SESSION_ID`
6. Insert `pty_sessions` record + empty `pty_session_output` BLOB
7. Start reader thread for output streaming
8. Start persistence thread for BLOB appends

### 2. Output Streaming

Two background threads per session:

**Reader Thread:**
- Reads 4KB chunks from PTY master file descriptor
- Applies UTF-8 boundary detection (`find_utf8_boundary`) — if the last byte is a partial multi-byte character, it's held back and prepended to the next chunk
- Emits `pty-output-{sessionId}` Tauri event with UTF-8 text
- Sends raw bytes to persistence thread via mpsc channel
- Detects clear-scrollback sequence (`\x1b[3J`) and sends `PersistMsg::Clear`
- On EOF: signals persistence thread to flush, waits for completion, marks session closed, emits `pty-exit-{sessionId}`

**Persistence Thread:**
- Receives bytes via mpsc channel
- Immediately appends to BLOB: `UPDATE pty_session_output SET data = data || ? WHERE session_id = ?`
- Trims to 1MB cap: `UPDATE pty_session_output SET data = SUBSTR(data, -1048576) WHERE session_id = ? AND LENGTH(data) > 1048576`
- Handles `PersistMsg::Clear` by resetting BLOB to empty
- Handles `PersistMsg::Flush` for forced flush (best-effort, via oneshot channel)
- Exits when mpsc channel closes

### 3. Closure

**Backend** (`service::pty::close_session`):
1. Send SIGHUP to PTY child process
2. Remove from `PtySessionMap`
3. Mark `closed_at` in database
4. Reader thread detects EOF and cleans up

### 4. Restoration

**Backend** (`service::pty::restore_session`):
1. Read raw output BLOB from old session
2. Parse through `vt100` virtual terminal emulator (10K scrollback buffer)
3. Extract formatted text with SGR color codes preserved, cursor movement stripped
4. Trim trailing visually-empty lines
5. Create new PTY session (same metadata)
6. Delete old session record
7. Return `RestoreResult { sessionId, history }` to frontend

The `vt100` sanitization ensures that restored output renders cleanly in xterm.js without artifacts from cursor positioning, alternate screen mode, or other terminal state.

## UTF-8 Boundary Detection

The `find_utf8_boundary` function in `infra::pty` prevents emitting partial multi-byte UTF-8 characters:

```
Byte pattern    | Meaning           | Action
----------------|-------------------|--------
0xxxxxxx        | ASCII (1 byte)    | Safe boundary
110xxxxx        | 2-byte start      | Need 1 more byte
1110xxxx        | 3-byte start      | Need 2 more bytes
11110xxx        | 4-byte start      | Need 3 more bytes
10xxxxxx        | Continuation      | Part of multi-byte
```

The function scans the last 1-3 bytes of each chunk. If an incomplete sequence is found, the boundary is moved back, and the partial bytes are prepended to the next read.

## Clear-Scrollback Detection

When the user runs `clear` or equivalent (which emits `\x1b[3J`), the reader thread detects this escape sequence in the output stream and sends a `PersistMsg::Clear` to the persistence thread. This resets the stored BLOB to empty (`SET data = X''`), ensuring that restored sessions don't replay cleared content.

## Shell Initialization

### ZDOTDIR Injection

The infrastructure layer creates a temporary directory with a `.zshenv` file that zsh automatically sources on startup:

**Temp directory:** `/tmp/2code-init-{session_id}/`

**.zshenv contents** (simplified):
```bash
# 1. Restore original ZDOTDIR immediately
export ZDOTDIR="$_2CODE_ORIG_ZDOTDIR"
unset _2CODE_ORIG_ZDOTDIR

# 2. Source user's real .zshenv (if exists)
[[ -f "$ZDOTDIR/.zshenv" ]] && source "$ZDOTDIR/.zshenv"

# 3. Register one-shot precmd hook
__2code_init() {
    # Remove self from precmd hooks (one-shot)
    precmd_functions=(${precmd_functions:#__2code_init})

    # Default init: create ~/.2code/bin/, generate notify hook,
    # generate claude wrapper, prepend to PATH
    {default_init_script}

    # Project init_script from 2code.json
    {project_init_script}

    # Self-clean temp directory
    rm -rf "/tmp/2code-init-{session_id}"
}
precmd_functions+=(__2code_init)
```

### Default Init Script

Generated for every session:
1. Create `~/.2code/bin/` and `~/.2code/hooks/` directories
2. Generate `~/.2code/hooks/notify.sh` — calls `$_2CODE_HELPER notify` (notification trigger)
3. Generate `~/.2code/hooks/claude-settings.json` — Claude Code settings with Stop + PermissionRequest hooks pointing to `notify.sh`
4. Generate `~/.2code/bin/claude` wrapper — finds real `claude` in PATH, adds `--settings` flag
5. Prepend `~/.2code/bin` to `$PATH`
6. Set `PROMPT_SP=""` (disables zsh trailing newline marker)

## Frontend Architecture

### TerminalLayer (`src/features/terminal/TerminalLayer.tsx`)

Renders as a persistent absolute-positioned overlay across all routes. Uses React 19 `use()` hook with `restorationPromise` (from `features/tabs/restore.ts`) for Suspense integration.

```
TerminalLayer
├── for each profile with tabs:
│   ├── ProjectTopBar (git branch + custom controls + AgentMenu)
│   └── TerminalTabs
│       ├── Tab bar (with notification dots)
│       └── Tab content panels (all mounted, hidden via CSS)
│           ├── Terminal (for terminal tabs)
│           └── AgentChat (for agent tabs)
```

**Visibility:** Uses `display: flex | none` based on current route match. Active profile gets `flex`, all others get `none`. Terminals never unmount.

**Tab type dispatch:** `TerminalTabs` uses `ts-pattern` exhaustive matching on the tab's `type` field to render either a `Terminal` or `AgentChat` component.

### Terminal (`src/features/terminal/Terminal.tsx`)

Wraps xterm.js in a React component:

- Creates xterm.js instance in ref callback (React 19 cleanup return)
- Loads addons: `FitAddon` (auto-resize), `WebLinksAddon` (clickable URLs via `@tauri-apps/plugin-shell`)
- Listens to `pty-output-{sessionId}` and `pty-exit-{sessionId}` Tauri events
- Buffers events during history write to prevent rendering conflicts
- Auto-resizes via `ResizeObserver` on container element
- Font/theme/size changes update xterm options dynamically (no remount needed)

### Tab Store and Session Registry

Terminal tabs are managed through the unified [Tab System](./tabs.md):

- **`useTabStore`** (`features/tabs/store.ts`) — Zustand store holding per-profile tab collections, active tab, notification dots
- **`sessionRegistry`** (`features/tabs/sessionRegistry.ts`) — Module-level `Map<string, TabSession>` tracking all active session objects
- **`TerminalTabSession`** (`features/tabs/TerminalTabSession.ts`) — `TabSession` subclass for terminal tabs; creates/closes PTY sessions

**Derived selectors:**
- `useTabProfileIds()` — Returns all profile IDs that have tabs
- `useProfileHasNotification(profileId)` — Whether any tab in a profile has unread notification

### Restoration Pipeline (`features/tabs/restore.ts`)

Module-level `restorationPromise` created at import time:

1. `QueryObserver` watches `queryKeys.projects.all`
2. On first data: clean stale profiles from store
3. Fetch all PTY sessions via `listProjectSessions` per project
4. Fetch all agent sessions via `listProjectAgentSessions` per project
5. Create `TerminalTabSession` / `AgentTabSession` instances (lazy, no process spawned)
6. Register in `sessionRegistry` and add tabs to `useTabStore`
7. Promise resolves → `TerminalLayer` renders via Suspense

### Terminal Themes (`src/features/terminal/themes.ts`)

9 built-in color schemes: GitHub Light, GitHub Dark, Dracula, Ayu Light, Ayu Mirage, Solarized Light, Solarized Dark, One Dark, One Light.

Theme selection supports sync mode (same theme for light/dark) or independent themes per color scheme. The `useTerminalThemeId()` hook resolves the active theme based on `terminalSettingsStore` and the current light/dark mode.
