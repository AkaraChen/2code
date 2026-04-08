#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DMG_DIR="$REPO_ROOT/src-tauri/target/release/bundle/dmg"

if [[ ! -d "$DMG_DIR" ]]; then
	echo "DMG directory not found: $DMG_DIR" >&2
	exit 1
fi

shopt -s nullglob
dmg_files=("$DMG_DIR"/*.dmg)
shopt -u nullglob

if [[ ${#dmg_files[@]} -eq 0 ]]; then
	echo "No DMG files found in: $DMG_DIR" >&2
	exit 1
fi

latest_dmg="$(ls -1t "${dmg_files[@]}" | head -n 1)"

echo "Opening latest DMG: $latest_dmg"
open "$latest_dmg"
