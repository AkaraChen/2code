start:
    cargo run -p gpui-app --manifest-path src-tauri/Cargo.toml

fmt:
    fama "./legacy/web/src/**/*.{ts,tsx}"
    cd src-tauri && cargo fmt

test-frontend:
    bun run legacy:test

test-rust:
    cd src-tauri && cargo test

test-all:
    just test-rust
    bun run legacy:test

verify:
    cargo test --manifest-path src-tauri/Cargo.toml --workspace
    cargo test --manifest-path src-tauri/Cargo.toml -p gpui-app

coverage:
    cd src-tauri && cargo llvm-cov --lib --tests --html --output-dir coverage/

coverage-summary:
    cd src-tauri && cargo llvm-cov --lib --tests

tauri-smoke:
    cd legacy/e2e && bun run test

cloc:
    cloc --include-lang="TypeScript,Rust,JavaScript,CSS" . --exclude-dir=node_modules,dist,target --fullpath --not-match-d='(src-tauri/target|legacy/web/src/generated|legacy/web/src/paraglide)'
