# AGENTS.md — e2e-tests

## OVERVIEW
End-to-end test suite for the desktop app. Runs headless via Tauri driver on Linux (xvfb-run).

## STACK
Mocha + Selenium WebDriver + `tauri-driver` (not Playwright/Cypress). Requires `webkit2gtk-driver` on Linux.

## STRUCTURE
```
e2e-tests/
├── test/           # Test files (Mocha)
└── package.json    # Standalone package, separate from root bun workspace
```

## RUNNING
Triggered via `.github/workflows/tauri-smoke.yml` on `ubuntu-24.04`. Not easily run locally on macOS without Tauri driver setup.

## NOTES
- Tests interact with the full compiled Tauri binary, not a dev server
- `xvfb-run` provides virtual X11 display for headless GTK
- Root-level unit/integration tests use Vitest (frontend) and `cargo test` (Rust)
