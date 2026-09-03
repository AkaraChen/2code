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
	})
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
	open::that(&dest).map_err(|e| e.to_string())?;
	Ok(dest.display().to_string())
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
	if cfg!(target_os = "macos") {
		&["dmg", "darwin", "macos", "app.tar.gz"]
	} else if cfg!(target_os = "windows") {
		&["msi", "exe", "windows"]
	} else {
		&["appimage", "deb", "rpm", "linux"]
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
				assets: Vec::new(),
			},
			GithubRelease {
				tag_name: "v3.2.0-beta.1".into(),
				draft: false,
				prerelease: true,
				html_url: String::new(),
				assets: Vec::new(),
			},
		];
		assert_eq!(pick_release(&releases, true).unwrap().tag_name, "v3.2.0-beta.1");
		assert_eq!(pick_release(&releases, false).unwrap().tag_name, "v3.1.0");
	}
}
