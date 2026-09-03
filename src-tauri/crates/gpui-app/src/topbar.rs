//! Native top-bar app launchers, ported from the old React control registry.

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct AppSpec {
	pub id: &'static str,
	pub label: &'static str,
	pub command: &'static str,
	pub mac_app: &'static str,
}

pub const EDITOR_APPS: &[AppSpec] = &[
	AppSpec {
		id: "vscode",
		label: "VS Code",
		command: "code",
		mac_app: "Visual Studio Code",
	},
	AppSpec {
		id: "cursor",
		label: "Cursor",
		command: "cursor",
		mac_app: "Cursor",
	},
	AppSpec {
		id: "zed",
		label: "Zed",
		command: "zed",
		mac_app: "Zed",
	},
	AppSpec {
		id: "windsurf",
		label: "Windsurf",
		command: "windsurf",
		mac_app: "Windsurf",
	},
	AppSpec {
		id: "sublime-text",
		label: "Sublime Text",
		command: "subl",
		mac_app: "Sublime Text",
	},
];

pub const TERMINAL_APPS: &[AppSpec] = &[
	AppSpec {
		id: "ghostty",
		label: "Ghostty",
		command: "ghostty",
		mac_app: "Ghostty",
	},
	AppSpec {
		id: "kitty",
		label: "kitty",
		command: "kitty",
		mac_app: "kitty",
	},
	AppSpec {
		id: "iterm2",
		label: "iTerm",
		command: "iterm2",
		mac_app: "iTerm",
	},
	AppSpec {
		id: "warp",
		label: "Warp",
		command: "warp",
		mac_app: "Warp",
	},
];

pub const GITHUB_DESKTOP: AppSpec = AppSpec {
	id: "github-desktop",
	label: "GitHub Desktop",
	command: "github-desktop",
	mac_app: "GitHub Desktop",
};

pub fn spec(app_id: &str) -> Option<AppSpec> {
	EDITOR_APPS
		.iter()
		.chain(TERMINAL_APPS)
		.copied()
		.chain(std::iter::once(GITHUB_DESKTOP))
		.find(|item| item.id == app_id)
}

pub fn command_exists(command: &str) -> bool {
	std::env::var_os("PATH")
		.map(|paths| {
			std::env::split_paths(&paths)
				.any(|dir| dir.join(command).is_file())
		})
		.unwrap_or(false)
}

pub fn is_available(app_id: &str) -> bool {
	let Some(spec) = spec(app_id) else {
		return false;
	};
	if command_exists(spec.command) {
		return true;
	}
	#[cfg(target_os = "macos")]
	{
		return std::path::Path::new("/Applications")
			.join(format!("{}.app", spec.mac_app))
			.exists();
	}
	#[cfg(not(target_os = "macos"))]
	{
		false
	}
}

pub fn open_app(app_id: &str, path: &str) -> Result<(), String> {
	let spec = spec(app_id).ok_or_else(|| format!("Unknown app: {app_id}"))?;
	if command_exists(spec.command) {
		std::process::Command::new(spec.command)
			.arg(path)
			.spawn()
			.map_err(|error| error.to_string())?;
		return Ok(());
	}
	#[cfg(target_os = "macos")]
	{
		let status = std::process::Command::new("open")
			.arg("-a")
			.arg(spec.mac_app)
			.arg(path)
			.status()
			.map_err(|error| error.to_string())?;
		if status.success() {
			return Ok(());
		}
	}
	Err(format!("{} is not installed", spec.label))
}

pub fn list_available_ids(candidates: &[AppSpec]) -> Vec<&'static str> {
	candidates
		.iter()
		.filter(|item| is_available(item.id))
		.map(|item| item.id)
		.collect()
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn known_ids_resolve() {
		assert!(spec("vscode").is_some());
		assert!(spec("github-desktop").is_some());
		assert!(spec("nope").is_none());
	}
}
