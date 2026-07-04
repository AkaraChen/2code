use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

use model::error::AppError;

const SETTINGS_WINDOW_LABEL: &str = "settings";

#[tauri::command]
pub fn open_settings_window(app: AppHandle) -> Result<(), AppError> {
	if let Some(window) = app.get_webview_window(SETTINGS_WINDOW_LABEL) {
		let _ = window.show();
		let _ = window.set_focus();
		return Ok(());
	}

	// Load the app root; the frontend branches on the window label to
	// render the settings UI, so no SPA route fallback is needed.
	WebviewWindowBuilder::new(
		&app,
		SETTINGS_WINDOW_LABEL,
		WebviewUrl::App("index.html".into()),
	)
	.title("Settings")
	.inner_size(880.0, 640.0)
	.min_inner_size(600.0, 420.0)
	.center()
	.build()
	.map_err(|e| {
		AppError::IoError(std::io::Error::other(format!(
			"failed to open settings window: {e}"
		)))
	})?;

	Ok(())
}
