## 1. Dependencies

- [x] 1.1 Install `@xterm/xterm` and `@xterm/addon-fit` via bun

## 2. Terminal Component

- [x] 2.1 Create `src/components/Terminal.tsx` — xterm.js wrapper that takes a `sessionId` prop
- [x] 2.2 On mount: initialize xterm, attach to DOM ref, load fit addon
- [x] 2.3 On mount: call `resume_stream` with a Tauri `Channel` to receive PTY output and write to xterm
- [x] 2.4 Hook xterm `onData` to call `write_to_pty` with raw bytes
- [x] 2.5 Add `ResizeObserver` on the container → `fitAddon.fit()` → `resize_pty` IPC call
- [x] 2.6 On unmount: dispose xterm instance, clean up observer and listeners

## 3. Tab Management

- [x] 3.1 Create `src/components/TerminalTabs.tsx` — manages tab state (`{ id, title }[]`, `activeId`, `counter`)
- [x] 3.2 Implement `createTab`: calls `create_pty`, adds tab with "Terminal N" label, sets it active
- [x] 3.3 Implement `closeTab`: calls `delete_pty`, removes tab, activates adjacent tab; if last tab, auto-create a new one
- [x] 3.4 Render tab bar with tab labels, close buttons, and a "+" button to create new tabs
- [x] 3.5 Render all `Terminal` instances, show active one via CSS (`display: none` on inactive)
- [x] 3.6 Auto-create first tab on mount

## 4. Page Integration

- [x] 4.1 Rewrite `ProjectsPage.tsx` to render `TerminalTabs` filling the full available space
- [x] 4.2 Handle layout padding — ensure the terminal fills the container without `p-8` interference
