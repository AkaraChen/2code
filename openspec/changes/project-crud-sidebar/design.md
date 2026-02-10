## Context

The app has a Tauri backend with 6 fully implemented Project CRUD commands (create temporary, create from folder, list, get, update, delete) backed by Diesel/SQLite. The frontend sidebar currently uses flat `SideNavLink` components from Carbon React. There is no frontend integration with any project commands — the Projects page is an empty placeholder.

Carbon React v1.100.0 is installed and provides `SideNavMenu` / `SideNavMenuItem` for expandable sidebar menus, which integrate naturally with the existing `SideNav` structure.

## Goals / Non-Goals

**Goals:**

- Replace the flat "Projects" sidebar link with an expandable `SideNavMenu` containing a create action and project list
- Load projects from backend on app startup and keep the list in sync after mutations
- Allow creating a new project (temporary) directly from the sidebar
- Navigate to individual project views via sidebar items
- Support i18n (en + zh) for all new UI strings

**Non-Goals:**

- Project editing/renaming UI (out of scope for this change — future work)
- "Create from folder" flow with native file picker (deferred — only temporary project creation for now)
- Drag-and-drop reordering of projects
- Project search/filter in sidebar

## Decisions

### 1. Use `SideNavMenu` + `SideNavMenuItem` (not TreeView)

**Choice**: Carbon's `SideNavMenu` component for the expandable project list.

**Rationale**: `SideNavMenu` is designed for sidebar navigation with 1-2 level hierarchies. It integrates seamlessly with the existing `SideNav` / `SideNavItems` structure and provides built-in expand/collapse with chevron indicators. TreeView is more suited for deeply nested file-browser-like UIs, which is unnecessary here.

### 2. React Context for project state management

**Choice**: A `ProjectProvider` React context to hold the project list and expose CRUD operations.

**Rationale**: Both the sidebar (project list) and project pages need access to the same project data. A shared context avoids prop-drilling and keeps state in sync — when a project is created in the sidebar, the project page reflects it immediately. No external state library needed for this scope.

**Alternatives considered**:

- Props/lifting state to App: Gets messy quickly with sidebar + pages both needing data
- Zustand/Redux: Overkill for a single entity with simple CRUD

### 3. Custom "Add" button inside SideNavMenu

**Choice**: Render a styled button with the `Add` icon as the first child inside the `SideNavMenu`, above the project list items.

**Rationale**: Carbon's `SideNavMenuItem` doesn't natively support action buttons, but we can insert a custom element as the first child of `SideNavMenu`. This keeps the "+" action visually grouped with the project list. Clicking it calls `create_project_temporary` and navigates to the new project.

### 4. Route structure: `/projects/:id`

**Choice**: Add a parameterized route `/projects/:id` for individual project views. Keep `/projects` as the project list/overview page.

**Rationale**: Standard REST-style routing. The sidebar items link to `/projects/<uuid>`, and the main content area renders the project detail. This naturally supports deep-linking and browser history.

### 5. Projects loaded eagerly on mount

**Choice**: Load the project list when the `ProjectProvider` mounts (app startup) via `list_projects`.

**Rationale**: The project list is small and always visible in the sidebar. Eager loading avoids loading spinners on sidebar expand. After mutations (create/delete), re-fetch the full list for simplicity rather than optimistic local updates.

## Risks / Trade-offs

- **SideNavMenu styling constraints** → The "Add" button inside the menu may need custom CSS to look distinct from navigation items. Mitigation: Use Carbon's spacing tokens and keep styling minimal.
- **Project list grows large** → If a user has 100+ projects, the sidebar list becomes unwieldy. Mitigation: Acceptable for MVP; future work can add search/filter or virtual scrolling.
- **Re-fetching full list after each mutation** → Slightly wasteful for single-item changes. Mitigation: The list is small and `list_projects` is a simple DB query — performance impact is negligible.
