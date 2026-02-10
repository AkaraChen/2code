## Context

The Rust backend has a complete PTY service (`src-tauri/src/pty/`) with session lifecycle management and streaming output via Tauri channels. The frontend has no terminal UI. The current ProjectsPage is a project list that will be entirely replaced by a tabbed terminal interface.

Key backend API surface:
- `create_pty(config?) → PtySessionInfo` — spawns a shell, returns `{ id, shell, cwd, rows, cols }`
- `write_to_pty(session_id, data)` — sends keyboard input as `Vec<u8>`
- `resume_stream(session_id, channel)` — opens a Tauri `Channel<PtyOutput>` that replays buffered output then streams live output
- `resize_pty(session_id, rows, cols)` — resizes the PTY
- `delete_pty(session_id)` — kills the session

The frontend uses `@tauri-apps/api/core` `invoke()` for commands and `Channel` for streaming.

## Goals / Non-Goals

**Goals:**
- Render a fully functional terminal (xterm.js) inside each tab
- Support multiple concurrent tabs, each with its own PTY session
- Handle terminal resize when the container or window size changes
- Preserve terminal output when switching between tabs (backend already buffers; `resume_stream` replays)

**Non-Goals:**
- Tab persistence across app restarts (sessions are ephemeral)
- Tab renaming, reordering, or drag-and-drop
- Split panes or tiling layout
- Customizable terminal themes or fonts (use sensible defaults)

## Decisions

### 1. Terminal library: xterm.js

xterm.js is the standard browser terminal emulator, used by VS Code, Hyper, and others. No realistic alternative exists for this use case.

Packages needed: `@xterm/xterm` (core) + `@xterm/addon-fit` (auto-resize to container).

### 2. Component structure

Two new components:

- **`TerminalTabs`** — the page-level component replacing ProjectsPage content. Manages tab state (list of `{ id, title }` where `id` is the PTY session ID). Renders a tab bar + the active terminal.
- **`Terminal`** — wraps a single xterm.js instance. Takes a `sessionId` prop. On mount: calls `resume_stream` with a `Channel` to receive output, hooks xterm's `onData` to `write_to_pty`. On unmount: disposes xterm instance. Uses `@xterm/addon-fit` with a `ResizeObserver` to auto-resize and call `resize_pty`.

### 3. Tab switching strategy

When switching tabs, the inactive terminal's DOM is hidden (not unmounted). This avoids destroying the xterm instance and losing scroll position. The `resume_stream` call on each terminal happens once at creation time; the backend's channel stays open as long as the component lives.

Implementation: render all `Terminal` components, use CSS `display: none` on inactive ones.

### 4. Tauri Channel usage for streaming

The frontend creates a `Channel` from `@tauri-apps/api/core` and passes it to `invoke("resume_stream", { sessionId, channel })`. The channel's `onmessage` callback receives `PtyOutput { data: number[] }` (Rust `Vec<u8>` serialized as JSON array). Convert to `Uint8Array` and write to xterm.

### 5. Page layout change

ProjectsPage currently sits inside `<main className="flex-1 p-8 overflow-y-auto">`. The terminal needs to fill the available space without padding interfering with xterm's precise sizing. The page component should override or negate the parent padding, or the App layout should conditionally remove padding for this route. Simplest approach: the terminal page uses negative margins or absolute positioning within its container to fill the space, or we remove `p-8` for this route.

Decision: The terminal page will use `absolute inset-0` positioning within main to break out of the padding, or we'll adjust the main element's padding conditionally. We'll use a simple approach: the TerminalTabs component fills its parent with `h-full w-full` and the page wraps it with negative margins to counteract the `p-8`.

## Risks / Trade-offs

- **xterm.js bundle size** (~300KB gzipped) — acceptable for a desktop Tauri app where it's loaded locally, not over network.
- **Memory with many tabs** — each tab keeps an xterm instance alive in DOM. For typical usage (< 10 tabs) this is fine. Not optimizing for hundreds of tabs.
- **`resume_stream` replays buffered output** — backend keeps last 1000 chunks. When switching tabs, the terminal already has its content since we keep it mounted. If a tab's channel dies unexpectedly, we'd need to re-call `resume_stream`, but this is an edge case.
- **Resize coordination** — `ResizeObserver` fires → `addon-fit` calculates rows/cols → `resize_pty` IPC call. Small lag is acceptable.
