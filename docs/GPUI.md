# 2code GPUI shell

2code’s shipped desktop process is a native [GPUI](https://gpui.rs) application (`gpui_app::run()`, binary `2code`). `cargo run` in `src-tauri` starts GPUI, not Tauri. It uses [gpui-component](https://github.com/longbridge/gpui-component) widgets and talks to `service` / `repo` / `infra` directly.

The old Tauri/React webview is behind `--features legacy-tauri`.

## Style baseline

Tokens were copied from `src/app.css` and checked against the current product screens:

| Token | Light | Dark |
| --- | --- | --- |
| background | `#ffffff` | `#252525` |
| foreground | `#252525` | `#fafafa` |
| sidebar | `#fafafa` | `#343434` |
| muted | `#f5f5f5` | `#444444` |
| border | `#e8e8e8` | white @ 10% |
| radius | 10px | 10px |
| sidebar width | 250px | 250px |
| header | 52px | 52px |

A static catalog lives at `docs/gpui-style-baseline.html`.

## Run

```bash
cd src-tauri && cargo run -p gpui-app
```

## Surfaces

- Home empty state and project cards
- Project sidebar with profiles
- Workspace panes via native `TabBar`: Files (preview + markdown `TextView`), Git (Changes / History), Terminal tabs + PTY
- Settings (language, theme, debug, terminal font) via `Switch` / `TabBar`
- Native `Dialog` / `AlertDialog` for create project, create profile, delete, and command palette
- vt100-backed PTY screen + agent status detector (Claude / Codex / Cursor)
- In-app notifications when an agent is waiting
- Tokens from `src/app.css` are applied onto the gpui-component `Theme`
