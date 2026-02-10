## Context

The app currently has a minimal Tauri 2 backend (just a `greet` command). We need to add a full PTY service that manages terminal sessions and streams their I/O to a frontend xterm.js terminal. Tauri 2 provides `Channel<T>` for high-throughput backend→frontend streaming and standard `#[tauri::command]` for request/response IPC.

## Goals / Non-Goals

**Goals:**

- Manage multiple concurrent PTY sessions with unique IDs
- Provide CRUD operations: create, get, update (resize), delete, list
- Stream PTY output to the frontend via Tauri channels with guaranteed ordering
- Accept user input via Tauri commands
- Buffer recent output so re-attaching clients can replay missed content
- Work on macOS and Linux; Windows via ConPTY

**Non-Goals:**

- Frontend implementation (xterm.js integration is a separate change)
- Session persistence across app restarts (sessions are ephemeral)
- Multi-window / multi-client attach to the same session (single consumer per session)
- Shell configuration UI (environment variables, shell selection beyond defaults)

## Decisions

### 1. PTY crate: `portable-pty`

Use `portable-pty` (from the WezTerm project) for cross-platform PTY spawning.

**Why over alternatives:**
- **vs `rust-pty`**: `portable-pty` is battle-tested in WezTerm (a production terminal). `rust-pty` is newer with less ecosystem validation.
- **vs `tauri-plugin-pty`**: The plugin is alpha-stage and doesn't expose CRUD/session management. Building on `portable-pty` gives full control over session lifecycle, buffering, and the IPC contract.

`portable-pty` does blocking I/O, but we wrap reads in a `tokio::task::spawn_blocking` to integrate with Tauri's async runtime.

### 2. Session registry: `Arc<Mutex<HashMap<String, PtySession>>>`

Store all active sessions in a `HashMap` behind `Arc<Mutex<>>`, managed as Tauri state.

Each `PtySession` holds:
- `id: String` — UUID v4
- `master: Box<dyn MasterPty + Send>` — for writing input and cloning readers
- `child: Box<dyn Child + Send>` — the spawned process handle
- `config: PtyConfig` — shell, cwd, env, size
- `created_at: SystemTime`
- `output_buffer: VecDeque<Vec<u8>>` — ring buffer of recent output chunks

**Why `Mutex` over `RwLock`**: Most operations mutate state (write input, append buffer). Read-heavy workloads (list/get) are infrequent. A `Mutex` is simpler and avoids writer starvation.

### 3. Output streaming: Tauri `Channel<T>`

Use `tauri::ipc::Channel<PtyOutput>` for streaming PTY output to the frontend.

- The `resume_stream` command accepts a `session_id` and a `Channel<PtyOutput>` parameter
- A background `tokio::task::spawn_blocking` reads from the PTY master in a loop, sending chunks through the channel
- On call, first flush the output buffer (replay), then stream live output
- If the frontend disconnects (channel drops), the read loop detects the send failure and stops — but the PTY session stays alive

**Why Channel over Events**: Channels provide guaranteed ordering (index-based), are type-safe, and are optimized for high-throughput streaming. Events are fire-and-forget with no ordering guarantees.

### 4. Input delivery: dedicated `write_to_pty` command

A simple `#[tauri::command]` that takes `session_id` and `data: Vec<u8>`, writes to the PTY master.

**Why not events**: Commands give us a return value (success/error) and are easier to reason about. Input frequency (keystrokes) is low enough that command overhead is negligible.

### 5. Output buffering: fixed-capacity `VecDeque<Vec<u8>>`

Keep the last N chunks (e.g., 1000 chunks of up to 4KB each ≈ 4MB max) in a ring buffer per session. When `resume_stream` is called, replay the buffer before switching to live output.

**Why chunk-based over byte-based**: Simpler bookkeeping. Each PTY read produces a chunk; we store chunks as-is. The frontend (xterm.js) handles partial sequences fine.

### 6. Module structure

```
src-tauri/src/
├── main.rs              # unchanged
├── lib.rs               # register new commands + manage state
├── pty/
│   ├── mod.rs           # re-exports
│   ├── session.rs       # PtySession, PtyConfig, session registry
│   ├── commands.rs      # #[tauri::command] functions
│   └── stream.rs        # output reader loop, buffering logic
```

### 7. New dependencies

```toml
portable-pty = "0.9"
tokio = { version = "1", features = ["rt", "sync", "macros"] }
uuid = { version = "1", features = ["v4"] }
```

Tauri 2 already bundles tokio, but we need explicit features for `spawn_blocking` and `Mutex`. `serde` is already present.

## Risks / Trade-offs

**[Blocking I/O in async context]** → `portable-pty` uses blocking reads. Mitigated by running reads in `spawn_blocking`. Each session consumes one OS thread while streaming — acceptable for a desktop app with a handful of sessions.

**[Buffer memory]** → 4MB per session. With ~10 sessions, that's 40MB. Acceptable for a desktop app. Can tune the cap later.

**[Channel lifetime]** → If the frontend calls `resume_stream` multiple times (re-attach), the previous read loop must stop. Mitigated by tracking an `AbortHandle` per session and aborting the old task before starting a new one.

**[PTY master thread-safety]** → `portable-pty`'s `MasterPty` supports `try_clone_reader()` and `take_writer()`. The reader clone lives in the stream task; the writer stays in the session for input commands. No shared mutable access needed.

**[Process cleanup]** → If `delete` is called while the process is still running, we `kill()` the child and drop the master. If the app crashes, PTY child processes become orphans. This is standard terminal behavior — the OS reaps them.
