# Contain sidebar re-renders: memoize project/profile rows and lazy-mount their dialogs

> Every profile-notes autosave (650ms debounce) and every project/profile mutation currently re-renders the entire sidebar — all project rows, all profile rows, and hundreds of closed dialog subtrees; React.memo on the rows plus lazy-mounted dialogs cuts this to exactly 1 row (measured 13–71x faster per update). | Severity: medium | Category: performance

## Problem

`AppSidebar` (`src/layout/AppSidebar.tsx:322`) subscribes to the projects query (`useProjects()` at `src/layout/AppSidebar.tsx:323`, key `queryKeys.projects.all`). Every time that query's data gets a new array identity — any invalidation or `setQueryData` — the whole sidebar re-renders, and because **none of the row components are memoized**, every project and profile row re-renders too:

- `ProjectMenuItem` is a plain function component (`src/layout/sidebar/ProjectMenuItem.tsx:42-239`), mapped directly for pinned projects at `src/layout/AppSidebar.tsx:775-790` and for top-level entries at `src/layout/AppSidebar.tsx:843-858`.
- `ProjectGroupSection` is a plain function component (`src/layout/sidebar/ProjectGroupSection.tsx:26-103`), mapped at `src/layout/AppSidebar.tsx:824-841`; it maps `ProjectMenuItem` again at `src/layout/sidebar/ProjectGroupSection.tsx:89-96`.
- `ProfileList` (`src/layout/sidebar/ProfileList.tsx:12-50`) and `ProfileItem` (`src/layout/sidebar/ProfileItem.tsx:25-81`) are plain function components under each row.

Worse, each row **statically mounts dialog subtrees even when closed**:

- `ProjectMenuItem` mounts FOUR dialogs unconditionally at `src/layout/sidebar/ProjectMenuItem.tsx:214-236`: `RenameProjectDialog` (its own react-hook-form `useForm` + `useWatch` + `useRenameProject` mutation — `src/features/projects/RenameProjectDialog.tsx:34-54`), `DeleteProjectDialog` (`useMatch` + `useNavigate` + `useDeleteProject` — `src/features/projects/DeleteProjectDialog.tsx:47-69`), `ProjectSettingsDialog` (`src/features/projects/ProjectSettingsDialog.tsx:182-216`), and — when the project has only a default profile — `CreateProfileDialog` (another `useForm` + `useCreateProfile` + `useNavigate` — `src/features/profiles/CreateProfileDialog.tsx:33-37`).
- `ProfileList` mounts one more `CreateProfileDialog` per project (`src/layout/sidebar/ProfileList.tsx:42-46`).
- Each `ProfileItem` mounts a `DeleteProfileDialog` (`src/layout/sidebar/ProfileItem.tsx:74-78`), which itself runs `useDeleteProfile`, `useProfileDeleteCheck(profile.id, isOpen)`, `useProjects`, `useNavigate`, and `useMatch` (`src/features/profiles/DeleteProfileDialog.tsx:41-45`).

So a 50-project workspace re-runs ~200+ dialog components with form-state hooks on **every** sidebar render.

Sidebar renders are not rare. Any of these gives `queryKeys.projects.all` a new array identity:

- **Profile-notes autosave**: `MarkdownEditor` flushes after a 650ms typing pause (`src/features/markdown/MarkdownEditor.tsx:931-939`) → `useUpdateProfileNotes.onSuccess` calls `setQueryData` on `queryKeys.projects.all` (`src/features/profiles/hooks.ts:121-155`, the `setQueryData` at `hooks.ts:139-152`). While a user types notes, the entire sidebar re-renders roughly every 650ms.
- Profile create/delete (`src/features/profiles/hooks.ts:41-61`, `70-87` — both `setQueryData` + `invalidateQueries` on `projects.all`).
- Project rename/delete, sidebar layout saves, group assignment, etc.

`buildSidebarLayout` is memoized (`src/layout/AppSidebar.tsx:343-346`), but since `projects` itself changes identity on each of these events, the memo recomputes and all rows re-render regardless.

Key enabler for the fix: the `setQueryData` updaters in `src/features/profiles/hooks.ts` (and TanStack Query's structural sharing on refetch) **preserve object identity for untouched projects and profiles** — e.g. `useUpdateProfileNotes` returns the same `project` reference for non-matching projects (`hooks.ts:142-150`) and the same profile references for non-edited profiles. So `React.memo` on the rows will actually hit.

## Evidence & Measurements

Benchmark results (verbatim from the verification run):

> Environment: jsdom, vitest 4.1.8, React 19 dev build, bun; 50 measured update cycles after 5 warm-ups. Scale A (100 projects x 3 profiles): BASELINE mount profiler 1128ms, 600 dialog components mounted; per notes-save update: 100 row renders, 200 profile-item renders, 600 dialog renders, ~398ms/update. OPTIMIZED (memo+lazy dialogs): mount 829ms, 0 dialogs mounted; per update: 1 row, 1 profile item, 0 dialogs, ~5.6ms/update (~71x). Scale B (20 projects x 3): BASELINE ~72ms/update; OPTIMIZED ~5.4ms/update (~13x). Optimized per-update cost is O(1) in project count.

Additional verifier notes:

- The benchmark rendered the REAL `AppSidebar` with a seeded QueryClient and simulated the exact `useUpdateProfileNotes.onSuccess` `setQueryData` per update. Memo hit rate was confirmed real: `rowRendersPerUpdate` was exactly 1.0 in optimized mode, proving `setQueryData` keeps unchanged project references stable.
- Mount also improved (1128ms → 829ms at 100 projects, ~26%) because 600 closed dialog subtrees are skipped.
- Numbers are jsdom + dev-mode React, inflated vs production WebView (est. 3–10x); the relative fan-out (all rows → 1 row) is scale-independent and is the load-bearing evidence.

## Proposed Change

Two orthogonal changes, applied together: (a) wrap the row components in `React.memo`, (b) mount each dialog only while its `useDialogState` flag is open. No data-layer changes are needed — the `setQueryData` paths already preserve references for untouched objects.

Keep all components as **named exports with the same names** (use the `memo(function Name(...) {...})` form) so no import sites change. `useDialogState` (`src/shared/hooks/useDialogState.ts`) already returns a stable `{ isOpen, onOpen, onClose }` object — no changes there.

### Step 1 — `src/layout/sidebar/ProfileItem.tsx`

1. Add `memo` to the react import: `import { memo } from "react";`
2. Wrap the component:

```tsx
export const ProfileItem = memo(function ProfileItem({
	profile,
	projectId,
	isActive,
}: {
	profile: Profile;
	projectId: string;
	isActive: boolean;
}) {
	// ...body unchanged except the dialog at the end...
});
```

Default shallow comparison is correct: `profile` is reference-stable via structural sharing / `setQueryData`, `projectId` and `isActive` are primitives.

3. Lazy-mount the delete dialog (currently `ProfileItem.tsx:74-78`):

```tsx
{deleteDialog.isOpen && (
	<DeleteProfileDialog
		isOpen={deleteDialog.isOpen}
		onClose={deleteDialog.onClose}
		profile={profile}
	/>
)}
```

This is safe: `DeleteProfileDialog`'s risk-check query is already gated on `isOpen` (`useProfileDeleteCheck(profile.id, isOpen)` with `enabled: !!profileId && enabled`, `src/features/profiles/hooks.ts:91-98`), so mounting it with `isOpen === true` fires the query exactly as before.

### Step 2 — `src/layout/sidebar/ProfileList.tsx`

Lazy-mount the per-project `CreateProfileDialog` (currently `ProfileList.tsx:42-46`):

```tsx
{createDialog.isOpen && (
	<CreateProfileDialog
		isOpen={createDialog.isOpen}
		onClose={createDialog.onClose}
		projectId={projectId}
	/>
)}
```

Do NOT bother memoizing `ProfileList` itself — it only renders when its parent `ProjectMenuItem` renders, which after Step 3 happens only for the affected project. (Its `profiles` prop is a fresh array from the `useMemo` in `ProjectMenuItem` whenever that project changes, so memo would rarely hit anyway.)

### Step 3 — `src/layout/sidebar/ProjectMenuItem.tsx`

1. Wrap in memo, preserving the named export:

```tsx
import { memo, useMemo, useState } from "react";

export const ProjectMenuItem = memo(function ProjectMenuItem({
	activeProfileId,
	project,
	projectGroups,
}: {
	activeProfileId: string | null;
	project: ProjectWithProfiles;
	projectGroups: ProjectGroup[];
}) {
	// ...body unchanged except the dialog block...
});
```

Default shallow comparison is correct: `project` is reference-stable for untouched projects (structural sharing + the `setQueryData` updaters), `projectGroups` comes from the separate `useProjectGroups` suspense query (stable unless groups actually change), `activeProfileId` is a string that only changes on navigation (one full-row re-render per navigation is fine).

2. Replace the always-mounted dialog block (`ProjectMenuItem.tsx:214-236`) with:

```tsx
{renameDialog.isOpen && (
	<RenameProjectDialog
		isOpen={renameDialog.isOpen}
		onClose={renameDialog.onClose}
		projectId={project.id}
		initName={project.name}
	/>
)}
{deleteDialog.isOpen && (
	<DeleteProjectDialog
		isOpen={deleteDialog.isOpen}
		onClose={deleteDialog.onClose}
		project={project}
	/>
)}
{settingsDialog.isOpen && (
	<ProjectSettingsDialog
		isOpen={settingsDialog.isOpen}
		onClose={settingsDialog.onClose}
		projectId={project.id}
	/>
)}
{hasOnlyDefaultProfile && createProfileDialog.isOpen && (
	<CreateProfileDialog
		isOpen={createProfileDialog.isOpen}
		onClose={createProfileDialog.onClose}
		projectId={project.id}
	/>
)}
```

Why this is safe (no dialog source changes needed):

- All five dialogs are fully controlled (`isOpen`/`onClose` props) and hold no state worth preserving while closed.
- `RenameProjectDialog` already resets its form when `isOpen` becomes true (`RenameProjectDialog.tsx:40-42`); with lazy mounting, `useForm({ defaultValues: { name: initName } })` initializes correctly at mount and the effect also fires — same result.
- `CreateProfileDialog` initializes with an empty branch name at mount and calls `form.reset()` on close — unmounting is equivalent.
- Base UI `DialogContent` already unmounts its popup DOM while closed; what this change removes is the dialog component functions themselves (useForm/useWatch/useMatch/useMutation + Base UI Root hooks). Base UI's `data-starting-style` mechanism still plays the open transition when a dialog mounts already-open.

### Step 4 — `src/layout/sidebar/ProjectGroupSection.tsx`

Wrap in memo, preserving the named export:

```tsx
import { memo } from "react";

export const ProjectGroupSection = memo(function ProjectGroupSection({
	activeProfileId,
	group,
	projectGroups,
	projects,
}: ProjectGroupSectionProps) {
	// ...body unchanged...
});
```

Honest caveat: its `projects` prop is `entry.projects`, a fresh array built by `buildSidebarLayout` whenever the layout memo recomputes (i.e. on every projects-query identity change), so this memo will MISS on query-driven renders. That is acceptable: the group section body is cheap, and its `ProjectMenuItem` children are memoized (Step 3), so the cascade stops one level down. The memo still hits for renders driven by other `AppSidebar` state (sidebar width drag, reorder-mode toggles, location changes with unchanged `activeProfileId`, zustand store updates). Do not try to memoize `buildSidebarLayout` entries per-group — the verifier confirmed row-level memo is sufficient.

### Step 5 — `src/layout/AppSidebar.tsx`

No required changes — `ProjectMenuItem` and `ProjectGroupSection` are consumed as named imports (`AppSidebar.tsx:67-68`), which Steps 3–4 preserve. The `activeProfileId` passed to rows is already memoized from `location.pathname` (`AppSidebar.tsx:347-352`), so it is referentially stable across query updates.

Optional (skip if in doubt): lazy-mount the single top-level `CreateProjectDialog` (`AppSidebar.tsx:902-905`) the same way. It is one instance, so the win is negligible; it is not part of the measured fix.

### Step 6 — New regression test

Add `src/layout/AppSidebar.rerender.test.tsx` (see Verification for the sketch). It renders the real `AppSidebar` with a seeded QueryClient, simulates the exact `useUpdateProfileNotes.onSuccess` `setQueryData`, and asserts (a) exactly one project row re-renders, (b) closed dialog components never execute.

## Verification

The full Tauri build fails in CI containers (missing GTK) — verify with vitest and tsc only:

```bash
cd /home/user/2code && bunx vitest run          # all 671 existing tests must still pass
cd /home/user/2code && bunx tsc --noEmit        # typecheck (tsconfig paths already map @/ -> src/)
```

Focused runs while iterating:

```bash
cd /home/user/2code && bunx vitest run src/layout src/features/profiles src/features/projects
```

**Existing tests covering this area** (must stay green):

- `src/features/profiles/hooks.test.tsx` — `useCreateProfile` / `useDeleteProfile` `setQueryData` behavior (the reference-stability the memo relies on).
- `src/features/profiles/ProfileNotesEditor.test.tsx` — the notes autosave path that triggers the sidebar renders.
- `src/layout/sidebarStore.test.ts` — sidebar zustand store.
- `src/features/projects/hooks.test.tsx`, `src/features/projects/CommandPalette.test.tsx` — project query/mutation plumbing.

**New test to add — `src/layout/AppSidebar.rerender.test.tsx`:**

Strategy: stub leaf components that each row renders unconditionally with counting stubs; memoized parents that skip re-rendering will not re-invoke the stubs. Sketch (adapt fixture shapes to the real `ProjectWithProfiles`/`Profile` types — copy the fixture style from `src/features/profiles/hooks.test.tsx`):

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import type { ProjectWithProfiles } from "@/generated";
import { queryKeys } from "@/shared/lib/queryKeys";

const counters = vi.hoisted(() => ({ projectRow: 0, overflowText: 0, dialog: 0 }));

// Global setup.ts mocks @/generated with a partial export list; re-mock with
// importActual so AppSidebar's `openSettingsWindow` import resolves.
vi.mock("@/generated", async () => {
	const actual = await vi.importActual<typeof import("@/generated")>("@/generated");
	return {
		...actual,
		listProjects: vi.fn(() => Promise.resolve([])),
		listProjectGroups: vi.fn(() => Promise.resolve([])),
	};
});

// ProjectAvatar renders once per ProjectMenuItem body execution.
vi.mock("@/layout/sidebar/ProjectAvatar", () => ({
	ProjectAvatar: () => {
		counters.projectRow += 1;
		return null;
	},
}));

// OverflowTooltipText renders once per ProfileItem body execution
// plus once per expanded row's default-profile label.
vi.mock("@/shared/components/OverflowTooltipText", () => ({
	default: () => {
		counters.overflowText += 1;
		return null;
	},
}));

// Per-row dialogs: with lazy mounting these must NEVER execute while closed.
const countingDialog = () => ({
	default: () => {
		counters.dialog += 1;
		return null;
	},
});
vi.mock("@/features/projects/RenameProjectDialog", countingDialog);
vi.mock("@/features/projects/DeleteProjectDialog", countingDialog);
vi.mock("@/features/projects/ProjectSettingsDialog", countingDialog);
vi.mock("@/features/profiles/CreateProfileDialog", countingDialog);
vi.mock("@/features/profiles/DeleteProfileDialog", countingDialog);
// Top-level, single-instance dialog: stub without counting (not part of the fix).
vi.mock("@/features/projects/CreateProjectDialog", () => ({ default: () => null }));

import AppSidebar from "./AppSidebar";

// build 20 projects x (1 default + 3 non-default profiles); no groups, no pins
// (fixture shape: copy from src/features/profiles/hooks.test.tsx)

describe("AppSidebar render containment", () => {
	it("notes-save setQueryData re-renders exactly one row and mounts zero closed dialogs", async () => {
		const queryClient = new QueryClient({
			defaultOptions: { queries: { retry: false } },
		});
		const projects: ProjectWithProfiles[] = makeProjects(20, 3);
		queryClient.setQueryData(queryKeys.projects.all, projects);
		queryClient.setQueryData(queryKeys.projectGroups.all, []);

		render(
			<QueryClientProvider client={queryClient}>
				<MemoryRouter>
					<AppSidebar />
				</MemoryRouter>
			</QueryClientProvider>,
		);
		expect(counters.dialog).toBe(0); // nothing mounted at rest

		counters.projectRow = 0;
		counters.overflowText = 0;

		// Simulate useUpdateProfileNotes.onSuccess (profiles/hooks.ts:139-152)
		const target = projects[7];
		const editedProfile = { ...target.profiles[2], notes: "updated" };
		await act(async () => {
			queryClient.setQueryData<ProjectWithProfiles[]>(
				queryKeys.projects.all,
				(prev) =>
					prev?.map((p) =>
						p.id === target.id
							? {
								...p,
								profiles: p.profiles.map((pr) =>
									pr.id === editedProfile.id ? editedProfile : pr,
								),
							}
							: p,
					),
			);
			// TanStack Query v5 notifyManager schedules subscriber notification
			// via setTimeout(0) — a sync act() never flushes it.
			await new Promise((resolve) => setTimeout(resolve, 20));
		});

		expect(counters.projectRow).toBe(1);   // only project 7's row re-ran
		expect(counters.overflowText).toBe(2); // its default-profile label + the one edited ProfileItem
		expect(counters.dialog).toBe(0);       // closed dialogs still never mounted
	});
});
```

Expected values before the fix (sanity check while developing the test): `projectRow` = 20, `overflowText` = 20 + 60 = 80, `dialog` > 0 on mount — so the test genuinely discriminates.

Test-environment notes:

- `useProjects`/`useProjectGroups` are `useSuspenseQuery` — pre-seeding both caches before render avoids suspension; no `<Suspense>` boundary needed.
- `useAppSidebarStore` defaults to `isCollapsed: false` (`src/layout/sidebarStore.ts:30`), so `AppSidebar` renders; if other tests in the same file toggle it, reset the store between tests.
- Keep the fixture free of groups and pinned projects so `ProjectGroupSection` (and its `useReducedMotion`/`matchMedia` dependency) stays out of the DOM; `src/hooks/use-mobile.ts` already guards missing `matchMedia`.
- Manual functional pass (if running with a display / on a dev machine): open each dialog from a project row's context menu (rename, delete, settings, create profile) and a profile row's delete — confirm they open, submit, and close correctly, and that rename pre-fills the current name.

## Risks & Constraints

CLAUDE.md invariants to respect:

- **Do not touch `project.inlang/settings.json` or `src/paraglide/`** (generated i18n code); the dialogs import `@/paraglide/messages.js` — leave those imports alone.
- **`src/generated/` is auto-generated and gitignored** — no changes there; this is a frontend-only change with no Rust/IPC impact, so no `cargo tauri-typegen generate` is needed.
- **Query keys must come from `shared/lib/queryKeys.ts`** — the new test does this.
- **Terminals use CSS display for show/hide** — untouched; this change is confined to `src/layout/sidebar/*`, `src/layout/AppSidebar.tsx` (optionally), and one new test.
- **Keyboard navigation** (`src/layout/CLAUDE.md`): `AppSidebar` arrow-key handling walks `[data-sidebar-item]` elements. Neither memoization nor lazy dialogs removes any `data-sidebar-item` node (dialogs render in portals and carry no such attribute) — but do not restructure the row JSX beyond the dialog block.

Regression risks:

1. **Exit animation on dialog close.** Unmounting on `isOpen === false` removes the dialog the instant it closes, so Base UI's closing transition (`data-ending-style`) is skipped — the dialog disappears immediately instead of fading out. Functionally harmless (the verifier confirmed lazy mounting is safe); if the visual polish matters, the follow-up is a small "keep mounted until transition ends" hook, NOT reverting to always-mounted. Do not block on this.
2. **Memo staleness.** If a future mutation path mutates a project/profile object in place instead of producing a new reference, the memoized row will not update. All current paths (`src/features/profiles/hooks.ts`, project hooks) produce new objects for changed entities — preserve that convention. The new regression test will catch the inverse problem (lost reference stability re-inflating render counts).
3. **`DeleteProjectDialog` navigation-on-delete.** It reads `useMatch` at render time and navigates away after deleting the currently-open project. With lazy mounting it now mounts on open — `useMatch` still evaluates before any deletion happens, so behavior is unchanged. Verify manually: delete the project you are currently viewing and confirm you are redirected to a replacement project (logic at `src/features/projects/DeleteProjectDialog.tsx:50-68`).
4. **`ProjectSettingsDialog` config fetch.** Its suspense-backed `useProjectConfig` runs inside `DialogContent`'s `AsyncBoundary`; lazy mounting just delays the fetch to open time (it already only rendered content when open). No prefetch existed to lose.
5. **React 19 + `memo`**: this codebase does not use the React Compiler; plain `memo` is the intended tool. Keep the `memo(function Name(...))` form so component names survive for DevTools and any future `displayName`-based tooling.
6. **Do not memoize with custom comparators.** Default shallow comparison is load-bearing and sufficient; a custom comparator that deep-compares `project` would mask reference-stability regressions in the data layer.
