use std::collections::HashMap;
use std::net::TcpListener;
use std::path::PathBuf;
use std::process::Command;

use axum::extract::{Query, State};
use axum::routing::get;
use axum::Json;
use tauri::{AppHandle, Emitter};
use tauri_plugin_store::StoreExt;

pub struct HelperState {
	pub port: u16,
	pub sidecar_path: PathBuf,
}

fn find_free_port() -> u16 {
	let listener =
		TcpListener::bind("127.0.0.1:0").expect("bind ephemeral port");
	listener.local_addr().unwrap().port()
}

fn resolve_sidecar_path() -> PathBuf {
	let target = env!("TARGET");

	// Production: next to the main executable
	if let Ok(exe) = std::env::current_exe() {
		if let Some(dir) = exe.parent() {
			let prod_path = dir.join(format!("2code-helper-{target}"));
			if prod_path.exists() {
				return prod_path;
			}
		}
	}

	// Dev: in the binaries/ directory relative to CARGO_MANIFEST_DIR
	PathBuf::from(env!("CARGO_MANIFEST_DIR"))
		.join("binaries")
		.join(format!("2code-helper-{target}"))
}

async fn notify_handler(
	State(app): State<AppHandle>,
	Query(params): Query<HashMap<String, String>>,
) -> Json<model::notification::NotifyResponse> {
	let played = try_play_notification(&app);
	if let Some(session_id) = params.get("session_id") {
		let _ = app.emit("pty-notify", session_id.as_str());
	}
	Json(model::notification::NotifyResponse { played })
}

fn try_play_notification(app: &AppHandle) -> bool {
	let store = app.store("settings.json").ok();
	let val = store.as_ref().and_then(|s| s.get("notification-settings"));
	let Some(val) = val else { return false };

	let Ok(entry) =
		serde_json::from_value::<model::notification::NotificationEntry>(val)
	else {
		return false;
	};

	if !entry.state.enabled {
		return false;
	}

	let sound_path =
		format!("/System/Library/Sounds/{}.aiff", entry.state.sound);

	std::path::Path::new(&sound_path).exists()
		&& Command::new("afplay").arg(&sound_path).spawn().is_ok()
}

async fn health_handler() -> &'static str {
	"ok"
}

pub fn start(app: &AppHandle) -> HelperState {
	let port = find_free_port();
	let sidecar_path = resolve_sidecar_path();
	let app_handle = app.clone();

	tracing::info!(target: "helper", %port, sidecar = %sidecar_path.display(), "starting helper HTTP server");

	tauri::async_runtime::spawn(async move {
		let router = axum::Router::new()
			.route("/notify", get(notify_handler))
			.route("/health", get(health_handler))
			.with_state(app_handle);

		let listener = tokio::net::TcpListener::bind(("127.0.0.1", port))
			.await
			.expect("bind helper HTTP server");

		if let Err(e) = axum::serve(listener, router).await {
			tracing::error!(target: "helper", "HTTP server error: {e}");
		}
	});

	HelperState { port, sidecar_path }
}
