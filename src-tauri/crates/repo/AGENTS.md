# AGENTS.md — src-tauri/crates/repo

## OVERVIEW
Data access layer. All Diesel ORM queries. No business logic — pure CRUD + complex queries.

## FILES
| File | Role |
|------|------|
| `project.rs` | Project CRUD |
| `checkout_notes.rs` | Notes keyed by `project_id` + canonical checkout path |
| `pty.rs` | PTY session **metadata** CRUD (insert/list/dimensions/mark-closed/delete/all-ids). Output bytes live in files (`infra::pty_log`), not the DB. |
| `lib.rs` | Re-exports |

Checkout paths for Git / the file tree come from live Herdr (or Local `projects.folder`), not a sqlite `profiles` table.

## WHERE TO LOOK
| Task | Location |
|------|----------|
| Checkout notes | `checkout_notes.rs` |
| Session output history | Not in the DB — read from files via `infra::pty_log::read_all` |
| Schema definitions | `model::schema` (DO NOT edit schema.rs directly) |

## ANTI-PATTERNS
- Complex orchestration (worktree creation, script execution) in repo layer — that's service's job
- Raw SQL strings for queries that Diesel DSL can express
