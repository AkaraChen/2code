mod error;
mod handler;
mod infra;
mod model;
mod repo;
mod schema;
mod service;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
	// Initialize tracing subscriber with console output + channel layer
	let (channel_layer, layer_handle) = infra::logger::ChannelLayer::new();
	{
		use tracing_subscriber::layer::SubscriberExt;
		use tracing_subscriber::util::SubscriberInitExt;
		tracing_subscriber::registry()
			.with(
				tracing_subscriber::fmt::layer()
					.with_target(true)
					.with_level(true),
			)
			.with(channel_layer)
			.init();
	}

	let sessions = infra::pty::create_session_map();
	let sessions_for_exit = sessions.clone();
	let shutdown_flag = infra::watcher::create_shutdown_flag();
	let shutdown_for_exit = shutdown_flag.clone();

	let app = tauri::Builder::default()
		.plugin(tauri_plugin_opener::init())
		.plugin(tauri_plugin_dialog::init())
		.plugin(tauri_plugin_notification::init())
		.manage(sessions)
		.manage(shutdown_flag)
		.manage(layer_handle)
		.setup(|app| {
			use tauri::Manager;
			let app_data_dir = app
				.path()
				.app_data_dir()
				.expect("failed to resolve app data dir");
			let pool = infra::db::init_db(&app_data_dir)
				.expect("failed to initialize database");

			// Mark any orphaned sessions (from previous unclean shutdown) as closed
			service::pty::mark_all_closed(&pool);

			app.manage(pool);
			Ok(())
		})
		.invoke_handler(tauri::generate_handler![
			handler::pty::create_pty_session,
			handler::pty::write_to_pty,
			handler::pty::resize_pty,
			handler::pty::close_pty_session,
			handler::pty::list_project_sessions,
			handler::pty::get_pty_session_history,
			handler::pty::delete_pty_session_record,
			handler::project::create_project_temporary,
			handler::project::create_project_from_folder,
			handler::project::list_projects,
			handler::project::update_project,
			handler::project::delete_project,
			handler::project::get_git_branch,
			handler::project::get_git_diff,
			handler::project::get_git_log,
			handler::project::get_commit_diff,
			handler::font::list_system_fonts,
			handler::sound::list_system_sounds,
			handler::sound::play_system_sound,
			handler::profile::create_profile,
			handler::profile::delete_profile,
			handler::watcher::watch_projects,
			handler::debug::start_debug_log,
			handler::debug::stop_debug_log,
		])
		.build(tauri::generate_context!())
		.expect("error while building tauri application");

	app.run(move |app_handle, event| {
		use tauri::Manager;
		if let tauri::RunEvent::Exit = event {
			// Signal watcher thread to stop
			shutdown_for_exit.store(true, std::sync::atomic::Ordering::Relaxed);

			// Mark all open sessions as closed in DB
			if let Some(db) = app_handle.try_state::<infra::db::DbPool>() {
				service::pty::mark_all_closed(&db);
			}

			infra::pty::close_all_sessions(&sessions_for_exit);
		}
	});
}
