# CLAUDE.md

This file guides Claude Code when working in `src-tauri/crates/repo`.

## Scope

- This crate is the database repository layer for the Tauri app.
- It owns Diesel-based CRUD/query logic and small SQL helpers for app entities.
- Business orchestration belongs in service crates; this crate should stay focused on persistence.

## Common Commands

Run from the workspace root (`src-tauri/`) unless noted.

- `cargo test -p repo` — run all tests in this crate
- `cargo test -p repo project::tests::insert_and_fetch` — run a single test
- `cargo check -p repo` — typecheck this crate
- `cargo clippy -p repo --all-targets -- -D warnings` — lint this crate
- `cargo fmt -p repo` — format this crate

If running from this crate directory (`src-tauri/crates/repo`):

- `cargo test`
- `cargo test project::tests::insert_and_fetch`
- `cargo check`

## Architecture

### Role in the backend stack

- This crate sits below handler/service layers and above SQLite storage.
- Public functions are table-focused repository APIs that accept `&mut SqliteConnection` and return model DTOs.
- Errors are normalized to `model::error::AppError` (mostly `DbError` and `NotFound`).

### Module map (`src/lib.rs`)

- `project` — project records and project+profiles aggregation
- `profile` — profile records and profile deletion constraints
- `pty` — PTY session metadata and persisted output blob operations
- `agent` — agent session/event persistence and lifecycle flags
- `snippet` — snippet CRUD with partial updates
- `marketplace` — marketplace agent catalog persistence
- `stats` — activity/session stats queries and homepage aggregates

### Data access patterns

- Most writes use Diesel query builder (`insert_into`, `update`, `delete`) followed by a readback for the created/updated row.
- Cross-table reads are done with joins where needed (for example, project-scoped PTY/agent session queries via `profiles`).
- Some hot paths use raw SQL (`diesel::sql_query`) for SQLite-specific operations:
    - PTY output append + 1MB trimming
    - Daily activity upserts
    - Aggregated stats queries

## Key Behaviors and Invariants

### Test strategy

- Tests are colocated in each module under `#[cfg(test)]`.
- Test DB setup is consistent:
    - in-memory SQLite (`:memory:`)
    - `PRAGMA foreign_keys=ON`
    - embedded migrations via `infra::db::MIGRATIONS`
- Follow this same setup for new repository tests.

### Project/Profile rules

- Default profiles are protected from direct deletion in `profile::delete`; they are removed via project cascade delete.
- `project::list_all_with_profiles` loads all projects and profiles and builds a grouped result map in memory.

### PTY persistence model

- `pty::insert_session` must create both:
    - a `pty_sessions` row
    - a companion `pty_session_output` row initialized with empty blob
- Output history is append-only data in `pty_session_output.data`, with hard trim to last 1MB.
- `mark_all_open_closed` marks sessions with `closed_at IS NULL` as closed.

### Agent session model

- Agent sessions are persisted separately from PTY sessions and linked to profiles.
- Soft-delete uses `destroyed_at` (`mark_destroyed`, `mark_all_active_destroyed`).
- Events are ordered by `event_index`; helpers exist for next index and turn-index tracking.
- `transfer_events` re-parents historical events to a replacement session ID.

### Stats model

- `session_stats` stores per-session rows; `daily_activity` stores per-day per-project rolled-up counters.
- Homepage stats are composed from multiple repository queries in `stats::get_homepage_stats`.
- Date-based filters rely on SQLite date functions against unixepoch timestamps.

## Conventions for edits in this crate

- Keep repository functions narrow and table-focused.
- Prefer returning domain models from `model` crate instead of ad-hoc structs (except local query-only mappers).
- Preserve current error mapping style (`map_err(|e| AppError::DbError(e.to_string()))`) unless the module already uses semantic `NotFound` handling.
- When adding persistence for a new entity, mirror existing structure: module in `src/`, export in `src/lib.rs`, colocated tests with in-memory migration setup.
