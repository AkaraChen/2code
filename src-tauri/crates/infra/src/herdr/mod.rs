//! Checksum-verified Herdr sidecar mapping, install checks, and discovery.
//!
//! Sidecar helpers locate the pinned executable and can run `herdr --version`.
//! Server namespace, probe, and detached startup live in [`process`].
//! Typed NDJSON requests live in [`transport`]. CLI `terminal session`
//! attach lives in [`terminal`]. None of these modules own worktrees or
//! stop the Herdr server.

pub mod process;
pub mod terminal;
pub mod transport;

use std::env;
use std::fs::{self, File};
use std::io;
use std::path::{Path, PathBuf};

use model::error::AppError;
use serde::Deserialize;
use sha2::{Digest, Sha256};
use zip::ZipArchive;

use crate::no_window::command_without_windows_console;

pub const PINNED_VERSION: &str = "0.9.0";
pub const PINNED_TAG: &str = "v0.9.0";
pub const PINNED_COMMIT: &str = "b99002ac99b09e00b4ca692436cb15a6b0d676f1";
pub const EXPECTED_VERSION_LINE: &str = "herdr 0.9.0";
/// Live-server / user-binary floor. The sidecar pin stays `PINNED_VERSION`.
pub const MIN_VERSION: &str = PINNED_VERSION;
pub const MIN_PROTOCOL: u64 = 22;
pub const SIDECAR_STEM: &str = "herdr";

const PIN_JSON: &str = include_str!("../../tests/fixtures/herdr/pin.json");

const TRIPLES: &[(&str, &str)] = &[
	("x86_64-unknown-linux-gnu", "x86_64-unknown-linux"),
	("aarch64-unknown-linux-gnu", "aarch64-unknown-linux"),
	("aarch64-apple-darwin", "aarch64-apple-darwin"),
	("x86_64-apple-darwin", "x86_64-apple-darwin"),
	("x86_64-pc-windows-msvc", "x86_64-pc-windows-msvc"),
];

#[derive(Debug, Deserialize)]
pub struct Pin {
	pub version: String,
	pub tag: String,
	pub source_commit: String,
	pub assets: Vec<PinAsset>,
}

#[derive(Debug, Deserialize)]
pub struct PinAsset {
	pub name: String,
	pub url: String,
	pub sha256: String,
	pub target: String,
	#[serde(default)]
	pub archive: bool,
	pub executable: String,
}

fn err(message: impl Into<String>) -> AppError {
	AppError::IoError(io::Error::other(message.into()))
}

pub fn load_pin() -> Result<Pin, AppError> {
	serde_json::from_str(PIN_JSON)
		.map_err(|error| err(format!("pin.json: {error}")))
}

pub fn host_triple() -> Result<&'static str, AppError> {
	#[cfg(all(target_os = "linux", target_arch = "x86_64"))]
	return Ok("x86_64-unknown-linux-gnu");
	#[cfg(all(target_os = "linux", target_arch = "aarch64"))]
	return Ok("aarch64-unknown-linux-gnu");
	#[cfg(all(target_os = "macos", target_arch = "aarch64"))]
	return Ok("aarch64-apple-darwin");
	#[cfg(all(target_os = "macos", target_arch = "x86_64"))]
	return Ok("x86_64-apple-darwin");
	#[cfg(all(target_os = "windows", target_arch = "x86_64"))]
	return Ok("x86_64-pc-windows-msvc");
	#[cfg(all(target_os = "windows", target_arch = "aarch64"))]
	return Err(err(
		"Windows ARM64 is unsupported; Herdr v0.9.0 has no stable asset",
	));
	#[cfg(not(any(
		all(target_os = "linux", target_arch = "x86_64"),
		all(target_os = "linux", target_arch = "aarch64"),
		all(target_os = "macos", target_arch = "aarch64"),
		all(target_os = "macos", target_arch = "x86_64"),
		all(target_os = "windows", target_arch = "x86_64"),
		all(target_os = "windows", target_arch = "aarch64"),
	)))]
	Err(err("unknown host triple for Herdr sidecar"))
}

pub fn sidecar_file_name(rustc_triple: &str) -> Result<String, AppError> {
	if rustc_triple.contains("windows") && rustc_triple.contains("aarch64") {
		return Err(err(
			"Windows ARM64 is unsupported; Herdr v0.9.0 has no stable asset",
		));
	}
	if !TRIPLES.iter().any(|(triple, _)| *triple == rustc_triple) {
		return Err(err(format!("unknown sidecar triple: {rustc_triple}")));
	}
	if rustc_triple.contains("windows") {
		Ok(format!("{SIDECAR_STEM}-{rustc_triple}.exe"))
	} else {
		Ok(format!("{SIDECAR_STEM}-{rustc_triple}"))
	}
}

pub fn pin_target_for_triple(
	rustc_triple: &str,
) -> Result<&'static str, AppError> {
	sidecar_file_name(rustc_triple)?;
	TRIPLES
		.iter()
		.find(|(triple, _)| *triple == rustc_triple)
		.map(|(_, pin_target)| *pin_target)
		.ok_or_else(|| err(format!("unknown sidecar triple: {rustc_triple}")))
}

pub fn asset_for_triple<'a>(
	pin: &'a Pin,
	rustc_triple: &str,
) -> Result<&'a PinAsset, AppError> {
	let pin_target = pin_target_for_triple(rustc_triple)?;
	let asset = pin
		.assets
		.iter()
		.find(|asset| asset.target == pin_target)
		.ok_or_else(|| err(format!("no pin.json asset for {rustc_triple}")))?;
	if asset.url.contains("/latest/")
		|| !asset.url.contains(&format!("/download/{PINNED_TAG}/"))
	{
		return Err(err(format!(
			"refusing to download latest or unpinned URL: {}",
			asset.url
		)));
	}
	Ok(asset)
}

pub fn sha256_hex(path: &Path) -> Result<String, AppError> {
	let bytes = fs::read(path)?;
	Ok(format!("{:x}", Sha256::digest(bytes)))
}

pub fn verify_sha256(path: &Path, expected: &str) -> Result<(), AppError> {
	let actual = sha256_hex(path)?;
	if actual != expected {
		return Err(err(format!(
			"SHA-256 mismatch for {}: expected {expected}, got {actual}",
			path.display()
		)));
	}
	Ok(())
}

fn extract_herdr_exe(zip_path: &Path, dest: &Path) -> Result<(), AppError> {
	let file = File::open(zip_path)?;
	let mut archive = ZipArchive::new(file)
		.map_err(|error| err(format!("zip open: {error}")))?;
	let mut exe = archive
		.by_name("herdr.exe")
		.map_err(|error| err(format!("zip missing herdr.exe: {error}")))?;
	if exe.is_dir() {
		return Err(err("zip member herdr.exe is a directory"));
	}
	let mut out = File::create(dest)?;
	io::copy(&mut exe, &mut out)?;
	Ok(())
}

pub fn install_verified_asset(
	asset_path: &Path,
	expected_sha256: &str,
	archive: bool,
	dest: &Path,
) -> Result<(), AppError> {
	verify_sha256(asset_path, expected_sha256)?;
	if let Some(parent) = dest.parent() {
		fs::create_dir_all(parent)?;
	}
	let tmp = dest.with_file_name(format!(
		"{}.tmp",
		dest.file_name()
			.ok_or_else(|| err("sidecar dest has no file name"))?
			.to_string_lossy()
	));
	let _ = fs::remove_file(&tmp);
	let installed = (|| {
		if archive {
			extract_herdr_exe(asset_path, &tmp)?;
		} else {
			fs::copy(asset_path, &tmp)?;
			verify_sha256(&tmp, expected_sha256)?;
		}
		#[cfg(unix)]
		{
			use std::os::unix::fs::PermissionsExt;
			fs::set_permissions(&tmp, fs::Permissions::from_mode(0o755))?;
		}
		fs::rename(&tmp, dest)?;
		Ok(())
	})();
	if installed.is_err() {
		let _ = fs::remove_file(&tmp);
	}
	installed
}

pub fn default_binaries_dir() -> PathBuf {
	Path::new(env!("CARGO_MANIFEST_DIR")).join("../../binaries")
}

pub fn default_exe_dir() -> Option<PathBuf> {
	let exe = std::env::current_exe().ok()?;
	let dir = exe.parent()?;
	if dir.file_name().is_some_and(|name| name == "deps") {
		dir.parent().map(Path::to_path_buf)
	} else {
		Some(dir.to_path_buf())
	}
}

pub fn cache_dir(version: &str) -> PathBuf {
	let root = std::env::var_os("XDG_CACHE_HOME")
		.map(PathBuf::from)
		.or_else(|| {
			std::env::var_os("HOME")
				.map(|home| PathBuf::from(home).join(".cache"))
		})
		.unwrap_or_else(std::env::temp_dir);
	root.join("2code/herdr").join(format!("v{version}"))
}

pub struct ResolveOptions<'a> {
	pub triple: &'a str,
	pub exe_dir: Option<&'a Path>,
	pub binaries_dir: Option<&'a Path>,
}

fn packaged_sidecar_name(rustc_triple: &str) -> &'static str {
	if rustc_triple.contains("windows") {
		"herdr.exe"
	} else {
		"herdr"
	}
}

pub fn try_resolve_sidecar(
	opts: &ResolveOptions<'_>,
) -> Result<Option<PathBuf>, AppError> {
	let file_name = sidecar_file_name(opts.triple)?;
	let packaged_name = packaged_sidecar_name(opts.triple);
	let exe_dir = opts.exe_dir.map(Path::to_path_buf).or_else(default_exe_dir);
	if let Some(exe_dir) = exe_dir {
		let packaged = exe_dir.join(packaged_name);
		if packaged.is_file() {
			return Ok(Some(packaged));
		}
		let triple_named = exe_dir.join(&file_name);
		if triple_named.is_file() {
			return Ok(Some(triple_named));
		}
	}
	let binaries = opts
		.binaries_dir
		.map(Path::to_path_buf)
		.unwrap_or_else(default_binaries_dir);
	let dev = binaries.join(file_name);
	if dev.is_file() {
		return Ok(Some(dev));
	}
	Ok(None)
}

pub fn resolve_sidecar(opts: &ResolveOptions<'_>) -> Result<PathBuf, AppError> {
	try_resolve_sidecar(opts)?.ok_or_else(|| {
		err(format!("Herdr sidecar not found for {}", opts.triple))
	})
}

pub fn sidecar_required() -> bool {
	std::env::var_os("HERDR_SIDECAR_REQUIRED").is_some()
}

fn herdr_path_names() -> &'static [&'static str] {
	#[cfg(windows)]
	{
		&["herdr.exe", "herdr"]
	}
	#[cfg(not(windows))]
	{
		&["herdr"]
	}
}

/// Look up a user-installed `herdr` in the given PATH directories.
pub fn find_herdr_in_dirs<I, P>(dirs: I) -> Option<PathBuf>
where
	I: IntoIterator<Item = P>,
	P: AsRef<Path>,
{
	for dir in dirs {
		for name in herdr_path_names() {
			let candidate = dir.as_ref().join(name);
			if candidate.is_file() {
				return Some(candidate);
			}
		}
	}
	None
}

/// Look up `herdr` on the process PATH. Sidecar fallback is separate.
pub fn find_herdr_on_path() -> Option<PathBuf> {
	let path = env::var_os("PATH")?;
	find_herdr_in_dirs(env::split_paths(&path))
}

pub fn parse_herdr_semver(text: &str) -> Option<(u64, u64, u64)> {
	let trimmed = text.trim();
	let rest = trimmed
		.strip_prefix("herdr")
		.map(str::trim)
		.unwrap_or(trimmed);
	let token = rest
		.split(|c: char| !(c.is_ascii_digit() || c == '.'))
		.find(|part| !part.is_empty())?;
	let mut parts = token.split('.');
	let major = parts.next()?.parse().ok()?;
	let minor = parts.next()?.parse().ok()?;
	let patch = parts.next().unwrap_or("0").parse().unwrap_or(0);
	Some((major, minor, patch))
}

pub fn herdr_version_meets_floor(text: &str) -> bool {
	parse_herdr_semver(text).is_some_and(|ver| ver >= (0, 9, 0))
}

pub fn old_binary_upgrade_message(found_version: &str) -> String {
	format!(
		"found Herdr {found_version}; required Herdr >= {MIN_VERSION} / protocol >= {MIN_PROTOCOL}; run `herdr update`"
	)
}

fn version_token_from_line(line: &str) -> Option<&str> {
	let rest = line.trim().strip_prefix("herdr")?.trim();
	rest.split(|c: char| c.is_whitespace() || c == '-' || c == '+')
		.find(|part| !part.is_empty())
}

#[cfg(test)]
pub(crate) fn lock_live_herdr_tests() -> std::sync::MutexGuard<'static, ()> {
	static LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());
	LOCK.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

pub fn report_version(executable: &Path) -> Result<String, AppError> {
	let output = command_without_windows_console(executable)
		.arg("--version")
		.output()?;
	if !output.status.success() {
		return Err(err(format!(
			"herdr --version failed ({:?}): {}",
			output.status.code(),
			String::from_utf8_lossy(&output.stderr)
		)));
	}
	let stdout = String::from_utf8_lossy(&output.stdout);
	let line = stdout
		.lines()
		.map(str::trim)
		.find(|line| !line.is_empty())
		.unwrap_or("");
	if herdr_version_meets_floor(line) {
		return Ok(line.to_string());
	}
	if parse_herdr_semver(line).is_some() {
		let found = version_token_from_line(line).unwrap_or(line);
		return Err(err(old_binary_upgrade_message(found)));
	}
	Err(err(format!(
		"unexpected herdr --version: {line:?} (required Herdr >= {MIN_VERSION})"
	)))
}

pub fn locate_cached_host_binary() -> Result<Option<PathBuf>, AppError> {
	let pin = load_pin()?;
	let triple = host_triple()?;
	let asset = asset_for_triple(&pin, triple)?;
	if asset.archive {
		return Ok(None);
	}
	let cached = cache_dir(&pin.version).join(&asset.name);
	if !cached.is_file() {
		return Ok(None);
	}
	verify_sha256(&cached, &asset.sha256)?;
	Ok(Some(cached))
}

#[cfg(test)]
mod tests {
	use super::*;
	use std::io::Write;
	use zip::write::SimpleFileOptions;
	use zip::{CompressionMethod, ZipWriter};

	fn write_zip(path: &Path, files: &[(&str, &[u8])]) {
		let file = File::create(path).unwrap();
		let mut zip = ZipWriter::new(file);
		let options = SimpleFileOptions::default()
			.compression_method(CompressionMethod::Deflated);
		for (name, body) in files {
			zip.start_file(*name, options).unwrap();
			zip.write_all(body).unwrap();
		}
		zip.finish().unwrap();
	}

	#[cfg(unix)]
	fn write_executable(path: &Path, body: &str) {
		use std::os::unix::fs::PermissionsExt;
		fs::write(path, body).unwrap();
		fs::set_permissions(path, fs::Permissions::from_mode(0o755)).unwrap();
	}

	#[test]
	fn pin_maps_every_supported_triple_and_never_latest() {
		let pin = load_pin().unwrap();
		assert_eq!(pin.version, PINNED_VERSION);
		assert_eq!(pin.tag, PINNED_TAG);
		assert_eq!(pin.source_commit, PINNED_COMMIT);
		assert_eq!(pin.assets.len(), 5);
		for (triple, _) in TRIPLES {
			let asset = asset_for_triple(&pin, triple).unwrap();
			assert!(
				asset.url.contains(&format!("/download/{PINNED_TAG}/")),
				"{}",
				asset.url
			);
			assert!(!asset.url.contains("/latest/"), "{}", asset.url);
			assert_eq!(asset.sha256.len(), 64, "{}", asset.name);
			let dest = sidecar_file_name(triple).unwrap();
			assert!(dest.starts_with("herdr-"), "{dest}");
			if triple.contains("windows") {
				assert!(asset.archive, "{}", asset.name);
				assert_eq!(asset.executable, "herdr.exe");
				assert!(dest.ends_with(".exe"), "{dest}");
			} else {
				assert!(!asset.archive, "{}", asset.name);
				assert!(!dest.ends_with(".exe"), "{dest}");
			}
		}
	}

	#[test]
	fn unknown_triple_and_windows_arm64_fail_closed() {
		let pin = load_pin().unwrap();
		let unknown =
			sidecar_file_name("x86_64-unknown-linux-musl").unwrap_err();
		assert!(unknown.to_string().contains("unknown sidecar triple"));
		let arm = sidecar_file_name("aarch64-pc-windows-msvc").unwrap_err();
		assert!(arm.to_string().contains("Windows ARM64"));
		assert!(asset_for_triple(&pin, "aarch64-pc-windows-msvc").is_err());
	}

	#[test]
	fn checksum_mismatch_refuses_to_install() {
		let tmp = tempfile::tempdir().unwrap();
		let asset = tmp.path().join("herdr-linux-x86_64");
		let dest = tmp.path().join("herdr-x86_64-unknown-linux-gnu");
		fs::write(&asset, b"not-the-pinned-binary").unwrap();
		let expected = "0".repeat(64);
		let err = install_verified_asset(&asset, &expected, false, &dest)
			.unwrap_err();
		assert!(err.to_string().contains("SHA-256 mismatch"));
		assert!(!dest.exists());
	}

	#[test]
	fn windows_zip_extracts_herdr_exe_after_digest_matches() {
		let tmp = tempfile::tempdir().unwrap();
		let zip_path = tmp.path().join("herdr-windows-x86_64.zip");
		write_zip(&zip_path, &[("herdr.exe", b"fake-herdr-exe")]);
		let digest = sha256_hex(&zip_path).unwrap();
		let dest = tmp.path().join("herdr-x86_64-pc-windows-msvc.exe");
		install_verified_asset(&zip_path, &digest, true, &dest).unwrap();
		assert_eq!(fs::read(&dest).unwrap(), b"fake-herdr-exe");

		let missing = tmp.path().join("missing.exe");
		let err = install_verified_asset(
			&zip_path,
			"1".repeat(64).as_str(),
			true,
			&missing,
		)
		.unwrap_err();
		assert!(err.to_string().contains("SHA-256 mismatch"));
		assert!(!missing.exists());
	}

	#[test]
	fn windows_zip_without_herdr_exe_does_not_install() {
		let tmp = tempfile::tempdir().unwrap();
		let zip_path = tmp.path().join("empty.zip");
		write_zip(&zip_path, &[("README.txt", b"no exe")]);
		let digest = sha256_hex(&zip_path).unwrap();
		let dest = tmp.path().join("herdr-x86_64-pc-windows-msvc.exe");
		let err = install_verified_asset(&zip_path, &digest, true, &dest)
			.unwrap_err();
		assert!(err.to_string().contains("herdr.exe"));
		assert!(!dest.exists());
	}

	#[cfg(unix)]
	#[test]
	fn packaged_layout_reports_pinned_version() {
		let tmp = tempfile::tempdir().unwrap();
		let exe_dir = tmp.path().join("usr/lib/2code");
		fs::create_dir_all(&exe_dir).unwrap();
		fs::write(exe_dir.join("2code"), b"").unwrap();
		write_executable(
			&exe_dir.join("herdr"),
			"#!/bin/sh\necho \"$@\" > \"$0.args\"\nif [ \"$1\" = server ]; then exit 99; fi\necho 'herdr 0.9.0'\n",
		);
		let resolved = resolve_sidecar(&ResolveOptions {
			triple: "x86_64-unknown-linux-gnu",
			exe_dir: Some(&exe_dir),
			binaries_dir: Some(tmp.path()),
		})
		.unwrap();
		assert_eq!(resolved, exe_dir.join("herdr"));
		assert_eq!(report_version(&resolved).unwrap(), EXPECTED_VERSION_LINE);
		let args = fs::read_to_string(exe_dir.join("herdr.args")).unwrap();
		assert_eq!(args.trim(), "--version");
	}

	#[cfg(unix)]
	#[test]
	fn dev_binaries_layout_resolves_triple_suffix() {
		let tmp = tempfile::tempdir().unwrap();
		let binaries = tmp.path().join("binaries");
		fs::create_dir_all(&binaries).unwrap();
		let name = sidecar_file_name("x86_64-unknown-linux-gnu").unwrap();
		write_executable(
			&binaries.join(&name),
			"#!/bin/sh\necho 'herdr 0.9.0'\n",
		);
		let resolved = resolve_sidecar(&ResolveOptions {
			triple: "x86_64-unknown-linux-gnu",
			exe_dir: Some(tmp.path()),
			binaries_dir: Some(&binaries),
		})
		.unwrap();
		assert_eq!(resolved, binaries.join(name));
		assert_eq!(report_version(&resolved).unwrap(), EXPECTED_VERSION_LINE);
	}

	#[test]
	fn live_sidecar_reports_pinned_version_when_present() {
		let path = match try_live_binary() {
			Some(path) => path,
			None if sidecar_required() => {
				panic!(
					"HERDR_SIDECAR_REQUIRED=1 but no checksum-verified Herdr v0.9.0 binary was found"
				);
			}
			None => {
				eprintln!(
					"skipping live sidecar --version (set HERDR_SIDECAR_REQUIRED=1 to fail)"
				);
				return;
			}
		};
		assert_eq!(report_version(&path).unwrap(), EXPECTED_VERSION_LINE);
	}

	fn try_live_binary() -> Option<PathBuf> {
		if let Ok(Some(cached)) = locate_cached_host_binary() {
			return Some(cached);
		}
		let triple = host_triple().ok()?;
		try_resolve_sidecar(&ResolveOptions {
			triple,
			exe_dir: None,
			binaries_dir: Some(&default_binaries_dir()),
		})
		.ok()
		.flatten()
	}

	#[test]
	fn packaged_bundle_layout_runs_real_binary_when_present() {
		let Some(src) = try_live_binary() else {
			if sidecar_required() {
				panic!(
					"HERDR_SIDECAR_REQUIRED=1 but no checksum-verified Herdr v0.9.0 binary was found"
				);
			}
			eprintln!("skipping packaged-layout live --version");
			return;
		};
		let tmp = tempfile::tempdir().unwrap();
		let exe_dir = tmp.path().join("usr/lib/2code");
		fs::create_dir_all(&exe_dir).unwrap();
		let dest_name = packaged_sidecar_name(host_triple().unwrap());
		let dest = exe_dir.join(dest_name);
		fs::copy(&src, &dest).unwrap();
		#[cfg(unix)]
		{
			use std::os::unix::fs::PermissionsExt;
			fs::set_permissions(&dest, fs::Permissions::from_mode(0o755))
				.unwrap();
		}
		let resolved = resolve_sidecar(&ResolveOptions {
			triple: host_triple().unwrap(),
			exe_dir: Some(&exe_dir),
			binaries_dir: Some(tmp.path()),
		})
		.unwrap();
		assert_eq!(resolved, dest);
		assert_eq!(report_version(&resolved).unwrap(), EXPECTED_VERSION_LINE);
	}

	#[test]
	fn tauri_registers_sidecar_without_frontend_spawn() {
		let src_tauri = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
		let conf =
			fs::read_to_string(src_tauri.join("tauri.conf.json")).unwrap();
		assert!(
			conf.contains("\"externalBin\""),
			"tauri.conf.json must register the Herdr sidecar"
		);
		assert!(conf.contains("binaries/herdr"));
		let caps =
			fs::read_to_string(src_tauri.join("capabilities/default.json"))
				.unwrap();
		assert!(
			!caps.contains("binaries/herdr"),
			"do not grant a frontend-spawnable Herdr sidecar"
		);
		assert!(!caps.contains("\"sidecar\": true"));
		assert!(!caps.contains("\"sidecar\":true"));
	}

	#[test]
	fn vendored_license_records_the_pin() {
		let dir = Path::new(env!("CARGO_MANIFEST_DIR"))
			.join("../../licenses/herdr-0.9.0");
		let license = fs::read_to_string(dir.join("LICENSE")).unwrap();
		assert!(license.contains("Apache License"));
		let notice = fs::read_to_string(dir.join("NOTICE")).unwrap();
		assert!(notice.contains(PINNED_COMMIT));
		assert!(notice.contains(PINNED_VERSION));
		assert!(!notice.contains("/releases/latest"));
	}

	#[test]
	fn version_floor_accepts_newer_herdr_and_rejects_older() {
		assert_eq!(parse_herdr_semver("herdr 0.9.0"), Some((0, 9, 0)));
		assert_eq!(parse_herdr_semver("0.10.0"), Some((0, 10, 0)));
		assert_eq!(parse_herdr_semver("herdr 0.8.2"), Some((0, 8, 2)));
		assert!(herdr_version_meets_floor("herdr 0.9.0"));
		assert!(herdr_version_meets_floor("herdr 0.9.1"));
		assert!(herdr_version_meets_floor("herdr 0.10.0"));
		assert!(!herdr_version_meets_floor("herdr 0.8.2"));
		assert!(!herdr_version_meets_floor("not-herdr"));
		let upgrade = old_binary_upgrade_message("0.8.2");
		assert!(upgrade.contains("0.8.2"), "{upgrade}");
		assert!(upgrade.contains(MIN_VERSION), "{upgrade}");
		assert!(upgrade.contains(&MIN_PROTOCOL.to_string()), "{upgrade}");
		assert!(upgrade.contains("herdr update"), "{upgrade}");
	}

	#[cfg(unix)]
	#[test]
	fn report_version_accepts_newer_user_binary_and_names_update_for_old() {
		let tmp = tempfile::tempdir().unwrap();
		let newer = tmp.path().join("herdr-newer");
		write_executable(&newer, "#!/bin/sh\necho 'herdr 0.10.0'\n");
		assert_eq!(report_version(&newer).unwrap(), "herdr 0.10.0");

		let patch = tmp.path().join("herdr-patch");
		write_executable(&patch, "#!/bin/sh\necho 'herdr 0.9.1'\n");
		assert_eq!(report_version(&patch).unwrap(), "herdr 0.9.1");

		let old = tmp.path().join("herdr-old");
		write_executable(&old, "#!/bin/sh\necho 'herdr 0.8.2'\n");
		let err = report_version(&old).unwrap_err().to_string();
		assert!(err.contains("0.8.2"), "{err}");
		assert!(err.contains(MIN_VERSION), "{err}");
		assert!(err.contains("herdr update"), "{err}");
		assert!(!err.contains("absent"), "{err}");

		let junk = tmp.path().join("not-herdr");
		write_executable(&junk, "#!/bin/sh\necho not-herdr\n");
		let junk_err = report_version(&junk).unwrap_err().to_string();
		assert!(
			junk_err.contains("unexpected herdr --version"),
			"{junk_err}"
		);
		assert!(!junk_err.contains("herdr update"), "{junk_err}");
	}

	#[cfg(unix)]
	#[test]
	fn path_lookup_prefers_user_herdr_and_ignores_missing_dirs() {
		let tmp = tempfile::tempdir().unwrap();
		let path_dir = tmp.path().join("bin");
		let other = tmp.path().join("other");
		fs::create_dir_all(&path_dir).unwrap();
		fs::create_dir_all(&other).unwrap();
		write_executable(
			&path_dir.join("herdr"),
			"#!/bin/sh\necho 'herdr 0.9.1'\n",
		);
		write_executable(
			&other.join("herdr"),
			"#!/bin/sh\necho 'herdr 0.9.0'\n",
		);
		let found = find_herdr_in_dirs([&path_dir, &other]).unwrap();
		assert_eq!(found, path_dir.join("herdr"));
		assert_eq!(find_herdr_in_dirs([tmp.path().join("missing")]), None);
	}
}
