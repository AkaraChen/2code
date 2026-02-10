## 1. Install Tauri dialog plugin

- [x] 1.1 Add `tauri-plugin-dialog` crate to `src-tauri/Cargo.toml` dependencies
- [x] 1.2 Install `@tauri-apps/plugin-dialog` npm package via `bun add`
- [x] 1.3 Register the dialog plugin in `src-tauri/src/lib.rs` (`.plugin(tauri_plugin_dialog::init())`)
- [x] 1.4 Add `"dialog:allow-open"` to `src-tauri/capabilities/default.json` permissions

## 2. Extend ProjectContext createProject

- [x] 2.1 Change `createProject` signature in `ProjectContext.tsx` to accept `opts?: { name?: string; folder?: string }`
- [x] 2.2 Route to `create_project_from_folder` when `folder` is provided, otherwise `create_project_temporary` with optional `name`
- [x] 2.3 Update `ProjectContextValue` interface to reflect the new signature

## 3. Create the dialog component

- [x] 3.1 Create `src/components/CreateProjectDialog.tsx` with Carbon `ComposedModal`, `ModalHeader`, `ModalBody`, `ModalFooter`
- [x] 3.2 Add `TextInput` for project name with placeholder text
- [x] 3.3 Add "Choose Folder" button that calls `open({ directory: true })` from `@tauri-apps/plugin-dialog`
- [x] 3.4 Display the selected folder path in the dialog when a folder is chosen
- [x] 3.5 Implement auto-fill: when a folder is selected and name is empty, set name to folder basename
- [x] 3.6 Implement "Create" button: call `createProject` with form state, close dialog, navigate to the new project

## 4. Wire up the sidebar

- [x] 4.1 Add `useState` for dialog open state in `AppSidebar.tsx`
- [x] 4.2 Change "New Project" `onClick` to open the dialog instead of calling `createProject` directly
- [x] 4.3 Render `CreateProjectDialog` in `AppSidebar` with `open` and `onClose` props

## 5. Add i18n messages

- [x] 5.1 Add paraglide message keys for dialog strings (title, name placeholder, choose folder button, create button)
