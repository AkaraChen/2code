use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

use model::error::AppError;

const SETTINGS_WINDOW_LABEL: &str = "settings";
const SETTINGS_URL: &str = "index.html";
const UPDATE_URL: &str = "index.html?tab=about";
const SELECT_UPDATE_TAB_SCRIPT: &str = r#"
window.history.replaceState(null, "", "?tab=about");
window.dispatchEvent(new Event("popstate"));
"#;

#[tauri::command]
pub fn open_settings_window(app: AppHandle) -> Result<(), AppError> {
	open_settings_window_at(app, SETTINGS_URL, None)
}

#[tauri::command]
pub fn open_update_page(app: AppHandle) -> Result<(), AppError> {
	open_settings_window_at(app, UPDATE_URL, Some(SELECT_UPDATE_TAB_SCRIPT))
}

fn open_settings_window_at(
	app: AppHandle,
	url: &'static str,
	existing_window_script: Option<&str>,
) -> Result<(), AppError> {
	if let Some(window) = app.get_webview_window(SETTINGS_WINDOW_LABEL) {
		let _ = window.show();
		let _ = window.set_focus();
		if let Some(script) = existing_window_script {
			window.eval(script).map_err(|e| {
				AppError::IoError(std::io::Error::other(format!(
					"failed to select update page: {e}"
				)))
			})?;
		}
		return Ok(());
	}

	// Load the app root; the frontend branches on the window label to
	// render the settings UI, so no SPA route fallback is needed.
	WebviewWindowBuilder::new(
		&app,
		SETTINGS_WINDOW_LABEL,
		WebviewUrl::App(url.into()),
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
