use std::net::TcpListener;
use std::path::PathBuf;

use std::collections::HashMap;

use axum::extract::{Query, State};
use axum::routing::get;
use axum::Json;
use tauri::{AppHandle, Emitter};
use tauri_plugin_store::StoreExt;

pub struct HelperState {
	pub port: u16,
	pub sidecar_path: PathBuf,
}

fn sidecar_binary_name(target: &str) -> String {
	if target.contains("windows") {
		format!("2code-helper-{target}.exe")
	} else {
		format!("2code-helper-{target}")
	}
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
			let prod_path = dir.join(sidecar_binary_name(target));
			if prod_path.exists() {
				return prod_path;
			}
		}
	}

	// Dev: in the binaries/ directory relative to CARGO_MANIFEST_DIR
	let manifest_dir =
		PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("binaries");
	let dev_path = manifest_dir.join(sidecar_binary_name(target));
	dev_path
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
	let store = match app.store("settings.json") {
		Ok(s) => s,
		Err(_) => return false,
	};

	let val = match store.get("notification-settings") {
		Some(v) => v,
		None => return false,
	};

	let entry: model::notification::NotificationEntry =
		match serde_json::from_value(val) {
			Ok(e) => e,
			Err(_) => return false,
		};

	if !entry.state.enabled {
		return false;
	}

	crate::handler::sound::try_play_system_sound(&entry.state.sound)
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

#[cfg(test)]
mod tests {
	use std::net::TcpListener;

	use super::{find_free_port, resolve_sidecar_path, sidecar_binary_name};

	#[test]
	fn find_free_port_returns_a_bindable_local_port() {
		let port = find_free_port();
		let listener =
			TcpListener::bind(("127.0.0.1", port)).expect("bind free port");
		assert_eq!(listener.local_addr().expect("local addr").port(), port);
	}

	#[test]
	fn resolve_sidecar_path_uses_the_target_specific_helper_name() {
		let path = resolve_sidecar_path();

		assert_eq!(
			path.file_name()
				.and_then(|value| value.to_str())
				.map(str::to_owned),
			Some(sidecar_binary_name(env!("TARGET"))),
		);
		assert!(path.to_string_lossy().contains("2code-helper-"));
	}
}
