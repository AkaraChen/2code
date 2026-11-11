# 2code

2code's workstation, as a layout for [Herdr](https://herdr.dev).

Projects on the left with their worktree profiles nested under them, a top bar
with the project, branch and a Files / Git switch, and line-style terminal tabs
with project and global terminal templates. Herdr runs the terminals and
agents; 2code is the look and the workflow on top.

![2code for Herdr](preview.png)

> The original Tauri desktop app lives on the
> [`legacy-tauri-app`](https://github.com/AkaraChen/2code/tree/legacy-tauri-app)
> branch and is no longer developed.

## Install

Install [Herdr](https://herdr.dev/download/), then ask the agent in any Herdr
terminal:

```
Add the layout at github.com/AkaraChen/2code
```

Or copy it yourself from a clone of this repo:

```sh
./scripts/install.sh                         # copies into ~/.config/herdr-app and runs herdr-app check
herdr-app do layout.switch --name 2code
```

`ctrl-shift-l` cycles layouts, so Herdr's own stays one key away.

## What it adds to Herdr

- **Projects and profiles.** Projects stay in the sidebar (only their paths
  are kept, in Herdr's shared state); a space opened on a new repo adds it.
  Profiles are the repo's checkouts from `git worktree list`: the main one
  first, then worktrees, open or not. Picking a closed one opens it.
- **Project menu** (right-click): new profile, rename, project settings,
  reveal in the file manager, remove. **Profile menu**: open, reveal, delete.
- **New profile** (`+` on a project) opens Herdr's own New worktree dialog and
  runs the project's `setup_script` as the new space's first tab.
- **Delete profile** (`×` on a profile) warns about uncommitted files and
  unpushed commits, runs the project's `teardown_script`, then removes the
  worktree. The branch stays.
- **Project settings** (the top bar gear): edit `2code.json` scripts and
  project templates, and the global templates in `~/2code/2code.json`.
- **Terminal templates**: the menu beside **New Terminal** opens a tab named
  after the template and types `init_script` and its commands into your shell.
- **Files**: a tree with file icons, git colors and gitignored entries dimmed,
  and a right-click menu (new, rename, delete to the trash, copy paths, reveal,
  open in the default app). Files open in their own tab beside the terminals:
  an editor with syntax highlighting, save, unsaved prompts, reload on disk
  changes, markdown preview and images. `cmd-k` finds a file by name.
- **Changes** in 2code's flat style: commits only the checked files (summary +
  description), discards a file (click twice) and pushes.
- **Diff dialog**: Changes and History, unified or split, image before/after,
  and review comments (click a line, click another to make a range) collected
  per repo and copied for an agent in one go.
- **Top bar**: the project opens its folder, the branch opens a branch
  switcher, the pull request shows with its state (`gh`), "Open in…" your
  editor, terminal or GitHub Desktop.
- GitHub avatars for projects, a tile rail when the sidebar is dragged narrow,
  arrow-key navigation in the sidebar. The corner says Herdr until you hover
  it, then rolls over to 2code.
- **English or 简体中文**, from the system's `LC_ALL` / `LC_MESSAGES` / `LANG`;
  English when none is Chinese or set.
- 2code's light and dark themes (`2code-light`, `2code-dark`).

Everything else (terminals that survive restarts, agent status and alerts,
worktree creation, settings, remote machines) is Herdr's.

## Keys

These apply while the 2code layout shows (`keys.json`, section
`layout:2code`; `install.sh` adds them to yours without replacing keys you
set). Herdr's own keys keep working: `cmd-w` closes a tab, `cmd-b` the
sidebar, `cmd-,` settings, `cmd-f` searches a terminal.

| macOS | Linux / Windows | |
|---|---|---|
| `cmd-t` | `ctrl-shift-t` | new terminal (runs `init_script`) |
| `cmd-k` | `ctrl-shift-k` | find a file |
| `cmd-s` | `ctrl-s` | save the file (in a file tab) |
| `cmd-g` | `ctrl-shift-g` | diff dialog |
| `cmd-e` | `ctrl-shift-e` | show / hide the Files / Changes panel |
| `cmd-shift-e` | `ctrl-shift-j` | arrow keys in the sidebar (Esc returns) |
| `shift-enter` | `shift-enter` | newline (for agent prompts) |
| `alt-left` / `alt-right` | `alt-left` / `alt-right` | word left / right |

Plain `ctrl-` letters stay with terminal programs on Linux and Windows, so
2code's `ctrl-k` / `ctrl-g` / `ctrl-e` became `ctrl-shift-` keys there
(`ctrl-s` only applies in a file tab). Herdr
treats an edited `keys.json` as yours and stops updating its defaults in it.

## `2code.json`

Put it at the root of a project (its main checkout; worktrees use it too):

```json
{
  "setup_script": ["bun install"],
  "teardown_script": ["rm -rf node_modules"],
  "init_script": ["nvm use"],
  "terminal_templates": [
    { "name": "Dev server", "cwd": "apps/web", "commands": ["bun dev"] }
  ]
}
```

- `setup_script` / `teardown_script`: one shell line each, run in order with
  `sh -c` in the worktree, stopping at the first failure.
- `init_script`: typed into every terminal 2code opens (New Terminal and
  templates), before a template's own commands.
- `terminal_templates[].cwd`: relative to the profile's checkout; empty means
  its root.

Global templates go in `~/2code/2code.json`:

```json
{
  "terminal_templates": [
    { "name": "Git log", "commands": ["git log --oneline -20"] }
  ]
}
```

## Repository

| Path | What |
|---|---|
| `layouts/2code.json` | the layout |
| `mods/2code/` | the mod: one folder, parts chosen with `props.part` |
| `themes/` | `2code-light` and `2code-dark` |
| `keys.json` | the layout's keys, merged into yours by `install.sh` |
| `RECIPE.md` | the brief to rebuild the layout from scratch (Herdr's sharing format) |
| `TODO.md` | what still differs from the Tauri app (中文) |
| `website/` | [2code's website](https://2code.akr.moe) (Next.js) |
| `scripts/install.sh` | copy into a Herdr home and check |
| `scripts/build-file-icons.mjs` | rebuild the file icon slice from material-icon-theme |
