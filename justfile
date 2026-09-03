start:
    ./start.sh

fmt:
    fama "./src/**/*.{ts,tsx}"
    cd src-tauri && cargo fmt
    cd src-gpui && cargo fmt

gpui:
    cd src-gpui && cargo run

gpui-check:
    cd src-gpui && cargo check

test-frontend:
    bun run test

test-rust:
    cd src-tauri && cargo test

test-all:
    bun run test
    just test-rust

verify:
    bun run lint:check
    bun run typecheck
    bun run test
    just test-rust

coverage:
    cd src-tauri && cargo llvm-cov --lib --tests --html --output-dir coverage/

coverage-summary:
    cd src-tauri && cargo llvm-cov --lib --tests

tauri-smoke:
    cd e2e-tests && bun run test

cloc:
    cloc --include-lang="TypeScript,Rust,JavaScript,CSS" . --exclude-dir=node_modules,dist,target --fullpath --not-match-d='(src-tauri/target|src/generated|src/paraglide)'
