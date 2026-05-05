use model::error::AppError;

pub mod debug;
pub mod filesystem;
pub mod font;
pub mod profile;
pub mod project;
pub mod pty;
pub mod quick_task;
pub mod sound;
pub mod topbar;
pub mod watcher;

pub async fn run_blocking<T, F>(job: F) -> Result<T, AppError>
where
	T: Send + 'static,
	F: FnOnce() -> Result<T, AppError> + Send + 'static,
{
	tauri::async_runtime::spawn_blocking(job)
		.await
		.map_err(|e| {
			AppError::IoError(std::io::Error::other(format!(
				"Blocking task failed: {e}",
			)))
		})?
}
