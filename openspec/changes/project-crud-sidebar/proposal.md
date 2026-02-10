## Why

The backend Project CRUD commands are fully implemented but have no frontend integration. Users cannot create, view, or manage projects from the UI. The sidebar's "Projects" item is a flat link to an empty page — it needs to become an expandable menu showing the project list with a create action, making projects accessible without navigating away from the current view.

## What Changes

- Convert the sidebar "Projects" link into an expandable menu that shows project children inline
- Add a "+" button at the top of the expanded project list to create new projects
- Display all projects as navigable items within the sidebar
- Wire up frontend to backend CRUD commands (`list_projects`, `create_project_temporary`, `delete_project`, etc.) via Tauri `invoke()`
- Add project detail/management route for individual projects
- Add i18n strings for new UI elements (en + zh)

## Capabilities

### New Capabilities

- `project-sidebar`: Expandable sidebar menu for projects — lists projects inline, provides create button, supports navigation to individual projects
- `project-management-ui`: Frontend pages/views for managing projects — create, view, delete operations using the existing backend commands

### Modified Capabilities

_None — existing `project-crud` and `project-storage` specs cover the backend which is unchanged._

## Impact

- **Frontend components**: `AppSidebar.tsx` changes from flat link to expandable menu; new project-related components
- **Routing**: New route(s) for individual project views (e.g., `/projects/:id`)
- **i18n**: New message keys in `messages/en.json` and `messages/zh.json`
- **Backend**: No changes — all commands already exist and are registered
- **Dependencies**: May use additional Carbon Design System components (`SideNavMenu`, `SideNavMenuItem`, `Modal`, etc.)
