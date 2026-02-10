mod pty;

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(pty::session::new_registry())
        .invoke_handler(tauri::generate_handler![
            greet,
            pty::commands::create_pty,
            pty::commands::get_pty,
            pty::commands::list_pty,
            pty::commands::resize_pty,
            pty::commands::delete_pty,
            pty::commands::resume_stream,
            pty::commands::write_to_pty,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
