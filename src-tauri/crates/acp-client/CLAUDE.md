# CLAUDE.md

## Project Overview

This crate (`acp-client`) is a small async Rust library that wraps an ACP-compatible subprocess behind a JSON-RPC client API.

- Spawns an external process with piped stdin/stdout
- Sends JSON-RPC requests and notifications to the subprocess
- Correlates responses to requests via incrementing request IDs
- Exposes subprocess notifications as an async stream
- Provides graceful shutdown semantics with pending-request cleanup

## Common Commands

Run these from this crate directory.

- Build: `cargo build`
- Check (fast compile validation): `cargo check`
- Lint: `cargo clippy --all-targets --all-features`
- Run tests: `cargo test`
- Run a single test: `cargo test <test_name>`
- Format: `cargo fmt`

## Architecture

### Public API Surface

`src/lib.rs` only re-exports:

- `AcpClient` from `src/adapter.rs`
- `AdapterError` and `Result` from `src/error.rs`

This keeps the crate boundary intentionally narrow.

### Core Client (`src/adapter.rs`)

`AcpClient` owns subprocess IO and request lifecycle state:

- `stdin`: shared, mutex-protected writer to child stdin
- `child`: shared, mutex-protected child process handle
- `pending`: map of request ID -> oneshot sender for response routing
- `notification_tx`: broadcast channel for push notifications
- `shutting_down`: atomic guard to prevent new work during shutdown
- `request_id`: atomic counter for JSON-RPC request IDs
- `request_timeout`: optional per-request timeout (defaults to no timeout)

Key behavior:

1. **Spawn path**
   - `spawn` delegates to `spawn_with_timeout`
   - Subprocess is started with piped stdin/stdout and inherited stderr
   - A background stdout reader task is spawned immediately

2. **Request/response flow**
   - `request()` allocates a numeric ID, stores a oneshot sender in `pending`, writes JSON-RPC payload, then awaits the response channel
   - Timeout is optional; `None` means wait indefinitely
   - On send failure or timeout, the request entry is removed from `pending`

3. **Notification flow**
   - `notify()` sends fire-and-forget JSON-RPC messages (no `id`)
   - `notifications()` returns a stream from a broadcast receiver

4. **Stdout dispatch loop**
   - Reads line-delimited stdout (`BufReader::lines`)
   - Parses each line as JSON
   - Messages with `id` are treated as responses and matched against `pending`
   - Messages without `id` are treated as notifications and broadcast

5. **Shutdown behavior**
   - Idempotent via `shutting_down` atomic swap
   - Clears all pending requests first
   - Then acquires child lock, checks process state, and kills/waits if still running
   - Avoids lock-order deadlocks by not using a separate exit watcher

### Error Model (`src/error.rs`)

`AdapterError` centralizes failure modes for subprocess and protocol handling:

- Process spawn / IO capture failures (`Spawn`, `MissingStdin`, `MissingStdout`)
- Subprocess write/flush failures (`Write`)
- Serialization failures (`Serialize`)
- Request wait failures (`Timeout`)
- Protocol/runtime mismatches (`InvalidMessage`, `ShuttingDown`)

Use the crate-level `Result<T>` alias for all fallible operations.

## Development Notes

- Protocol framing assumes **one JSON message per stdout line** from the subprocess.
- If the subprocess emits non-JSON or multi-line JSON output on stdout, messages are dropped by the parser loop.
- `request_id` uses an atomic counter with relaxed ordering; request matching relies on the `pending` mutex map.
- There are currently no crate-local tests in `src/`.