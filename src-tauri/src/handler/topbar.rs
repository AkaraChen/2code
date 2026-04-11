use std::path::PathBuf;
use std::process::Command;

use model::error::AppError;
use model::topbar::TopbarApp;

#[derive(Clone, Copy, Debug)]
struct TopbarAppSpec {
	id: &'static str,
	app_name: &'static str,
	bundle_name: &'static str,
}

const KNOWN_TOPBAR_APPS: [TopbarAppSpec; 10] = [
	TopbarAppSpec {
		id: "github-desktop",
		app_name: "GitHub Desktop",
		bundle_name: "GitHub Desktop.app",
	},
	TopbarAppSpec {
		id: "vscode",
		app_name: "Visual Studio Code",
		bundle_name: "Visual Studio Code.app",
	},
	TopbarAppSpec {
		id: "windsurf",
		app_name: "Windsurf",
		bundle_name: "Windsurf.app",
	},
	TopbarAppSpec {
		id: "cursor",
		app_name: "Cursor",
		bundle_name: "Cursor.app",
	},
	TopbarAppSpec {
		id: "zed",
		app_name: "Zed",
		bundle_name: "Zed.app",
	},
	TopbarAppSpec {
		id: "sublime-text",
		app_name: "Sublime Text",
		bundle_name: "Sublime Text.app",
	},
	TopbarAppSpec {
		id: "ghostty",
		app_name: "Ghostty",
		bundle_name: "Ghostty.app",
	},
	TopbarAppSpec {
		id: "iterm2",
		app_name: "iTerm",
		bundle_name: "iTerm.app",
	},
	TopbarAppSpec {
		id: "kitty",
		app_name: "kitty",
		bundle_name: "kitty.app",
	},
	TopbarAppSpec {
		id: "warp",
		app_name: "Warp",
		bundle_name: "Warp.app",
	},
];

#[cfg(target_os = "macos")]
fn known_app_spec(app_id: &str) -> Option<&'static TopbarAppSpec> {
	KNOWN_TOPBAR_APPS.iter().find(|spec| spec.id == app_id)
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
fn resolve_app_path(spec: &TopbarAppSpec) -> Option<PathBuf> {
	app_search_roots()
		.into_iter()
		.map(|root| root.join(spec.bundle_name))
		.find(|path| path.exists())
}

#[cfg(target_os = "macos")]
fn list_supported_topbar_apps_macos() -> Vec<TopbarApp> {
	KNOWN_TOPBAR_APPS
		.iter()
		.filter(|spec| resolve_app_path(spec).is_some())
		.map(|spec| TopbarApp {
			id: spec.id.to_string(),
		})
		.collect()
}

#[cfg(target_os = "macos")]
fn open_topbar_app_macos(app_id: &str, path: &str) -> Result<(), AppError> {
	let spec = known_app_spec(app_id).ok_or_else(|| {
		AppError::NotFound(format!("Unknown top bar app: {app_id}"))
	})?;

	let app_path = resolve_app_path(spec).ok_or_else(|| {
		AppError::NotFound(format!("Top bar app not found: {app_id}"))
	})?;

	let status = Command::new("open")
		.arg("-a")
		.arg(&app_path)
		.arg(path)
		.status()?;

	if status.success() {
		return Ok(());
	}

	Err(AppError::IoError(std::io::Error::other(format!(
		"Failed to open {} ({}) for {}: {status}",
		spec.id, spec.app_name, path,
	))))
}

#[tauri::command]
pub async fn list_supported_topbar_apps() -> Vec<TopbarApp> {
	#[cfg(target_os = "macos")]
	{
		let apps = tauri::async_runtime::spawn_blocking(
			list_supported_topbar_apps_macos,
		)
		.await;
		return apps.unwrap_or_default();
	}

	#[cfg(not(target_os = "macos"))]
	{
		Vec::new()
	}
}

#[tauri::command]
pub async fn open_topbar_app(
	app_id: String,
	path: String,
) -> Result<(), AppError> {
	#[cfg(target_os = "macos")]
	{
		return super::run_blocking(move || {
			open_topbar_app_macos(&app_id, &path)
		})
		.await;
	}

	#[cfg(not(target_os = "macos"))]
	{
		let _ = (app_id, path);
		Err(AppError::NotFound(
			"Top bar app launching is only supported on macOS".into(),
		))
	}
}

#[cfg(test)]
mod tests {
	use std::collections::HashSet;

	use super::*;

	#[test]
	fn topbar_app_ids_are_unique() {
		let ids = KNOWN_TOPBAR_APPS.iter().map(|spec| spec.id);
		let unique = ids.collect::<HashSet<_>>();
		assert_eq!(unique.len(), KNOWN_TOPBAR_APPS.len());
	}

	#[cfg(target_os = "macos")]
	#[test]
	fn search_roots_cover_standard_locations() {
		let roots = app_search_roots();
		assert!(roots.contains(&PathBuf::from("/Applications")));
		assert!(roots.contains(&PathBuf::from("/Applications/Setapp")));
	}
}
