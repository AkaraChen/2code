# AGENTS.md — src-tauri/crates/repo

## OVERVIEW
Data access layer. All Diesel ORM queries. No business logic — pure CRUD + complex queries.

## FILES
| File | Role |
|------|------|
| `project.rs` | Project CRUD + `resolve_context_folder` (polymorphic project/profile folder lookup) |
| `profile.rs` | Profile CRUD |
| `pty.rs` | PTY session + output chunk CRUD; oldest-chunk pruning query |
| `lib.rs` | Re-exports |

## KEY PATTERN — resolve_context_folder
```rust
pub fn resolve_context_folder(conn, context_id) -> Result<PathBuf>
```
Tries `profiles` table first (profile ID → worktree path), falls back to `projects` table (project ID → folder). Used by all git commands to support both regular projects and profile worktrees with the same `contextId` parameter.

## WHERE TO LOOK
| Task | Location |
|------|----------|
| Context ID resolution | `project.rs::resolve_context_folder` |
| Session history query | `pty.rs` — fetches chunks ordered by timestamp |
| Schema definitions | `model::schema` (DO NOT edit schema.rs directly) |

## ANTI-PATTERNS
- Complex orchestration (worktree creation, script execution) in repo layer — that's service's job
- Raw SQL strings for queries that Diesel DSL can express
