use tauri::ipc::Channel;
use tauri::State;

use crate::infra::logger::ChannelLayerHandle;
use crate::model::debug::LogEntry;

#[tauri::command]
pub fn start_debug_log(
	on_event: Channel<LogEntry>,
	handle: State<'_, ChannelLayerHandle>,
) {
	handle.attach(on_event);
}

#[tauri::command]
pub fn stop_debug_log(handle: State<'_, ChannelLayerHandle>) {
	handle.detach();
}
