# AGENTS.md — src/features/projects

## OVERVIEW
Project CRUD, folder selection, project detail page, and settings. Core domain.

## FILES
| File | Role |
|------|------|
| `hooks.ts` | `useProjects`, `useCreateProject`, `useDeleteProject`, `useUpdateProject`, `useProjectProfiles`, `useProjectConfig`, `useSaveProjectConfig` |
| `ProjectDetailPage.tsx` | Main project view — renders terminal layer and top bar |
| `CreateProjectDialog.tsx` | New project dialog with folder picker |
| `DeleteProjectDialog.tsx` | Confirm delete with warning |
| `RenameProjectDialog.tsx` | Inline rename |
| `ProjectSettingsDialog.tsx` | Edit `2code.json` config (setup/teardown scripts) |

## KEY PATTERNS

**`2code.json` config**: Projects can have a `2code.json` in their root with `setup_script` and `teardown_script` arrays. Runs via `sh -c` during profile create/delete. Managed via `useProjectConfig` + `useSaveProjectConfig`.

**Routing**: `ProjectDetailPage` is at `/projects/:id/profiles/:profileId`. If no `profileId`, redirects to first profile or prompts creation.

**Query invalidation**: After mutations, invalidate `queryKeys.projects.all` to refresh sidebar.

## WHERE TO LOOK
| Task | Location |
|------|----------|
| Project backend logic | `src-tauri/crates/service/src/project.rs` |
| Project DB queries | `src-tauri/crates/repo/src/project.rs` |
| Config loading + scripts | `src-tauri/crates/infra/src/config.rs` |
| Query keys | `src/shared/lib/queryKeys.ts` |
