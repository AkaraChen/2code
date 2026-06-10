# AGENTS.md — src/layout

## OVERVIEW
Main app navigation shell. `AppSidebar` renders the project list, profile sub-items, and nav links. Keyboard-navigable (arrow keys).

## FILES
```
layout/
├── AppSidebar.tsx          # Root sidebar component — project list + nav links
└── sidebar/
    ├── ProjectMenuItem.tsx # Single project item + collapse/expand
    ├── ProfileList.tsx     # Profiles under a project
    └── ProfileItem.tsx     # Single profile with agent status dot + active state
```

## KEY PATTERNS

**Agent status dot**: `ProfileItem` reads `useProfileAgentStatus(profileId)` from `features/terminal/store.ts` — renders yellow when waiting for input and blinking green while running.

**Active state**: Profile items highlight based on current route params (`/projects/:id/profiles/:profileId`). Uses `react-router` `useParams`.

**Keyboard navigation**: `AppSidebar` handles arrow key events for project/profile navigation — do not break focus management when modifying sidebar items.

**Project data**: Sourced from `useProjects()` (TanStack Query, `queryKeys.projects.all`). Sidebar re-renders on any project mutation.

## WHERE TO LOOK
| Task | Location |
|------|----------|
| Agent status dot logic | `features/terminal/store.ts::useProfileAgentStatus` |
| Project query | `features/projects/hooks.ts::useProjects` |
| Profile query | `features/projects/hooks.ts::useProjectProfiles` |
