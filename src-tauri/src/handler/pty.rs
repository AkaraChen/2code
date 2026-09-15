use tauri::{ipc::Channel, State};
use tokio::sync::mpsc;

use crate::bridge::{
	PtyOutputReceiver, PtyOutputReceivers, PtyOutputSink, PtyOutputSinks,
};
use model::error::AppError;
use model::pty::{PtyConfig, PtySessionMeta, PtySessionRecord, RestoreResult};
use model::runtime::{
	HerdrTerminalFrame, RuntimeBackend, SessionAgentStatus,
	TerminalScrollDirection, TerminalScrollSource,
};
use service::runtime::{RuntimeHandle, TerminalRuntime};
use service::runtime_agent::pump_session_agent_status;

#[tauri::command]
#[tracing::instrument(skip_all)]
pub async fn create_pty_session(
	runtime: State<'_, RuntimeHandle>,
	meta: PtySessionMeta,
	config: PtyConfig,
) -> Result<String, AppError> {
	let runtime = runtime.inner().clone();
	super::run_blocking(move || {
		runtime.create_session(&meta, &config).map(|r| r.session_id)
	})
	.await
}

#[tauri::command]
#[tracing::instrument(skip_all)]
pub fn write_to_pty(
	runtime: State<'_, RuntimeHandle>,
	session_id: String,
	data: String,
) -> Result<(), AppError> {
	runtime.write(&session_id, data.as_bytes())
}

#[tauri::command]
#[tracing::instrument(skip_all)]
pub fn resize_pty(
	runtime: State<'_, RuntimeHandle>,
	session_id: String,
	rows: u16,
	cols: u16,
) -> Result<(), AppError> {
	runtime.resize(&session_id, rows, cols)
}

#[tauri::command]
#[tracing::instrument(skip_all)]
pub fn scroll_pty(
	runtime: State<'_, RuntimeHandle>,
	session_id: String,
	direction: TerminalScrollDirection,
	lines: u16,
	source: TerminalScrollSource,
) -> Result<(), AppError> {
	runtime.scroll(&session_id, direction, lines, source)
}

#[tauri::command]
#[tracing::instrument(skip_all)]
pub fn close_pty_session(
	runtime: State<'_, RuntimeHandle>,
	session_id: String,
) -> Result<(), AppError> {
	runtime.close_session(&session_id)
}

#[tauri::command]
#[tracing::instrument(skip_all)]
pub async fn list_project_sessions(
	project_id: String,
	runtime: State<'_, RuntimeHandle>,
) -> Result<Vec<PtySessionRecord>, AppError> {
	let runtime = runtime.inner().clone();
	super::run_blocking(move || runtime.list_project_sessions(&project_id))
		.await
}

#[tauri::command]
#[tracing::instrument(skip_all)]
pub async fn get_pty_session_history(
	session_id: String,
	runtime: State<'_, RuntimeHandle>,
) -> Result<Vec<u8>, AppError> {
	let runtime = runtime.inner().clone();
	super::run_blocking(move || runtime.history(&session_id)).await
}

#[tauri::command]
#[tracing::instrument(skip_all)]
pub async fn delete_pty_session_record(
	session_id: String,
	runtime: State<'_, RuntimeHandle>,
) -> Result<(), AppError> {
	let runtime = runtime.inner().clone();
	super::run_blocking(move || runtime.delete_session(&session_id)).await
}

#[tauri::command]
#[tracing::instrument(skip_all)]
pub async fn restore_pty_session(
	runtime: State<'_, RuntimeHandle>,
	old_session_id: String,
	meta: PtySessionMeta,
	config: PtyConfig,
) -> Result<RestoreResult, AppError> {
	let runtime = runtime.inner().clone();
	super::run_blocking(move || {
		runtime.restore_session(&old_session_id, &meta, &config)
	})
	.await
}

#[tauri::command]
#[tracing::instrument(skip_all)]
pub fn get_session_backend(
	session_id: String,
	runtime: State<'_, RuntimeHandle>,
) -> Result<RuntimeBackend, AppError> {
	runtime.backend_for(&session_id)
}

#[tauri::command]
#[tracing::instrument(skip_all)]
pub fn get_session_agent_status(
	session_id: String,
	runtime: State<'_, RuntimeHandle>,
) -> Result<Option<SessionAgentStatus>, AppError> {
	runtime.session_agent_status(&session_id)
}

#[tauri::command]
#[tracing::instrument(skip_all)]
pub async fn stream_session_agent_status(
	session_id: String,
	on_update: Channel<SessionAgentStatus>,
	runtime: State<'_, RuntimeHandle>,
) -> Result<(), AppError> {
	if runtime.backend_for(&session_id)? != RuntimeBackend::Herdr {
		return Err(AppError::PtyError("not a Herdr session".into()));
	}
	let runtime = runtime.inner().clone();
	super::run_blocking(move || {
		pump_session_agent_status(
			&session_id,
			|| runtime.session_agent_status(&session_id),
			|dto| on_update.send(dto).is_ok(),
		)
	})
	.await
}

#[tauri::command]
#[tracing::instrument(skip_all)]
pub fn attach_pty_output(
	session_id: String,
	stream_id: String,
	runtime: State<'_, RuntimeHandle>,
	sinks: State<'_, PtyOutputSinks>,
	receivers: State<'_, PtyOutputReceivers>,
) -> Result<(), AppError> {
	if runtime.backend_for(&session_id)? == RuntimeBackend::Herdr {
		return runtime.attach_output(&session_id, &stream_id);
	}
	let (sender, receiver) = mpsc::unbounded_channel();
	{
		let mut sinks = sinks.lock().map_err(|_| AppError::LockError)?;
		sinks.insert(
			session_id.clone(),
			PtyOutputSink {
				stream_id: stream_id.clone(),
				sender,
			},
		);
	}
	{
		let mut receivers =
			receivers.lock().map_err(|_| AppError::LockError)?;
		receivers.insert(
			session_id,
			PtyOutputReceiver {
				stream_id,
				receiver,
			},
		);
	}

	Ok(())
}

#[tauri::command]
#[tracing::instrument(skip_all)]
pub async fn stream_pty_output(
	session_id: String,
	stream_id: String,
	on_output: Channel<&[u8]>,
	runtime: State<'_, RuntimeHandle>,
	receivers: State<'_, PtyOutputReceivers>,
) -> Result<(), AppError> {
	if runtime.backend_for(&session_id)? == RuntimeBackend::Herdr {
		return Ok(());
	}
	let receiver = {
		let mut receivers =
			receivers.lock().map_err(|_| AppError::LockError)?;
		let Some(receiver) = receivers.get(&session_id) else {
			return Ok(());
		};
		if receiver.stream_id != stream_id {
			return Ok(());
		}
		receivers
			.remove(&session_id)
			.map(|receiver| receiver.receiver)
	};
	let Some(mut receiver) = receiver else {
		return Ok(());
	};

	while let Some(chunk) = receiver.recv().await {
		if on_output.send(chunk.as_slice()).is_err() {
			break;
		}
	}
	Ok(())
}

#[tauri::command]
#[tracing::instrument(skip_all)]
pub async fn stream_herdr_output(
	session_id: String,
	stream_id: String,
	on_output: Channel<HerdrTerminalFrame>,
	runtime: State<'_, RuntimeHandle>,
) -> Result<(), AppError> {
	if runtime.backend_for(&session_id)? != RuntimeBackend::Herdr {
		return Err(AppError::PtyError("not a Herdr session".into()));
	}
	let runtime = runtime.inner().clone();
	super::run_blocking(move || {
		loop {
			match runtime.recv_terminal_frame(&session_id, &stream_id) {
				Ok(frame) => {
					if on_output.send(frame).is_err() {
						break;
					}
				}
				Err(err) if herdr_stream_ended(&err) => break,
				Err(err) => return Err(err),
			}
		}
		Ok(())
	})
	.await
}

fn herdr_stream_ended(err: &AppError) -> bool {
	matches!(
		err,
		AppError::PtyError(message)
			if message.contains("not attached")
				|| message.contains("closed")
				|| message.contains("stale Herdr")
	)
}

#[tauri::command]
#[tracing::instrument(skip_all)]
pub fn detach_pty_output(
	session_id: String,
	stream_id: String,
	runtime: State<'_, RuntimeHandle>,
	sinks: State<'_, PtyOutputSinks>,
	receivers: State<'_, PtyOutputReceivers>,
) -> Result<(), AppError> {
	if runtime.backend_for(&session_id)? == RuntimeBackend::Herdr {
		return runtime.detach_output(&session_id, &stream_id);
	}
	let mut sinks = sinks.lock().map_err(|_| AppError::LockError)?;
	if sinks
		.get(&session_id)
		.is_some_and(|sink| sink.stream_id == stream_id)
	{
		sinks.remove(&session_id);
	}
	drop(sinks);

	let mut receivers = receivers.lock().map_err(|_| AppError::LockError)?;
	if receivers
		.get(&session_id)
		.is_some_and(|receiver| receiver.stream_id == stream_id)
	{
		receivers.remove(&session_id);
	}
	Ok(())
}

#[tauri::command]
#[tracing::instrument(skip_all)]
pub fn flush_pty_output(
	session_id: String,
	runtime: State<'_, RuntimeHandle>,
) -> Result<(), AppError> {
	runtime.flush(&session_id)
}

#[tauri::command]
#[tracing::instrument(skip_all)]
pub fn clear_pty_output(
	session_id: String,
	runtime: State<'_, RuntimeHandle>,
) -> Result<(), AppError> {
	runtime.clear(&session_id)
}
