#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "${SCRIPT_DIR}"

TARGET_TRIPLE="$(rustc --print host-tuple)"
BIN_SUFFIX=""

if [[ "${TARGET_TRIPLE}" == *windows* ]]; then
    BIN_SUFFIX=".exe"
fi

HELPER_PATH="src-tauri/binaries/2code-helper-${TARGET_TRIPLE}${BIN_SUFFIX}"

if [[ ! -f "${HELPER_PATH}" ]]; then
    just build-helper
fi

nr start
