# AGENTS.md — src-tauri/bins/2code-helper

## OVERVIEW
CLI sidecar binary that PTY shells invoke to trigger desktop notifications. Single source file.

## FILE
`src/main.rs` — Reads `_2CODE_HELPER_URL` env var, sends `GET /notify?session_id={_2CODE_SESSION_ID}` to the Axum server in `infra::helper.rs`.

## NOTIFICATION FLOW
```
PTY shell calls: $_2CODE_HELPER notify
  → 2code-helper reads env vars
  → HTTP GET to infra::helper.rs Axum server
  → helper plays sound + emits pty-notify Tauri event
  → frontend terminalStore.markNotified(sessionId)
  → green dot on terminal tab + sidebar profile item
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
