use std::sync::Arc;

use tauri::ipc::Channel;
use tauri::State;

use infra::pty::{PtyReadThreads, PtySessionMap};
use model::error::AppError;
use model::quick_task::QuickTaskPtyEvent;

use crate::bridge::TauriQuickTaskSender;

#[tauri::command]
pub async fn start_quick_task_pty(
	on_event: Channel<QuickTaskPtyEvent>,
	run_id: String,
	shell: Option<String>,
	cwd: String,
	command: String,
	rows: u16,
	cols: u16,
	sessions: State<'_, PtySessionMap>,
	read_threads: State<'_, PtyReadThreads>,
) -> Result<(), AppError> {
	let sessions = sessions.inner().clone();
	let read_threads = read_threads.inner().clone();
	let shell = shell.unwrap_or_else(|| "/bin/zsh".to_string());
	let sender = Arc::new(TauriQuickTaskSender(on_event));

	super::run_blocking(move || {
		service::quick_task::start_session(
			sessions,
			read_threads,
			sender,
			run_id,
			shell,
			cwd,
			command,
			rows,
			cols,
		)
	})
	.await
}

#[tauri::command]
pub fn write_quick_task_pty(
	run_id: String,
	data: String,
	sessions: State<'_, PtySessionMap>,
) -> Result<(), AppError> {
	service::quick_task::write_to_session(sessions.inner(), &run_id, &data)
}

#[tauri::command]
pub fn resize_quick_task_pty(
	run_id: String,
	rows: u16,
	cols: u16,
	sessions: State<'_, PtySessionMap>,
) -> Result<(), AppError> {
	service::quick_task::resize_session(sessions.inner(), &run_id, rows, cols)
}

#[tauri::command]
pub fn stop_quick_task_pty(
	run_id: String,
	sessions: State<'_, PtySessionMap>,
) -> Result<(), AppError> {
	service::quick_task::stop_session(sessions.inner(), &run_id)
}
