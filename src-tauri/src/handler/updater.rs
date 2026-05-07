use std::process::Command;
use std::sync::Mutex;

use model::error::AppError;
use serde::{Deserialize, Serialize};
use tauri::{ipc::Channel, AppHandle, State};
use tauri_plugin_updater::{Update, UpdaterExt};

const GITHUB_RELEASES_API: &str =
	"https://api.github.com/repos/AkaraChen/2code/releases?per_page=20";
const GITHUB_RELEASE_DOWNLOAD_BASE: &str =
	"https://github.com/AkaraChen/2code/releases/download";

#[derive(Default)]
pub struct PendingUpdate(Mutex<Option<Update>>);

#[derive(Debug, Deserialize)]
struct GithubRelease {
	tag_name: String,
	draft: bool,
	prerelease: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateMetadata {
	current_version: String,
	version: String,
	date: Option<String>,
	body: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(tag = "event", content = "data")]
pub enum UpdateDownloadEvent {
	#[serde(rename_all = "camelCase")]
	Started {
		content_length: Option<u64>,
	},
	#[serde(rename_all = "camelCase")]
	Progress {
		chunk_length: usize,
	},
	Finished,
}

fn updater_error(error: impl std::fmt::Display) -> AppError {
	AppError::PtyError(format!("Updater error: {error}"))
}

fn encode_release_tag(tag: &str) -> String {
	tag.replace('/', "%2F")
}

fn update_metadata(update: &Update) -> UpdateMetadata {
	UpdateMetadata {
		current_version: update.current_version.clone(),
		version: update.version.clone(),
		date: update.date.map(|date| date.to_string()),
		body: update.body.clone(),
	}
}

fn gh_auth_token() -> Option<String> {
	let output = Command::new("gh")
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

async fn latest_beta_endpoint(
	auth_token: Option<&str>,
) -> Result<String, AppError> {
	let mut request = reqwest::Client::new()
		.get(GITHUB_RELEASES_API)
		.header("accept", "application/vnd.github+json")
		.header("user-agent", "2code-updater");

	if let Some(token) = auth_token {
		request = request.bearer_auth(token);
	}

	let releases = request
		.send()
		.await
		.map_err(updater_error)?
		.error_for_status()
		.map_err(updater_error)?
		.json::<Vec<GithubRelease>>()
		.await
		.map_err(updater_error)?;

	let release = releases
		.into_iter()
		.find(|release| {
			!release.draft
				&& release.prerelease
				&& release.tag_name.to_ascii_lowercase().contains("beta")
		})
		.ok_or_else(|| AppError::NotFound("beta release".into()))?;

	Ok(format!(
		"{}/{}/latest.json",
		GITHUB_RELEASE_DOWNLOAD_BASE,
		encode_release_tag(&release.tag_name),
	))
}

#[tauri::command]
pub async fn check_update(
	app: AppHandle,
	pending_update: State<'_, PendingUpdate>,
	accept_beta: bool,
) -> Result<Option<UpdateMetadata>, AppError> {
	let auth_token = gh_auth_token();
	let mut builder = app.updater_builder();
	if let Some(token) = auth_token.as_deref() {
		builder = builder
			.header("Authorization", format!("Bearer {token}"))
			.map_err(updater_error)?;
	}

	let update = if accept_beta {
		let endpoint = latest_beta_endpoint(auth_token.as_deref()).await?;
		builder
			.endpoints(vec![endpoint.parse().map_err(updater_error)?])
			.map_err(updater_error)?
			.build()
			.map_err(updater_error)?
			.check()
			.await
			.map_err(updater_error)?
	} else {
		builder
			.build()
			.map_err(updater_error)?
			.check()
			.await
			.map_err(updater_error)?
	};

	let metadata = update.as_ref().map(update_metadata);
	*pending_update.0.lock().map_err(|_| AppError::LockError)? = update;
	Ok(metadata)
}

#[tauri::command]
pub async fn install_update(
	app: AppHandle,
	pending_update: State<'_, PendingUpdate>,
	on_event: Channel<UpdateDownloadEvent>,
) -> Result<(), AppError> {
	let update = pending_update
		.0
		.lock()
		.map_err(|_| AppError::LockError)?
		.take()
		.ok_or_else(|| AppError::NotFound("pending update".into()))?;

	let mut started = false;
	update
		.download_and_install(
			|chunk_length, content_length| {
				if !started {
					let _ = on_event
						.send(UpdateDownloadEvent::Started { content_length });
					started = true;
				}
				let _ = on_event
					.send(UpdateDownloadEvent::Progress { chunk_length });
			},
			|| {
				let _ = on_event.send(UpdateDownloadEvent::Finished);
			},
		)
		.await
		.map_err(updater_error)?;

	app.restart();
}
