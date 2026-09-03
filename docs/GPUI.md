# 2code GPUI shell

2code’s shipped desktop process is a native [GPUI](https://gpui.rs) application (`gpui_app::run()`, binary `2code`). `cargo run` in `src-tauri` starts GPUI, not Tauri. It uses [gpui-component](https://github.com/longbridge/gpui-component) widgets and talks to `service` / `repo` / `infra` directly.

The old Tauri/React webview is behind `--features legacy-tauri`. Default `code` / `2code` builds do not link WebKit.

## Style baseline

Tokens were copied from `legacy/web/src/app.css` and checked against the current product screens:

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
- Workspace chrome: Files / Git / Terminal pane switcher, native top bar (editor / external terminal / GitHub Desktop / PR status)
- Settings (language, theme, debug, terminal font) via `Switch` / `TabBar`
- Native `Dialog` / `AlertDialog` for create project, create profile, delete, and command palette
- vt100-backed PTY screen + raw key input, color spans, resize, and session restore
- Agent status detector (Claude / Codex / Cursor) with in-app + system-sound notifications
- Git changes list with commit / discard / push / branch checkout
- Hierarchical file tree with git badges, native `Editor` for source, and markdown preview/edit
- Colored unified diffs for changes and commit history
- Project groups in the sidebar
- Tokens from `legacy/web/src/app.css` are applied onto the gpui-component `Theme`
