# AGENTS.md — src-tauri/src/handler

## OVERVIEW
Tauri IPC entry points. Thin delegation layer — no business logic here.

## FILES
| File | Commands |
|------|----------|
| `debug.rs` | `start_debug_log`, `stop_debug_log` |
| `filesystem.rs` | File tree operations, file content read/write, previews, terminal file resolution |
| `font.rs` | `list_system_fonts` (macOS only) |
| `mod.rs` | `tauri::generate_handler![]` registration |
| `profile.rs` | `create_profile`, `delete_profile` |
| `project.rs` | `create_project_from_folder`, `list_projects`, `update_project`, `delete_project`, `get_project_config`, `save_project_config` |
| `terminal.rs` | `create_terminal_session`, `write_to_terminal`, `resize_terminal`, `scroll_terminal`, `close_terminal_session`, `list_project_sessions`, `get_session_backend`, `get_session_agent_status`, `stream_session_agent_status`, `attach_terminal_output`, `stream_herdr_output`, `detach_terminal_output`, `flush_terminal_output`, `clear_terminal_output` |
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
