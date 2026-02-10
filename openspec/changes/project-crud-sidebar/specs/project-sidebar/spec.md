## ADDED Requirements

### Requirement: Expandable projects menu in sidebar
The sidebar SHALL replace the flat "Projects" `SideNavLink` with a `SideNavMenu` component that expands to show project children. The menu SHALL use the `FolderOpen` icon and display the localized "Projects" label as its title.

#### Scenario: Menu renders in collapsed state
- **WHEN** the app loads
- **THEN** the sidebar displays a "Projects" menu item with a chevron indicator, and the project children are hidden

#### Scenario: Menu expands on click
- **WHEN** the user clicks the "Projects" menu header
- **THEN** the menu expands to reveal the add button and project list items

#### Scenario: Menu collapses on second click
- **WHEN** the user clicks the "Projects" menu header while it is expanded
- **THEN** the menu collapses and hides the children

### Requirement: Add project button as first menu child
The expanded projects menu SHALL display an "Add" action as its first child item. This item SHALL use the `Add` icon and a localized label (e.g., "New Project" / "新建项目").

#### Scenario: Add button visible when expanded
- **WHEN** the projects menu is expanded
- **THEN** the first item in the list is the "New Project" action with an `Add` icon

#### Scenario: Clicking add creates a temporary project
- **WHEN** the user clicks the "New Project" action
- **THEN** the system invokes `create_project_temporary` via Tauri IPC, the project list refreshes to include the new project, and the app navigates to `/projects/<new-project-id>`

### Requirement: Project list items in sidebar
The expanded projects menu SHALL display all projects from the database as `SideNavMenuItem` items below the add button. Each item SHALL show the project name and navigate to the project's detail route on click.

#### Scenario: Projects loaded and displayed
- **WHEN** the projects menu is expanded and the database contains projects
- **THEN** each project appears as a menu item showing the project name

#### Scenario: No projects exist
- **WHEN** the projects menu is expanded and the database contains no projects
- **THEN** only the "New Project" add button is shown, with no project items below it

#### Scenario: Clicking a project navigates to its detail view
- **WHEN** the user clicks a project item in the sidebar
- **THEN** the app navigates to `/projects/<project-id>` and the clicked item is marked as active

#### Scenario: Active project highlighted
- **WHEN** the current route matches `/projects/<id>` for a listed project
- **THEN** that project's sidebar item SHALL have `isActive` set to true

### Requirement: Projects loaded on app startup
The project list SHALL be fetched from the backend via `list_projects` when the `ProjectProvider` context mounts. The sidebar SHALL render project items from this shared state.

#### Scenario: Successful load
- **WHEN** the app starts and `list_projects` returns N projects
- **THEN** the sidebar project list contains N items

#### Scenario: Backend returns error
- **WHEN** `list_projects` fails on startup
- **THEN** the sidebar project list is empty and no error UI blocks the app

### Requirement: Project list stays in sync after mutations
After any project mutation (create or delete), the project list in the sidebar SHALL be refreshed by re-invoking `list_projects`.

#### Scenario: After creating a project
- **WHEN** a project is created via the add button
- **THEN** the sidebar project list re-fetches and includes the new project

#### Scenario: After deleting a project
- **WHEN** a project is deleted from the management UI
- **THEN** the sidebar project list re-fetches and the deleted project is no longer shown

### Requirement: i18n support for sidebar elements
All user-facing text in the sidebar project menu SHALL use Paraglide message functions. New message keys SHALL be added to both `en.json` and `zh.json`.

#### Scenario: English locale
- **WHEN** the locale is `en`
- **THEN** the add button displays "New Project"

#### Scenario: Chinese locale
- **WHEN** the locale is `zh`
- **THEN** the add button displays "新建项目"
