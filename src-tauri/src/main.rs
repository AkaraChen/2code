// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
	#[cfg(feature = "legacy-tauri")]
	{
		code_lib::run();
	}
	#[cfg(not(feature = "legacy-tauri"))]
	{
		gpui_app::run();
	}
}
