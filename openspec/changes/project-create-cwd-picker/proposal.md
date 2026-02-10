## Why

Currently, clicking "New Project" in the sidebar immediately creates a temporary project under `/tmp/<uuid>/` with the name "Untitled". There is no way for the user to choose a name or point the project at an existing folder on disk. Users who want to work with an existing codebase must create a project first and then manually update it — or rely on a backend command (`create_project_from_folder`) that the UI never exposes. A simple creation dialog fixes this by giving the user control over the project name and working directory upfront.

## What Changes

- Add a **Create Project dialog** (modal) that opens when the user clicks "New Project" in the sidebar.
- The dialog contains a **name text input** and a **CWD button** that opens the system native folder picker (Tauri dialog plugin).
- Selecting a folder is **optional**. If no folder is selected, the existing `create_project_temporary` flow is used (create `/tmp/<uuid>/`, `git init`).
- If a folder is selected and the name field is still empty, the folder's basename is auto-filled as the project name.
- If a folder is selected, the project is created via `create_project_from_folder` instead of `create_project_temporary`.
- Integrate the `@tauri-apps/plugin-dialog` (Tauri 2 dialog plugin) for the native folder picker.

## Capabilities

### New Capabilities
- `project-create-dialog`: The modal UI component for creating a project, including the name input, CWD folder picker button, and the conditional creation logic (temporary vs. from-folder).

### Modified Capabilities
- `project-crud`: The `createProject` function in `ProjectContext` currently calls `create_project_temporary` unconditionally. It needs to accept optional `name` and `folder` parameters and route to the correct backend command accordingly.

## Impact

- **Frontend**: `AppSidebar.tsx` (trigger dialog instead of direct create), `ProjectContext.tsx` (extend `createProject` signature), new dialog component.
- **Dependencies**: Add `@tauri-apps/plugin-dialog` (npm + Cargo + Tauri plugin registration).
- **Backend**: No new Rust commands needed — `create_project_temporary` and `create_project_from_folder` already exist. However, `create_project_temporary` currently doesn't accept a `name` parameter from the frontend; it may need a minor adjustment to pass the user-supplied name through.
- **Tauri config**: Register the dialog plugin in `tauri.conf.json` permissions and `lib.rs` plugin setup.
