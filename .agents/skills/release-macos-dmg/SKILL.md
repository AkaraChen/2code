---
name: release-macos-dmg
description: Release a macOS desktop app version through GitHub Releases, watch the GitHub Actions build until completion, download the macOS DMG asset, mount it, copy the app into /Applications, detach the image, launch the installed app, and verify the installed version. Use when the user asks to release a version, ship a beta, watch CI, download a DMG from GitHub Releases, install a macOS app artifact, or continue a release/install workflow.
---

# Release macOS DMG

## Overview

Run an end-to-end macOS app release/install loop: verify the intended version, create or use the release/tag, watch GitHub Actions, download the correct DMG, install it safely, and confirm the app launched.

Prefer `gh` for GitHub operations. Do not rewrite unrelated local changes. Do not use destructive git commands.

## Inputs To Determine

- Version/tag to release, for example `v2.4.1-beta5`.
- Release workflow/run ID, if already known.
- DMG asset pattern, usually `*aarch64.dmg` on Apple Silicon or `*x64.dmg` on Intel.
- Installed app bundle name, for example `2code.app`.
- Whether the user wants a new tag/release or only wants to continue watching/installing an existing release.

Ask only if a required input cannot be inferred from repo files, recent commits, tags, release assets, or conversation history.

## Release Workflow

1. Inspect state before changing anything.

```bash
git status --short
git log --oneline -10
gh repo view --json nameWithOwner --jq .nameWithOwner
```

2. Verify the app version file already matches the intended version. If changing a version is required, edit the project-specific version file minimally, run the project’s required checks, commit only intended files if the user asked to commit, then push/tag according to repo conventions.

3. Create or push the tag only when the release should be started and the user has asked for release/publish behavior.

```bash
git tag vX.Y.Z-betaN
git push origin vX.Y.Z-betaN
```

4. Identify the GitHub Actions release run.

```bash
gh run list --limit 10
gh run view <run-id> --json status,conclusion,jobs
```

5. Poll until completion. Use a long timeout and report meaningful status updates only when useful.

```bash
while true; do
  status=$(gh run view <run-id> --json status --jq '.status' 2>&1)
  if [ "$status" = "completed" ]; then
    gh run view <run-id> --json conclusion,jobs --jq '.conclusion + " | " + ([.jobs[] | .name + ": " + (.conclusion // "?")] | join(", "))'
    break
  fi
  date +%H:%M:%S
  sleep 60
done
```

6. Stop if the conclusion is not `success`. Inspect failed jobs with `gh run view <run-id> --log-failed` before trying any install step.

## Download And Install

1. Confirm the expected release asset exists.

```bash
gh release view vX.Y.Z-betaN --json tagName,name,isDraft,isPrerelease,assets --jq '{tagName,name,isDraft,isPrerelease,assets:[.assets[].name]}'
```

2. Use a fresh temp directory and download the exact DMG.

```bash
rm -rf /tmp/<app>-release-install
mkdir -p /tmp/<app>-release-install
gh release download vX.Y.Z-betaN --pattern "<asset-pattern>.dmg" --dir /tmp/<app>-release-install
```

3. Quit the running app if replacing it. Ignore failure if it is not running.

```bash
osascript -e 'tell application "<AppName>" to quit' >/dev/null 2>&1 || true
```

4. Mount the DMG, copy the app bundle to `/Applications`, detach, and launch.

```bash
mount_plist=$(mktemp /tmp/<app>-mount.XXXXXX.plist)
hdiutil attach /tmp/<app>-release-install/<asset>.dmg -nobrowse -plist > "$mount_plist"
volume=$(plutil -extract system-entities.0.mount-point raw "$mount_plist" 2>/dev/null || plutil -extract system-entities.1.mount-point raw "$mount_plist")
rm -rf "/Applications/<AppName>.app"
cp -R "$volume/<AppName>.app" /Applications/
hdiutil detach "$volume" -quiet
open "/Applications/<AppName>.app"
```

Quote every path that can contain spaces. If the mounted volume layout differs, inspect the mounted volume and adapt the copy path instead of guessing.

## Verification

Run the checks that fit the app bundle:

```bash
plutil -extract CFBundleShortVersionString raw "/Applications/<AppName>.app/Contents/Info.plist"
plutil -extract CFBundleVersion raw "/Applications/<AppName>.app/Contents/Info.plist"
pgrep -fl "<process-name>"
```

Report the release run conclusion, downloaded asset name, installed version, and whether the app process is running.

## Safety Rules

- Never install if CI failed or release assets are missing.
- Never install an architecture-mismatched DMG unless the user explicitly asks.
- Never delete unrelated files in `/tmp` or `/Applications`.
- Never force-push, reset, or revert unrelated work.
- Prefer continuing from known run IDs, tags, and temp directories when the user says “continue”.
