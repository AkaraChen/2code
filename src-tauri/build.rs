fn main() {
	println!(
		"cargo:rustc-env=TARGET={}",
		std::env::var("TARGET").unwrap()
	);
	if cfg!(feature = "legacy-tauri") {
		tauri_build::build();
	}
}