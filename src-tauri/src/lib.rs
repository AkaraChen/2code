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
	let notification_tasks: agent::NotificationTaskMap = std::sync::Arc::new(
		tokio::sync::Mutex::new(std::collections::HashMap::new()),
	);
	let read_threads = infra::pty::create_thread_tracker();
	let flush_senders = service::pty::create_flush_senders();
	let shutdown_flag = infra::watcher::create_shutdown_flag();

	// Clone handles needed by the exit handler
	let exit_agent_sessions = agent_sessions.clone();
	let exit_notification_tasks = notification_tasks.clone();
	let exit_sessions = sessions.clone();
	let exit_read_threads = read_threads.clone();
	let exit_shutdown = shutdown_flag.clone();

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
		.manage(notification_tasks)
		.setup(|app| {
			use tauri::Manager;
			let app_data_dir = app
				.path()
				.app_data_dir()
				.expect("failed to resolve app data dir");
			println!("Using app data dir: {:?}", app_data_dir);
			let pool = infra::db::init_db(&app_data_dir)
				.expect("failed to initialize database");

			// Mark any orphaned sessions (from previous unclean shutdown) as closed
			service::pty::mark_all_closed(&pool);
			tracing::info!(target: "pty", "startup: marked orphaned sessions closed");

			// Mark any orphaned agent sessions as destroyed
			if let Ok(count) = service::agent::mark_all_destroyed(&pool) {
				tracing::info!(target: "agent", count, "startup: marked orphaned agent sessions destroyed");
			}

			app.manage(pool);

			// Start helper HTTP server (for CLI sidecar communication)
			let helper = helper::start(app.handle());
			app.manage(helper);

			// Restore PTY sessions from previous run
			{
				let pty_ctx = crate::bridge::build_pty_context(app.handle());
				let count = service::pty::restore_all_sessions(&pty_ctx);
				tracing::info!(target: "pty", count, "startup: restored PTY sessions");
			}

			// Agent sessions: only DB cleanup at startup.
			// Actual agent process spawning happens lazily when the frontend
			// calls reconnect_agent_session for each tab the user opens.
			tracing::info!(target: "agent", "startup: agent sessions ready for lazy reconnection");

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
			handler::pty::get_session_output,
			handler::project::create_project_temporary,
			handler::project::create_project_from_folder,
			handler::project::list_projects,
			handler::project::update_project,
			handler::project::delete_project,
			handler::project::get_git_branch,
			handler::project::get_github_pr_status,
			handler::project::get_git_diff,
			handler::project::get_git_log,
			handler::project::get_commit_diff,
			handler::project::get_project_config,
			handler::project::save_project_config,
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
			handler::agent::send_agent_prompt,
			handler::agent::get_agent_session_models,
			handler::agent::set_agent_session_model,
			handler::agent::get_agent_session_modes,
			handler::agent::set_agent_session_mode,
			handler::agent::close_agent_session,
			handler::agent::create_agent_session_persistent,
			handler::agent::reconnect_agent_session,
			handler::agent::list_project_agent_sessions,
			handler::agent::list_agent_session_events,
			handler::agent::delete_agent_session_record,
			handler::stats::get_homepage_stats,
			handler::snippet::create_snippet,
			handler::snippet::list_snippets,
			handler::snippet::update_snippet,
			handler::snippet::delete_snippet,
			handler::skill::list_skills,
			handler::skill::get_skill,
			handler::skill::delete_skill,
			handler::marketplace::fetch_agent_registry,
			handler::marketplace::list_marketplace_agents,
			handler::marketplace::add_marketplace_agent,
			handler::marketplace::remove_marketplace_agent,
		])
		.build(tauri::generate_context!())
		.expect("error while building tauri application");

	app.run(move |app_handle, event| {
		use std::sync::atomic::Ordering;
		use tauri::Manager;

		if let tauri::RunEvent::Exit = event {
			exit_shutdown.store(true, Ordering::Relaxed);

			// Abort all notification tasks and shut down all agent sessions
			let agent_sessions = exit_agent_sessions.clone();
			let notification_tasks = exit_notification_tasks.clone();
			tauri::async_runtime::block_on(async {
					for (id, task) in notification_tasks.lock().await.drain() {
						tracing::info!(session_id = %id, "exit: aborting notification task");
						task.abort();
					}
					for (id, session) in agent_sessions.lock().await.drain() {
						tracing::info!(session_id = %id, "exit: shutting down agent session");
						session.shutdown().await;
					}
				});

			infra::pty::close_all_sessions(&exit_sessions);
			tracing::info!(target: "pty", "exit: joining read threads...");
			infra::pty::join_all_read_threads(&exit_read_threads);
			tracing::info!(target: "pty", "exit: all read threads joined");

			if let Some(db) = app_handle.try_state::<infra::db::DbPool>() {
				service::pty::mark_all_closed(&db);

				// Mark all active agent sessions as destroyed
				if let Ok(count) = service::agent::mark_all_destroyed(&db) {
					tracing::info!(target: "agent", count, "exit: marked agent sessions destroyed");
				}
			}
		}
	});
}
