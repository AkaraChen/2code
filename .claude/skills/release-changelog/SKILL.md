---
name: release-changelog
description: "Create a GitHub release with auto-generated changelog for the 2code Tauri desktop app. Use when the user wants to create a new release, publish a version, generate a changelog, build and ship a DMG, or run the release pipeline. Handles the full pipeline: reads version from src-tauri/tauri.conf.json, builds DMG via bun tauri build, generates changelog from conventional commits since the last release, creates a GitHub draft release, uploads the DMG artifact, and publishes."
---

# Release & Changelog

Full pipeline for releasing the 2code Tauri app: build DMG → draft release with changelog → upload artifact → publish.

## Steps

### 1. Gather context

```bash
# Version to release
cat src-tauri/tauri.conf.json | grep -A1 '"version"'

# Previous release tag
gh release list --limit 1 --json tagName -q '.[0].tagName'

# Commits since last release (for changelog)
git log $(gh release list --limit 1 --json tagName -q '.[0].tagName')..HEAD --oneline
```

### 2. Build DMG (run in background — takes ~5 min)

```bash
bun tauri build
```

Use `run_in_background: true`. Proceed to step 3 while building.

Output path: `src-tauri/target/release/bundle/dmg/two-code_<version>_aarch64.dmg`

### 3. Create draft release with changelog

Group commits by conventional prefix:

- `feat:` / `feat(scope):` → **Features**
- `fix:` / `fix(scope):` → **Bug Fixes**
- `chore:` / `build:` / `refactor:` → omit unless significant
- Unprefixed commits → use judgment

```bash
gh release create v<version> \
  --title "v<version>" \
  --notes "## What's Changed

### Features
- <feat commits, one per line>

### Bug Fixes
- <fix commits, one per line>

**Full Changelog**: https://github.com/AkaraChen/2code/compare/<prev-tag>...v<version>" \
  --draft
```

Always create as **draft** — publish only after DMG is uploaded.

### 4. Upload DMG (after build completes)

```bash
gh release upload v<version> \
  "src-tauri/target/release/bundle/dmg/two-code_<version>_aarch64.dmg" \
  --clobber
```

### 5. Publish

```bash
gh release edit v<version> --draft=false
```

Report the release URL to the user.

## Notes

- Repo: `AkaraChen/2code`
- If no `feat`/`fix` commits exist, use "Minor improvements and fixes"
- Omit empty sections (e.g. no Features section if no feat commits)
