## MODIFIED Requirements

### Requirement: Create temporary project

The `create_project_temporary` command SHALL generate a UUID, create a directory at `/tmp/<uuid>/`, run `git init` inside it, create a project record with a default name, and return the project.

#### Scenario: Successful temporary project creation

- **WHEN** `create_project_temporary` is invoked with an optional `name`
- **THEN** the system generates a UUID, creates `/tmp/<uuid>/`, runs `git init` in that directory, inserts a project record with the UUID as id, the provided name (or `"Untitled"` if omitted) as name, and `/tmp/<uuid>` as folder, and returns the full `Project`

#### Scenario: git init fails

- **WHEN** `git init` fails in the created directory (e.g., git not installed)
- **THEN** the command returns an error string and no project record is persisted

#### Scenario: Frontend passes a name

- **WHEN** `create_project_temporary` is invoked from the frontend with `{ name: "My Project" }`
- **THEN** the created project record uses `"My Project"` as the name instead of `"Untitled"`

### Requirement: Frontend createProject routes to correct backend command

The `createProject` function in `ProjectContext` SHALL accept optional `name` and `folder` parameters and route to the correct backend command.

#### Scenario: Called with folder

- **WHEN** `createProject({ name: "foo", folder: "/path/to/dir" })` is called
- **THEN** the function invokes `create_project_from_folder` with `name: "foo"` and `folder: "/path/to/dir"`

#### Scenario: Called with name only

- **WHEN** `createProject({ name: "foo" })` is called (no folder)
- **THEN** the function invokes `create_project_temporary` with `name: "foo"`

#### Scenario: Called with no arguments

- **WHEN** `createProject()` is called with no arguments
- **THEN** the function invokes `create_project_temporary` with no name, preserving the existing "Untitled" + `/tmp` behavior
