mod bridge;
mod handler;
mod helper;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
	// Fix PATH when launched from GUI (macOS Finder / Dock) so shell
	// profiles (e.g. .zshrc) are reflected in the app environment.
	let _ = fix_path_env::fix();

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
	let read_threads = infra::pty::create_thread_tracker();
	let read_threads_for_exit = read_threads.clone();
	let flush_senders = service::pty::create_flush_senders();
	let shutdown_flag = infra::watcher::create_shutdown_flag();
	let shutdown_for_exit = shutdown_flag.clone();
	let git_watchers = handler::project::create_git_watchers();
	let git_cancel_tokens = handler::project::create_git_cancel_tokens();

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
		.manage(git_watchers)
		.manage(git_cancel_tokens)
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
			handler::pty::get_pty_session_history,
			handler::pty::delete_pty_session_record,
			handler::pty::flush_pty_output,
			handler::pty::clear_pty_output,
			handler::pty::restore_pty_session,
			handler::project::create_project_temporary,
			handler::project::create_project_from_folder,
			handler::project::list_projects,
			handler::project::update_project,
			handler::project::delete_project,
			handler::project::get_git_branch,
			handler::project::get_git_diff,
			handler::project::get_git_diff_stats,
			handler::project::get_git_index_status,
			handler::project::get_git_file_patch,
			handler::project::stage_git_files,
			handler::project::unstage_git_files,
			handler::project::stage_git_hunk,
			handler::project::unstage_git_hunk,
			handler::project::stage_git_lines,
			handler::project::unstage_git_lines,
			handler::project::get_git_log,
			handler::project::get_commit_diff,
			handler::project::get_git_binary_preview,
			handler::project::commit_git_changes,
			handler::project::discard_git_file_changes,
			handler::project::get_git_ahead_count,
			handler::project::git_push,
			handler::project::get_git_identity,
			handler::project::set_git_identity,
			handler::project::unset_git_identity,
			handler::project::start_git_watcher,
			handler::project::stop_git_watcher,
			handler::project::git_push_cancellable,
			handler::project::cancel_git_operation,
			handler::project::get_project_config,
			handler::project::save_project_config,
			handler::filesystem::list_file_tree_paths,
			handler::filesystem::rename_file_tree_path,
			handler::filesystem::move_file_tree_paths,
			handler::filesystem::delete_file_tree_path,
			handler::filesystem::create_file_tree_folder,
			handler::filesystem::create_file_tree_file,
			handler::filesystem::read_file_content,
			handler::filesystem::write_file_content,
			handler::filesystem::search_file,
			handler::filesystem::get_file_tree_git_status,
			handler::font::list_system_fonts,
			handler::sound::list_system_sounds,
			handler::sound::play_system_sound,
			handler::topbar::list_supported_topbar_apps,
			handler::topbar::open_topbar_app,
			handler::profile::create_profile,
			handler::profile::delete_profile,
			handler::watcher::watch_projects,
			handler::debug::start_debug_log,
			handler::debug::stop_debug_log,
		])
		.build(tauri::generate_context!())
		.expect("error while building tauri application");

	app.run(move |app_handle, event| {
		use std::sync::atomic::Ordering;
		use tauri::Manager;

		match event {
			tauri::RunEvent::Exit => {
				shutdown_for_exit.store(true, Ordering::Relaxed);
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
