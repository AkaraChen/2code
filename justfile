start:
    nr start

fmt:
    fama

build-helper:
    #!/usr/bin/env bash
    set -euo pipefail
    TARGET_TRIPLE=$(rustc --print host-tuple)
    cd src-tauri && cargo build --release -p twocode-helper
    mkdir -p binaries
    cp -f target/release/2code-helper "binaries/2code-helper-${TARGET_TRIPLE}"
    chmod +x "binaries/2code-helper-${TARGET_TRIPLE}"

build-helper-dev:
    #!/usr/bin/env bash
    set -euo pipefail
    TARGET_TRIPLE=$(rustc --print host-tuple)
    cd src-tauri && cargo build -p twocode-helper
    mkdir -p binaries
    cp -f target/debug/2code-helper "binaries/2code-helper-${TARGET_TRIPLE}"
    chmod +x "binaries/2code-helper-${TARGET_TRIPLE}"
