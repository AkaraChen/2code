# 2code

2code's coding workstation inside Herdr: projects on the left with their git
worktree profiles nested under them, a quiet top bar with the project, branch
and a Files / Git switch, flat Files and Changes panels, and line-style terminal
tabs with a terminal-template menu. Neutral grays (shadcn style), light and
dark, English or 简体中文.

![2code](preview.png)

## What you see

Left to right:

- **Sidebar**, 250px (min 44, max 420), `chrome` background.
  - 52px header: "2Code" (15px semibold) and a sidebar-toggle icon. Drags the window.
  - "Projects" label (12px, `dim`) with a `+` that opens the system folder picker.
  - One 32px row per project (a git repo): a 20px rounded letter tile, the repo
    name, the most urgent agent dot, a caret. Under it, one 28px row per profile
    (a space): branch icon, branch name, agent dot. The main checkout comes first.
  - Footer: Settings (opens Herdr's settings).
- **Work column**:
  - 44px top bar (`background`, bottom border): a segmented switch (folder icon =
    Files, branch icon with green `+N` / red `-N` = Changes), the project name
    (14px semibold) and branch centered, a settings button on the right. Drags the window.
  - Below it, a row: a 260px side panel (a stack of the `files` and `changes`
    parts, hidden until picked in the switch), then the terminal area. Both are
    flat (`background`, no card): Files is a 24px-row tree (12px indent, names in
    `muted`, git-colored: new green `ansi2`, modified blue `ansi4`, deleted red
    `ansi1`, a blue dot on folders with changes); Changes has a 40px header
    (select-all checkbox, "N changed file(s)", `+a -d`), 30px rows (checkbox,
    name, folder in `dim`, a 16px square status badge), the picked file's diff,
    and a commit box ("COMMIT", Summary input, Description textarea, "x of y files
    included", Commit).
  - Terminal area: a 34px tab strip (2px underline on the active tab, program icon,
    title, agent dot, ×), "+ New Terminal" and a chevron for templates; then the
    active tab's panes with 1px borders, no gaps, no rounding.
- Themes `2code-light` (white, `#fafafa` chrome, `#e5e5e5` borders, GitHub Light
  terminal colors) and `2code-dark` (`#161616` terminals, `#0a0a0a` chrome,
  GitHub-Dark-style ANSI), picked by the system appearance.

## How it behaves

- Agent dots: `working` pulses green (`#34d399`, opacity loop 1.2s), `blocked`
  is yellow (`#facc15`), `done` is green (`#22c55e`), `idle` shows nothing. A
  project shows its most urgent profile's status.
- Click a project: selects its shown (else first) profile. Caret folds it.
  Hover a project: `+` replaces the dot and opens Herdr's `worktree` dialog
  (action `new`); if the project's `2code.json` has `setup_script`, the new
  space's first tab is named "setup" ("安装") and runs it.
- Hover a non-default profile: `×` opens the 2code delete dialog: it lists the
  `teardown_script`, runs it in the worktree (Run / Skip / Cancel; a failure
  offers Remove anyway), then opens Herdr's `worktree` dialog (action `remove`).
- Top bar switch: clicking a mode shows the panel with that child; clicking the
  shown one hides the panel. Stats refresh every 3s.
- Tabs: click selects, right-click opens Herdr's tab menu, × closes. New
  Terminal opens a tab in the focused folder and types the project's
  `init_script`. The chevron lists project templates (`2code.json` in the main
  checkout) and global ones (`~/2code/2code.json`); picking one opens a tab named
  after it in its `cwd` and types `init_script` then its `commands`.
- Changes: clicking a row shows its diff below the list (again hides it); a
  checkbox includes or leaves out a file; Commit (or Enter in Summary) runs
  `git add -A -- <checked>` and `git commit -m <summary> [-m <description>] --
  <checked>` (plain `add -A` + `commit` when all are checked).
- Language: at start the sidebar runs `sh -c 'printf %s "${LC_ALL:-${LC_MESSAGES:-$LANG}}"'`
  (PowerShell's `$env:` on Windows); a `zh*` value shows 简体中文, anything else
  English. The result is shared `2code.locale`, so every part redraws.

## Built from

- Layout `layouts/2code.json`: root `row` (`titlebar: none`, traffic lights
  `[16, 24]`, theme `{light: 2code-light, dark: 2code-dark}`, JetBrains Mono 13,
  terminal padding `[8, 10]`) → `sidebar` column (`brand` block, `projects`
  block) and `work` column (`topbar` block, `work-body` row → `panel` stack
  [`files`, `changes` blocks] and `terminal-area` column [`tabs` block, `main` tab block]).
- One mod, `mods/2code`, every block `{mod: "2code", props: {part}}` with parts
  `header`, `sidebar`, `topbar`, `tabs`, `files`, `changes`, and overlay parts `templates` (popup
  300×360) and `teardown` (dialog 460×300). One folder because Herdr refuses
  imports from another mod's folder; `lib/` holds i18n, git, `2code.json` and
  terminal helpers.
- Shipped mods used: `worktree` (dialogs), `menu` (tab menu). The `files` and
  `changes` parts start from Herdr's shipped mods of those names (Apache-2.0,
  `mods/2code/NOTICE`): those draw themselves as rounded cards, which a layout
  can't turn off.
- `herdr` calls: `spaces`, `panes`, `focused`, `layout`, `theme`, `shared` /
  `setShared`, `exec`, `hc` (`send`), `readTextFile`, `pickFolder`,
  `openOverlay` / `closeOverlay`, `notify`, `run` (`space.select`,
  `space.new`, `tab.new`, `tab.select`, `tab.close`, `layout.toggle|show|hide|select`,
  `app.settings`).
- Programs run: `git`, `sh`, `defaults` (macOS) / `powershell.exe` (Windows).

## Watch out

- `tab.new {task}` only types into agents, so templates find the new tab's
  terminal in `panes()` (polling with `cx.sleep(100)`, up to 6s) and type each
  line with `hc send`.
- A popup's tasks die when it closes: the templates popup draws nothing while it
  opens the terminal, and closes itself after.
- Herdr has no locale API (no `Intl`, no `navigator`); the language comes from
  environment variables through `exec`. Herdr's own dialogs stay in English.
  On macOS, `LANG` is only there if the login shell sets it.
- `overflow_x_scrollbar()` wraps the tab strip, so it needs `flex_1()` to shrink.
- Profiles removed from Herdr's own space menu skip `teardown_script`.
- A project's config is read from its main checkout, so an uncommitted
  `2code.json` there applies to every worktree.

## Done when

- `herdr-app check mods/2code` passes and `layout.switch {name: "2code"}` shows
  the sidebar, top bar and tabs with no `herdr-app status` errors.
- Two worktrees of one repo appear as profiles under one project row.
- A project with `setup_script` gets a worktree from `+` whose first tab ran it.
- `×` on that profile runs `teardown_script`, then Herdr's remove dialog appears.
- A template from the chevron opens a tab with its name and its commands ran.
- With `LANG=zh_CN.UTF-8`, every 2code label is Chinese; unset, English.
- Unchecking a file in Changes and committing leaves that file uncommitted.
