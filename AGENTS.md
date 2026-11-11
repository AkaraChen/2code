# AGENTS.md

This repo is **2code for Herdr**: a Herdr app layout (`layouts/2code.json`),
its mod (`mods/2code/`) and themes (`themes/`), plus 2code's website
(`website/`). The old Tauri app is on the `legacy-tauri-app` branch; don't
bring its code back here.

## Herdr basics

- Herdr's UI is files under `~/.config/herdr-app`: layouts are JSON node
  trees, mods are JavaScript that describe native GPUI elements. No HTML, CSS,
  DOM, `setTimeout`, `Intl` or Node APIs.
- The truth for the API is the installed `~/.config/herdr-app/AGENTS.md`,
  `herdr.d.ts` and `gpui-kit.d.ts` (rewritten by each Herdr version). Read them
  before using something new.
- Prefer Herdr's own features and shipped mods (`files`, `changes`,
  `worktree`, `menu`, ...) over reimplementing them. Shipped mods are
  read-only: reference them from the layout, or `mod.clone` if they must change.

## Working on the mod

- One mod folder on purpose: Herdr rejects imports outside a mod's folder, so
  shared code (`lib/i18n.js`, `lib/git.js`, `lib/config.js`, `lib/terminal.js`)
  must live in `mods/2code/`. A layout block picks a part with
  `{"mod": "2code", "props": {"part": "<name>"}}`; parts are in `parts/` and
  registered in `main.js`.
- All user-facing strings go through `t()` with both `en` and `zh` entries in
  `lib/i18n.js`. The locale comes only from the system's `LC_ALL` /
  `LC_MESSAGES` / `LANG` (read with `exec`), falling back to English; there is
  no switcher. Parts read `shared("2code.locale")` in `render` so they redraw
  when it resolves.
- `parts/files.js` and `parts/changes.js` derive from Herdr's shipped mods
  (Apache-2.0): keep `NOTICE` and `LICENSE-Herdr.txt` with them.
- Never keep a `cx`; use the one each callback gets. Start async work with
  `cx.spawn`, wait with `cx.sleep(ms)`, poll gently with `cx.timer.every`.
- Git reads pass `--no-optional-locks -c core.fsmonitor=false` (`READ` in
  `lib/git.js`) so they don't trigger folder watches.
- Nothing is persisted by 2code except `localStorage` UI state and the shared
  locale. Projects come from `spaces()` + git; config comes from
  `2code.json` files.

## Test

```sh
./scripts/install.sh                       # copy into ~/.config/herdr-app + herdr-app check
herdr-app do layout.switch --name 2code
herdr-app status                           # errors from files and mods
herdr-app shot /tmp/2code.png              # what the window shows
```

Never call a change done without a passing `herdr-app check` and a look in
the running app. Install by copying, not symlinking (Herdr won't load SVGs or
hot-reload through a symlink). Update `RECIPE.md` when behavior changes.

## Website

`website/` is a standalone Next.js app (bun, deployed by Netlify from
`website/netlify.toml`): `cd website && bun install && bun run dev`.
