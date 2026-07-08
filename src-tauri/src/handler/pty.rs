use tauri::{ipc::Channel, AppHandle, State};

use crate::bridge::{
	PtyOutputReceiver, PtyOutputReceivers, PtyOutputSink, PtyOutputSinks,
	RestoredHistories,
};
use infra::db::DbPool;
use infra::pty::{self as session, PtySessionMap};
use infra::pty_stream::{
	coalesce_chunks, create_output_channel, MAX_BATCH_BYTES,
};
use model::error::AppError;
use model::pty::{PtyConfig, PtySessionMeta, PtySessionRecord, RestoreResult};
use service::pty::{PtyFlushSenders, PtyLogDir};

pub struct RawBytesResponse(Vec<u8>);

impl RawBytesResponse {
	fn new(bytes: Vec<u8>) -> Self {
		Self(bytes)
	}
}

impl tauri::ipc::IpcResponse for RawBytesResponse {
	fn body(self) -> tauri::Result<tauri::ipc::InvokeResponseBody> {
		Ok(tauri::ipc::InvokeResponseBody::Raw(self.0))
	}
}

#[tauri::command]
#[tracing::instrument(skip_all)]
pub async fn create_pty_session(
	app: AppHandle,
	meta: PtySessionMeta,
	config: PtyConfig,
) -> Result<String, AppError> {
	let ctx = crate::bridge::build_pty_context(&app);
	super::run_blocking(move || {
		service::pty::create_session(&ctx, &meta, &config)
	})
	.await
}

#[tauri::command]
#[tracing::instrument(skip_all)]
pub fn write_to_pty(
	sessions: State<'_, PtySessionMap>,
	session_id: String,
	data: String,
) -> Result<(), AppError> {
	session::write_to_pty(&sessions, &session_id, data.as_bytes())
}

#[tauri::command]
#[tracing::instrument(skip_all)]
pub fn resize_pty(
	sessions: State<'_, PtySessionMap>,
	db: State<'_, DbPool>,
	session_id: String,
	rows: u16,
	cols: u16,
) -> Result<(), AppError> {
	session::resize_pty(&sessions, &session_id, rows, cols)?;

	let db = db.inner().clone();
	tauri::async_runtime::spawn_blocking(move || {
		if let Ok(mut conn) = db.lock() {
			repo::pty::update_dimensions(&mut conn, &session_id, cols, rows);
		}
	});

	Ok(())
}

#[tauri::command]
#[tracing::instrument(skip_all)]
pub async fn close_pty_session(
	db: State<'_, DbPool>,
	sessions: State<'_, PtySessionMap>,
	stash: State<'_, RestoredHistories>,
	session_id: String,
) -> Result<(), AppError> {
	if let Ok(mut histories) = stash.0.lock() {
		histories.remove(&session_id);
	}
	let db = db.inner().clone();
	let sessions = sessions.inner().clone();
	super::run_blocking(move || {
		service::pty::close_session(&db, &sessions, &session_id)
	})
	.await
}

#[tauri::command]
#[tracing::instrument(skip_all)]
pub async fn list_project_sessions(
	project_id: String,
	state: State<'_, DbPool>,
) -> Result<Vec<PtySessionRecord>, AppError> {
	let db = state.inner().clone();
	super::run_blocking(move || {
		let conn = &mut *db.lock().map_err(|_| AppError::LockError)?;
		service::pty::list_project_sessions(conn, &project_id)
	})
	.await
}

#[tauri::command]
#[tracing::instrument(skip_all)]
pub async fn get_pty_session_history(
	session_id: String,
	log_dir: State<'_, PtyLogDir>,
) -> Result<RawBytesResponse, AppError> {
	let dir = log_dir.0.clone();
	let bytes = super::run_blocking(move || {
		Ok(service::pty::get_history(&dir, &session_id))
	})
	.await?;
	Ok(RawBytesResponse::new(bytes))
}

#[tauri::command]
#[tracing::instrument(skip_all)]
pub async fn delete_pty_session_record(
	session_id: String,
	state: State<'_, DbPool>,
	log_dir: State<'_, PtyLogDir>,
	stash: State<'_, RestoredHistories>,
) -> Result<(), AppError> {
	if let Ok(mut histories) = stash.0.lock() {
		histories.remove(&session_id);
	}
	let db = state.inner().clone();
	let dir = log_dir.0.clone();
	super::run_blocking(move || {
		let conn = &mut *db.lock().map_err(|_| AppError::LockError)?;
		service::pty::delete_session(conn, &dir, &session_id)
	})
	.await
}

#[tauri::command]
#[tracing::instrument(skip_all)]
pub async fn restore_pty_session(
	app: AppHandle,
	old_session_id: String,
	meta: PtySessionMeta,
	config: PtyConfig,
	stash: State<'_, RestoredHistories>,
) -> Result<RestoreResult, AppError> {
	let ctx = crate::bridge::build_pty_context(&app);
	let restored = super::run_blocking(move || {
		service::pty::restore_session(&ctx, &old_session_id, &meta, &config)
	})
	.await?;

	let history_len = restored.history.len();
	if history_len > 0 {
		stash
			.0
			.lock()
			.map_err(|_| AppError::LockError)?
			.insert(restored.new_session_id.clone(), restored.history);
	}

	Ok(RestoreResult {
		new_session_id: restored.new_session_id,
		history_len,
	})
}

#[tauri::command]
#[tracing::instrument(skip_all)]
pub fn take_restored_history(
	session_id: String,
	stash: State<'_, RestoredHistories>,
) -> Result<RawBytesResponse, AppError> {
	let bytes = stash
		.0
		.lock()
		.map_err(|_| AppError::LockError)?
		.remove(&session_id)
		.unwrap_or_default();
	Ok(RawBytesResponse::new(bytes))
}

#[tauri::command]
#[tracing::instrument(skip_all)]
pub fn attach_pty_output(
	session_id: String,
	stream_id: String,
	sinks: State<'_, PtyOutputSinks>,
	receivers: State<'_, PtyOutputReceivers>,
) -> Result<(), AppError> {
	let (sender, receiver) = create_output_channel();
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
	receivers: State<'_, PtyOutputReceivers>,
) -> Result<(), AppError> {
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

	let mut batch = Vec::with_capacity(MAX_BATCH_BYTES);
	while let Some(chunk) = receiver.recv().await {
		coalesce_chunks(&mut batch, chunk, &mut receiver, MAX_BATCH_BYTES);
		if on_output.send(batch.as_slice()).is_err() {
			break;
		}
	}
	Ok(())
}

#[tauri::command]
#[tracing::instrument(skip_all)]
pub fn detach_pty_output(
	session_id: String,
	stream_id: String,
	sinks: State<'_, PtyOutputSinks>,
	receivers: State<'_, PtyOutputReceivers>,
) -> Result<(), AppError> {
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
pub async fn flush_pty_output(
	session_id: String,
	state: State<'_, PtyFlushSenders>,
) -> Result<(), AppError> {
	let senders = state.inner().clone();
	super::run_blocking(move || {
		service::pty::flush_output(&senders, &session_id)
	})
	.await
}

#[tauri::command]
#[tracing::instrument(skip_all)]
pub async fn clear_pty_output(
	session_id: String,
	log_dir: State<'_, PtyLogDir>,
	state: State<'_, PtyFlushSenders>,
) -> Result<(), AppError> {
	let dir = log_dir.0.clone();
	let senders = state.inner().clone();
	super::run_blocking(move || {
		service::pty::clear_output(&dir, &senders, &session_id)
	})
	.await
}
