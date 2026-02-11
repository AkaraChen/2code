# API Reference

## Overview

2code uses Tauri's IPC (Inter-Process Communication) system for frontend-backend communication. All API calls are type-safe and follow a command-based pattern.

## IPC Communication Pattern

```typescript
// Frontend: Invoke a command
const result = await invoke<ReturnType>("command_name", { arg1, arg2 });

// Backend: Handle the command
#[tauri::command]
pub fn command_name(arg1: Type, arg2: Type) -> AppResult<ReturnType> {
    // Implementation
}
```

## Project Commands

### `list_projects`
Returns all projects from the database.

**Frontend:**
```typescript
projectsApi.list() -> Promise<Project[]>
```

**Backend:**
```rust
#[tauri::command]
pub fn list_projects(state: State<'_, DbPool>) -> AppResult<Vec<Project>>
```

**Returns:** `Project[]`
- `id: string` - UUID
- `name: string` - Project name
- `folder: string` - Absolute path to project directory
- `created_at: string` - ISO timestamp

---

### `create_project_temporary`
Creates a new project in a temporary directory with `git init`.

**Frontend:**
```typescript
projectsApi.createTemporary(name?: string | null) -> Promise<Project>
```

**Backend:**
```rust
#[tauri::command]
pub fn create_project_temporary(
    name: Option<String>,
    state: State<'_, DbPool>,
) -> AppResult<Project>
```

**Behavior:**
1. Generates UUID and folder name (pinyin transliteration for CJK)
2. Creates directory in temp folder
3. Runs `git init`
4. Inserts record into database

---

### `create_project_from_folder`
Imports an existing folder as a project.

**Frontend:**
```typescript
projectsApi.createFromFolder(name: string, folder: string) -> Promise<Project>
```

**Backend:**
```rust
#[tauri::command]
pub fn create_project_from_folder(
    name: String,
    folder: String,
    state: State<'_, DbPool>,
) -> AppResult<Project>
```

**Validation:** Verifies folder exists before creating

---

### `get_project`
Retrieves a single project by ID.

**Frontend:**
```typescript
// Via useProject hook
useProject(id: string) -> Project | undefined
```

**Backend:**
```rust
#[tauri::command]
pub fn get_project(id: String, state: State<'_, DbPool>) -> AppResult<Project>
```

---

### `update_project`
Updates project metadata.

**Frontend:**
```typescript
projectsApi.update(id: string, name: string) -> Promise<Project>
```

**Backend:**
```rust
#[tauri::command]
pub fn update_project(
    id: String,
    name: Option<String>,
    folder: Option<String>,
    state: State<'_, DbPool>,
) -> AppResult<Project>
```

---

### `delete_project`
Deletes a project (database only, not folder).

**Frontend:**
```typescript
projectsApi.delete(id: string) -> Promise<void>
```

**Backend:**
```rust
#[tauri::command]
pub fn delete_project(id: String, state: State<'_, DbPool>) -> AppResult<()>
```

## PTY Commands

### `create_pty_session`
Creates a new PTY session for a project.

**Frontend:**
```typescript
ptyApi.createSession(
  projectId: string,
  title: string,
  shell: string,
  cwd: string,
  rows: number,
  cols: number
) -> Promise<string>  // Returns sessionId
```

**Backend:**
```rust
#[tauri::command]
pub fn create_pty_session(
    app: AppHandle,
    sessions: State<'_, PtySessionMap>,
    project_id: String,
    title: String,
    shell: String,
    cwd: String,
    rows: u16,
    cols: u16,
) -> AppResult<String>
```

**Side Effects:**
1. Spawns shell process via `portable-pty`
2. Inserts session record into database
3. Starts background reader thread
4. Emits `pty-output-{id}` events for output

---

### `write_to_pty`
Sends input to a PTY session.

**Frontend:**
```typescript
ptyApi.write(sessionId: string, data: string) -> Promise<void>
```

**Backend:**
```rust
#[tauri::command]
pub fn write_to_pty(
    sessions: State<'_, PtySessionMap>,
    session_id: String,
    data: String,
) -> AppResult<()>
```

---

### `resize_pty`
Resizes the PTY terminal dimensions.

**Frontend:**
```typescript
ptyApi.resize(sessionId: string, rows: number, cols: number) -> Promise<void>
```

**Backend:**
```rust
#[tauri::command]
pub fn resize_pty(
    sessions: State<'_, PtySessionMap>,
    session_id: String,
    rows: u16,
    cols: u16,
) -> AppResult<()>
```

**Triggered by:** XTerm.js `onResize` event

---

### `close_pty_session`
Closes a PTY session.

**Frontend:**
```typescript
ptyApi.close(sessionId: string) -> Promise<void>
```

**Backend:**
```rust
#[tauri::command]
pub fn close_pty_session(
    app: AppHandle,
    sessions: State<'_, PtySessionMap>,
    session_id: String,
) -> AppResult<()>
```

**Side Effects:**
1. Kills child shell process
2. Removes session from HashMap
3. Marks session as closed in database

---

### `list_active_sessions`
Lists all PTY sessions for a project.

**Frontend:**
```typescript
ptyApi.listActiveSessions(projectId: string) -> Promise<PtySessionRecord[]>
```

**Backend:**
```rust
#[tauri::command]
pub fn list_active_sessions(
    project_id: String,
    state: State<'_, DbPool>,
) -> AppResult<Vec<PtySessionRecord>>
```

---

### `get_pty_session_history`
Retrieves scrollback history for a session.

**Frontend:**
```typescript
ptyApi.getHistory(sessionId: string) -> Promise<number[]>  // UTF-8 bytes
```

**Backend:**
```rust
#[tauri::command]
pub fn get_pty_session_history(
    session_id: String,
    state: State<'_, DbPool>,
) -> AppResult<Vec<u8>>
```

**Note:** Returns concatenated chunks from `pty_output_chunks` table

---

### `delete_pty_session_record`
Deletes a session record from the database.

**Frontend:**
```typescript
ptyApi.deleteRecord(sessionId: string) -> Promise<void>
```

**Backend:**
```rust
#[tauri::command]
pub fn delete_pty_session_record(
    session_id: String,
    state: State<'_, DbPool>,
) -> AppResult<()>
```

## Font Commands

### `list_system_fonts`
Returns a list of available system fonts for terminal selection.

**Frontend:**
```typescript
// Via font API
listSystemFonts() -> Promise<string[]>
```

**Backend:**
```rust
#[tauri::command]
pub fn list_system_fonts() -> AppResult<Vec<String>>
```

**Implementation:** Uses `core-text` on macOS to enumerate font families.

## Event-Driven Communication

PTY output uses Tauri's event system instead of request/response:

```typescript
// Frontend: Listen for PTY output
const unlisten = await listen<string>(`pty-output-${sessionId}`, (event) => {
  term.write(event.payload);
});

// Backend: Emit output (in reader thread)
app.emit(&format!("pty-output-{}", session_id), data)?;
```

**Events:**
- `pty-output-{sessionId}`: Terminal output stream
- `pty-exit-{sessionId}`: Process termination signal

## Error Handling

All commands return `AppResult<T>` which serializes errors to strings for the frontend:

```rust
pub type AppResult<T> = Result<T, AppError>;

#[derive(Error, Debug)]
pub enum AppError {
    #[error("IO error: {0}")]
    IoError(#[from] std::io::Error),
    #[error("Lock error: failed to acquire lock")]
    LockError,
    #[error("PTY error: {0}")]
    PtyError(String),
    #[error("Database error: {0}")]
    DbError(String),
    #[error("Not found: {0}")]
    NotFound(String),
}
```

Frontend error handling:
```typescript
// TanStack Query handles errors
const mutation = useMutation({
  mutationFn: projectsApi.delete,
  onError: (error) => {
    toast.error(error.message);
  },
});
```
