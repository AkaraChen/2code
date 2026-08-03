# Split on-demand features out of the 2.9MB entry chunk (git diff stack, ligatures addon, settings window, tour)

> Eager startup JS drops ~29% (2,832 → 2,009 KiB minified; gzip 824 → 600 KiB) and V8 compile of the eager set drops 27–31% on every app launch, by lazy-loading four features that are never needed for first paint. | Severity: high | Category: performance

## Problem

The production entry chunk is **2,891.16 kB minified / 850.25 kB gzip** (`dist/assets/index-BiI5hxk8.js` from `bunx vite build`). In a Tauri webview this file must be fully fetched, parsed, and executed before first paint **on every app launch** — there is no cross-launch bytecode cache guarantee, so this is a recurring per-launch cost, not a one-time download.

Sourcemap byte attribution of that chunk shows several large blocks that are provably not needed for first render:

1. **`@xterm/addon-ligatures` — 269 KB** (a single prebundled `.mjs`). Statically imported at `src/features/terminal/lib/addons.ts:4` and loaded unconditionally per terminal at `addons.ts:42-46` — already inside a `try/catch` ("Ligatures not supported by current font"), i.e. it is best-effort and trivially deferrable.

2. **The git-diff/file-tree stack — `@pierre/diffs` 194 KB + `@pierre/trees` 149 KB + shiki/`@shikijs/vscode-textmate`/oniguruma ~160 KB** — pulled into the entry chunk because `GitDiffDialog` is statically imported at `src/features/git/ProjectTopBar.tsx:17` and `src/features/git/components/SidebarGitPanel.tsx:14`, even though the dialog only ever shows on explicit user action (Cmd+G, toolbar button, double-click on a changed file). `GitReviewQueueDialog` rides along via `src/features/git/components/GitDiffContent.tsx:50`.

3. **The entire settings-window UI**, statically imported at `src/main.tsx:14` (`import SettingsWindow from "./features/settings/SettingsWindow"`) and only rendered when `getCurrentWebviewWindow().label === "settings"` (`main.tsx:22,48-52`). The main window parses all of it for nothing. This static import chain also defeats an existing split: `main.tsx:27` dynamically imports `./features/debug/performanceProfileStore`, but `src/features/settings/SettingsPage.tsx:25` statically imports the same module, producing rolldown's `INEFFECTIVE_DYNAMIC_IMPORT` warning in the build log and inlining the store into the entry chunk.

4. **`driver.js` — 20 KB** (onboarding tour), statically imported at `src/features/home/TourOnboarding.tsx:2-3` which is statically imported by `src/features/home/HomePage.tsx:13` — only used when the project list is empty.

Additionally, `src/App.tsx:7-8` statically imports both route pages (`HomePage`, `ProjectDetailPage`), so there is zero route-level splitting (this is noted as optional headroom below; it was **not** part of the measured fix).

The codebase already uses the `React.lazy` pattern successfully: `src/features/terminal/TerminalTabs.tsx:49-50` lazy-loads `FileViewerPane` and `UnsavedFileCloseDialog`. The 3.6 MB monaco (`editor.api2`) and shiki language chunks are **already lazy** — leave them alone.

## Evidence & Measurements

Baseline build output: `dist/assets/index-BiI5hxk8.js 2,891.16 kB │ gzip: 850.25 kB`, plus the rolldown warning: `src/features/debug/performanceProfileStore.ts is dynamically imported by src/main.tsx but also statically imported by src/features/settings/SettingsPage.tsx`.

Sourcemap byte attribution of the entry chunk: `@xterm/addon-ligatures` 269 KB, `@pierre/diffs` 194 KB, `@pierre/trees` 149 KB, shiki+`@shikijs/vscode-textmate`+oniguruma-to-es+oniguruma-parser+`@shikijs/core` ~160 KB, motion-dom+framer-motion 122 KB, `@phosphor-icons/react` 120 KB, driver.js 20 KB.

A/B benchmark, verified by applying exactly the four fixes below to an isolated copy of this repo (verbatim results):

> Build A/B (bunx vite build, rolldown-vite, identical machine, isolated copy of repo with node_modules symlinked; fixes = exactly the finding's items 1-4, no route splitting): BASELINE entry chunk index-BiI5hxk8.js = 2,891.16 kB min / 850.25 kB gzip; INEFFECTIVE_DYNAMIC_IMPORT warning present. OPTIMIZED entry chunk index-l2-AKAd1.js = 1,783.47 kB / 528.12 kB gzip (-1,107.7 kB / -322.1 kB, -38.3%/-37.9% entry-only); warning gone. Honest eager-set totals from dist/index.html (script + modulepreload, all executed at startup): baseline 3 files = 2,831.6 KiB raw / 823.7 KiB gzip; optimized 9 files = 2,009.1 KiB / 600.0 KiB gzip => -822.5 KiB raw (-29.0%), -223.7 KiB gzip (-27.2%). New lazy chunks: GitDiffDialog 482.14 kB/137.90 gz, addon-ligatures 276.50 kB/79.13 gz, SettingsWindow 64 kB, TourOnboarding 21 kB; performanceProfileStore split into own chunk. Parse-cost proxy (node v22.22.2, vm.SourceTextModule compile of full eager set, unique trailing comment per iter to defeat V8 compilation cache, 3 warmups + 20 iters): default lazy-parse mean 88.04 ms -> 64.63 ms (-23.4 ms, -26.6%); --no-lazy full compile mean 247.09 ms -> 170.69 ms (-76.4 ms, -30.9%). Correctness: bunx vitest run src/features/git src/features/home src/features/terminal on the patched copy = 388/388 pass (27 files). Top-level execution savings of deferred modules not measurable in node (no DOM), so parse numbers are a lower bound.

The real startup win is strictly larger than the parse numbers: the deferred modules' top-level execution (oniguruma/shiki init, ligature font table setup, driver.js, settings UI) is also skipped on every launch.

## Proposed Change

Four independent edits. Each is safe to land alone; together they reproduce the measured numbers.

### 1. Defer `@xterm/addon-ligatures` in `src/features/terminal/lib/addons.ts`

Remove the static import at line 4:

```ts
// DELETE: import { LigaturesAddon } from "@xterm/addon-ligatures";
```

Replace the `try { terminal.loadAddon(new LigaturesAddon()); } catch { ... }` block at lines 42-46 with an async fire-and-forget dynamic import:

```ts
// Ligatures are best-effort (were already wrapped in try/catch). Loading
// async is acceptable: the addon just re-shapes glyph runs when it attaches.
void import("@xterm/addon-ligatures")
	.then(({ LigaturesAddon }) => {
		terminal.loadAddon(new LigaturesAddon());
	})
	.catch(() => {
		// Ligatures not supported by current font (or module failed to load)
	});
```

Note: `terminal.loadAddon` can throw synchronously inside the `.then` — the promise `.catch` handles that, preserving the old failure tolerance. One behavioral nuance: if the terminal is disposed before the import resolves, `loadAddon` on a disposed terminal throws — also swallowed by the `.catch`, which matches the old best-effort semantics. Keep all other addons (Fit, Search, Serialize, Clipboard, Image, Progress, WebLinks, Unicode11) eager — xterm core and `TerminalLayer` are first-paint content.

### 2. Lazy-load `GitDiffDialog` at both usage sites

`GitDiffDialog` is a **default export**, so `lazy(() => import(...))` works directly. Both sites currently mount the dialog unconditionally with an `isOpen` prop, so with plain `React.lazy` the chunk is fetched/parsed on component mount rather than on first open — that is still off the synchronous first-paint path (which is where the measured win comes from). For true on-demand loading, additionally gate rendering on a `hasEverOpened` flag (NOT on `isOpen` alone, which would break close animations by unmounting mid-animation).

**`src/features/git/ProjectTopBar.tsx`** — replace the static import at line 17:

```ts
// DELETE: import GitDiffDialog from "@/features/git/GitDiffDialog";
import { lazy, Suspense } from "react";  // merge into existing react import at lines 2-9
const GitDiffDialog = lazy(() => import("@/features/git/GitDiffDialog"));
```

The internal `GitDiffDialogWithBranch` wrapper (lines 59-90) renders `<GitDiffDialog …>` — that reference now resolves to the lazy component; no change needed inside it. Wrap the conditional render block at lines 307-328 (the `profile.is_default ? <GitDiffDialogWithBranch …> : <GitDiffDialog …>` ternary) in a Suspense boundary, optionally gated on first open:

```tsx
const [hasEverOpenedGitDiff, setHasEverOpenedGitDiff] = useState(false);
// in openGitDiffDialog (line ~126): setHasEverOpenedGitDiff(true);

{hasEverOpenedGitDiff && (
	<Suspense fallback={null}>
		{profile.is_default ? (
			<GitDiffDialogWithBranch … />
		) : (
			<GitDiffDialog … />
		)}
	</Suspense>
)}
```

If the `hasEverOpened` gate feels risky, the minimal measured variant is just `<Suspense fallback={null}>` around the existing lines 307-328 with no gating — this is exactly what was benchmarked.

**`src/features/git/components/SidebarGitPanel.tsx`** — same treatment. Replace line 14:

```ts
// DELETE: import GitDiffDialog from "../GitDiffDialog";
import { lazy, Suspense } from "react";  // merge into existing react import at lines 2-9
const GitDiffDialog = lazy(() => import("../GitDiffDialog"));
```

Wrap the `<GitDiffDialog …>` at lines 234-242 in `<Suspense fallback={null}>…</Suspense>` (same optional `hasEverOpened` gating; open triggers are `handleOpenFile`/`handleMaximize` which call `setDiffDialogOpen(true)`).

`GitReviewQueueDialog` needs no separate treatment: it is only imported by `GitDiffContent.tsx` (line 50), which is inside the `GitDiffDialog` graph, so it moves into the lazy chunk automatically.

### 3. Lazy-load `SettingsWindow` in `src/main.tsx`

Replace line 14:

```ts
// DELETE: import SettingsWindow from "./features/settings/SettingsWindow";
const SettingsWindow = React.lazy(
	() => import("./features/settings/SettingsWindow"),
);
```

(`React` is already imported as `* as React` at line 4; `SettingsWindow` is a default export.)

Wrap the settings branch of the render (lines 48-52) in Suspense:

```tsx
{isSettingsWindow ? (
	<React.Suspense fallback={null}>
		<SettingsWindow />
	</React.Suspense>
) : (
	<AppRoot />
)}
```

This alone removes the `INEFFECTIVE_DYNAMIC_IMPORT` warning and lets `performanceProfileStore` split into its own chunk — do **not** touch the `void import("./features/debug/performanceProfileStore")` at `main.tsx:27` (it is a deliberate main-window-only side effect) nor the static import in `SettingsPage.tsx:25`; once `SettingsWindow` is lazy, `SettingsPage`'s static import no longer drags the store into the entry chunk. Also leave `./features/settings/stores/crossWindowSync` (main.tsx:16) eager — the main window needs it to receive settings changes from the settings window.

### 4. Lazy-load the tour in `src/features/home/HomePage.tsx`

`TourOnboarding` is a **named export**, so map it to a default:

Replace line 13:

```ts
// DELETE: import { TourOnboarding } from "./TourOnboarding";
import { lazy, Suspense } from "react";  // merge into the existing react import at line 2
const TourOnboarding = lazy(() =>
	import("./TourOnboarding").then((m) => ({ default: m.TourOnboarding })),
);
```

And at line 58:

```tsx
<Suspense fallback={null}>
	<TourOnboarding isEnabled={hasNoProjects} />
</Suspense>
```

`TourOnboarding` renders `null` and drives the tour via effects with a 300 ms mount delay (`TourOnboarding.tsx:50-57`), so the async chunk load is invisible. The `driver.js/dist/driver.css` import (`TourOnboarding.tsx:3`) moves into the lazy chunk's CSS, which Vite injects on load — fine, since the tour is the only consumer.

### What NOT to change (scope limits)

- **Do not** attempt to fully evict `@pierre/diffs` / `@pierre/trees` from the entry chunk. `SidebarGitPanel` (eager, in the sidebar) → `src/features/git/hooks.ts:24` → `patchFiles.ts` runtime-imports `parsePatchFiles`, so the diff **parser** portion stays eager; only the FileDiff React + shiki portion moves (that is most of the bytes). Likewise `@pierre/trees` stays partly eager via `src/shared/lib/fileTreeIcons.ts` (`createFileTreeIconResolver`/`getBuiltInSpriteSheet`) and `FileTreePanel` via `ProfileSidebar`. Evicting these fully requires refactors beyond this plan.
- **Do not** touch monaco/shiki language chunks — already lazy.
- **Optional stretch (unmeasured, extra headroom):** route-level splitting of `HomePage`/`ProjectDetailPage` in `src/App.tsx:7-8` via `lazy()` — `App.tsx` already wraps routes in `AsyncBoundary` with `PageSkeleton` fallback (lines 62-81), so Suspense integration is nearly free. Land the four measured fixes first; only add this if doing so, and verify `TerminalLayer` (App.tsx:90) stays eager.

## Verification

All commands run from `/home/user/2code`. **Do not run `bun tauri build`/`bun tauri dev` or plain `cargo build`/`cargo test`** — the full Tauri app cannot build or launch in CI containers (missing GTK libs / no display). No Rust code changes are involved anyway.

1. **Typecheck + build (primary gate):**
   ```bash
   bun run build        # paraglide compile → tsc → vite build
   # or, for iteration: bunx vite build
   ```
   Success criteria in the build output:
   - The `INEFFECTIVE_DYNAMIC_IMPORT` warning about `performanceProfileStore.ts` is **gone**.
   - New lazy chunks exist, approximately: `GitDiffDialog` ~482 kB (contains @pierre/diffs + shiki), `addon-ligatures` ~276 kB, `SettingsWindow` ~64 kB, `TourOnboarding` ~21 kB, and a small `performanceProfileStore` chunk.
   - Entry chunk drops from ~2,891 kB to ~1,783 kB.

2. **Honest eager-set accounting (do not judge by the entry-chunk line alone):** rolldown hoists modules shared between the entry and new lazy chunks into `modulepreload`ed chunks that still execute at startup (expected: separator ~104 KiB, useScrollLock ~95 KiB, messages ~39 KiB, queryKeys ~19 KiB). Validate with the sum of ALL script + modulepreload JS referenced by `dist/index.html`:
   ```bash
   node -e '
   const fs=require("fs"),zlib=require("zlib");
   const html=fs.readFileSync("dist/index.html","utf8");
   const files=[...html.matchAll(/(?:src|href)="\/(assets\/[^"]+\.js)"/g)].map(m=>m[1]);
   let raw=0,gz=0;
   for(const f of files){const b=fs.readFileSync("dist/"+f);raw+=b.length;gz+=zlib.gzipSync(b,{level:9}).length;}
   console.log(files.length,"eager files:",(raw/1024).toFixed(1),"KiB raw /",(gz/1024).toFixed(1),"KiB gzip");'
   ```
   Expected: baseline ~2,832 KiB raw / ~824 KiB gzip (3 files) → ~2,009 KiB raw / ~600 KiB gzip (~9 files). Also confirm the GitDiffDialog/addon-ligatures/SettingsWindow/TourOnboarding chunks are **not** in that eager list.

3. **Existing tests (all passed with these exact patches applied — 388/388 in 27 files):**
   ```bash
   bunx vitest run src/features/git src/features/home src/features/terminal
   ```
   And the full suite (671 tests pass on baseline):
   ```bash
   bunx vitest run
   ```
   Relevant existing coverage: `src/features/git/gitDiffReducer.test.ts`, `hooks.test.tsx`, `patchFiles.test.ts`, `reviewQueue.test.ts`, `utils.test.ts`, and the terminal feature tests.

4. **New test to add:** a small vitest for the lazy render sites, e.g. `src/features/git/lazyGitDiffDialog.test.tsx`: render `SidebarGitPanel` (or a minimal harness around the Suspense-wrapped lazy `GitDiffDialog`) with `isOpen=false`, assert nothing throws and the panel content renders; then flip open and `await waitFor(...)` for dialog content, proving the Suspense fallback resolves. If a `hasEverOpened` gate was added, assert the dialog module is not mounted before first open and stays mounted after close (so close animations survive).

5. **Manual smoke (dev machine only, not CI):** `bun tauri dev` — open the git diff dialog via Cmd+G and via sidebar double-click (both entry points), open Settings (Cmd+,, separate window), start with zero projects to see the tour, and confirm ligatures render in a terminal with a ligature font (e.g. Fira Code: type `=>` and `!=`).

## Risks & Constraints

- **CLAUDE.md invariant — terminals must never unmount / use CSS `display:none` only.** Nothing here may conditionally render `<Terminal>` or `TerminalLayer`. Keep xterm core, all non-ligature addons, and `TerminalLayer` eager: terminals are first-paint content. Only the ligatures addon becomes async.
- **Ligatures load is now async fire-and-forget.** A terminal may render its very first frames without ligature shaping until the chunk loads (one-time, per launch). This was already best-effort (try/catch); acceptable. Keep the `.catch(() => {})` — removing it turns missing-font/disposed-terminal errors into unhandled rejections.
- **Suspense fallback must be `null`** for the dialogs/tour — they are overlay/portal content; any visible fallback would flash in the layout.
- **Close animations:** if adding the `hasEverOpened` gate, gate on "ever opened", never on `isOpen` — unmounting on close kills the dialog's exit animation. Both `ProjectTopBar` and `SidebarGitPanel` render sites need their own Suspense wrapper.
- **`main.tsx` ordering:** the main-window-only side effects at lines 26-35 (`performanceProfileStore`, `fileWatcher`, profiling sync) and the eager `crossWindowSync` import (line 16) must not be moved into the lazy `SettingsWindow` graph — the main window depends on `crossWindowSync` to observe settings changes, and the settings window must NOT start a second file watcher (comment at main.tsx:24-25).
- **Do not edit generated/compiled dirs:** `src/generated/`, `src/paraglide/`, `project.inlang/settings.json` are off-limits (paraglide messages are pre-compiled; touching inlang settings can silently empty all messages).
- **Shared-chunk drift:** rolldown's chunking is content-driven; exact chunk names/sizes will differ per build. Judge success by the eager-set sum (step 2 of Verification), not by any single chunk line.
- **`GitDiffDialogWithBranch` calls `useGitBranch(cwd, isOpen && isActive)`** — moving it inside a conditional `hasEverOpened` block changes when that hook first runs (from mount to first open). The hook is already gated on `isOpen && isActive`, so behavior is equivalent, but keep an eye on `hooks.test.tsx` if it asserts mount-time query registration.
- **No Rust/backend changes** — the four workspace-crate test suites (`cargo test -p model -p repo -p service -p infra`, 151 tests) are unaffected; don't run un-scoped cargo commands in containers.
