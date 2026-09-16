use tauri::ipc::Channel;
use tauri::State;

use infra::db::DbPool;
use infra::watcher::WatcherShutdownFlag;
use model::watcher::WatchEvent;
use service::runtime::RuntimeHandle;

use crate::bridge::TauriWatchSender;

#[tauri::command]
#[tracing::instrument(skip_all)]
pub fn watch_projects(
	on_event: Channel<WatchEvent>,
	state: State<'_, DbPool>,
	runtime: State<'_, RuntimeHandle>,
	shutdown: State<'_, WatcherShutdownFlag>,
) {
	let db = state.inner().clone();
	let runtime = runtime.inner().clone();
	let flag = shutdown.inner().clone();
	service::watcher::start(
		Box::new(TauriWatchSender(on_event)),
		db,
		runtime,
		flag,
	);
}
