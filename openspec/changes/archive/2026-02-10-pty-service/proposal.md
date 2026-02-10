## Why

The app needs a terminal emulator backed by real pseudo-terminal (PTY) sessions. The backend must manage PTY lifecycle (create, configure, destroy) and provide a streaming interface so the frontend (xterm.js) can attach, detach, and re-attach to any running session without data loss.

## What Changes

- Add a PTY service module in the Rust backend that spawns and manages PTY child processes
- Expose CRUD commands via Tauri IPC: create, get info, update config, delete, and list sessions
- Expose a streaming command that lets the frontend resume (attach/re-attach) a PTY's I/O stream, receiving output and sending input
- Maintain an in-memory registry of active PTY sessions, each identified by a unique ID
- Buffer recent PTY output per session so that re-attaching clients can replay missed content

## Capabilities

### New Capabilities

- `pty-management`: CRUD operations for PTY sessions — create (spawn shell), get info, update (resize, env), delete (kill), and list all sessions
- `pty-streaming`: Bidirectional I/O streaming for a PTY session — resume/attach to a session's stream, send input, receive output, handle disconnect/reconnect with output buffering

### Modified Capabilities

_(none — no existing specs)_

## Impact

- **Backend code**: New Rust module(s) under `src-tauri/src/` for PTY management and streaming
- **Tauri commands**: New `#[tauri::command]` functions registered in `lib.rs`
- **Dependencies**: New crates — `portable-pty` (or similar) for cross-platform PTY spawning, `tokio` for async runtime, `uuid` for session IDs
- **IPC surface**: New invoke commands exposed to the frontend; streaming likely uses Tauri's event/channel system rather than simple request-response
- **Platform**: Must work on macOS and Linux; Windows support is secondary but `portable-pty` covers it
