use std::collections::HashMap;
use std::io::Write;

use serde::Deserialize;

const GITHUB_RELEASES_API: &str = "https://api.github.com/repos/AkaraChen/2code/releases?per_page=20";
const GITHUB_RELEASES_PAGE: &str = "https://github.com/AkaraChen/2code/releases";
const GITHUB_RELEASE_DOWNLOAD_BASE: &str = "https://github.com/AkaraChen/2code/releases/download";

#[derive(Debug, Clone)]
pub struct UpdateInfo {
	pub current_version: String,
	pub latest_version: String,
	pub available: bool,
	pub prerelease: bool,
	pub html_url: String,
	pub released_at: Option<String>,
}

#[derive(Debug, Deserialize)]
struct GithubRelease {
	tag_name: String,
	#[serde(default)]
	draft: bool,
	#[serde(default)]
	prerelease: bool,
	#[serde(default)]
	html_url: String,
	#[serde(default)]
	published_at: Option<String>,
	#[serde(default)]
	assets: Vec<GithubAsset>,
}

#[derive(Debug, Deserialize)]
struct GithubAsset {
	name: String,
	browser_download_url: String,
}

#[derive(Debug, Deserialize)]
struct LatestJson {
	#[serde(default)]
	platforms: HashMap<String, LatestPlatform>,
}

#[derive(Debug, Deserialize)]
struct LatestPlatform {
	url: String,
}

pub fn current_version() -> &'static str {
	env!("CARGO_PKG_VERSION")
}

pub fn releases_page() -> &'static str {
	GITHUB_RELEASES_PAGE
}

pub fn check_for_update(accept_beta: bool) -> Result<UpdateInfo, String> {
	let mut request = ureq::get(GITHUB_RELEASES_API)
		.set("accept", "application/vnd.github+json")
		.set("user-agent", "2code-gpui");

	if let Some(token) = gh_auth_token() {
		request = request.set("authorization", &format!("Bearer {token}"));
	}

	let releases: Vec<GithubRelease> = request
		.call()
		.map_err(|e| e.to_string())?
		.into_json()
		.map_err(|e| e.to_string())?;

	let release = pick_release(&releases, accept_beta).ok_or_else(|| "no matching GitHub release".to_string())?;
	let latest = release.tag_name.trim_start_matches('v').to_string();
	let current = current_version().to_string();
	Ok(UpdateInfo {
		available: is_newer(&latest, &current),
		latest_version: latest,
		current_version: current,
		prerelease: release.prerelease,
		html_url: if release.html_url.is_empty() {
			GITHUB_RELEASES_PAGE.to_string()
		} else {
			release.html_url.clone()
		},
		released_at: release.published_at.as_deref().and_then(format_release_date),
	})
}

fn format_release_date(raw: &str) -> Option<String> {
	let date = raw.get(..10)?;
	if date.as_bytes().get(4) == Some(&b'-') && date.as_bytes().get(7) == Some(&b'-') {
		Some(date.to_string())
	} else {
		None
	}
}

fn pick_release(releases: &[GithubRelease], accept_beta: bool) -> Option<&GithubRelease> {
	if accept_beta {
		if let Some(beta) = releases.iter().find(|release| {
			!release.draft && release.prerelease && release.tag_name.to_ascii_lowercase().contains("beta")
		}) {
			return Some(beta);
		}
	}
	releases
		.iter()
		.find(|release| !release.draft && !release.prerelease)
		.or_else(|| releases.iter().find(|release| !release.draft))
}

fn gh_auth_token() -> Option<String> {
	let output = std::process::Command::new("gh")
		.args(["auth", "token"])
		.env("GH_PROMPT_DISABLED", "1")
		.output()
		.ok()?;
	if !output.status.success() {
		return None;
	}
	let token = String::from_utf8(output.stdout).ok()?.trim().to_string();
	if token.is_empty() {
		None
	} else {
		Some(token)
	}
}

fn version_parts(raw: &str) -> Vec<u32> {
	raw.trim()
		.trim_start_matches('v')
		.split(|c: char| !c.is_ascii_digit())
		.filter(|part| !part.is_empty())
		.filter_map(|part| part.parse().ok())
		.take(3)
		.collect()
}

fn is_newer(latest: &str, current: &str) -> bool {
	let mut latest_parts = version_parts(latest);
	let mut current_parts = version_parts(current);
	while latest_parts.len() < 3 {
		latest_parts.push(0);
	}
	while current_parts.len() < 3 {
		current_parts.push(0);
	}
	latest_parts > current_parts
}

pub fn download_and_install(accept_beta: bool) -> Result<String, String> {
	let info = check_for_update(accept_beta)?;
	if !info.available {
		return Err("no update available".into());
	}
	let url = asset_url(accept_beta)?;
	let name = url
		.rsplit('/')
		.next()
		.unwrap_or("2code-update")
		.split('?')
		.next()
		.unwrap_or("2code-update");
	let dest = std::env::temp_dir().join(format!("{}-{}", info.latest_version, name));
	let mut request = ureq::get(&url).set("user-agent", "2code-gpui");
	if let Some(token) = gh_auth_token() {
		request = request.set("authorization", &format!("Bearer {token}"));
	}
	let response = request.call().map_err(|e| e.to_string())?;
	let mut file = std::fs::File::create(&dest).map_err(|e| e.to_string())?;
	let mut reader = response.into_reader();
	std::io::copy(&mut reader, &mut file).map_err(|e| e.to_string())?;
	file.flush().map_err(|e| e.to_string())?;
	match install_kind(name) {
		InstallKind::ReplaceRunningBinary => {
			replace_running_binary(&dest)?;
			Ok(dest.display().to_string())
		}
		InstallKind::OpenInstaller => {
			open::that(&dest).map_err(|e| e.to_string())?;
			Ok(dest.display().to_string())
		}
	}
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum InstallKind {
	ReplaceRunningBinary,
	OpenInstaller,
}

pub fn install_kind(asset_name: &str) -> InstallKind {
	let name = asset_name.to_ascii_lowercase();
	if name.contains("2code-linux") || name.contains("2code-macos") || name.contains("2code-windows") {
		return InstallKind::ReplaceRunningBinary;
	}
	if name.ends_with(".dmg")
		|| name.ends_with(".pkg")
		|| name.ends_with(".msi")
		|| name.ends_with(".appimage")
		|| name.ends_with(".deb")
		|| name.ends_with(".rpm")
	{
		return InstallKind::OpenInstaller;
	}
	InstallKind::ReplaceRunningBinary
}

fn replace_running_binary(downloaded: &std::path::Path) -> Result<(), String> {
	let current = std::env::current_exe().map_err(|e| e.to_string())?;
	#[cfg(unix)]
	{
		use std::os::unix::fs::PermissionsExt;
		let mut perms = std::fs::metadata(downloaded).map_err(|e| e.to_string())?.permissions();
		perms.set_mode(0o755);
		std::fs::set_permissions(downloaded, perms).map_err(|e| e.to_string())?;
	}
	let staged = current.with_file_name(format!(
		"{}.update",
		current.file_name().and_then(|n| n.to_str()).unwrap_or("2code")
	));
	std::fs::copy(downloaded, &staged).map_err(|e| e.to_string())?;
	#[cfg(unix)]
	{
		use std::os::unix::fs::PermissionsExt;
		let mut perms = std::fs::metadata(&staged).map_err(|e| e.to_string())?.permissions();
		perms.set_mode(0o755);
		std::fs::set_permissions(&staged, perms).map_err(|e| e.to_string())?;
	}
	match std::fs::rename(&staged, &current) {
		Ok(()) => Ok(()),
		Err(_) => {
			let backup = current.with_extension("old");
			std::fs::rename(&current, &backup).map_err(|e| e.to_string())?;
			std::fs::rename(&staged, &current).map_err(|e| {
				let _ = std::fs::rename(&backup, &current);
				e.to_string()
			})
		}
	}
}

fn asset_url(accept_beta: bool) -> Result<String, String> {
	let mut request = ureq::get(GITHUB_RELEASES_API)
		.set("accept", "application/vnd.github+json")
		.set("user-agent", "2code-gpui");
	if let Some(token) = gh_auth_token() {
		request = request.set("authorization", &format!("Bearer {token}"));
	}
	let releases: Vec<GithubRelease> = request
		.call()
		.map_err(|e| e.to_string())?
		.into_json()
		.map_err(|e| e.to_string())?;
	let release = pick_release(&releases, accept_beta).ok_or_else(|| "no matching GitHub release".to_string())?;
	let tag = release.tag_name.replace('/', "%2F");
	let latest_url = format!("{GITHUB_RELEASE_DOWNLOAD_BASE}/{tag}/latest.json");
	if let Ok(url) = url_from_latest_json(&latest_url) {
		return Ok(url);
	}
	let needle = platform_asset_needle();
	release
		.assets
		.iter()
		.find(|a| needle.iter().any(|n| a.name.to_ascii_lowercase().contains(n)))
		.map(|a| a.browser_download_url.clone())
		.ok_or_else(|| "no installer asset for this platform".into())
}

fn url_from_latest_json(url: &str) -> Result<String, String> {
	let mut request = ureq::get(url).set("user-agent", "2code-gpui");
	if let Some(token) = gh_auth_token() {
		request = request.set("authorization", &format!("Bearer {token}"));
	}
	let latest: LatestJson = request
		.call()
		.map_err(|e| e.to_string())?
		.into_json()
		.map_err(|e| e.to_string())?;
	let key = platform_latest_key();
	latest
		.platforms
		.get(key)
		.or_else(|| latest.platforms.values().next())
		.map(|p| p.url.clone())
		.ok_or_else(|| "latest.json has no platform url".into())
}

fn platform_latest_key() -> &'static str {
	if cfg!(all(target_os = "macos", target_arch = "aarch64")) {
		"darwin-aarch64"
	} else if cfg!(all(target_os = "macos", target_arch = "x86_64")) {
		"darwin-x86_64"
	} else if cfg!(target_os = "windows") {
		"windows-x86_64"
	} else {
		"linux-x86_64"
	}
}

fn platform_asset_needle() -> &'static [&'static str] {
	if cfg!(all(target_os = "macos", target_arch = "aarch64")) {
		&["macos-arm64", "darwin-aarch64", "dmg", "darwin", "macos"]
	} else if cfg!(target_os = "macos") {
		&["macos-x64", "darwin-x86", "dmg", "darwin", "macos"]
	} else if cfg!(target_os = "windows") {
		&["windows-x64", "windows", "msi", "exe"]
	} else {
		&["linux-x64", "linux", "appimage", "deb", "rpm"]
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn newer_tag_wins() {
		assert!(is_newer("3.1.0", "3.0.1"));
		assert!(!is_newer("3.0.1", "3.0.1"));
		assert!(!is_newer("v3.0.0", "3.0.1"));
		assert!(is_newer("v4.0.0-beta.1", "3.0.1"));
	}

	#[test]
	fn prefers_beta_when_requested() {
		let releases = vec![
			GithubRelease {
				tag_name: "v3.1.0".into(),
				draft: false,
				prerelease: false,
				html_url: String::new(),
				published_at: None,
				assets: Vec::new(),
			},
			GithubRelease {
				tag_name: "v3.2.0-beta.1".into(),
				draft: false,
				prerelease: true,
				html_url: String::new(),
				published_at: None,
				assets: Vec::new(),
			},
		];
		assert_eq!(pick_release(&releases, true).unwrap().tag_name, "v3.2.0-beta.1");
		assert_eq!(pick_release(&releases, false).unwrap().tag_name, "v3.1.0");
	}

	#[test]
	fn formats_github_release_date() {
		assert_eq!(
			format_release_date("2026-04-09T12:00:00Z").as_deref(),
			Some("2026-04-09")
		);
		assert_eq!(format_release_date("not-a-date"), None);
	}

	#[test]
	fn gpui_release_asset_names_match_platform() {
		let names = platform_asset_needle();
		if cfg!(target_os = "linux") {
			assert!(names.iter().any(|n| *n == "linux-x64"));
		} else if cfg!(target_os = "windows") {
			assert!(names.iter().any(|n| *n == "windows-x64"));
		} else if cfg!(all(target_os = "macos", target_arch = "aarch64")) {
			assert!(names.iter().any(|n| *n == "macos-arm64"));
		}
	}

	#[test]
	fn gpui_binaries_replace_in_place() {
		assert_eq!(install_kind("2code-linux-x64"), InstallKind::ReplaceRunningBinary);
		assert_eq!(install_kind("2code-macos-arm64"), InstallKind::ReplaceRunningBinary);
		assert_eq!(install_kind("2code-windows-x64.exe"), InstallKind::ReplaceRunningBinary);
		assert_eq!(install_kind("2code_3.0.1_aarch64.dmg"), InstallKind::OpenInstaller);
		assert_eq!(install_kind("2code-setup.msi"), InstallKind::OpenInstaller);
	}
}
