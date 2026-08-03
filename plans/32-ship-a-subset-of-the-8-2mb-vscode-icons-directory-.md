# Ship a subset of the 8.2MB vscode-icons directory instead of the full icon set

> Cut the shipped `file-icons/` payload from 8.2M du / 4.06MB raw / 1.48MB gzipped to 4.6M / 2.56MB / 0.93MB by copying only the 805 icon filenames that `vscode-icons-js` can ever resolve, and fix three mapped-but-missing icons that 404 today. | Severity: low | Category: performance

## Problem

The Vite plugin `localFileIconsPlugin` (`scripts/vite-plugin-local-file-icons.ts`) populates `public/file-icons/` on first build by sparse-cloning the **entire** `icons/` directory of the `vscode-icons/vscode-icons` GitHub repo at HEAD:

- `scripts/vite-plugin-local-file-icons.ts:15-16` — repo URL and sparse path `icons` (the whole directory).
- `scripts/vite-plugin-local-file-icons.ts:71-85` — `git clone --depth=1 --filter=blob:none --sparse` + `sparse-checkout set icons`.
- `scripts/vite-plugin-local-file-icons.ts:88-90` — unfiltered recursive `cp` of the whole `icons/` tree into `config.publicDir/file-icons`.
- `scripts/vite-plugin-local-file-icons.ts:55-57` — the whole step is skipped whenever `public/file-icons/` is non-empty, so existing dev machines / CI caches keep the full copy forever unless invalidated.

Because it lives in `public/`, Vite copies all of it verbatim into `dist/`, and from there into the Tauri installer. That is currently **1564 SVGs, 8.2M `du`, 4.06MB raw bytes, 1.48MB gzipped**.

At runtime, icons are resolved *by filename* through `vscode-icons-js` and fetched individually as `<img>` URLs:

- `src/shared/lib/fileIcons.ts:9-11` — `getFileIconUrl` calls `getIconForFile(name)` and falls back to `default_file.svg` only when the lookup returns `undefined` (i.e. it never falls back on a 404 of a *mapped* name).
- `src/shared/lib/fileIcons.ts:13-16` — `getFolderIconUrl` calls `getIconForFolder` / `getIconForOpenFolder`. Note `getIconForOpenFolder` (in `vscode-icons-js/dist/Index.js`) synthesizes the opened variant as `<closed-icon stem> + "_opened.svg"` — folder icons and their `_opened` twins ARE runtime-reachable and must be kept.

`vscode-icons-js@11.6.1` resolves names exclusively from five static mapping tables (`node_modules/vscode-icons-js/dist/generated/{FileExtensions1ToIcon,FileExtensions2ToIcon,FileNamesToIcon,FolderNamesToIcon,LanguagesToIcon}.js`) plus five `DEFAULT_*` constants. The union of every value in those tables, the 5 defaults, and the synthesized `_opened.svg` folder variants is exactly **805 filenames**. Everything else in the cloned directory — **762 of the 1564 shipped files (49%)** — is provably unreachable dead weight (icon variants, retired icons, etc. that no lookup can ever return).

**Bonus correctness bug (fix alongside):** the plugin clones vscode-icons **HEAD**, but `vscode-icons-js@11.6.1` pins an *older* icon inventory. Three mapped filenames are absent from the current clone, so these lookups already render broken `<img>` 404s today:

- `getIconForFile("makefile")` → `file_type_makefile.svg` (missing)
- `getIconForFile("photo.webp")` → `file_type_webp.svg` (missing)
- `getIconForFile("now.json")` → `file_type_light_zeit.svg` (missing)

There is **zero runtime performance impact** either way (icons are fetched on demand); this is purely installed-disk and installer weight, hence severity low.

## Evidence & Measurements

Verified benchmark results (verbatim):

> Environment: linux container, node via bun toolchain; measurement is byte-exact file accounting, not timing (finding is payload weight, no runtime path). Baseline (pre-existing `bunx vite build` output, verified identical to public/): dist/file-icons = 1564 files, raw bytes 4.06MB, `du -sh` 8.2M, `tar czf` 1.48MB (1,519,083 B). Optimized variant (standalone prototype of the suggested fix — copy only filenames reachable from vscode-icons-js mapping tables + defaults + `_opened` folder variants; 805-name set, 802 present): 802 files, raw 2.56MB, `du -sh` 4.6M, `tar czf` 0.93MB (949,997 B). Delta: -762 files, -1.50MB raw, -3.6MB du (installed disk), -0.55MB compressed (installer proxy). Reachable-but-missing icons in shipped set: file_type_makefile.svg (getIconForFile("makefile")), file_type_webp.svg ("photo.webp"), file_type_light_zeit.svg ("now.json") — live 404s. `bunx vitest run src/shared/lib/fileIcons.test.ts`: 3/3 pass.

Independently re-confirmed in this checkout before writing this plan:

- `ls public/file-icons | wc -l` → 1564; `du -sh public/file-icons` → 8.2M.
- Reachable-set computation (5 maps + 5 defaults + `_opened` variants) → **805 names, 802 present in `public/file-icons`, missing = exactly the 3 files above**.
- `vscode-icons-js` has no `exports` field in its `package.json` (`main: dist/Index.js` only), so deep imports like `vscode-icons-js/dist/generated/FileExtensions1ToIcon.js` are legal and each ships a `.d.ts` next to it. The root entry only exports `DEFAULT_*` and the three `getIconFor*` functions — the maps require deep imports.
- Note: expected post-fix size is ~4.6M du / 2.56MB raw. Do **not** chase the original finding's "~1MB" figure — that would require truncating to a "top-N types" list, silently degrading icon coverage.

## Proposed Change

All changes are confined to `scripts/vite-plugin-local-file-icons.ts`, one new test file, and a one-line `vitest.config.ts` include tweak. No Rust changes, no changes to `src/shared/lib/fileIcons.ts` (its tests mock `vscode-icons-js` and assert path shapes only).

### Step 1 — Add a reachable-set function in `scripts/vite-plugin-local-file-icons.ts`

Add imports at the top (keep existing imports; add `copyFile` and `writeFile` to the `node:fs/promises` import, `cp` becomes unused and should be removed from it):

```ts
import {
	DEFAULT_FILE,
	DEFAULT_FOLDER,
	DEFAULT_FOLDER_OPENED,
	DEFAULT_ROOT,
	DEFAULT_ROOT_OPENED,
} from "vscode-icons-js";
import { FileExtensions1ToIcon } from "vscode-icons-js/dist/generated/FileExtensions1ToIcon.js";
import { FileExtensions2ToIcon } from "vscode-icons-js/dist/generated/FileExtensions2ToIcon.js";
import { FileNamesToIcon } from "vscode-icons-js/dist/generated/FileNamesToIcon.js";
import { FolderNamesToIcon } from "vscode-icons-js/dist/generated/FolderNamesToIcon.js";
import { LanguagesToIcon } from "vscode-icons-js/dist/generated/LanguagesToIcon.js";
```

(These CJS deep imports load fine under both bun and Vite's config bundling — verified with `bun -e` in this repo. If `tsc` complains about the `.js` deep-import paths during `bun run build`, the `.d.ts` files exist at the same paths; `moduleResolution: "bundler"` in this repo resolves them.)

Add the exported pure function (exported so it can be unit-tested):

```ts
const SVG_SUFFIX_RE = /\.svg$/;

/**
 * Every icon filename vscode-icons-js can ever return:
 * the union of its five mapping tables, the five DEFAULT_* constants,
 * and the `_opened.svg` folder variants that getIconForOpenFolder
 * synthesizes by string-replacing the closed icon's stem.
 */
export function computeReachableIconFilenames(): Set<string> {
	const names = new Set<string>([
		DEFAULT_FILE,
		DEFAULT_FOLDER,
		DEFAULT_FOLDER_OPENED,
		DEFAULT_ROOT,
		DEFAULT_ROOT_OPENED,
	]);
	for (const map of [
		FileExtensions1ToIcon,
		FileExtensions2ToIcon,
		FileNamesToIcon,
		LanguagesToIcon,
	]) {
		for (const icon of Object.values(map)) {
			names.add(icon);
		}
	}
	for (const icon of Object.values(FolderNamesToIcon)) {
		names.add(icon);
		names.add(icon.replace(SVG_SUFFIX_RE, "_opened.svg"));
	}
	return names;
}
```

With `vscode-icons-js@11.6.1` this yields exactly 805 names.

### Step 2 — Replace the unfiltered `cp` with a filtered copy + 404 fallback

Replace `scripts/vite-plugin-local-file-icons.ts:87-90` (the `rm` + `cp` block) with:

```ts
const sourceDir = path.join(cloneDir, VSCODE_ICONS_SPARSE_PATH);
const reachable = computeReachableIconFilenames();
const available = new Set(await readdir(sourceDir));

await rm(targetDir, { recursive: true, force: true });
await mkdir(targetDir, { recursive: true });

const aliased: string[] = [];
for (const name of reachable) {
	if (available.has(name)) {
		await copyFile(path.join(sourceDir, name), path.join(targetDir, name));
		continue;
	}
	// vscode-icons HEAD has dropped/renamed an icon that vscode-icons-js
	// still maps to. Without this, the frontend renders a broken <img>:
	// getFileIconUrl only falls back when the lookup returns undefined,
	// never on a 404 (src/shared/lib/fileIcons.ts:10). Alias the missing
	// name to the appropriate default icon instead.
	aliased.push(name);
	const fallback = name.startsWith("folder_type_")
		? name.endsWith("_opened.svg")
			? DEFAULT_FOLDER_OPENED
			: DEFAULT_FOLDER
		: DEFAULT_FILE;
	await copyFile(path.join(sourceDir, fallback), path.join(targetDir, name));
	config.logger.warn(
		`[file-icons] ${name} is mapped by vscode-icons-js but missing from the vscode-icons clone; aliased to ${fallback}`,
	);
}

await writeFile(
	path.join(targetDir, SUBSET_MARKER_FILENAME),
	JSON.stringify({ version: SUBSET_VERSION, files: reachable.size, aliased }, null, "\t"),
);
```

With today's inventories this copies 802 real icons and writes 3 aliases (`file_type_makefile.svg`, `file_type_webp.svg`, `file_type_light_zeit.svg` → copies of `default_file.svg`), fixing the live 404s.

### Step 3 — Invalidate stale full-copy caches automatically

The plugin currently skips regeneration whenever the directory is non-empty (`scripts/vite-plugin-local-file-icons.ts:55-57`), so every existing dev machine and CI cache would keep the 1564-file copy forever. Add a marker-file check so the old cache regenerates itself once:

```ts
const SUBSET_MARKER_FILENAME = ".file-icons-manifest.json";
const SUBSET_VERSION = 1; // bump to force regeneration on future logic changes
```

Change the early-return in `ensureLocalFileIcons` (line 55) from:

```ts
if (await directoryHasFiles(targetDir)) {
	return;
}
```

to:

```ts
if (
	(await directoryHasFiles(targetDir)) &&
	(await isCurrentSubset(targetDir))
) {
	return;
}
```

with:

```ts
async function isCurrentSubset(dirPath: string) {
	try {
		const raw = await readFile(path.join(dirPath, SUBSET_MARKER_FILENAME), "utf8");
		return (JSON.parse(raw) as { version?: number }).version === SUBSET_VERSION;
	} catch {
		return false;
	}
}
```

(add `readFile` to the `node:fs/promises` import). The marker lands in `dist/` too (Vite copies `public/` dotfiles); it is ~1KB and harmless. Update the "missing, cloning" log message wording if desired; not required.

Also mention in the PR description that anyone can force a refresh manually with `rm -rf public/file-icons` — but the marker makes that unnecessary.

### Step 4 — New unit test for the reachable-set function

Vitest currently only includes `src/**/*.test.{ts,tsx}` (`vitest.config.ts:18`). Extend it:

```ts
include: ["src/**/*.test.{ts,tsx}", "scripts/**/*.test.ts"],
```

Create `scripts/vite-plugin-local-file-icons.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { computeReachableIconFilenames } from "./vite-plugin-local-file-icons";

describe("computeReachableIconFilenames", () => {
	it("includes the five default icons", () => {
		const names = computeReachableIconFilenames();
		for (const name of [
			"default_file.svg",
			"default_folder.svg",
			"default_folder_opened.svg",
			"default_root_folder.svg",
			"default_root_folder_opened.svg",
		]) {
			expect(names.has(name)).toBe(true);
		}
	});

	it("includes synthesized _opened variants for every mapped folder icon", () => {
		const names = computeReachableIconFilenames();
		expect(names.has("folder_type_src.svg")).toBe(true);
		expect(names.has("folder_type_src_opened.svg")).toBe(true);
		expect(names.has("folder_type_test.svg")).toBe(true);
		expect(names.has("folder_type_test_opened.svg")).toBe(true);
	});

	it("includes file icons resolved via extension tables", () => {
		const names = computeReachableIconFilenames();
		// These three are mapped by vscode-icons-js but absent from the
		// vscode-icons clone at HEAD — the plugin must alias them, so they
		// must be in the reachable set.
		expect(names.has("file_type_makefile.svg")).toBe(true);
		expect(names.has("file_type_webp.svg")).toBe(true);
		expect(names.has("file_type_light_zeit.svg")).toBe(true);
	});

	it("covers the full vscode-icons-js mapping inventory", () => {
		// 805 with vscode-icons-js@11.6.1; use a floor so a minor package
		// bump doesn't break the test.
		expect(computeReachableIconFilenames().size).toBeGreaterThanOrEqual(800);
	});
});
```

Note: importing the plugin module pulls in `vite` types only at type level and node builtins at value level — safe under vitest's jsdom environment (the node builtins are available; the plugin's side-effect-free top level does no I/O).

### Explicitly NOT doing (and why)

- **Do not drop folder icons** — the original finding suggested it, but `getFolderIconUrl` (`src/shared/lib/fileIcons.ts:13-16`) actively requests `folder_type_*.svg` and their `_opened` variants; ~400 folder icons are in the reachable set.
- **Do not truncate to "top ~150 types" / chase ~1MB** — 4.6M du is the correct floor for a lossless subset.
- **Do not pin the clone to an old vscode-icons tag** as the primary fix for the 3 missing icons — the exact tag matching `vscode-icons-js@11.6.1`'s inventory would need online verification, and the alias fallback in Step 2 is deterministic, self-healing for future drift, and warns loudly. Pinning can be a follow-up if pixel-perfect makefile/webp/zeit icons are wanted.
- **Do not convert to a sprite sheet** — larger change, and `src/shared/lib/fileTreeIcons.ts` already covers the sprite-based use case via `@pierre/trees`; `fileIcons.ts` is a separate URL-based seam.
- Side observation for a possible separate cleanup (out of scope here): `getFileIconUrl`/`getFolderIconUrl` currently have no production callers — only `fileIcons.test.ts` imports them (the file tree uses `fileTreeIcons.ts`/`@pierre/trees` instead). Removing `fileIcons.ts` + `public/file-icons` entirely would save the full 8.2MB, but that is a dead-code decision for the maintainer, not this performance fix. This plan keeps the module working as designed.

## Verification

All commands run from `/home/user/2code` unless noted. **Never run plain `cargo build`/`cargo test` or `bun tauri ...` in CI containers** (full Tauri build needs GTK libs that are absent); nothing in this change touches Rust anyway.

1. **Unit tests (new + existing):**
   ```bash
   bunx vitest run scripts/vite-plugin-local-file-icons.test.ts src/shared/lib/fileIcons.test.ts
   ```
   Expect the 4 new tests plus the existing 3 `fileIcons` tests to pass (the existing test mocks `vscode-icons-js` and is path-shape-based, so the subset cannot break it).

2. **Full frontend test suite** (guards the `vitest.config.ts` include change against collateral damage):
   ```bash
   bunx vitest run
   ```
   Expect 671 existing tests + 4 new = 675 passing.

3. **Regeneration + size check** (needs network for the git clone; the marker check must force a rebuild even though `public/file-icons` is non-empty):
   ```bash
   bunx vite build
   ls dist/file-icons | wc -l        # expect 806 (805 svgs + .file-icons-manifest.json)
   du -sh dist/file-icons            # expect ~4.6M (baseline was 8.2M)
   cat dist/file-icons/.file-icons-manifest.json
   # expect version 1, files 805, aliased = the 3 known names
   ```
   Baseline for comparison: 1564 files, 8.2M.

4. **404-fix check** — the three previously-broken names now resolve to real files:
   ```bash
   ls dist/file-icons/file_type_makefile.svg \
      dist/file-icons/file_type_webp.svg \
      dist/file-icons/file_type_light_zeit.svg
   cmp dist/file-icons/file_type_makefile.svg dist/file-icons/default_file.svg   # identical
   ```

5. **Reachability cross-check (optional but cheap)** — prove every icon `vscode-icons-js` can return exists on disk:
   ```bash
   bun -e "
   import { getIconForFile, getIconForFolder, getIconForOpenFolder } from 'vscode-icons-js';
   import { FileExtensions1ToIcon } from 'vscode-icons-js/dist/generated/FileExtensions1ToIcon.js';
   import { FileExtensions2ToIcon } from 'vscode-icons-js/dist/generated/FileExtensions2ToIcon.js';
   import { FileNamesToIcon } from 'vscode-icons-js/dist/generated/FileNamesToIcon.js';
   import { FolderNamesToIcon } from 'vscode-icons-js/dist/generated/FolderNamesToIcon.js';
   import { existsSync } from 'node:fs';
   const probes = [
     ...Object.keys(FileExtensions1ToIcon).map(e => 'x.' + e),
     ...Object.keys(FileExtensions2ToIcon).map(e => 'x.' + e),
     ...Object.keys(FileNamesToIcon),
   ].map(n => getIconForFile(n));
   for (const f of Object.keys(FolderNamesToIcon)) { probes.push(getIconForFolder(f), getIconForOpenFolder(f)); }
   const missing = [...new Set(probes)].filter(i => i && !existsSync('dist/file-icons/' + i));
   console.log(missing.length === 0 ? 'OK: every resolvable icon exists' : missing);
   "
   ```
   Expect `OK`. (Note this probe set intentionally exercises the same lookups the app performs.)

6. **Cache-invalidation check:** run `bunx vite build` twice; the second run must log nothing about cloning (marker present, skip path taken) and finish without network access to github.

Existing coverage of the area: `src/shared/lib/fileIcons.test.ts` (3 tests, URL construction with mocked resolver). There is no existing test of the Vite plugin; Step 4's test is the new coverage. No benchmark needed — the "benchmark" is the byte accounting in step 3.

## Risks & Constraints

- **CLAUDE.md invariants:** do not touch `src/generated/`, `src/paraglide/`, or `project.inlang/settings.json` (the latter has a pre-existing unrelated modification in some checkouts — leave it alone). No Rust commands change, so no `cargo tauri-typegen generate` needed. No query keys, stores, or terminal code involved.
- **Coupling to `vscode-icons-js` internals:** the deep imports (`vscode-icons-js/dist/generated/*.js`) are not part of a public `exports` map (the package has none, so they resolve fine today), but a major-version restructuring of the package could move them. Mitigation: the unit test in Step 4 fails loudly at `vitest run` time, and the plugin fails at `vite build` config time — both are impossible to miss. Also keep the `_opened.svg` synthesis rule in sync with `getIconForOpenFolder` (it string-replaces the closed icon's stem; the unit test pins this behavior).
- **Version drift between the two icon sources:** the plugin clones vscode-icons HEAD while `vscode-icons-js` pins an older inventory. Today 3 names are missing; future HEAD changes could drop more. The alias-fallback + build-time warning degrades gracefully (default icon instead of broken image) — strictly better than today's silent 404s. If the warning list grows, pin the clone to a matching vscode-icons release tag as a follow-up.
- **Stale caches:** without Step 3's marker, dev machines and CI caches silently keep shipping 8.2M. The marker forces exactly one re-clone per machine (network required at that moment). If a build environment is offline on that first run, the build fails in `configResolved` — same failure mode the plugin already has on a fresh checkout, so no new constraint.
- **`getFileIconUrl` fallback semantics unchanged:** the frontend still only falls back to `default_file.svg` when `getIconForFile` returns `undefined` (`src/shared/lib/fileIcons.ts:10`). The subset must therefore contain *every* mapped name — which is exactly what `computeReachableIconFilenames` + the alias step guarantee. Never "optimize" by filtering the reachable set further.
- **Marker file ships in dist:** `.file-icons-manifest.json` (~1KB) is copied into `dist/file-icons/` by Vite's public-dir copy. Harmless; if the team objects, move the marker to `node_modules/.cache/2code-file-icons/` instead and adjust `isCurrentSubset` — but keeping it beside the icons is simpler and self-documenting.
- **Vitest include widening** (`scripts/**/*.test.ts`) runs the new test under the jsdom environment with `src/test/setup.ts`; the function under test is pure and the plugin module has no top-level side effects, so this is safe — verified reasoning, but if setup file mocks ever conflict, scope the include to the single file instead.
- **Expected numbers are version-pinned:** 805/802/4.6M hold for `vscode-icons-js@11.6.1` + vscode-icons HEAD as of 2026-07-07. A dependency bump shifts them slightly; the verification steps compare against the 8.2M baseline direction, not exact bytes, except where noted.
