# CLAUDE.md

This file gives future Claude Code instances the minimum high-signal context for working in `src-tauri/crates/model`.

## Scope

This crate is the shared Rust data-model layer for the app. It defines:

- Diesel schema bindings (`src/schema.rs`)
- Diesel model structs (`Queryable`, `Insertable`, `AsChangeset`)
- Serde DTOs shared across backend layers and frontend IPC boundaries
- Shared error and distribution types used by higher-level crates

It intentionally contains data types, not repository/business logic.

## Common Commands

Run from `src-tauri/crates/model`.

- Build/check this crate: `cargo check`
- Run all tests in this crate: `cargo test`
- Run one test by name substring: `cargo test test_parse_npx_distribution`
- Run one exact test path: `cargo test distribution::tests::test_parse_npx_distribution -- --exact`
- Lint this crate: `cargo clippy --all-targets --all-features`
- Format this crate: `cargo fmt`

## Architecture

## 1) Module layout

`src/lib.rs` is the crate surface; it exports domain modules:

- Core entities: `project`, `profile`, `pty`, `agent`, `snippet`, `marketplace`, `stats`
- Support DTOs: `notification`, `watcher`, `debug`, `skill`
- Platform/shared types: `distribution`, `error`
- Database schema: `schema`

Most modules follow a predictable pattern:

- DB row structs: `#[derive(Queryable, Selectable)]`
- Insert payload structs: `#[derive(Insertable)]`
- Update payload structs where relevant: `#[derive(AsChangeset)]`
- Request/response DTOs: serde types with camelCase/snake_case normalization as needed

## 2) Database contract source of truth

`src/schema.rs` is generated Diesel schema and defines:

- Tables, column types, PKs
- Join relationships (`joinable!`)
- Cross-table query allowances (`allow_tables_to_appear_in_same_query!`)

Model structs in other modules are tightly coupled to this schema via `#[diesel(table_name = ...)]`.

Important: `src/schema.rs` is generated; update schema via migrations/print-schema workflow in the backend crate, not by manual edits here.

## 3) Key domain boundaries

- `project.rs` / `profile.rs`: project + git-worktree profile records and project config DTO (`ProjectConfig` with setup/teardown/init scripts).
- `pty.rs`: terminal session persistence types (`pty_sessions`, `pty_session_output`) and PTY config/meta request payloads.
- `agent.rs`: persistent agent sessions and event log records (`agent_sessions`, `agent_session_events`), plus session-create metadata.
- `stats.rs`: analytics/session aggregation model types (`session_stats`, `daily_activity`) and homepage summary DTO.
- `marketplace.rs` + `distribution.rs`: ACP marketplace records and distribution spec parsing/resolution for agent launch.

## 4) Distribution resolution behavior

`distribution.rs` encodes ACP distribution JSON and resolves launch command/env with fixed priority:

1. `npx`
2. `uvx`
3. `binary` for current platform key

If none match, it returns `AppError::NotFound`. This resolution logic is covered by crate tests and is a behavior contract for downstream launch code.

## 5) Serialization/error conventions

- `error.rs` defines `AppError` variants used across infra/service layers.
- `AppError` serializes to a plain string message (not structured JSON object), which affects IPC/client expectations.
- Several DTOs use `#[serde(rename_all = "camelCase")]` for frontend compatibility.

## 6) Type/time representation caveats

The crate mixes DB time representations by table contract:

- Some records use timestamp-like `String` fields (e.g., many Diesel query models)
- Stats/agent event records use integer epoch-like fields (`i32`)

Do not normalize these opportunistically in this crate; keep types aligned with the existing schema and caller expectations.
