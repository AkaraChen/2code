use tauri::ipc::Channel;
use tauri::State;

use infra::db::DbPool;
use infra::watcher::WatcherShutdownFlag;
use model::watcher::WatchEvent;

use crate::bridge::TauriWatchSender;

#[tauri::command]
pub fn watch_projects(
	on_event: Channel<WatchEvent>,
	state: State<'_, DbPool>,
	shutdown: State<'_, WatcherShutdownFlag>,
) {
	let db = state.inner().clone();
	let flag = shutdown.inner().clone();
	service::watcher::start(Box::new(TauriWatchSender(on_event)), db, flag);
}
