#[cfg(target_os = "macos")]
use std::path::PathBuf;

use infra::no_window::command_without_windows_console;
use model::browser::BrowserApp;
use model::error::AppError;

#[derive(Clone, Copy, Debug)]
struct BrowserSpec {
	id: &'static str,
	name: &'static str,
	#[cfg(target_os = "macos")]
	bundle_name: &'static str,
}

const KNOWN_BROWSERS: [BrowserSpec; 9] = [
	BrowserSpec {
		id: "safari",
		name: "Safari",
		#[cfg(target_os = "macos")]
		bundle_name: "Safari.app",
	},
	BrowserSpec {
		id: "chrome",
		name: "Google Chrome",
		#[cfg(target_os = "macos")]
		bundle_name: "Google Chrome.app",
	},
	BrowserSpec {
		id: "chrome-canary",
		name: "Google Chrome Canary",
		#[cfg(target_os = "macos")]
		bundle_name: "Google Chrome Canary.app",
	},
	BrowserSpec {
		id: "edge",
		name: "Microsoft Edge",
		#[cfg(target_os = "macos")]
		bundle_name: "Microsoft Edge.app",
	},
	BrowserSpec {
		id: "firefox",
		name: "Firefox",
		#[cfg(target_os = "macos")]
		bundle_name: "Firefox.app",
	},
	BrowserSpec {
		id: "arc",
		name: "Arc",
		#[cfg(target_os = "macos")]
		bundle_name: "Arc.app",
	},
	BrowserSpec {
		id: "brave",
		name: "Brave Browser",
		#[cfg(target_os = "macos")]
		bundle_name: "Brave Browser.app",
	},
	BrowserSpec {
		id: "vivaldi",
		name: "Vivaldi",
		#[cfg(target_os = "macos")]
		bundle_name: "Vivaldi.app",
	},
	BrowserSpec {
		id: "orion",
		name: "Orion",
		#[cfg(target_os = "macos")]
		bundle_name: "Orion.app",
	},
];

fn known_browser_spec(browser_id: &str) -> Option<&'static BrowserSpec> {
	KNOWN_BROWSERS.iter().find(|spec| spec.id == browser_id)
}

#[cfg(target_os = "macos")]
fn app_search_roots() -> Vec<PathBuf> {
	let mut roots = vec![
		PathBuf::from("/Applications"),
		PathBuf::from("/Applications/Setapp"),
		PathBuf::from("/System/Applications"),
	];

	if let Some(home) = std::env::var_os("HOME") {
		roots.push(PathBuf::from(home).join("Applications"));
	}

	roots
}

#[cfg(target_os = "macos")]
fn resolve_browser_path(spec: &BrowserSpec) -> Option<PathBuf> {
	app_search_roots()
		.into_iter()
		.map(|root| root.join(spec.bundle_name))
		.find(|path| path.exists())
}

#[cfg(target_os = "macos")]
fn list_installed_browsers_macos() -> Vec<BrowserApp> {
	KNOWN_BROWSERS
		.iter()
		.filter(|spec| resolve_browser_path(spec).is_some())
		.map(|spec| BrowserApp {
			id: spec.id.to_string(),
			name: spec.name.to_string(),
		})
		.collect()
}

#[cfg(target_os = "macos")]
fn open_url_in_browser_macos(
	browser_id: &str,
	url: &str,
) -> Result<(), AppError> {
	let spec = known_browser_spec(browser_id).ok_or_else(|| {
		AppError::NotFound(format!("Unknown browser: {browser_id}"))
	})?;
	let app_path = resolve_browser_path(spec).ok_or_else(|| {
		AppError::NotFound(format!("Browser not found: {browser_id}"))
	})?;

	let status = command_without_windows_console("open")
		.arg("-a")
		.arg(app_path)
		.arg(url)
		.status()?;

	if status.success() {
		return Ok(());
	}

	Err(AppError::IoError(std::io::Error::other(format!(
		"Failed to open {} for {url}: {status}",
		spec.name,
	))))
}

#[tauri::command]
pub async fn list_installed_browsers() -> Vec<BrowserApp> {
	#[cfg(target_os = "macos")]
	{
		let browsers =
			tauri::async_runtime::spawn_blocking(list_installed_browsers_macos)
				.await;
		return browsers.unwrap_or_default();
	}

	#[cfg(not(target_os = "macos"))]
	{
		Vec::new()
	}
}

#[tauri::command]
pub async fn open_url_in_browser(
	browser_id: String,
	url: String,
) -> Result<(), AppError> {
	#[cfg(target_os = "macos")]
	{
		return super::run_blocking(move || {
			open_url_in_browser_macos(&browser_id, &url)
		})
		.await;
	}

	#[cfg(not(target_os = "macos"))]
	{
		let _ = (browser_id, url);
		Err(AppError::NotFound(
			"Opening a specific browser is only supported on macOS".into(),
		))
	}
}

#[cfg(test)]
mod tests {
	use std::collections::HashSet;

	use super::*;

	#[test]
	fn browser_ids_are_unique() {
		let ids = KNOWN_BROWSERS.iter().map(|spec| spec.id);
		let unique = ids.collect::<HashSet<_>>();
		assert_eq!(unique.len(), KNOWN_BROWSERS.len());
	}

	#[cfg(target_os = "macos")]
	#[test]
	fn search_roots_cover_standard_locations() {
		let roots = app_search_roots();
		assert!(roots.contains(&PathBuf::from("/Applications")));
		assert!(roots.contains(&PathBuf::from("/Applications/Setapp")));
	}
}
