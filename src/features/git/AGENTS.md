# AGENTS.md — src/features/git

## OVERVIEW

Full git client UI: dock-style `GitPanel` with Changes / History / Branches / Stash tabs, Monaco-powered diff viewer, virtualized commit graph, in-progress merge/rebase resolver, history-rewrite dialogs, and a top-bar branch indicator. Operates on either a project or profile via `contextId` resolution in the backend.

The `GitPanel` is mounted persistently per profile inside `TerminalLayer` and toggled with CSS `display` (same pattern as terminals — never unmounts). Width is shared across profiles; tab + open state + commit-message draft are per-profile.

## FILES

### Panel + tabs

| File | Role |
|------|------|
| `GitPanel.tsx` | Main right-dock panel with resize handle, tab list, `InitRepoFlow` for non-git folders, `InProgressBanner`, and per-tab body |
| `gitPanelStore.ts` | Zustand store: panel open state, active tab, panel width, commit-message drafts (all per-profile keyed) |
| `ChangesTab.tsx` | Staged/unstaged file list with tri-state bulk-select checkboxes |
| `CommitComposer.tsx` | Commit message editor with persisted draft, identity selector |
| `GraphLogTab.tsx` | Virtualized log list with composable filters; selecting commits opens `CommitDetailPane` in a tab |
| `GraphCanvas.tsx` | Per-row Canvas painter for the commit graph (lanes + bezier S-curves) |
| `LogFiltersBar.tsx` | Composable filter bar (author, path, message, hash-prefix detection) |
| `BranchesTab.tsx` | File-tree-style local + remote branches + tags; auto-fetches on mount; shared context menu for both local and remote rows |
| `StashTab.tsx` | Stash list with Pop / Apply / Drop |
| `InProgressBanner.tsx` | Sticky banner above tabs for in-progress merge/rebase/cherry-pick/revert with conflict list |
| `InitRepoFlow.tsx` | First-run flow when the project folder isn't a git repo (init + optional add-remote) |
| `HistoryTab.tsx` | Legacy flat history list (kept as fallback; `GraphLogTab` is the active history view) |

### Diff viewing + tabs

| File | Role |
|------|------|
| `DiffTabPane.tsx` | Read-only diff editor tab opened when a file is selected from Changes or a commit. Three view modes: split / inline / patch |
| `CommitDetailPane.tsx` | Commit info + file explorer + per-file diff for one or more selected commits |
| `MonacoFileDiff.tsx` | Patch-text Monaco editor with hunk-staging gutter for partial commits |
| `MonacoSideBySideDiff.tsx` | Side-by-side `DiffEditor` with syntax highlighting; auto-collapses to single-pane for added/deleted files |
| `diffTabs.ts` | Synthetic tab-path encoding: `2code-diff://<side>/<path>` and `2code-commit://<hash>+<hash>/...` (consumed by `fileViewerTabsStore`) |
| `MergeResolverPane.tsx` | 90% viewport modal with three-pane Monaco view (ours / theirs / editable result); Cmd+Enter to mark resolved |

### History rewrite (Phase 2.5)

| File | Role |
|------|------|
| `EditMessageDialog.tsx` | Reword a single commit message |
| `SquashDialog.tsx` | Squash multiple selected commits with a combined message editor |
| `EditAuthorDialog.tsx` | Bulk identity rewrite for selected commits |
| `IdentityDropdown.tsx` | Per-commit identity override picker |
| `RewriteDialogShell.tsx` | Shared dialog chrome (title, error slot, submit/cancel) reused by all rewrite + branch dialogs |

### Hooks + bindings

| File | Role |
|------|------|
| `hooks.ts` | All TanStack Query hooks: status, diff, log, graph, branches, remote-branches, tags, stashes, in-progress op, conflict state, identity, rewrites, fetch/pull/push/merge/rebase/delete-remote/rename-remote, plus mutation invalidation helpers |
| `changesTabBindings.ts` | Hand-written Tauri `invoke()` wrappers + DTO types. **Note:** these will be replaced by `cargo tauri-typegen generate` output (`src/generated/`) once the typegen run is committed |
| `useGitStateSubscription.ts` | Subscribes to `.git/` watcher events emitted by the backend and invalidates relevant query keys |
| `gitError.ts` | `GitError` discriminated union + `showGitErrorToast()` |

### Utilities + tests

| File | Role |
|------|------|
| `branchTree.ts` | Slash-grouped tree builder (e.g. `feat/auth/login` → nested folder nodes). Used by both local-branch and remote-branch trees |
| `commentUtils.ts` | Comment parsing/rendering helpers for commit messages |
| `gitDiffReducer.ts` | Reducer for legacy `GitDiffDialog` view state |
| `utils.ts` | Diff parsing/formatting helpers |
| `*.test.ts` | Colocated unit tests |
| `GitDiffDialog.tsx`, `ProjectTopBar.tsx`, `components/` | Pre-revamp top-bar diff viewer; `ProjectTopBar.tsx` is also where the "Initialize git" entry point lives for non-repo folders |

## KEY PATTERNS

**Context ID**: every git command accepts a `profileId` (also resolves project IDs polymorphically via `repo::project::resolve_context_folder`). Frontend never branches on which it is.

**Query keys**: most use the centralized `queryKeys.git.*` from `@/shared/lib/queryKeys.ts`; a handful of newer ones use string-literal arrays (`["git-branches", profileId]`, `["git-remote-branches", profileId]`, `["git-stashes", profileId]`, `["git-in-progress", profileId]`, `["git-commit-graph", profileId]`). Mutation `onSuccess` handlers must invalidate every key that the operation can affect — see `useBranchMutation` and `useRebaseMergeMutation` in `hooks.ts` for the canonical lists.

**Live updates**: the backend file watcher (`infra::git::watcher`) emits Tauri events when `.git/HEAD`, refs, or the index change. `useGitStateSubscription` (mounted by `GitPanel`) invalidates affected query keys, so cross-pane UI stays consistent without polling.

**Tab persistence**: opening a diff or commit-detail pane goes through `useFileViewerTabsStore.openUntitled()` with a synthetic path from `diffTabs.ts`. This puts diffs alongside regular file tabs and inherits all the tab reorder/close logic.

**Auto-fetch on `BranchesTab` mount**: `useAutoFetchOnce` fires one `git fetch` per profile per session. Errors are swallowed (offline/no-remote/auth-prompt are normal). Manual `Fetch` in the toolbar gives users an explicit retry path with toasts.

**Unified branch context menu**: right-click on a local **or** remote branch row opens the same `BranchContextMenu` (Checkout / New branch from this… / Rebase / Merge / Rename / Delete). The component takes a discriminated `target: { kind: "local"; branch } | { kind: "remote"; rb }` and routes to local-vs-remote-flavored dialogs underneath. Destructive remote ops (Rename / Delete) use type-the-name confirmation.

## WHERE TO LOOK

| Task | Location |
|------|----------|
| Add a new git command | `src-tauri/crates/infra/src/git/cli.rs` (writes) or `gix.rs` (reads) → service passthrough → `handler/project.rs` → register in `lib.rs` → bindings + hook here |
| Add a new query invalidation | `useBranchMutation` / `useRebaseMergeMutation` / `useStashMutation` in `hooks.ts` |
| Change diff view mode behavior | `DiffTabPane.tsx` (split/inline/patch toggle) |
| Add a new branch action | `BranchContextMenu` in `BranchesTab.tsx`; wire to a hook in `hooks.ts` |
| Hook into `.git/` change events | `useGitStateSubscription.ts` |
| Backend git resolution | `src-tauri/crates/repo/src/project.rs::resolve_context_folder` |
