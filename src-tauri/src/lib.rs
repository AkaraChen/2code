mod db;
mod error;
mod project;
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
        .plugin(tauri_plugin_dialog::init())
        .manage(pty::session::create_session_map())
        .setup(|app| {
            use tauri::Manager;
            let app_data_dir = app.path().app_data_dir().expect("failed to resolve app data dir");
            let pool = db::init_db(&app_data_dir).expect("failed to initialize database");
            app.manage(pool);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            greet,
            pty::commands::create_pty_session,
            pty::commands::write_to_pty,
            pty::commands::resize_pty,
            pty::commands::close_pty_session,
            project::commands::create_project_temporary,
            project::commands::create_project_from_folder,
            project::commands::list_projects,
            project::commands::get_project,
            project::commands::update_project,
            project::commands::delete_project,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
