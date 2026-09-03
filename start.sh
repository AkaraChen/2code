#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "${SCRIPT_DIR}"

# Primary product entry: native GPUI shell.
if command -v just >/dev/null 2>&1; then
	exec just gpui
fi

cd src-gpui
exec cargo run
