## ADDED Requirements

### Requirement: Create a profile

The `create_profile` command SHALL accept a `project_id` and `branch_name`, resolve the project's folder from the database, generate a UUID v4 as the profile ID, compute the worktree path as `~/.2code/workspace/{profile_id}/`, run `git worktree add <worktree_path> <branch_name>` with cwd set to the project folder, insert a profile record into the database, execute setup scripts from `2code.json` (if present), and return the created profile.

#### Scenario: Successful profile creation

- **WHEN** `create_profile` is invoked with a valid `project_id` and `branch_name` "feature/login"
- **THEN** the system generates a UUID, creates a worktree at `~/.2code/workspace/{profile_id}/` via `git worktree add`, inserts a profile record with the id, project_id, branch_name, and worktree_path, executes any setup scripts from `2code.json` in the worktree directory, and returns the full `Profile`

#### Scenario: Project not found

- **WHEN** `create_profile` is invoked with a `project_id` that does not exist in the database
- **THEN** the command SHALL return a NotFound error and no worktree or profile record is created

#### Scenario: Git worktree add fails

- **WHEN** `git worktree add` fails (e.g., branch already checked out in another worktree, or invalid branch name)
- **THEN** the command SHALL return a GitError with the stderr output and no profile record is inserted

#### Scenario: Setup script fails

- **WHEN** the worktree is created successfully but a setup script from `2code.json` fails
- **THEN** the profile record SHALL still be inserted and returned; the script failure SHALL be logged as a warning but SHALL NOT cause the command to fail

#### Scenario: Home directory resolution

- **WHEN** `create_profile` is invoked
- **THEN** the system SHALL resolve `~` using `dirs::home_dir()` to compute the worktree base path `~/.2code/workspace/`

### Requirement: List profiles for a project

The `list_profiles` command SHALL accept a `project_id` and return all profile records associated with that project.

#### Scenario: Project has profiles

- **WHEN** `list_profiles` is invoked with a `project_id` that has N profiles
- **THEN** the system returns a list of N `Profile` objects

#### Scenario: Project has no profiles

- **WHEN** `list_profiles` is invoked with a `project_id` that has no profiles
- **THEN** the system returns an empty list

#### Scenario: Project does not exist

- **WHEN** `list_profiles` is invoked with a `project_id` that does not exist
- **THEN** the system returns an empty list (no error — consistent with listing an empty collection)

### Requirement: Get profile by ID

The `get_profile` command SHALL accept an `id` and return the matching profile record.

#### Scenario: Profile found

- **WHEN** `get_profile` is invoked with an `id` that exists in the database
- **THEN** the system returns the matching `Profile`

#### Scenario: Profile not found

- **WHEN** `get_profile` is invoked with an `id` that does not exist
- **THEN** the command SHALL return a NotFound error

### Requirement: Update profile

The `update_profile` command SHALL accept an `id` and an optional `branch_name`. Only the `branch_name` field is updatable. This does NOT change the worktree on disk — it only updates the database record (e.g., for correcting a label).

#### Scenario: Update branch_name

- **WHEN** `update_profile` is invoked with a valid `id` and a new `branch_name`
- **THEN** the profile's branch_name is updated in the database and the updated `Profile` is returned

#### Scenario: No fields provided

- **WHEN** `update_profile` is invoked with a valid `id` but no optional fields
- **THEN** the current profile is returned unchanged

#### Scenario: Profile not found

- **WHEN** `update_profile` is invoked with an `id` that does not exist
- **THEN** the command SHALL return a NotFound error

### Requirement: Delete a profile

The `delete_profile` command SHALL accept an `id`, execute teardown scripts from `2code.json` (if present) in the worktree directory, run `git worktree remove` to clean up the worktree on disk, and remove the profile record from the database.

#### Scenario: Successful deletion

- **WHEN** `delete_profile` is invoked with an `id` that exists
- **THEN** the system executes teardown scripts in the worktree directory, runs `git worktree remove <worktree_path> --force` with cwd set to the project folder, removes the profile record from the database, and the command succeeds

#### Scenario: Profile not found

- **WHEN** `delete_profile` is invoked with an `id` that does not exist
- **THEN** the command SHALL return a NotFound error

#### Scenario: Teardown script fails

- **WHEN** teardown scripts fail during deletion
- **THEN** the system SHALL log a warning and continue with worktree removal and database cleanup

#### Scenario: Git worktree remove fails

- **WHEN** `git worktree remove` fails (e.g., worktree directory already manually deleted)
- **THEN** the system SHALL log a warning and still remove the profile record from the database

### Requirement: Database schema

The system SHALL have a `profiles` table with the following columns: `id` (TEXT PRIMARY KEY), `project_id` (TEXT NOT NULL, foreign key to projects with ON DELETE CASCADE), `branch_name` (TEXT NOT NULL), `worktree_path` (TEXT NOT NULL), `created_at` (TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP).

#### Scenario: Table created via migration

- **WHEN** the application starts and runs pending migrations
- **THEN** the `profiles` table SHALL exist with all specified columns and constraints

#### Scenario: Cascade delete

- **WHEN** a project is deleted from the `projects` table
- **THEN** all associated profile records SHALL be automatically deleted via ON DELETE CASCADE

### Requirement: All profile commands registered in invoke handler

All profile commands (`create_profile`, `list_profiles`, `get_profile`, `update_profile`, `delete_profile`) SHALL be registered in the `tauri::generate_handler!` macro in `lib.rs`.

#### Scenario: Frontend can invoke all profile commands

- **WHEN** the frontend calls `invoke("create_profile", ...)`, `invoke("list_profiles", ...)`, `invoke("get_profile", ...)`, `invoke("update_profile", ...)`, or `invoke("delete_profile", ...)`
- **THEN** each call routes to the corresponding Rust command handler
