## Context

The app currently creates projects via a single sidebar click that immediately invokes `create_project_temporary` — no user input, no folder selection. Both backend commands (`create_project_temporary` with `name: Option<String>`, and `create_project_from_folder` with `name` + `folder`) already exist and are registered in the invoke handler. The frontend never calls `create_project_from_folder` and always passes no arguments to `create_project_temporary`.

The UI uses Carbon Design System (React) and the app runs on Tauri 2. No dialog plugin is currently installed.

## Goals / Non-Goals

**Goals:**
- Let users name their project and optionally select an existing folder at creation time
- Use the OS-native folder picker via the Tauri dialog plugin
- Keep the "quick create" path: if the user provides nothing, the existing temp-folder flow still works
- Auto-fill the project name from the selected folder's basename when the name field is empty

**Non-Goals:**
- Project templates or scaffolding
- Validating the folder contents (e.g., checking for `package.json`)
- Git initialization for user-selected folders (only temp projects get `git init`)
- Drag-and-drop folder support

## Decisions

### 1. Use Carbon `ComposedModal` for the dialog

**Choice**: Carbon's `ComposedModal` + `ModalHeader` + `ModalBody` + `ModalFooter`

**Rationale**: The app already uses Carbon for all UI. `ComposedModal` gives full control over body content (unlike the simpler `Modal` which is for confirmation-style dialogs). This keeps the UI consistent.

**Alternatives considered**:
- Carbon `Modal` — too opinionated for custom form content
- Custom dialog — unnecessary when Carbon provides a fitting component

### 2. Use `@tauri-apps/plugin-dialog` for folder picking

**Choice**: Install `tauri-plugin-dialog` (Rust crate) + `@tauri-apps/plugin-dialog` (npm package). Call `open({ directory: true })` from the frontend.

**Rationale**: This is Tauri 2's official way to open OS-native file/folder dialogs. It runs via IPC — the frontend calls the JS API, Tauri routes it to the native dialog on the Rust side. No custom Rust command needed.

**Alternatives considered**:
- Custom Rust command wrapping `rfd` — redundant since the Tauri plugin does exactly this
- HTML `<input type="file">` — doesn't support folder selection reliably and doesn't feel native

### 3. Dialog component lives in `src/components/CreateProjectDialog.tsx`

**Choice**: A standalone component that receives `open: boolean` and `onClose` props. The sidebar controls visibility state.

**Rationale**: Keeps the dialog self-contained and the sidebar simple. The dialog owns the form state (name, folder) and calls `createProject` from context on submit.

### 4. Extend `createProject` in `ProjectContext` to accept options

**Choice**: Change signature from `createProject()` to `createProject(opts?: { name?: string; folder?: string })`.

- If `folder` is provided → call `create_project_from_folder` with `name` and `folder`
- Otherwise → call `create_project_temporary` with `name` (which is already `Option<String>` on the Rust side)

**Rationale**: Minimal change — the context function becomes the single entry point for both creation paths. The dialog doesn't need to know about invoke details.

### 5. Folder picker interaction flow

1. User clicks "New Project" → dialog opens with empty name field and no folder selected
2. User clicks "Choose Folder" button → OS folder picker opens via `open({ directory: true })`
3. If a folder is selected and name is empty → auto-fill name with folder basename
4. User can still edit the name after auto-fill
5. User clicks "Create" → `createProject({ name, folder })` is called
6. If user clicks "Create" with no name and no folder → behaves like the current quick-create (Untitled + /tmp)

## Risks / Trade-offs

- **Tauri dialog plugin adds a new dependency** → Acceptable; it's an official Tauri plugin and folder picking is a core need. The plugin is lightweight.
- **`open()` returns `null` if user cancels the picker** → Handle by keeping the previous folder state (or no folder). No error needed.
- **Name field empty + no folder = "Untitled" project in /tmp** → This preserves backward compatibility. Acceptable for quick prototyping use case.
- **Permission configuration** → Tauri 2 requires explicit plugin permissions in capabilities. Must add `dialog:allow-open` to the default capability file.
