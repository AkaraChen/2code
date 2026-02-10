## ADDED Requirements

### Requirement: Create temporary project
The `create_project_temporary` command SHALL generate a UUID, create a directory at `/tmp/<uuid>/`, run `git init` inside it, create a project record with a default name, and return the project.

#### Scenario: Successful temporary project creation
- **WHEN** `create_project_temporary` is invoked with an optional `name`
- **THEN** the system generates a UUID, creates `/tmp/<uuid>/`, runs `git init` in that directory, inserts a project record with the UUID as id, the provided name (or `"Untitled"` if omitted) as name, and `/tmp/<uuid>` as folder, and returns the full `Project`

#### Scenario: git init fails
- **WHEN** `git init` fails in the created directory (e.g., git not installed)
- **THEN** the command returns an error string and no project record is persisted

### Requirement: Create project from existing folder
The `create_project_from_folder` command SHALL accept a `name` and `folder` path, validate the folder exists on disk, and create a project record.

#### Scenario: Folder exists
- **WHEN** `create_project_from_folder` is invoked with a `name` and a `folder` path that exists on disk
- **THEN** the system inserts a project record with a generated UUID, the given name and folder, and returns the full `Project`

#### Scenario: Folder does not exist
- **WHEN** `create_project_from_folder` is invoked with a `folder` path that does not exist
- **THEN** the command returns an error string and no project record is persisted

### Requirement: List all projects
The `list_projects` command SHALL return all project records from the database.

#### Scenario: Projects exist
- **WHEN** `list_projects` is invoked and there are N projects in the database
- **THEN** the system returns a list of N `Project` objects

#### Scenario: No projects exist
- **WHEN** `list_projects` is invoked and the projects table is empty
- **THEN** the system returns an empty list

### Requirement: Get project by ID
The `get_project` command SHALL return a single project by its ID.

#### Scenario: Project found
- **WHEN** `get_project` is invoked with an `id` that exists in the database
- **THEN** the system returns the matching `Project`

#### Scenario: Project not found
- **WHEN** `get_project` is invoked with an `id` that does not exist
- **THEN** the command returns an error string indicating the project was not found

### Requirement: Update project
The `update_project` command SHALL accept an `id` and optional `name` and `folder` fields, update the matching record, and return the updated project.

#### Scenario: Update name only
- **WHEN** `update_project` is invoked with an `id` and a new `name` (no `folder`)
- **THEN** the project's name is updated and the updated `Project` is returned

#### Scenario: Update folder only
- **WHEN** `update_project` is invoked with an `id` and a new `folder` (no `name`)
- **THEN** the project's folder is updated and the updated `Project` is returned

#### Scenario: Project not found
- **WHEN** `update_project` is invoked with an `id` that does not exist
- **THEN** the command returns an error string indicating the project was not found

### Requirement: Delete project
The `delete_project` command SHALL remove the project record from the database. It SHALL NOT delete the folder on disk.

#### Scenario: Successful deletion
- **WHEN** `delete_project` is invoked with an `id` that exists
- **THEN** the project record is removed from the database and the command succeeds

#### Scenario: Project not found
- **WHEN** `delete_project` is invoked with an `id` that does not exist
- **THEN** the command returns an error string indicating the project was not found

### Requirement: All commands registered in invoke handler
All project commands (`create_project_temporary`, `create_project_from_folder`, `list_projects`, `get_project`, `update_project`, `delete_project`) SHALL be registered in the `tauri::generate_handler!` macro in `lib.rs`.

#### Scenario: Frontend can invoke all project commands
- **WHEN** the frontend calls `invoke("create_project_temporary")`, `invoke("create_project_from_folder", ...)`, `invoke("list_projects")`, `invoke("get_project", ...)`, `invoke("update_project", ...)`, or `invoke("delete_project", ...)`
- **THEN** each call routes to the corresponding Rust command handler
