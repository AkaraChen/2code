use tauri::ipc::Channel;
use tauri::State;

use crate::infra::db::DbPool;
use crate::infra::watcher::WatcherShutdownFlag;
use crate::model::watcher::WatchEvent;

#[tauri::command]
pub fn watch_projects(
	on_event: Channel<WatchEvent>,
	state: State<'_, DbPool>,
	shutdown: State<'_, WatcherShutdownFlag>,
) {
	let db = state.inner().clone();
	let flag = shutdown.inner().clone();
	crate::service::watcher::start(on_event, db, flag);
}
