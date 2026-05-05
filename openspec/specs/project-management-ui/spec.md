## ADDED Requirements

### Requirement: Project detail route

The app SHALL define a route at `/projects/:id` that renders a project detail view. The route SHALL receive the project ID from the URL parameter and display the corresponding project data.

#### Scenario: Valid project ID in URL

- **WHEN** the user navigates to `/projects/<id>` and a project with that ID exists
- **THEN** the project detail view renders showing the project's name and folder path

#### Scenario: Invalid project ID in URL

- **WHEN** the user navigates to `/projects/<id>` and no project with that ID exists
- **THEN** the app displays an error message or redirects to `/projects`

### Requirement: Project detail view displays project information

The project detail view SHALL display the project name, folder path, and creation date. It SHALL provide a delete action.

#### Scenario: Project info displayed

- **WHEN** the project detail view loads for a valid project
- **THEN** the view shows the project name as a heading, the folder path, and the formatted creation date

#### Scenario: Delete button present

- **WHEN** the project detail view is rendered
- **THEN** a delete button is visible to the user

### Requirement: Delete project from detail view

The project detail view SHALL provide a delete action that invokes `delete_project` via Tauri IPC, refreshes the shared project list, and navigates away from the deleted project.

#### Scenario: Successful deletion

- **WHEN** the user clicks delete on a project and confirms
- **THEN** the system invokes `delete_project` with the project ID, the project list refreshes, and the app navigates to `/projects`

#### Scenario: Delete with confirmation

- **WHEN** the user clicks the delete button
- **THEN** a confirmation prompt appears before the deletion proceeds

### Requirement: ProjectProvider context

The app SHALL wrap the component tree in a `ProjectProvider` that manages the project list state. The context SHALL expose the project list, a `refresh` function, a `createProject` function, and a `deleteProject` function.

#### Scenario: Context provides project list

- **WHEN** any component calls `useProjects()` within the provider
- **THEN** it receives the current list of projects

#### Scenario: Context provides create function

- **WHEN** a component calls `createProject({ folder: "/path/to/dir" })` from the context
- **THEN** the function invokes `create_project_from_folder`, refreshes the list, and returns the new project

#### Scenario: Context provides delete function

- **WHEN** a component calls `deleteProject(id)` from the context
- **THEN** the function invokes `delete_project` with the given ID and refreshes the list

### Requirement: Projects overview page

The `/projects` route (without `:id`) SHALL display a list or grid of all projects with their names and a link/button to navigate to each project's detail view.

#### Scenario: Projects exist

- **WHEN** the user navigates to `/projects` and projects exist
- **THEN** the page displays a list of project cards/items, each showing the project name and linking to `/projects/<id>`

#### Scenario: No projects exist

- **WHEN** the user navigates to `/projects` and no projects exist
- **THEN** the page displays an empty state message encouraging the user to create a project

### Requirement: i18n support for management UI

All user-facing text in the project management pages SHALL use Paraglide message functions. New message keys SHALL be added to both `en.json` and `zh.json`.

#### Scenario: Required message keys

- **WHEN** the project management UI renders
- **THEN** it uses localized strings for: "New Project", "Delete", "Delete Project", "Confirm delete message", "No projects yet", "Folder", "Created at"
