---
name: dead-code-cleanup
description: Find and remove unused code across frontend and backend. Use when the user asks to "clean up dead code", "find unused exports", "remove unused commands", "delete dead code", or wants to identify and eliminate unreferenced functions, types, dependencies, or Tauri commands. Covers both TypeScript/React frontend (via knip) and Rust/Tauri backend analysis.
---

# Dead Code Cleanup

## Frontend (TypeScript/React)

### 1. Run knip

```bash
bunx knip
```

Reports: unused exports, unused files, unused dependencies, unused types, configuration hints.

### 2. Verify each finding

Grep before removing — especially for:

- **Tauri plugin deps** (e.g. `@tauri-apps/plugin-*`): May be used only from Rust backend. If no JS imports exist but `lib.rs` registers the plugin, the npm package is safe to remove.
- **Unused exports**: If the symbol is used internally in the same file, just remove `export` instead of deleting.

### 3. Apply fixes

- Remove `export` keyword from internally-used-only symbols
- Delete entirely unused functions/types
- `bun remove <pkg>` for unused dependencies
- Remove empty directories

### 4. Iterate until `bunx knip` is clean

## Backend (Rust/Tauri)

### 1. Find unused Tauri commands

Compare `generate_handler![]` entries in `lib.rs` against actual frontend imports:

1. List all commands from `generate_handler![]`
2. Map to camelCase TypeScript names in `src/generated/commands.ts`
3. Grep `src/` (excluding `src/generated/`, `src/paraglide/`) for each name
4. Zero imports = unused command

### 2. Trace the dead code chain

For each unused command, trace downward through each architectural layer:

```
handler → service → repo → model
```

At each level, grep to verify no other callers exist before removing:

```bash
grep -r "service::module::fn_name" src-tauri/src/
```

### 3. Remove in order

1. Delete handler functions from `handler/*.rs`
2. Remove entries from `generate_handler![]` in `lib.rs`
3. Delete dead service functions from `service/*.rs`
4. Delete dead repo functions from `repo/*.rs`
5. Delete dead model types from `model/*.rs`
6. Clean up `use` imports in each modified file
7. Delete or rewrite tests that reference removed functions

### 4. Verify with clippy

```bash
cargo clippy
```

If clippy reports new `dead_code` warnings from transitive removal, repeat the trace-and-remove cycle until clean.

### 5. Regenerate frontend bindings

```bash
cargo tauri-typegen generate
```

Fix any TS errors in regenerated bindings (e.g. unused `Channel` import).

## Final Verification Checklist

```bash
bunx knip           # frontend: zero issues
bun run build       # frontend: compiles
cargo clippy        # backend: zero warnings
cargo test          # backend: all tests pass
```
