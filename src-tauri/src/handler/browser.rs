#[cfg(target_os = "macos")]
use std::path::PathBuf;

use infra::no_window::command_without_windows_console;
use model::browser::InstalledBrowser;
use model::error::AppError;

#[derive(Clone, Copy, Debug)]
struct BrowserSpec {
	id: &'static str,
	app_name: &'static str,
	#[cfg(target_os = "macos")]
	bundle_name: &'static str,
}

const KNOWN_BROWSERS: [BrowserSpec; 9] = [
	BrowserSpec {
		id: "safari",
		app_name: "Safari",
		#[cfg(target_os = "macos")]
		bundle_name: "Safari.app",
	},
	BrowserSpec {
		id: "google-chrome",
		app_name: "Google Chrome",
		#[cfg(target_os = "macos")]
		bundle_name: "Google Chrome.app",
	},
	BrowserSpec {
		id: "google-chrome-canary",
		app_name: "Google Chrome Canary",
		#[cfg(target_os = "macos")]
		bundle_name: "Google Chrome Canary.app",
	},
	BrowserSpec {
		id: "firefox",
		app_name: "Firefox",
		#[cfg(target_os = "macos")]
		bundle_name: "Firefox.app",
	},
	BrowserSpec {
		id: "microsoft-edge",
		app_name: "Microsoft Edge",
		#[cfg(target_os = "macos")]
		bundle_name: "Microsoft Edge.app",
	},
	BrowserSpec {
		id: "arc",
		app_name: "Arc",
		#[cfg(target_os = "macos")]
		bundle_name: "Arc.app",
	},
	BrowserSpec {
		id: "brave",
		app_name: "Brave Browser",
		#[cfg(target_os = "macos")]
		bundle_name: "Brave Browser.app",
	},
	BrowserSpec {
		id: "vivaldi",
		app_name: "Vivaldi",
		#[cfg(target_os = "macos")]
		bundle_name: "Vivaldi.app",
	},
	BrowserSpec {
		id: "zen",
		app_name: "Zen Browser",
		#[cfg(target_os = "macos")]
		bundle_name: "Zen Browser.app",
	},
];

#[cfg(target_os = "macos")]
fn browser_search_roots() -> Vec<PathBuf> {
	let mut roots = vec![
		PathBuf::from("/Applications"),
		PathBuf::from("/System/Applications"),
	];

	if let Some(home) = std::env::var_os("HOME") {
		roots.push(PathBuf::from(home).join("Applications"));
	}

	roots
}

#[cfg(target_os = "macos")]
fn resolve_browser_path(spec: &BrowserSpec) -> Option<PathBuf> {
	browser_search_roots()
		.into_iter()
		.map(|root| root.join(spec.bundle_name))
		.find(|path| path.exists())
}

#[cfg(target_os = "macos")]
fn list_installed_browsers_macos() -> Vec<InstalledBrowser> {
	KNOWN_BROWSERS
		.iter()
		.filter(|spec| resolve_browser_path(spec).is_some())
		.map(|spec| InstalledBrowser {
			id: spec.id.to_string(),
			name: spec.app_name.to_string(),
		})
		.collect()
}

#[cfg(target_os = "macos")]
fn open_url_in_browser_macos(browser_id: &str, url: &str) -> Result<(), AppError> {
	let spec = KNOWN_BROWSERS
		.iter()
		.find(|s| s.id == browser_id)
		.ok_or_else(|| AppError::NotFound(format!("Unknown browser: {browser_id}")))?;

	let app_path = resolve_browser_path(spec).ok_or_else(|| {
		AppError::NotFound(format!("Browser not found: {browser_id}"))
	})?;

	let status = command_without_windows_console("open")
		.arg("-a")
		.arg(&app_path)
		.arg(url)
		.status()?;

	if status.success() {
		return Ok(());
	}

	Err(AppError::IoError(std::io::Error::other(format!(
		"Failed to open {} for URL {}: {status}",
		spec.app_name, url,
	))))
}

#[tauri::command]
pub async fn list_installed_browsers() -> Vec<InstalledBrowser> {
	#[cfg(target_os = "macos")]
	{
		list_installed_browsers_macos()
	}
	#[cfg(not(target_os = "macos"))]
	{
		Vec::new()
	}
}

#[tauri::command]
pub async fn open_url_in_browser(browser_id: String, url: String) -> Result<(), AppError> {
	#[cfg(target_os = "macos")]
	{
		open_url_in_browser_macos(&browser_id, &url)
	}
	#[cfg(not(target_os = "macos"))]
	{
		let _ = (&browser_id, &url);
		Err(AppError::NotFound(
			"Browser-specific opening is not supported on this platform".to_string(),
		))
	}
}
