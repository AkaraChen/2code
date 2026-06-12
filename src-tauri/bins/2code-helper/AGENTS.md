# AGENTS.md — src-tauri/bins/2code-helper

## OVERVIEW
CLI sidecar binary that PTY shells invoke to trigger desktop notification sounds and agent status updates. Single source file.

## FILE
`src/main.rs` — Reads `_2CODE_HELPER_URL` env var, sends `GET /notify` or `GET /status?session_id={_2CODE_SESSION_ID}&status=...` to the Axum server in `infra::helper.rs`.

## NOTIFICATION FLOW
```
PTY shell calls: $_2CODE_HELPER status running|waiting|idle
  → 2code-helper reads env vars
  → HTTP GET to infra::helper.rs Axum server
  → helper emits pty-agent-status Tauri event
  → frontend terminalStore.setAgentStatus(sessionId, status)
  → blinking green/yellow dot on terminal tab + sidebar profile item

PTY shell calls: $_2CODE_HELPER notify
  → helper plays the configured sound only
```

## BUILDING
```bash
just build-helper        # release build
just build-helper-dev    # debug build
```
Bundled as `externalBin` in `tauri.conf.json`. Target triple suffix added automatically by Tauri.

## ENV VARS (injected by shell_init.rs)
- `_2CODE_HELPER` — path to this binary
- `_2CODE_HELPER_URL` — URL of the Axum server  
- `_2CODE_SESSION_ID` — current PTY session ID

## ANTI-PATTERNS
- Adding business logic here — this is intentionally a tiny HTTP client only
