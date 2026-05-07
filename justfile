start:
    ./start.sh

fmt:
    fama "./src/**/*.{ts,tsx}"
    cd src-tauri && cargo fmt

test-frontend:
    bun run test

test-rust:
    just build-helper-dev
    cd src-tauri && cargo test

test-all:
    bun run test
    just test-rust

# Build CLI sidecar (src-tauri/bins/2code-helper)
build-helper:
    #!/usr/bin/env bash
    set -euo pipefail
    TARGET_TRIPLE="${TWOCODE_HELPER_TARGET:-$(rustc --print host-tuple)}"
    BIN_SUFFIX=""
    if [[ "${TARGET_TRIPLE}" == *windows* ]]; then
        BIN_SUFFIX=".exe"
    fi
    CARGO_TARGET_ARGS=()
    TARGET_DIR="target/release"
    if [[ "${TARGET_TRIPLE}" != "$(rustc --print host-tuple)" ]]; then
        CARGO_TARGET_ARGS=(--target "${TARGET_TRIPLE}")
        TARGET_DIR="target/${TARGET_TRIPLE}/release"
    fi
    cd src-tauri && cargo build --release -p twocode-helper "${CARGO_TARGET_ARGS[@]}"
    mkdir -p binaries
    cp -f "${TARGET_DIR}/2code-helper${BIN_SUFFIX}" "binaries/2code-helper-${TARGET_TRIPLE}${BIN_SUFFIX}"
    chmod +x "binaries/2code-helper-${TARGET_TRIPLE}${BIN_SUFFIX}"

# Build CLI sidecar in debug mode (src-tauri/bins/2code-helper)
build-helper-dev:
    #!/usr/bin/env bash
    set -euo pipefail
    TARGET_TRIPLE="${TWOCODE_HELPER_TARGET:-$(rustc --print host-tuple)}"
    BIN_SUFFIX=""
    if [[ "${TARGET_TRIPLE}" == *windows* ]]; then
        BIN_SUFFIX=".exe"
    fi
    CARGO_TARGET_ARGS=()
    TARGET_DIR="target/debug"
    if [[ "${TARGET_TRIPLE}" != "$(rustc --print host-tuple)" ]]; then
        CARGO_TARGET_ARGS=(--target "${TARGET_TRIPLE}")
        TARGET_DIR="target/${TARGET_TRIPLE}/debug"
    fi
    cd src-tauri && cargo build -p twocode-helper "${CARGO_TARGET_ARGS[@]}"
    mkdir -p binaries
    cp -f "${TARGET_DIR}/2code-helper${BIN_SUFFIX}" "binaries/2code-helper-${TARGET_TRIPLE}${BIN_SUFFIX}"
    chmod +x "binaries/2code-helper-${TARGET_TRIPLE}${BIN_SUFFIX}"

coverage:
    cd src-tauri && cargo llvm-cov --lib --tests --html --output-dir coverage/

coverage-summary:
    cd src-tauri && cargo llvm-cov --lib --tests

tauri-smoke:
    cd e2e-tests && bun run test

cloc:
    cloc --include-lang="TypeScript,Rust,JavaScript,CSS" . --exclude-dir=node_modules,dist,target --fullpath --not-match-d='(src-tauri/target|src/generated|src/paraglide)'
