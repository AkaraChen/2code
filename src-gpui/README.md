# 2code GPUI

Native desktop rewrite of 2code using [GPUI](https://gpui.rs) and [gpui-component](https://github.com/longbridge/gpui-component). This crate is the primary product shell. It calls the existing `model` / `repo` / `service` / `infra` crates directly (no IPC). The React/Tauri UI remains in the repo as a reference implementation.

## Run

```bash
# from repo root
just start
# or
just gpui
# or
cd src-gpui && cargo run
```

`./start.sh` and `bun start` also launch this GPUI shell. The legacy Tauri path is `just tauri-dev` / `bun tauri:dev`.

Requires Rust 1.87+ (GPUI). On Linux install `libxkbcommon`, Vulkan, and Wayland/X11 development libraries.

## Window contract

- Main window `2code`: 1440×900, overlay title bar, traffic lights at (16, 24)
- Settings window `Settings`: 880×640, min 600×420
- Same SQLite DB as Tauri: `$XDG_DATA_HOME/com.akrc.code/app.db` (or platform equivalent)
- Preferences: `gpui-prefs.json` next to the DB

## Surfaces

App sidebar, Home empty state, Profile workspace (top bar, Files/Git/Notes, unified tabs), PTY terminals (vt100 cell grid, never destroyed on tab switch, restored from the session DB on launch, drag-to-PTY paths, clickable links), file viewer (text / markdown / image / archive), file-tree multi-select + inline rename, command palette, Git panel + unified/split two-column diff, all product dialogs, toasts, debug FAB, settings (6 tabs, system font/sound pickers), GitHub updater, filesystem watcher, en/zh i18n from `messages/*.json`.

See `docs/ui-inventory.md` for the rewrite spec this crate implements.
