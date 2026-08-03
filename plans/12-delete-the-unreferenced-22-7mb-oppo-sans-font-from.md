# Delete the unreferenced 22.7MB OPPO-Sans font from public/fonts

> Removing one dead, never-referenced TTF cuts the shipped frontend payload by 22,741,096 bytes (55.3MB → 32.5MB, −41.1%) and each compressed updater artifact by ~15.6 MiB, with zero functional change. | Severity: high | Category: performance

## Problem

`public/fonts/OPPO-Sans-4.0.ttf` (22,741,096 bytes) is tracked in git and, because everything in `public/` is copied verbatim into `dist/` by Vite, it ships inside every production build, DMG/installer, and auto-update artifact (`"createUpdaterArtifacts": true` at `src-tauri/tauri.conf.json:36`; the bundle uses `"frontendDist": "../dist"` at `src-tauri/tauri.conf.json:32`).

The font is referenced **nowhere**:

- No `@font-face`, no `font-family` mention, no `/fonts/` URL anywhere in `src/`, `index.html`, `vite.config.ts`, `tauri.conf.json`, or the Rust backend (`src-tauri/`). Repo-wide greps for `OPPO`, `/fonts/`, `font-face`, and `.ttf` (excluding node_modules) hit nothing relevant.
- The app's UI fonts come exclusively from `@fontsource` packages: `src/app.css:4-5` imports `@fontsource-variable/inter` and `@fontsource-variable/geist`, and `src/app.css:612-613` defines the only custom font variables:
  ```css
  --font-sans: 'Inter Variable', sans-serif;
  --font-heading: 'Geist Variable', sans-serif;
  ```
  These resolve to 12 woff2 files, ~308KB total in `dist/` — the entirety of the fonts the app actually uses.
- Terminal fonts are supplied by the OS (macOS `core-text`, Linux/Windows `fontdb` — see CLAUDE.md "Gotchas"), not by bundled web fonts.
- The built JS bundles contain zero `fonts/` or `OPPO` strings, which rules out any dynamically-constructed URL to the file.

The dead TTF is 41.1% of the shipped frontend payload. Every user pays 22.7MB of disk per install and ~15.6 MiB of extra download per auto-update, for nothing.

## Evidence & Measurements

Verified against the real repo and real production builds (verbatim from the verification pass):

> A/B production builds, vite 8.0.16, real vite.config.ts (variant differed only in publicDir pointing at a copy of public/ minus fonts/, simulating git rm). Baseline (font included): dist = 55,289,952 bytes (52.7 MiB), dist/fonts = 22,741,096 bytes, 2007 files, 0 sourcemaps, built in 19.80s (23.4s wall). No-font: dist = 32,548,856 bytes (31.0 MiB), 2006 files, built in 16.39s (17.4s wall; single runs, timing noisy — not the claim). Delta = exactly 22,741,096 bytes = 41.1% of shipped frontend payload. cmp: dist/fonts/OPPO-Sans-4.0.ttf byte-identical to public/ source (verbatim copy). gzip -9 of the TTF = 16,309,367 bytes (~15.6 MiB) = approximate added weight in each compressed updater artifact (createUpdaterArtifacts: true in tauri.conf.json). Fonts actually used: 12 woff2 files, 308KB total (@fontsource-variable inter+geist). Reference greps: 0 hits for OPPO//fonts//font-face/.ttf in src/, index.html, vite.config.ts, tauri.conf.json, src-tauri/, and 0 hits for 'OPPO'/'fonts/' in built dist JS bundles.

Additional confirmed facts:

- `git ls-files public/fonts` → only `public/fonts/OPPO-Sans-4.0.ttf` (the directory contains nothing else, so it disappears from `dist/` entirely after removal).
- `stat -c %s public/fonts/OPPO-Sans-4.0.ttf` → `22741096`.
- Only one other `public/` asset tree exists and it IS used: `public/file-icons` (8.2MB, 1564 files) is consumed via `localFileIconsPlugin` imported at `vite.config.ts:8` and registered at `vite.config.ts:15`. Do not touch it.

**Measured impact:** Removing the dead font cuts the shipped frontend payload by exactly 22,741,096 bytes (55.3MB → 32.5MB, −41.1%) and each compressed updater artifact by ~15.6 MiB (gzip -9), for zero functional change.

## Proposed Change

This is a one-file deletion. No code edits, no config edits, no test edits.

1. **Delete the font from the repo:**
   ```bash
   cd /home/user/2code
   git rm public/fonts/OPPO-Sans-4.0.ttf
   ```
   `git rm` removes the file from both the working tree and the index. Since it is the only file in `public/fonts/`, git drops the now-empty directory automatically; if an empty `public/fonts/` directory lingers on disk (git doesn't track directories), remove it: `rmdir public/fonts 2>/dev/null || true`.

2. **Do NOT:**
   - Touch `public/file-icons/` — referenced by `localFileIconsPlugin` (`vite.config.ts:8,15`).
   - Edit `src/app.css`, `index.html`, `vite.config.ts`, or `src-tauri/tauri.conf.json` — nothing references the font, so nothing needs updating.
   - Rewrite git history. The 22.7MB blob remains in history after `git rm`, so clone size is unchanged; the win is in `dist/`, the DMG/installer, and updater artifacts. History rewriting (filter-repo/BFG) is a separate, disruptive decision — out of scope.
   - Commit or revert `project.inlang/settings.json` if it shows as modified — in some CI/container checkouts that is a pre-existing environment patch (local paraglide plugin path for offline builds) unrelated to this change.

3. **Commit** with a message like:
   ```
   perf(build): remove unreferenced 22.7MB OPPO-Sans font from public/fonts

   The TTF was never referenced by any @font-face, CSS, HTML, or JS —
   UI fonts are Inter Variable + Geist Variable via @fontsource, and
   terminal fonts come from the OS. Cuts dist/ by 22.7MB (-41.1%) and
   each compressed updater artifact by ~15.6 MiB.
   ```

**Optional follow-up (separate change, only if a CJK UI font is actually wanted):** the zh locale currently renders via system font fallback anyway, since no `@font-face` for OPPO Sans ever existed. If a bundled CJK fallback is desired later, subset a variable OPPO Sans to the zh glyphs actually used (~1–2MB woff2), add a real `@font-face` in `src/app.css`, and append it to `--font-sans` (`src/app.css:612`). That is explicitly NOT part of this change.

## Verification

Reminder: the full Tauri app cannot be built in CI containers (missing GTK libs) — never run plain `cargo build`/`cargo test` without `-p` flags, and never `bun tauri ...`. All verification below is frontend/build-level and works in the container.

1. **Confirm the file is gone and nothing else changed:**
   ```bash
   cd /home/user/2code
   git status --porcelain          # expect exactly: D  public/fonts/OPPO-Sans-4.0.ttf
   git ls-files public/fonts       # expect empty output
   ```

2. **Confirm zero references (should already be true; re-run as a safety net):**
   ```bash
   grep -rn "OPPO\|/fonts/" src/ index.html vite.config.ts src-tauri/tauri.conf.json | grep -v node_modules
   # expect no output
   ```

3. **Production frontend build succeeds and dist/fonts is gone:**
   ```bash
   cd /home/user/2code
   bun run build                   # paraglide compile → tsc → vite build; must succeed
   ls dist/fonts 2>&1              # expect "No such file or directory"
   du -sb dist                     # expect ~32.5MB (was ~55.3MB); exact prior-verified value: 32,548,856 bytes, 2006 files
   ls dist/file-icons | head       # expect file-icons still present (unaffected)
   ls dist/assets/*.woff2 | wc -l  # expect 12 (Inter + Geist variable woff2s still shipped)
   ```
   If `bun run build` fails for unrelated reasons in the container, `bunx vite build` alone is sufficient to verify the dist payload (that is exactly what the A/B measurement used).

4. **Existing test suites still pass (regression guard — no test references the font, so these must be unaffected):**
   ```bash
   cd /home/user/2code && bunx vitest run                 # 671 tests pass at time of writing
   cd /home/user/2code/src-tauri && cargo test -p model -p repo -p service -p infra   # 151 tests
   ```

5. **New tests/benchmarks:** none warranted. This deletes a static asset with no runtime code path; there is no function to unit-test or benchmark. The dist-size check in step 3 is the meaningful assertion. (Optionally, a repo-hygiene CI check that fails on files >5MB in `public/` would prevent recurrence, but that is a separate improvement, not part of this fix.)

6. **Outside the container (release pipeline, informational):** the next `bun tauri build` will produce a DMG/installer and updater artifact ~22.7MB / ~15.6 MiB (compressed) smaller respectively. No action needed — just expected output of the release process.

## Risks & Constraints

- **Functional risk: effectively zero.** The font has no reference anywhere (source, HTML, config, backend, or built JS — including dynamically constructed URLs, which were explicitly ruled out by grepping the built bundles). A/B builds confirmed the only dist difference is the font file itself (2007 → 2006 files, all remaining output identical).
- **CLAUDE.md invariants respected:** no changes to `src/generated/`, `src/paraglide/`, `project.inlang/settings.json`, Diesel schema, terminal rendering, or IPC — this change touches none of them. UI fonts (`@fontsource` imports in `src/app.css:4-5`) are untouched.
- **Do not delete `public/file-icons/`** — it is actively served via `localFileIconsPlugin` (`vite.config.ts:8,15`). The deletion must be scoped to exactly `public/fonts/OPPO-Sans-4.0.ttf`.
- **CJK rendering:** unchanged. Chinese UI text already renders via the OS font fallback chain (`sans-serif` tail of `--font-sans`, `src/app.css:612`) because the TTF was never wired into any `@font-face`. Users will see no visual difference.
- **Git history still carries the blob** (~22.7MB in `.git` of every clone). Acceptable; history rewrite is intentionally out of scope due to its disruption to all collaborators.
- **Container/CI limits:** full Tauri builds fail here (missing GTK); verification must stay at `vite build` / `vitest` / `cargo test -p ...` level as specified above.
