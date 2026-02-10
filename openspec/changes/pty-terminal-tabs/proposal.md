## Why

The PTY backend is fully implemented but has no frontend UI. The Projects page currently shows a project list that isn't needed. Replace it with a tabbed terminal interface so users can interact with multiple PTY sessions directly.

## What Changes

- **BREAKING**: Remove all existing content from ProjectsPage (project list, navigation to project details)
- Add a tab bar to ProjectsPage where each tab represents an independent PTY terminal session
- Users can create new tabs (each spawns a new PTY via `create_pty`)
- Users can close tabs (kills the PTY via `delete_pty`)
- Users can switch between tabs to view different terminal sessions
- Install and integrate xterm.js as the terminal emulator in the browser
- Connect xterm.js to the PTY backend via Tauri IPC (`write_to_pty`, `resume_stream`, `resize_pty`)

## Capabilities

### New Capabilities

- `terminal-tabs`: Tab management UI — create, close, switch between terminal tabs on the Projects page
- `terminal-view`: xterm.js terminal component connected to PTY backend via Tauri IPC (input, output streaming, resize)

### Modified Capabilities

_(none — existing `pty-management` and `pty-streaming` specs are unchanged; this change only adds frontend consumption)_

## Impact

- **Frontend**: `src/pages/ProjectsPage.tsx` rewritten entirely; new terminal component(s) added
- **Dependencies**: `xterm` + `@xterm/addon-fit` added to package.json
- **Backend**: No changes — existing PTY commands used as-is
- **Routing**: `/projects` route remains but now serves the terminal tab UI; `/projects/:id` route and `ProjectDetailPage` may become unused
