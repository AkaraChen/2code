pub use infra::shell_detect::AvailableShell;

#[tauri::command]
pub async fn list_available_shells() -> Vec<AvailableShell> {
	tauri::async_runtime::spawn_blocking(
		infra::shell_detect::load_available_shells,
	)
	.await
	.unwrap_or_default()
}
