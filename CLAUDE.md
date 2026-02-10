# 2code — Tauri 2 + React + TypeScript

## Commands

```bash
bun tauri dev          # Run dev (frontend + backend hot-reload)
bun tauri build        # Production build (creates native binary)
bun run build          # Frontend-only build (TypeScript + Vite)
cd src-tauri && cargo test  # Run Rust tests
```

## Architecture

Tauri 2 app with two layers:

- **Frontend** (`/src`): React 19 + TypeScript, bundled by Vite. Entry: `main.tsx` → `App.tsx`.
- **Backend** (`/src-tauri`): Rust. Entry: `src/main.rs` → `src/lib.rs`. Commands registered in `lib.rs` via `tauri::generate_handler!`.

### IPC

Frontend calls Rust commands via `invoke()` from `@tauri-apps/api/core`:

```ts
import { invoke } from "@tauri-apps/api/core";
const result = await invoke("greet", { name: "world" });
```

Rust side: functions annotated with `#[tauri::command]` and registered in the invoke handler.

## Key Config Files

| File | Purpose |
|---|---|
| `src-tauri/tauri.conf.json` | Tauri app config (window, bundle, dev server) |
| `src-tauri/Cargo.toml` | Rust dependencies |
| `package.json` | Frontend dependencies, scripts |
| `vite.config.ts` | Vite/React config |
| `tsconfig.json` | TypeScript config |
