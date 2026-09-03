# 2code GPUI shell

2code’s primary desktop UI is a native [GPUI](https://gpui.rs) application in `src-tauri/crates/gpui-app`. It uses [gpui-component](https://github.com/longbridge/gpui-component) widgets (Sidebar, Button, Input, Switch, TabBar, TitleBar, Icon) and calls the existing `service` / `repo` / `infra` crates directly.

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

- Home empty state
- Project sidebar with profiles
- Workspace top bar, file list, Git stats/diff, PTY terminal
- Settings (language, theme, debug, terminal font)
- Create project / create profile / delete project dialogs
