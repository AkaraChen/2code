# Slim the Monaco bundle: full-fat import plus 4 unused language workers is ~12.6MB of the 27.7MB JS payload

> Dropping the ts/css/html language workers (and keeping only the JSON service) cuts Monaco's JS payload from 12.91MB to ~4.3MB raw (gzip 3.06MB → ~1.12MB), ~34% of the app's total shipped JS. | Severity: medium | Category: performance

## Problem

`src/shared/lib/monaco.ts` pulls in the **entire** Monaco editor and registers **five** web workers, even though the app only uses Monaco as a lightweight file viewer/editor:

- `src/shared/lib/monaco.ts:2` — `import * as monaco from "monaco-editor"` resolves (via the package `exports` map: `"." → "./esm/vs/editor/editor.main.js"`) to the full-fat entry: every editor feature contribution, all ~86 basic-languages, **plus** the css/html/json/typescript language *services* and the monaco-lsp-client.
- `src/shared/lib/monaco.ts:3-7` — imports all five workers (`editor.worker`, `css.worker`, `html.worker`, `json.worker`, `ts.worker`) as Vite `?worker` assets, so all five ship in the build.
- `src/shared/lib/monaco.ts:17-31` — `MonacoEnvironment.getWorker` routes labels `json`/`css`/`scss`/`less`/`html`/`handlebars`/`razor`/`typescript`/`javascript` to the four language workers.
- `src/shared/lib/monaco.ts:33` — `loader.config({ monaco })` hands this namespace to `@monaco-editor/react`.

The only consumer is `src/features/projects/FileViewerPane.tsx:1` (`import "@/shared/lib/monaco"`), which is itself `React.lazy`-loaded from `src/features/terminal/TerminalTabs.tsx:49`. FileViewerPane **explicitly disables all TS/JS diagnostics** in its `beforeMount` handler (`src/features/projects/FileViewerPane.tsx:287-298`, `noSemanticValidation: true` / `noSyntaxValidation: true` for both `typescriptDefaults` and `javascriptDefaults`). Syntax highlighting for TS/JS/CSS/HTML and every other code language is Monarch-based (registered by `basic-languages/*` contributions) and runs on the main thread — it does not need the language workers.

Resulting dist payload (measured from the real build, `dist/assets/`):

| Asset | Raw | Gzip |
|---|---|---|
| `editor.api2-F5DVBnku.js` (main Monaco chunk) | 3,626.9 kB | 916 kB |
| `ts.worker-B0J26iPs.js` | 6,733 kB | 1,442 kB |
| `css.worker-CvXBzhp8.js` | 1,030 kB | 233 kB |
| `html.worker-BO6WuOEO.js` | 703 kB | 184 kB |
| `json.worker-BkJRGcCJ.js` | 400 kB | 118 kB |
| `editor.worker-Cn2oRESe.js` | 273 kB | 84 kB |

That is ~12.7MB of a 26.3MB total dist JS (~48%), all shipped in the installer and every updater artifact. The ts.worker alone is 6.7MB and spawns (128ms parse on a worker thread) every time a TS/JS file is opened — to serve completions/hover that a file *viewer* doesn't need (diagnostics, its main job, are disabled).

**Important scope correction (verified by A/B benchmark, see below):** the originally-suggested "slim entry" fix (`monaco-editor/esm/vs/editor/editor.api` + hand-picked feature contributions) does **not** work on monaco-editor 0.55.1 — `editor.api` transitively pulls the whole standalone editor, shrinking the main chunk only 2.6%, and first-open parse time is unchanged. **The entire realizable win is removing the unwanted language services and their worker assets.** The main editor chunk staying ~3.6MB after this change is expected, not a regression.

## Evidence & Measurements

Verbatim benchmark results from verification:

> Environment: repo's own vite 8.0.16 (rolldown) + monaco-editor 0.55.1, standalone A/B project symlinking repo node_modules; sizes from build output + gzip -9 via node zlib; parse via node 22 vm.SourceTextModule (3 warmup + 15 iters, median).
>
> Real app dist (pre-existing build, /home/user/2code/dist/assets): editor.api2-F5DVBnku.js 3,626.9kB (926.8kB gz claimed, 916kB gz re-measured level 9); ts.worker 6,733kB/1,442kB gz; css.worker 1,030kB/233kB; html.worker 703kB/184kB; json.worker 400kB/118kB; editor.worker 273kB/84kB. Total dist JS 26.30MB (424 files); monaco share ~12.7MB = 48%.
>
> A/B builds (baseline = exact replica of src/shared/lib/monaco.ts; slim = editor.api + coreCommands + codeEditorWidget + 18 feature contribs + 29 basic-languages + editor.worker only):
> - FULL: main chunk 3,643.3kB raw / 916.1kB gz; workers ts 6,733.4/1,442.5 + css 1,029.9/233.0 + html 702.7/184.4 + json 399.6/118.4 + editor 273.4/83.7; TOTAL JS 12.91MB raw / 3.06MB gz. Build 3.78s.
> - SLIM: main chunk 3,550.0kB raw / 891.3kB gz (-2.6% raw, -2.7% gz vs full); editor.worker only 273.4kB; TOTAL JS 3.86MB raw / 1.00MB gz (-70% raw, -67% gz).
> - SLIM+JSON service (keeps JSON highlighting): main 3,551.3kB + jsonMode 41.3kB + json.worker 399.6kB; TOTAL 4.29MB raw / 1.12MB gz (+0.43MB over slim).
>
> V8 ESM parse/compile (median of 15, node 22, this container): real editor.api2 chunk 3,542kB → 101.6ms (min 99.3, max 108.0); bench full main 3,643kB → 107.6ms; bench slim main 3,550kB → 103.5ms (i.e. first-open parse UNCHANGED by slim entry, ~4% delta); ts.worker 6,733kB → 128.0ms (worker thread, only when TS/JS file opened); editor.worker 273kB → 8.1ms.
>
> Grep proof slim entry fails to tree-shake (feature-name occurrences in slim main chunk despite not importing them): stickyScroll 11, minimap 19, marked 3, parameterHints 3, rename 9 — monaco 0.55 editor.api→standaloneEditor.js imports StandaloneEditor/StandaloneDiffEditor2/MultiDiffEditorWidget/StandaloneServices transitively.

Additional facts driving the design (all verified against `node_modules/monaco-editor@0.55.1`):

- `esm/vs/editor/editor.main.js` = the four language-service contributions (css/html/json/typescript) + all basic-languages contributions + monaco-lsp-client (`external/monaco-lsp-client/out/index.js`, exported as `lsp`) + `editor.all.js`-equivalent contrib imports + 8 standalone-only extras (quick-access palette, inspectTokens, iPadShowKeyboard, referenceSearch, toggleHighContrast) + re-export of the API from `editor.api2.js`.
- `esm/vs/editor/editor.all.js` = core commands + codeEditorWidget + diffEditor contribution + all `contrib/*` features + `standaloneStrings` + codicon CSS. It does **not** include the standalone quick-access extras.
- JSON syntax highlighting is **service-based, not Monarch** — there is no `basic-languages/json`. Dropping the JSON service renders `.json` files as plaintext. Keeping `vs/language/json/monaco.contribution` + `json.worker` costs only +0.43MB raw / +0.12MB gz (measured) — keep it.
- `vs/language/json/monaco.contribution.js` self-registers the `json` language and lazily imports `jsonMode.js` on first JSON file (separate lazy chunk).
- Basic-languages contributions are tiny registration stubs; each Monarch grammar is already a separate lazy chunk (~0.13MB total across all). They are not worth pruning.
- `monaco.languages.typescript` is populated by the typescript service contribution. Once that contribution is no longer imported, `monaco.languages.typescript` is `undefined` at runtime, so `FileViewerPane.tsx:292` would **throw in `beforeMount`** without a guard.
- The monaco `exports` map has `"./*": "./*"`, so deep ESM imports are allowed (the worker imports already rely on this).
- `esm/vs/editor/editor.api.d.ts` contains **no** `languages.typescript/json/css/html` namespaces, so the slim namespace will not be assignable to `@monaco-editor/react`'s `Monaco` type without a cast.

## Proposed Change

Two files change: `src/shared/lib/monaco.ts` (rewritten) and `src/features/projects/FileViewerPane.tsx` (guard one callback). Nothing else imports `monaco-editor` or `@/shared/lib/monaco` (verified by grep; `FileViewerPane.test.tsx:19` mocks the module entirely).

### Step 1 — Rewrite `src/shared/lib/monaco.ts` as a custom slim entry

Replace the whole file. The new file mirrors `node_modules/monaco-editor/esm/vs/editor/editor.main.js` but **omits** the css, html, and typescript service contributions and the `lsp` (monaco-lsp-client) import, and **keeps** the JSON service. Register only `editor.worker` and `json.worker`.

Do **not** keep any `import ... from "monaco-editor"` (root) anywhere — if the root entry stays, the ts/css/html modes still activate on those file types and would request workers that now fall back to `editor.worker`, causing proxy call failures.

```ts
import { loader } from "@monaco-editor/react";
import type { Monaco } from "@monaco-editor/react";

// ---------------------------------------------------------------------------
// Slim Monaco entry. Mirrors monaco-editor/esm/vs/editor/editor.main.js but
// omits the css/html/typescript language SERVICES (workers: 6.7MB ts + 1.0MB
// css + 0.7MB html) and the monaco-lsp-client. Syntax highlighting for those
// languages is Monarch-based (basic-languages below) and unaffected. The JSON
// service IS kept: JSON highlighting is service-based (no basic-language
// fallback) and costs only ~0.43MB raw. If monaco-editor is upgraded, re-diff
// this file against esm/vs/editor/editor.main.js.
// ---------------------------------------------------------------------------

// Core editor, every feature contribution (find, folding, multicursor, ...),
// standalone strings and codicon styles:
import "monaco-editor/esm/vs/editor/editor.all.js";

// Standalone-only extras that editor.main.js adds on top of editor.all.js
// (F1 command palette, Ctrl+G goto-line, etc.):
import "monaco-editor/esm/vs/editor/standalone/browser/iPadShowKeyboard/iPadShowKeyboard.js";
import "monaco-editor/esm/vs/editor/standalone/browser/inspectTokens/inspectTokens.js";
import "monaco-editor/esm/vs/editor/standalone/browser/quickAccess/standaloneHelpQuickAccess.js";
import "monaco-editor/esm/vs/editor/standalone/browser/quickAccess/standaloneGotoLineQuickAccess.js";
import "monaco-editor/esm/vs/editor/standalone/browser/quickAccess/standaloneGotoSymbolQuickAccess.js";
import "monaco-editor/esm/vs/editor/standalone/browser/quickAccess/standaloneCommandsQuickAccess.js";
import "monaco-editor/esm/vs/editor/standalone/browser/referenceSearch/standaloneReferenceSearch.js";
import "monaco-editor/esm/vs/editor/standalone/browser/toggleHighContrast/toggleHighContrast.js";

// JSON language service (kept — see header comment). Self-registers the
// "json" language and lazy-loads jsonMode.js on first use:
import "monaco-editor/esm/vs/language/json/monaco.contribution.js";

// Basic-languages (Monarch grammars, each a tiny lazy chunk). Copy this block
// VERBATIM from node_modules/monaco-editor/esm/vs/editor/editor.main.js
// (~86 imports, from abap to yaml), rewriting the relative '../basic-languages/'
// prefix to 'monaco-editor/esm/vs/basic-languages/'. Keeping the full list
// preserves current highlighting behavior exactly and costs ~0.13MB total.
import "monaco-editor/esm/vs/basic-languages/abap/abap.contribution.js";
// ... (all entries from editor.main.js) ...
import "monaco-editor/esm/vs/basic-languages/yaml/yaml.contribution.js";

// The public API namespace (editor, languages, KeyMod, Uri, ...):
import * as monaco from "monaco-editor/esm/vs/editor/editor.api.js";

// Workers: only the generic editor worker (word-based suggestions, unicode
// highlighting, diff, ...) and the JSON worker remain.
import EditorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import JsonWorker from "monaco-editor/esm/vs/language/json/json.worker?worker";

interface MonacoEnvironment {
	getWorker: (_workerId: string, label: string) => Worker;
}

const monacoGlobal = globalThis as typeof globalThis & {
	MonacoEnvironment?: MonacoEnvironment;
};

monacoGlobal.MonacoEnvironment = {
	getWorker(_workerId, label) {
		if (label === "json") return new JsonWorker();
		return new EditorWorker();
	},
};

// editor.api.d.ts lacks the languages.{typescript,json,css,html} namespaces
// that the full editor.main.d.ts declares, hence the cast. At runtime the
// namespace has everything FileViewerPane uses (editor, KeyMod, KeyCode,
// languages); languages.typescript is intentionally absent — see the guard in
// FileViewerPane.handleEditorBeforeMount.
loader.config({ monaco: monaco as unknown as Monaco });
```

Notes for the implementer:

- Generate the basic-languages block mechanically, e.g.:
  `grep "basic-languages" node_modules/monaco-editor/esm/vs/editor/editor.main.js | sed "s|'\.\./|\"monaco-editor/esm/vs/|; s|\.js';|.js\";|; s|^import '|import \"|"` — then paste. Do not hand-prune the list.
- If `@monaco-editor/react` does not export a `Monaco` type in the installed version (4.7.x does), fall back to `loader.config({ monaco: monaco as unknown as Parameters<typeof loader.config>[0]["monaco"] })`.
- The `?worker` suffix imports and the deep `esm/vs/...` specifiers are already proven to work in this Vite setup (the current file uses both).

### Step 2 — Guard `FileViewerPane.handleEditorBeforeMount`

`src/features/projects/FileViewerPane.tsx:287-298` currently reads `monaco.languages.typescript.typescriptDefaults` unconditionally. With the ts service dropped, `monaco.languages.typescript` is `undefined` at runtime (the static type still claims it exists, so tsc will not catch this). Replace the callback body:

```ts
const handleEditorBeforeMount = useCallback<BeforeMount>((monaco) => {
	// The TypeScript/JavaScript language service is intentionally not bundled
	// (see src/shared/lib/monaco.ts) — languages.typescript is undefined at
	// runtime even though the type says otherwise. Keep the diagnostics
	// opt-out guarded so this survives if the service is ever re-added.
	const ts = monaco.languages.typescript as
		| typeof monaco.languages.typescript
		| undefined;
	if (!ts) return;
	const diagnosticsOptions = {
		noSemanticValidation: true,
		noSyntaxValidation: true,
	};
	ts.typescriptDefaults.setDiagnosticsOptions(diagnosticsOptions);
	ts.javascriptDefaults.setDiagnosticsOptions(diagnosticsOptions);
}, []);
```

No other FileViewerPane code touches service namespaces (`monaco.KeyMod`/`monaco.KeyCode` at lines 379-382 are in `editor.api`).

### Step 3 — State the behavior change in the PR description

This is a deliberate trade, not a silent refactor:

- TS/JS files lose worker-based completions and hover (`ts.worker` currently serves those — the finding's claim that "workers do nothing useful" was wrong; only diagnostics are disabled). Word-based suggestions via `editor.worker` remain (`suggestController` is still bundled).
- CSS/SCSS/LESS and HTML lose validation and completions. Syntax highlighting is unchanged (Monarch, from basic-languages).
- JSON behavior is fully unchanged (service kept).

## Verification

All commands run from `/home/user/2code`. **Never** run `bun tauri build`/`bun tauri dev` or plain `cargo build`/`cargo test` in a CI container (the full Tauri build fails there for lack of GTK libs; this change touches no Rust anyway).

1. **Typecheck** (paraglide messages are already compiled — do not re-run `paraglide:compile` and do not touch `project.inlang/` or `src/paraglide/`):
   ```
   bunx tsc -p tsconfig.json --noEmit
   ```
2. **Existing tests covering the area** (both must stay green; `FileViewerPane.test.tsx:19` mocks `@/shared/lib/monaco` as `{}` and `:65` mocks `@monaco-editor/react`, so they exercise the pane logic, not monaco itself):
   ```
   bunx vitest run src/features/projects/FileViewerPane.test.tsx src/shared/lib/languageDetection.test.ts
   bunx vitest run   # full suite, 671 tests at time of writing
   ```
3. **New test** — extend `src/features/projects/FileViewerPane.test.tsx`: in the `@monaco-editor/react` mock's `Editor` component, invoke the `beforeMount` prop with a stub monaco object whose `languages` has **no** `typescript` key (`{ languages: {} }`), and assert rendering a non-markdown text file (e.g. `main.ts`) does not throw and still shows the editor. This pins the Step 2 guard: it fails against the current unguarded code (`TypeError: Cannot read properties of undefined (reading 'typescriptDefaults')`) and passes after.
4. **Bundle proof** — build the frontend only and inspect assets:
   ```
   bunx vite build
   ls -la dist/assets/ | grep -Ei "worker|editor|jsonMode"
   du -sh dist/assets
   ```
   Expected after the change:
   - `ts.worker-*`, `css.worker-*`, `html.worker-*` are **gone** from `dist/assets`.
   - `editor.worker-*` (~273 kB) and `json.worker-*` (~400 kB) remain; a `jsonMode-*` lazy chunk (~41 kB) appears.
   - Total worker assets drop ~9.14MB → ~0.67MB; total `dist/assets` drops by roughly 8.4MB (28M → ~20M).
   - The main Monaco chunk stays ~3.5-3.6MB — **this is expected** (see Evidence: the slim entry cannot shrink it on monaco 0.55), not a regression. Do not chase it.
5. **Manual smoke test** (only in a real dev environment with a display, not CI): `bun tauri dev`, open a project, open `.ts`, `.tsx`, `.js`, `.json`, `.css`, `.html`, `.rs`, `.py` files in the file viewer. Verify: syntax highlighting renders for all; no red squiggles in TS/JS (matches current behavior); no console errors mentioning `getWorker`, worker proxy, or `typescriptDefaults`; Ctrl/Cmd+S save still works (editor `addCommand` path); Ctrl+F find and F1 command palette work (proves the standalone extras were kept).

## Risks & Constraints

- **Do not implement the original suggested fix's slim-entry half.** Importing `editor.api` + selected contribs was measured at -2.6% on the main chunk (monaco 0.55 pulls the whole standalone editor transitively) and basic-languages are already lazy chunks. Any effort there is dead weight; the plan above intentionally keeps the full contrib set via `editor.all.js`.
- **Do not drop only the `?worker` imports while keeping `import * as monaco from "monaco-editor"`.** The root entry activates the ts/css/html modes, which would then call `getWorker` and get the wrong (editor) worker → runtime proxy failures on those file types. Service removal and worker removal must land together, as specified.
- **Runtime crash risk without Step 2:** `monaco.languages.typescript` is `undefined` after this change and tsc will not flag the access (the `Monaco` type still declares it). The guard in FileViewerPane is mandatory, and the new test in Verification pins it.
- **Monaco upgrade fragility:** the new `monaco.ts` mirrors internal file paths of monaco-editor 0.55.1 (`editor.all.js`, `standalone/browser/*`, `basic-languages/*`). On any monaco-editor version bump, re-diff the file against the new `esm/vs/editor/editor.main.js` (the header comment in the sketch says so). Deep imports are sanctioned by the package's `"./*": "./*"` exports entry.
- **Deliberate feature regressions** (must be stated in the PR, see Step 3): TS/JS worker completions/hover disappear; CSS/HTML validation/completions disappear. If users complain, the ts service can be restored later by re-adding two imports (`vs/language/typescript/monaco.contribution` + `ts.worker`) at a known +7MB raw cost.
- **CLAUDE.md / repo invariants:** `src/generated/` and `src/paraglide/` are generated — untouched by this change. `project.inlang/settings.json` must not be modified (note: it has a pre-existing unrelated local modification in some checkouts — leave it alone). No Rust, DB, PTY, or terminal-rendering code is involved; the "terminals use CSS display" and single-connection-DB invariants are unaffected. Keep using `@/` path aliases. UI primitives are not involved.
- **Test-mock coupling:** `FileViewerPane.test.tsx` mocks `@/shared/lib/monaco` as an empty module, so the rewrite cannot break existing tests — but that also means only the new test in Verification step 3 and the manual smoke test actually exercise the new wiring. The `bunx vite build` asset check is therefore a required part of review, not optional.
- **Chunk-name churn:** the main Monaco chunk is currently named `editor.api2-*.js` after Rollup's entry heuristics; the name may change after the rewrite. Anything hard-coding that filename would break — grep shows nothing does.
