#!/usr/bin/env bash
set -euo pipefail
cargo build -p gpui-app --release --manifest-path src-tauri/Cargo.toml
