# Tauri Smoke Test

This directory contains a CI-oriented desktop smoke test for the Tauri app.

It uses Tauri's WebDriver support via `tauri-driver` plus Selenium to verify that:

- the desktop shell launches
- the main layout renders
- the frontend is not blank

## Run

```bash
bun --cwd e2e-tests install
bun run test:tauri-smoke
```

## CI Notes

- Install `tauri-driver` with Cargo before running the suite.
- On Linux CI, run the suite under a virtual display such as `xvfb-run`.
- The suite skips on macOS because Tauri does not provide a desktop WebDriver client there.
- If your runner needs an explicit native WebDriver binary, set `TAURI_SMOKE_NATIVE_DRIVER=/path/to/driver`.
