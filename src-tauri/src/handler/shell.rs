pub use infra::shell_detect::AvailableShell;

#[tauri::command]
pub async fn list_available_shells() -> Vec<AvailableShell> {
	match tauri::async_runtime::spawn_blocking(
		infra::shell_detect::load_available_shells,
	)
	.await
	{
		Ok(shells) => shells,
		Err(err) => {
			tracing::error!(
				error = %err,
				"list_available_shells: blocking task failed; returning empty list"
			);
			Vec::new()
		}
	}
}
