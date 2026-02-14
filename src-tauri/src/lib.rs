mod bridge;
mod handler;
mod helper;

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
	let agent_manager = std::sync::Arc::new(
		agent::AgentManagerWrapper::new(
			dirs::cache_dir()
				.unwrap_or_else(|| std::path::PathBuf::from("/tmp"))
				.join("2code")
				.join("agents"),
		)
		.expect("failed to initialize agent manager"),
	);
	let agent_sessions = agent::create_agent_session_map();
	let agent_sessions_for_exit = agent_sessions.clone();
	let sessions_for_exit = sessions.clone();
	let read_threads = infra::pty::create_thread_tracker();
	let read_threads_for_exit = read_threads.clone();
	let flush_senders = service::pty::create_flush_senders();
	let shutdown_flag = infra::watcher::create_shutdown_flag();
	let shutdown_for_exit = shutdown_flag.clone();

	let app = tauri::Builder::default()
		.plugin(tauri_plugin_opener::init())
		.plugin(tauri_plugin_dialog::init())
		.plugin(tauri_plugin_notification::init())
		.plugin(tauri_plugin_shell::init())
		.plugin(tauri_plugin_store::Builder::default().build())
		.manage(sessions)
		.manage(read_threads)
		.manage(flush_senders)
		.manage(shutdown_flag)
		.manage(layer_handle)
		.manage(agent_manager)
		.manage(agent_sessions)
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
			tracing::info!(target: "pty", "startup: marked orphaned sessions closed");

			app.manage(pool);

			// Start helper HTTP server (for CLI sidecar communication)
			let helper = helper::start(app.handle());
			app.manage(helper);

			Ok(())
		})
		.invoke_handler(tauri::generate_handler![
			handler::pty::create_pty_session,
			handler::pty::write_to_pty,
			handler::pty::resize_pty,
			handler::pty::close_pty_session,
			handler::pty::list_project_sessions,
			handler::pty::delete_pty_session_record,
			handler::pty::flush_pty_output,
			handler::pty::restore_pty_session,
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
			handler::agent::list_agent_status,
			handler::agent::install_agent,
			handler::agent::detect_credentials,
			handler::agent::spawn_agent_session,
			handler::agent::send_agent_prompt,
			handler::agent::close_agent_session,
		])
		.build(tauri::generate_context!())
		.expect("error while building tauri application");

	app.run(move |app_handle, event| {
		use std::sync::atomic::Ordering;
		use tauri::Manager;

		match event {
			tauri::RunEvent::Exit => {
				shutdown_for_exit.store(true, Ordering::Relaxed);

				// Shut down all agent sessions
				let agent_sessions = agent_sessions_for_exit.clone();
				tokio::task::block_in_place(|| {
					tokio::runtime::Handle::current().block_on(async {
						let mut map = agent_sessions.lock().await;
						for (id, session) in map.drain() {
							tracing::info!(session_id = %id, "exit: shutting down agent session");
							session.shutdown().await;
						}
					});
				});

				infra::pty::close_all_sessions(&sessions_for_exit);
				tracing::info!(target: "pty", "exit: joining read threads...");
				infra::pty::join_all_read_threads(&read_threads_for_exit);
				tracing::info!(target: "pty", "exit: all read threads joined");

				if let Some(db) = app_handle.try_state::<infra::db::DbPool>() {
					service::pty::mark_all_closed(&db);
				}
			}

			_ => {}
		}
	});
}
