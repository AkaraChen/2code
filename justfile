start:
    nr start

fmt:
    fama "./src/**/*.{ts,tsx}"
    cd src-tauri && cargo fmt

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

coverage:
    cd src-tauri && cargo llvm-cov --lib --tests --html --output-dir coverage/

coverage-summary:
    cd src-tauri && cargo llvm-cov --lib --tests

cloc:
    cloc --include-lang="TypeScript,Rust,JavaScript,CSS" . --exclude-dir=node_modules,dist,target --fullpath --not-match-d='(src-tauri/target|src/generated|src/paraglide)'
