use serde::Deserialize;

const GITHUB_RELEASES_API: &str =
	"https://api.github.com/repos/AkaraChen/2code/releases?per_page=20";
const GITHUB_RELEASES_PAGE: &str = "https://github.com/AkaraChen/2code/releases";

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

	let release = pick_release(&releases, accept_beta)
		.ok_or_else(|| "no matching GitHub release".to_string())?;
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
			!release.draft
				&& release.prerelease
				&& release.tag_name.to_ascii_lowercase().contains("beta")
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
			},
			GithubRelease {
				tag_name: "v3.2.0-beta.1".into(),
				draft: false,
				prerelease: true,
				html_url: String::new(),
			},
		];
		assert_eq!(pick_release(&releases, true).unwrap().tag_name, "v3.2.0-beta.1");
		assert_eq!(pick_release(&releases, false).unwrap().tag_name, "v3.1.0");
	}
}
