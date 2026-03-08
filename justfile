start:
    nr start

fmt:
    nr lint

test:
    nr test

typecheck:
    nr typecheck

lint:
    nr lint

# Build CLI sidecar (src-tauri/bins/2code-helper)
build-helper:
    #!/usr/bin/env bash
    set -euo pipefail
    TARGET_TRIPLE=$(rustc --print host-tuple)
    cd src-tauri && cargo build --release -p twocode-helper
    mkdir -p binaries
    cp -f target/release/2code-helper "binaries/2code-helper-${TARGET_TRIPLE}"
    chmod +x "binaries/2code-helper-${TARGET_TRIPLE}"

# Build CLI sidecar in debug mode (src-tauri/bins/2code-helper)
build-helper-dev:
    #!/usr/bin/env bash
    set -euo pipefail
    TARGET_TRIPLE=$(rustc --print host-tuple)
    cd src-tauri && cargo build -p twocode-helper
    mkdir -p binaries
    cp -f target/debug/2code-helper "binaries/2code-helper-${TARGET_TRIPLE}"
    chmod +x "binaries/2code-helper-${TARGET_TRIPLE}"

# Regenerate TypeScript bindings from Rust commands and patch tauri-typegen v0.4.1 unused-import bugs
typegen:
    #!/usr/bin/env bash
    set -euo pipefail
    cargo tauri-typegen generate
    sed -i '' 's/import { invoke, Channel }/import { invoke }/' src/generated/commands.ts
    sed -i '' 's/import { listen, type UnlistenFn, type Event }/import { listen, type UnlistenFn }/' src/generated/events.ts
    grep -v "^import \* as types from './types'" src/generated/events.ts > /tmp/_events_patched.ts && mv /tmp/_events_patched.ts src/generated/events.ts

coverage:
    cd src-tauri && cargo llvm-cov --lib --tests --html --output-dir coverage/

coverage-summary:
    cd src-tauri && cargo llvm-cov --lib --tests

cloc:
    cloc --include-lang="TypeScript,Rust,JavaScript,CSS" . --exclude-dir=node_modules,dist,target --fullpath --not-match-d='(src-tauri/target|src/generated|src/paraglide)'

# Removed redundant test target as it's now handled by nr test
