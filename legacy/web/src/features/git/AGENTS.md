# AGENTS.md — src/features/git

## OVERVIEW
Git diff viewer, commit history browser, and top bar with branch display. Uses context ID resolution to work with both projects and profiles.

## FILES
| File | Role |
|------|------|
| `hooks.ts` | `useGitDiff`, `useGitLog`, `useCommitDiff`, `useGitBranch` TanStack Query hooks |
| `gitDiffReducer.ts` | Reducer for diff view state (file selection, view mode) |
| `gitDiffReducer.test.ts` | Tests for reducer |
| `utils.ts` | Diff parsing/formatting helpers |
| `utils.test.ts` | Utility tests |
| `GitDiffDialog.tsx` | Full diff viewer dialog |
| `ProjectTopBar.tsx` | Branch display + diff/history trigger button |
| `components/ChangesFileList.tsx` | Staged/unstaged files list |
| `components/CommitList.tsx` | Commit history list |
| `components/GitDiffPane.tsx` | Diff pane with syntax highlighting |
| `components/HistoryFileList.tsx` | Files changed in a commit |

## KEY PATTERNS

**Context ID**: All git commands accept `contextId` — either a project ID or profile ID. Backend resolves polymorphically via `repo::project::resolve_context_folder`. Frontend passes `profileId` or `projectId` without needing to know which folder it maps to.

**Query keys**: Use `queryKeys.git.diff(contextId)`, `queryKeys.git.log(contextId)` from `@/shared/lib/queryKeys.ts`.

## WHERE TO LOOK
| Task | Location |
|------|----------|
| Backend git resolution | `src-tauri/crates/repo/src/project.rs::resolve_context_folder` |
| Git command execution | `src-tauri/crates/infra/src/git.rs` |
| IPC bindings | `src/generated/` — `getGitDiff`, `getGitLog`, `getCommitDiff`, `getGitBranch` |
| Diff state management | `gitDiffReducer.ts` |
