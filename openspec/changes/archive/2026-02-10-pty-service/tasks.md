## 1. Project Setup

- [x] 1.1 Add `portable-pty`, `tokio` (with `rt`, `sync`, `macros` features), and `uuid` (with `v4` feature) to `src-tauri/Cargo.toml`
- [x] 1.2 Create the `src-tauri/src/pty/` module directory with `mod.rs`, `session.rs`, `commands.rs`, and `stream.rs`
- [x] 1.3 Declare `mod pty;` in `lib.rs` and verify the project compiles

## 2. Session Data Structures

- [x] 2.1 Define `PtyConfig` struct (shell, cwd, env, rows, cols) with serde Serialize/Deserialize and sensible defaults (user shell, home dir, 80×24)
- [x] 2.2 Define `PtySessionInfo` struct (id, shell, cwd, rows, cols, created_at) as the serializable response type
- [x] 2.3 Define `PtySession` struct holding id, master, child, writer, config, created_at, output_buffer (`VecDeque<Vec<u8>>`), and optional `AbortHandle` for the stream task
- [x] 2.4 Define `PtySessionRegistry` as `Arc<Mutex<HashMap<String, PtySession>>>` and a constructor function

## 3. CRUD Commands

- [x] 3.1 Implement `create_pty` command: accept optional `PtyConfig`, resolve defaults, spawn PTY via `portable-pty`, insert into registry, return `PtySessionInfo`
- [x] 3.2 Implement `get_pty` command: look up session by ID, return `PtySessionInfo` or not-found error
- [x] 3.3 Implement `list_pty` command: return `Vec<PtySessionInfo>` of all active sessions
- [x] 3.4 Implement `resize_pty` command: look up session, call `master.resize()`, update stored config, return success or not-found error
- [x] 3.5 Implement `delete_pty` command: look up session, abort stream task if active, kill child process, remove from registry, return success or not-found error

## 4. Streaming & I/O

- [x] 4.1 Define `PtyOutput` struct (`data: Vec<u8>`) as the channel message type
- [x] 4.2 Implement the output reader loop in `stream.rs`: clone PTY reader, read in 4KB chunks via `spawn_blocking`, send through channel, append to output buffer with ring buffer eviction (max 1000 chunks)
- [x] 4.3 Implement `resume_stream` command: accept session ID and `Channel<PtyOutput>`, abort previous stream task if any, replay buffered output, then start the live reader loop
- [x] 4.4 Implement `write_to_pty` command: accept session ID and `data: Vec<u8>`, write to PTY master writer, return success or not-found error
- [x] 4.5 Handle stream termination on channel drop (send failure stops the loop, session stays alive and continues buffering)
- [x] 4.6 Handle stream termination on process exit (EOF on reader stops the loop, session remains in registry)

## 5. Wiring & Registration

- [x] 5.1 Register `PtySessionRegistry` as Tauri managed state in `lib.rs`
- [x] 5.2 Register all commands (`create_pty`, `get_pty`, `list_pty`, `resize_pty`, `delete_pty`, `resume_stream`, `write_to_pty`) in `tauri::generate_handler!`
- [x] 5.3 Verify the full project compiles and the app launches without errors

## 6. Testing

- [x] 6.1 Write a Rust integration test: create a session, verify session info is returned with correct defaults
- [x] 6.2 Write a Rust integration test: create, list, get, resize, delete lifecycle — verify each step returns expected results
- [ ] 6.3 Manually test via `bun tauri dev`: create a session, resume stream, type commands, verify output flows back, resize, delete
