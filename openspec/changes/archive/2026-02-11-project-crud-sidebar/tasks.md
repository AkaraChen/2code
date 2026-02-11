## 1. i18n Messages

- [x] 1.1 Add new message keys to `messages/en.json`: "newProject", "delete", "deleteProject", "confirmDeleteProject", "noProjectsYet", "folder", "createdAt"
- [x] 1.2 Add corresponding Chinese translations to `messages/zh.json`
- [x] 1.3 Run `paraglide-js compile` to regenerate `src/paraglide/` output

## 2. ProjectProvider Context

- [x] 2.1 Create `src/contexts/ProjectContext.tsx` with `Project` type definition (id, name, folder, created_at)
- [x] 2.2 Implement `ProjectProvider` with state for project list, `refresh()`, `createProject()`, and `deleteProject(id)` functions using Tauri `invoke()`
- [x] 2.3 Export `useProjects()` hook
- [x] 2.4 Wrap the component tree in `ProjectProvider` in `main.tsx` (inside Router, so context functions can use `useNavigate`)

## 3. Expandable Sidebar Menu

- [x] 3.1 Replace the flat "Projects" `SideNavLink` in `AppSidebar.tsx` with `SideNavMenu` using `FolderOpen` icon and localized title
- [x] 3.2 Add "New Project" `SideNavMenuItem` as first child with `Add` icon, wired to `createProject()` from context and navigation to `/projects/:id`
- [x] 3.3 Render project list as `SideNavMenuItem` children below the add button, each linking to `/projects/:id`
- [x] 3.4 Set `isActive` on the menu item matching the current route `/projects/:id`

## 4. Projects Overview Page

- [x] 4.1 Update `ProjectsPage.tsx` to consume `useProjects()` and display project list with name and link to `/projects/:id`
- [x] 4.2 Add empty state when no projects exist with a message encouraging project creation

## 5. Project Detail Page

- [x] 5.1 Create `src/pages/ProjectDetailPage.tsx` that reads `:id` from URL params and finds the project from context
- [x] 5.2 Display project name, folder path, and formatted creation date
- [x] 5.3 Add delete button with confirmation modal (Carbon `Modal` or inline confirm) that calls `deleteProject(id)` and navigates to `/projects`
- [x] 5.4 Handle invalid project ID (show error or redirect to `/projects`)

## 6. Routing

- [x] 6.1 Add `/projects/:id` route in `App.tsx` pointing to `ProjectDetailPage`

## 7. Verify

- [x] 7.1 Run `bun run build` to confirm TypeScript and Vite build pass
- [ ] 7.2 Manual smoke test: expand sidebar menu, create project, navigate to detail, delete project
