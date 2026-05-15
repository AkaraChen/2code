#[cfg(target_os = "macos")]
use std::path::PathBuf;
use std::process::Command;

use model::error::AppError;
use model::topbar::TopbarApp;

#[derive(Clone, Copy, Debug)]
struct TopbarAppSpec {
	id: &'static str,
	app_name: &'static str,
	#[cfg(target_os = "macos")]
	bundle_name: &'static str,
	windows_commands: &'static [&'static str],
}

const KNOWN_TOPBAR_APPS: [TopbarAppSpec; 10] = [
	TopbarAppSpec {
		id: "github-desktop",
		app_name: "GitHub Desktop",
		#[cfg(target_os = "macos")]
		bundle_name: "GitHub Desktop.app",
		windows_commands: &["GitHubDesktop.exe", "github"],
	},
	TopbarAppSpec {
		id: "vscode",
		app_name: "Visual Studio Code",
		#[cfg(target_os = "macos")]
		bundle_name: "Visual Studio Code.app",
		windows_commands: &["code.cmd", "code.exe", "code"],
	},
	TopbarAppSpec {
		id: "windsurf",
		app_name: "Windsurf",
		#[cfg(target_os = "macos")]
		bundle_name: "Windsurf.app",
		windows_commands: &["windsurf.cmd", "windsurf.exe", "windsurf"],
	},
	TopbarAppSpec {
		id: "cursor",
		app_name: "Cursor",
		#[cfg(target_os = "macos")]
		bundle_name: "Cursor.app",
		windows_commands: &["cursor.cmd", "cursor.exe", "cursor"],
	},
	TopbarAppSpec {
		id: "zed",
		app_name: "Zed",
		#[cfg(target_os = "macos")]
		bundle_name: "Zed.app",
		windows_commands: &["zed.cmd", "zed.exe", "zed"],
	},
	TopbarAppSpec {
		id: "sublime-text",
		app_name: "Sublime Text",
		#[cfg(target_os = "macos")]
		bundle_name: "Sublime Text.app",
		windows_commands: &["subl.exe", "sublime_text.exe", "subl"],
	},
	TopbarAppSpec {
		id: "ghostty",
		app_name: "Ghostty",
		#[cfg(target_os = "macos")]
		bundle_name: "Ghostty.app",
		windows_commands: &["ghostty.exe", "ghostty"],
	},
	TopbarAppSpec {
		id: "iterm2",
		app_name: "iTerm",
		#[cfg(target_os = "macos")]
		bundle_name: "iTerm.app",
		windows_commands: &[],
	},
	TopbarAppSpec {
		id: "kitty",
		app_name: "kitty",
		#[cfg(target_os = "macos")]
		bundle_name: "kitty.app",
		windows_commands: &["kitty.exe", "kitty"],
	},
	TopbarAppSpec {
		id: "warp",
		app_name: "Warp",
		#[cfg(target_os = "macos")]
		bundle_name: "Warp.app",
		windows_commands: &["warp.exe", "warp"],
	},
];

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
	let roots = app_search_roots();
	resolve_app_path_in_roots(spec, &roots)
}

#[cfg(target_os = "macos")]
fn resolve_app_path_in_roots(
	spec: &TopbarAppSpec,
	roots: &[PathBuf],
) -> Option<PathBuf> {
	roots
		.iter()
		.map(|root| root.join(spec.bundle_name))
		.find(|path| path.exists())
}

#[cfg(target_os = "macos")]
fn list_supported_topbar_apps_macos() -> Vec<TopbarApp> {
	let roots = app_search_roots();
	KNOWN_TOPBAR_APPS
		.iter()
		.filter(|spec| resolve_app_path_in_roots(spec, &roots).is_some())
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

#[cfg(target_os = "windows")]
fn windows_command_exists(command: &str) -> bool {
	let Some(path) = std::env::var_os("PATH") else {
		return false;
	};

	std::env::split_paths(&path).any(|dir| dir.join(command).exists())
}

#[cfg(target_os = "windows")]
fn resolve_windows_command(spec: &TopbarAppSpec) -> Option<&'static str> {
	spec.windows_commands
		.iter()
		.copied()
		.find(|command| windows_command_exists(command))
}

#[cfg(target_os = "windows")]
fn list_supported_topbar_apps_windows() -> Vec<TopbarApp> {
	KNOWN_TOPBAR_APPS
		.iter()
		.filter(|spec| resolve_windows_command(spec).is_some())
		.map(|spec| TopbarApp {
			id: spec.id.to_string(),
		})
		.collect()
}

#[cfg(target_os = "windows")]
fn open_topbar_app_windows(app_id: &str, path: &str) -> Result<(), AppError> {
	let spec = known_app_spec(app_id).ok_or_else(|| {
		AppError::NotFound(format!("Unknown top bar app: {app_id}"))
	})?;
	let command = resolve_windows_command(spec).ok_or_else(|| {
		AppError::NotFound(format!("Top bar app not found: {app_id}"))
	})?;

	let status = Command::new("powershell.exe")
		.args([
			"-NoProfile",
			"-ExecutionPolicy",
			"Bypass",
			"-Command",
			"& { param($exe, $target) Start-Process -FilePath $exe -ArgumentList @($target) }",
		])
		.arg(command)
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

	#[cfg(target_os = "windows")]
	{
		let apps = tauri::async_runtime::spawn_blocking(
			list_supported_topbar_apps_windows,
		)
		.await;
		return apps.unwrap_or_default();
	}

	#[cfg(not(any(target_os = "macos", target_os = "windows")))]
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

	#[cfg(target_os = "windows")]
	{
		return super::run_blocking(move || {
			open_topbar_app_windows(&app_id, &path)
		})
		.await;
	}

	#[cfg(not(any(target_os = "macos", target_os = "windows")))]
	{
		let _ = (app_id, path);
		Err(AppError::NotFound(
			"Top bar app launching is only supported on macOS and Windows".into(),
		))
	}
}

#[cfg(test)]
mod tests {
	use std::collections::HashSet;
	#[cfg(target_os = "macos")]
	use std::time::Instant;

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

	#[cfg(target_os = "macos")]
	#[test]
	#[ignore]
	fn bench_list_supported_topbar_apps_reusing_roots() {
		let iterations = 20_000;

		let started = Instant::now();
		let mut repeated_roots_count = 0;
		for _ in 0..iterations {
			repeated_roots_count += KNOWN_TOPBAR_APPS
				.iter()
				.filter(|spec| {
					let roots = app_search_roots();
					resolve_app_path_in_roots(spec, &roots).is_some()
				})
				.count();
		}
		let repeated_roots = started.elapsed();

		let started = Instant::now();
		let mut reused_roots_count = 0;
		for _ in 0..iterations {
			let roots = app_search_roots();
			reused_roots_count += KNOWN_TOPBAR_APPS
				.iter()
				.filter(|spec| resolve_app_path_in_roots(spec, &roots).is_some())
				.count();
		}
		let reused_roots = started.elapsed();

		assert_eq!(repeated_roots_count, reused_roots_count);
		println!(
			"repeated_roots={repeated_roots:?} reused_roots={reused_roots:?} speedup={:.2}x",
			repeated_roots.as_secs_f64() / reused_roots.as_secs_f64()
		);
	}
}
