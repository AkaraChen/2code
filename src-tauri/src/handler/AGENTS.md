# AGENTS.md — src-tauri/src/handler

## OVERVIEW
Tauri IPC entry points. Thin delegation layer — no business logic here.

## FILES
| File | Commands |
|------|----------|
| `debug.rs` | `start_debug_log`, `stop_debug_log` |
| `font.rs` | `list_system_fonts` (macOS only) |
| `mod.rs` | `tauri::generate_handler![]` registration |
| `profile.rs` | `create_profile`, `delete_profile` |
| `project.rs` | `create_project_from_folder`, `list_projects`, `update_project`, `delete_project`, `get_project_config`, `save_project_config` |
| `pty.rs` | `create_pty_session`, `write_to_pty`, `resize_pty`, `close_pty_session`, `list_project_sessions`, `get_pty_session_history`, `delete_pty_session_record`, `flush_pty_output`, `restore_pty_session` |
| `sound.rs` | `list_system_sounds`, `play_system_sound` (macOS only) |
| `watcher.rs` | `watch_projects` |

## PATTERN
Each handler follows this shape:
```rust
#[tauri::command]
pub async fn my_command(
    state: State<'_, Arc<Mutex<SqliteConnection>>>,
    // other params...
) -> Result<ReturnType, AppError> {
    let mut conn = state.lock().await; // or .lock().unwrap()
    service::my_module::do_thing(&mut conn, params).await
}
```

**After adding a command**: register it in `mod.rs` `generate_handler![]` and run `cargo tauri-typegen generate`.

## ANTI-PATTERNS
- DB queries or git operations directly in handler — use service layer
- Holding `conn` lock longer than one service call
