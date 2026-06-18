use tauri::ipc::Channel;
use tauri::State;

use infra::logger::ChannelLayerHandle;
use model::debug::{FrontendProfileEvent, LogEntry};
use model::error::AppError;

use crate::profiler::DevProfileState;

#[tauri::command]
pub fn start_debug_log(
	on_event: Channel<LogEntry>,
	handle: State<'_, ChannelLayerHandle>,
) {
	handle.attach(move |entry| on_event.send(entry).is_ok());
}

#[tauri::command]
pub fn stop_debug_log(handle: State<'_, ChannelLayerHandle>) {
	handle.detach();
}

#[tauri::command]
pub fn append_frontend_profile_events(
	events: Vec<FrontendProfileEvent>,
	profile: State<'_, DevProfileState>,
) -> Result<(), AppError> {
	profile.append_jsonl(&events)
}

#[tauri::command]
pub fn is_performance_profile_enabled(
	profile: State<'_, DevProfileState>,
) -> bool {
	profile.enabled()
}

#[tauri::command]
pub fn set_performance_profile_enabled(
	enabled: bool,
	profile: State<'_, DevProfileState>,
) -> Result<Option<String>, AppError> {
	Ok(profile
		.set_enabled(enabled)?
		.map(|path| path.to_string_lossy().to_string()))
}
