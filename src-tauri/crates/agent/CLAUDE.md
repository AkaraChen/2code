# CLAUDE.md

This file guides Claude Code instances working in `src-tauri/crates/agent`.

## Scope

This crate provides the AI agent runtime layer for 2code’s Tauri backend. It wraps ACP-compatible agent processes and exposes session lifecycle, prompt dispatch, notification streaming, and model-selection state.

## Common Commands

Run these from `src-tauri/crates/agent` unless noted otherwise.

- Build crate:
  - `cargo build`
- Build optimized:
  - `cargo build --release`
- Run tests for this crate:
  - `cargo test`
- Run a single test:
  - `cargo test test_mask_key`
- Run tests with logs/output visible:
  - `cargo test -- --nocapture`
- Type/lint check (if clippy is available):
  - `cargo clippy --all-targets --all-features -- -D warnings`
- Format (workspace-standard Rust formatting):
  - `cargo fmt --all`

## Architecture

### Module layout

- `src/lib.rs`
  - Public crate surface and type aliases.
  - Re-exports key types from submodules so callers can depend on `agent` directly.
  - Defines shared runtime maps:
    - `AgentSessionMap`: local session id -> `ManagedAgentSession`
    - `NotificationTaskMap`: session id -> notification task handle

- `src/manager.rs`
  - Thin wrapper around `sandbox-agent-agent-management`.
  - Responsibilities:
    - list installed/ready agent runtimes
    - install ACP bridges
    - resolve launch specs (`program`, `args`, `env`)
    - detect credentials (Anthropic/OpenAI) and mask key previews
  - Converts upstream types into stable crate-facing DTOs (`AgentStatusInfo`, `CredentialInfo`).

- `src/runtime.rs`
  - Low-level ACP transport session (`AgentSession`).
  - Spawns ACP process using `acp-client`, sends JSON-RPC request/notification messages, exposes notification stream, and performs graceful shutdown.
  - No ACP session lifecycle semantics here; just process + protocol transport.

- `src/session.rs`
  - High-level managed lifecycle (`ManagedAgentSession`) built on `AgentSession`.
  - Responsibilities:
    - create/load ACP sessions via `session/new` and `session/load`
    - send prompts via `session/prompt`
    - parse ACP push notifications into `SessionNotification`
    - maintain per-session event counter and reconnect history handoff
    - maintain model capability/state and model switching fallback strategy
  - Model switch behavior:
    1. try `session/set_model`
    2. fallback to `session/set_config_option` with model config id

- `src/models.rs`
  - Serde DTOs for frontend/backend boundary.
  - Includes prompt content schema, prompt result schema, session info, session events, and model option/state payloads.

## Key Runtime Flow

1. Resolve/install agent tooling via `AgentManagerWrapper`.
2. Spawn ACP process (`AgentSession::spawn` or `spawn_from_raw`).
3. Initialize or restore ACP session (`ManagedAgentSession::create` / `load`).
4. Send prompt (`ManagedAgentSession::prompt`).
5. Consume streamed notifications from `ManagedAgentSession::notifications` and parse with `parse_notification`.
6. Persist/forward events in callers (outside this crate).
7. Shutdown session gracefully on cleanup.

## Important Behaviors and Constraints

- `DEFAULT_TIMEOUT` is `None`: spawn/request flows are designed to wait indefinitely unless caller provides timeout in lower-level runtime calls.
- Prompt request results do not carry full conversation text; message content is expected from notification stream updates.
- Managed session keeps a local id and ACP session id; do not assume they are identical.
- Model metadata is parsed from multiple ACP response shapes (`models` and `configOptions`) to support heterogeneous agent implementations.
- Agent credential exposure is intentionally masked (`mask_key`) before surfacing to callers.

## Testing Notes

- Tests are colocated in each module (`#[cfg(test)]`).
- Most tests cover:
  - serialization/deserialization stability
  - ACP response/notification parsing
  - model state extraction logic
  - credential masking and agent id parsing
- When changing protocol parsing or DTOs, update both parser logic and round-trip tests in the same module.