# AGENTS.md — src-tauri/crates/repo

## OVERVIEW
Data access layer. All Diesel ORM queries. No business logic — pure CRUD + complex queries.

## FILES
| File | Role |
|------|------|
| `project.rs` | Project CRUD |
| `checkout_notes.rs` | Notes keyed by `project_id` + canonical checkout path |
| `lib.rs` | Re-exports |

Checkout paths for Git / the file tree come from live Herdr, not a sqlite `profiles` table.

## WHERE TO LOOK
| Task | Location |
|------|----------|
| Checkout notes | `checkout_notes.rs` |
| Schema definitions | `model::schema` (DO NOT edit schema.rs directly) |

## ANTI-PATTERNS
- Complex orchestration (worktree creation, script execution) in repo layer — that's service's job
- Raw SQL strings for queries that Diesel DSL can express
