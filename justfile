# GPUI native desktop app (primary product UI)
gpui:
    cd src-gpui && cargo run

gpui-check:
    cd src-gpui && cargo test

start:
    just gpui

tauri-dev:
    just gpui

leftover-tauri:
    bun run leftover:tauri:dev

fmt:
    fama "./src/**/*.{ts,tsx}"
    cd src-tauri && cargo fmt
    cd src-gpui && cargo fmt

test-frontend:
    bun run test

test-rust:
    cd src-tauri && cargo test

test-all:
    just gpui-check
    just test-rust

verify:
    just gpui-check
    just test-rust

coverage:
    cd src-tauri && cargo llvm-cov --lib --tests --html --output-dir coverage/

coverage-summary:
    cd src-tauri && cargo llvm-cov --lib --tests

tauri-smoke:
    cd e2e-tests && bun run test

cloc:
    cloc --include-lang="TypeScript,Rust,JavaScript,CSS" . --exclude-dir=node_modules,dist,target --fullpath --not-match-d='(src-tauri/target|src/generated|src/paraglide)'
