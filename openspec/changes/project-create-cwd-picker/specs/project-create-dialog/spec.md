## ADDED Requirements

### Requirement: Create Project dialog opens on New Project click

The "New Project" sidebar action SHALL open a modal dialog instead of immediately creating a project.

#### Scenario: User clicks New Project

- **WHEN** the user clicks the "New Project" menu item in the sidebar
- **THEN** a Create Project modal dialog opens with an empty name field and no folder selected

### Requirement: Project name text input

The dialog SHALL contain a text input field for the project name.

#### Scenario: User enters a project name

- **WHEN** the dialog is open and the user types into the name field
- **THEN** the typed value is captured as the project name

#### Scenario: Name field is empty on open

- **WHEN** the dialog first opens
- **THEN** the name field is empty with placeholder text

### Requirement: CWD folder picker button

The dialog SHALL contain a button that opens the OS-native folder picker via the Tauri dialog plugin (`@tauri-apps/plugin-dialog`).

#### Scenario: User clicks the folder picker button

- **WHEN** the user clicks the "Choose Folder" button
- **THEN** the system opens the OS-native folder selection dialog via `open({ directory: true })`

#### Scenario: User selects a folder

- **WHEN** the OS folder picker returns a selected folder path
- **THEN** the selected folder path is displayed in the dialog

#### Scenario: User cancels the folder picker

- **WHEN** the OS folder picker is cancelled (returns `null`)
- **THEN** the dialog state remains unchanged (no folder selected, or previously selected folder preserved)

### Requirement: Auto-fill name from folder basename

When a folder is selected and the name field is empty, the dialog SHALL auto-fill the name with the folder's basename.

#### Scenario: Folder selected with empty name

- **WHEN** the user selects a folder via the picker and the name field is currently empty
- **THEN** the name field is auto-filled with the basename of the selected folder path

#### Scenario: Folder selected with non-empty name

- **WHEN** the user selects a folder via the picker and the name field already contains text
- **THEN** the name field is NOT overwritten

#### Scenario: User edits auto-filled name

- **WHEN** the name was auto-filled from a folder basename
- **THEN** the user can freely edit the auto-filled name

### Requirement: Create button dispatches correct backend command

The dialog's "Create" button SHALL call `createProject` with the appropriate parameters based on form state.

#### Scenario: Create with folder selected

- **WHEN** the user clicks "Create" and a folder path is selected
- **THEN** the system calls `createProject` with the name (or folder basename if name is empty) and the folder path, routing to `create_project_from_folder`

#### Scenario: Create with no folder selected

- **WHEN** the user clicks "Create" and no folder is selected
- **THEN** the system calls `createProject` with the name only (if provided), routing to `create_project_temporary`

#### Scenario: Create with no name and no folder

- **WHEN** the user clicks "Create" with both fields empty
- **THEN** the system calls `createProject` with no arguments, creating an "Untitled" project in `/tmp`

### Requirement: Dialog closes after successful creation

The dialog SHALL close and navigate to the new project after successful creation.

#### Scenario: Successful project creation

- **WHEN** `createProject` resolves successfully
- **THEN** the dialog closes, the project list refreshes, and the app navigates to the new project's detail page

### Requirement: Dialog can be dismissed

The dialog SHALL be dismissible via a close button or clicking outside.

#### Scenario: User closes the dialog

- **WHEN** the user clicks the close button or clicks outside the modal
- **THEN** the dialog closes without creating a project and form state is reset
