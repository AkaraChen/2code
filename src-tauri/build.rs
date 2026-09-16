use std::path::PathBuf;
use std::process::Command;

fn main() {
	ensure_herdr_sidecar();
	println!(
		"cargo:rustc-env=TARGET={}",
		std::env::var("TARGET").unwrap()
	);
	tauri_build::build()
}

fn ensure_herdr_sidecar() {
	let manifest = PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").unwrap());
	let target = std::env::var("TARGET").unwrap();
	let ext = if target.contains("windows") {
		".exe"
	} else {
		""
	};
	let dest = manifest.join(format!("binaries/herdr-{target}{ext}"));
	println!("cargo:rerun-if-changed={}", dest.display());
	println!("cargo:rerun-if-env-changed=TARGET");
	println!(
		"cargo:rerun-if-changed={}",
		manifest.join("../scripts/herdr-sidecar.mjs").display()
	);
	if dest.is_file() {
		return;
	}

	let script = manifest.join("../scripts/herdr-sidecar.mjs");
	let mut missing_runner = None;
	for cmd in ["bun", "node"] {
		match Command::new(cmd)
			.arg(&script)
			.arg("--target")
			.arg(&target)
			.status()
		{
			Ok(status) if status.success() => return,
			Ok(status) => panic!(
				"Herdr sidecar fetch with {cmd} failed ({status}). Refusing to bundle an unverified binary."
			),
			Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
				missing_runner = Some(cmd);
			}
			Err(err) => {
				panic!("Herdr sidecar fetch with {cmd} failed: {err}")
			}
		}
	}
	panic!(
		"Herdr sidecar missing at {}. Install bun or node, then run: bun ./scripts/herdr-sidecar.mjs --target {target} (tried {:?})",
		dest.display(),
		missing_runner
	);
}
