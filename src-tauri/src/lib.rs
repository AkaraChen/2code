mod bridge;
mod handler;
mod helper;
mod profiler;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
	// Fix PATH when launched from GUI (macOS Finder / Dock) so shell
	// profiles (e.g. .zshrc) are reflected in the app environment.
	let _ = fix_path_env::fix();

	let (channel_layer, layer_handle) = infra::logger::ChannelLayer::new();

	let sessions = infra::pty::create_session_map();
	let sessions_for_exit = sessions.clone();
	let read_threads = infra::pty::create_thread_tracker();
	let read_threads_for_exit = read_threads.clone();
	let flush_senders = service::pty::create_flush_senders();
	let output_sinks = bridge::create_output_sinks();
	let shutdown_flag = infra::watcher::create_shutdown_flag();
	let shutdown_for_exit = shutdown_flag.clone();

	let app = tauri::Builder::default()
		.plugin(tauri_plugin_process::init())
		.plugin(tauri_plugin_updater::Builder::new().build())
		.plugin(tauri_plugin_opener::init())
		.plugin(tauri_plugin_dialog::init())
		.plugin(tauri_plugin_notification::init())
		.plugin(tauri_plugin_shell::init())
		.plugin(tauri_plugin_store::Builder::default().build())
		.plugin(tauri_plugin_clipboard_manager::init())
		.manage(sessions)
		.manage(read_threads)
		.manage(flush_senders)
		.manage(output_sinks)
		.manage(shutdown_flag)
		.manage(layer_handle)
		.manage(handler::updater::PendingUpdate::default())
		.setup(move |app| {
			use tauri::Manager;

			// On Windows the native title bar would render as an opaque bar
			// above the app content. Drop system decorations so the frontend
			// can render a custom title bar that matches the macOS overlay
			// look; the WindowControls component supplies min/max/close.
			#[cfg(target_os = "windows")]
			if let Some(window) = app.get_webview_window("main") {
				let _ = window.set_decorations(false);
			}

			let app_data_dir = app
				.path()
				.app_data_dir()
				.expect("failed to resolve app data dir");

			app.manage(profiler::init(&app_data_dir, channel_layer));

			let pool = infra::db::init_db(&app_data_dir)
				.expect("failed to initialize database");

			// Mark any orphaned sessions (from previous unclean shutdown) as closed
			service::pty::mark_all_closed(&pool);
			tracing::info!(target: "pty", "startup: marked orphaned sessions closed");

			// Reap output log files with no matching session row (crash
			// leftovers + profile/project cascade-delete orphans).
			let log_dir = infra::pty_log::logs_dir(&app_data_dir);
			service::pty::gc_orphan_logs(&pool, &log_dir);
			app.manage(service::pty::PtyLogDir(log_dir));

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
			handler::pty::attach_pty_output,
			handler::pty::detach_pty_output,
			handler::project::create_project_from_folder,
			handler::project::list_projects,
			handler::project::update_project,
			handler::project::delete_project,
			handler::project::create_project_group,
			handler::project::list_project_groups,
			handler::project::assign_project_to_group,
			handler::project::update_project_sidebar_layout,
			handler::project::get_git_branch,
			handler::project::get_git_diff,
			handler::project::get_git_diff_stats,
			handler::project::get_git_log,
			handler::project::get_commit_diff,
			handler::project::get_git_binary_preview,
			handler::project::commit_git_changes,
			handler::project::discard_git_file_changes,
			handler::project::get_git_ahead_count,
			handler::project::git_push,
			handler::project::get_git_pull_request_status,
			handler::project::get_project_config,
			handler::project::save_project_config,
			handler::project::get_project_github_avatar,
			handler::filesystem::list_file_tree_child_paths,
			handler::filesystem::rename_file_tree_path,
			handler::filesystem::move_file_tree_paths,
			handler::filesystem::delete_file_tree_paths,
			handler::filesystem::create_file_tree_path,
			handler::filesystem::reveal_path_in_file_manager,
			handler::filesystem::open_path_in_default_app,
			handler::filesystem::read_file_content,
			handler::filesystem::write_file_content,
			handler::filesystem::get_file_preview,
			handler::filesystem::search_file,
			handler::filesystem::get_file_tree_git_status,
			handler::filesystem::resolve_terminal_file_path,
			handler::font::list_system_fonts,
			handler::shell::list_available_shells,
			handler::sound::list_system_sounds,
			handler::sound::play_system_sound,
			handler::topbar::list_supported_topbar_apps,
			handler::topbar::open_topbar_app,
			handler::profile::create_profile,
			handler::profile::delete_profile,
			handler::profile::get_profile_delete_check,
			handler::profile::update_profile_notes,
			handler::watcher::watch_projects,
			handler::updater::check_update,
			handler::updater::install_update,
			handler::browser::list_installed_browsers,
			handler::browser::open_url_in_browser,
			handler::debug::start_debug_log,
			handler::debug::stop_debug_log,
			handler::debug::append_frontend_profile_events,
			handler::debug::is_performance_profile_enabled,
			handler::debug::set_performance_profile_enabled,
		])
		.build(tauri::generate_context!())
		.expect("error while building tauri application");

	app.run(move |app_handle, event| {
		use std::sync::atomic::Ordering;
		use tauri::Manager;

		if let tauri::RunEvent::Exit = event {
			shutdown_for_exit.store(true, Ordering::Relaxed);
			infra::pty::close_all_sessions(&sessions_for_exit);
			tracing::info!(target: "pty", "exit: joining read threads...");
			infra::pty::join_all_read_threads(&read_threads_for_exit);
			tracing::info!(target: "pty", "exit: all read threads joined");

			if let Some(db) = app_handle.try_state::<infra::db::DbPool>() {
				service::pty::mark_all_closed(&db);
			}
			if let Some(profile) =
				app_handle.try_state::<profiler::DevProfileState>()
			{
				profile.finish();
			}
		}
	});
}
