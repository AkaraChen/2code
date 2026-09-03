# Leftover Tauri/React UI

2code’s shipped desktop app is native GPUI (`src-tauri/crates/gpui-app`).

This directory is the old webview UI, kept only for `--features legacy-tauri` and leftover Vitest coverage.

- `web/` — React 19 + Vite frontend
- `e2e/` — Tauri-driver smoke tests

Do not add new product features here. Port them to `src-tauri/crates/gpui-app` instead.
