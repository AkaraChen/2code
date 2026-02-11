mod db;
mod error;
mod project;
mod pty;
mod schema;

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
	format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
	let sessions = pty::session::create_session_map();
	let sessions_for_exit = sessions.clone();

	let app = tauri::Builder::default()
		.plugin(tauri_plugin_opener::init())
		.plugin(tauri_plugin_dialog::init())
		.manage(sessions)
		.setup(|app| {
			use tauri::Manager;
			let app_data_dir = app
				.path()
				.app_data_dir()
				.expect("failed to resolve app data dir");
			let pool = db::init_db(&app_data_dir)
				.expect("failed to initialize database");

			// Mark any orphaned sessions (from previous unclean shutdown) as closed
			pty::commands::mark_all_open_sessions_closed(&pool);

			app.manage(pool);
			Ok(())
		})
		.invoke_handler(tauri::generate_handler![
			greet,
			pty::commands::create_pty_session,
			pty::commands::write_to_pty,
			pty::commands::resize_pty,
			pty::commands::close_pty_session,
			pty::commands::list_pty_sessions,
			pty::commands::list_active_sessions,
			pty::commands::get_pty_session_history,
			pty::commands::delete_pty_session_record,
			project::commands::create_project_temporary,
			project::commands::create_project_from_folder,
			project::commands::list_projects,
			project::commands::get_project,
			project::commands::update_project,
			project::commands::delete_project,
		])
		.build(tauri::generate_context!())
		.expect("error while building tauri application");

	app.run(move |app_handle, event| {
		use tauri::Manager;
		if let tauri::RunEvent::Exit = event {
			// Mark all open sessions as closed in DB
			if let Some(db) = app_handle.try_state::<db::DbPool>() {
				pty::commands::mark_all_open_sessions_closed(&db);
			}

			pty::session::close_all_sessions(&sessions_for_exit);
		}
	});
}
