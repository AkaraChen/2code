use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::OnceLock;

use model::error::AppError;

const OFFICE_PREVIEW_MAX_BYTES: u64 = 50 * 1024 * 1024;
static SOFFICE_COMMAND: OnceLock<Option<PathBuf>> = OnceLock::new();

pub fn previewable_image_mime_type(path: &Path) -> Option<&'static str> {
	let extension = path.extension()?.to_string_lossy().to_lowercase();
	match extension.as_str() {
		"apng" => Some("image/apng"),
		"avif" => Some("image/avif"),
		"bmp" => Some("image/bmp"),
		"cur" | "ico" => Some("image/x-icon"),
		"gif" => Some("image/gif"),
		"jfif" | "jpe" | "jpeg" | "jpg" | "pjp" | "pjpeg" => Some("image/jpeg"),
		"png" => Some("image/png"),
		"svg" => Some("image/svg+xml"),
		"webp" => Some("image/webp"),
		_ => None,
	}
}

pub fn is_pdf_file(path: &Path) -> bool {
	path.extension()
		.map(|value| value.to_string_lossy().eq_ignore_ascii_case("pdf"))
		.unwrap_or(false)
}

pub fn is_office_file(path: &Path) -> bool {
	let Some(extension) = path.extension() else {
		return false;
	};

	matches!(
		extension.to_string_lossy().to_lowercase().as_str(),
		"doc"
			| "docx" | "xls"
			| "xlsx" | "ppt"
			| "pptx" | "odt"
			| "ods" | "odp"
	)
}

pub fn ensure_previewable_file(
	path: &Path,
) -> Result<std::fs::Metadata, AppError> {
	if !path.exists() {
		return Err(AppError::NotFound(format!(
			"File: {}",
			path.to_string_lossy()
		)));
	}
	if path.is_dir() {
		return Err(AppError::IoError(std::io::Error::other(
			"Path is a directory",
		)));
	}

	std::fs::metadata(path).map_err(AppError::IoError)
}

pub fn cache_preview_file(
	cache_root: &Path,
	path: &Path,
	metadata: &std::fs::Metadata,
) -> Result<PathBuf, AppError> {
	let file_name = path.file_name().ok_or_else(|| {
		AppError::IoError(std::io::Error::other(
			"Preview file has no file name",
		))
	})?;
	let modified = metadata
		.modified()
		.ok()
		.and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
		.map(|duration| (duration.as_secs(), duration.subsec_nanos()))
		.unwrap_or_default();
	let mut hasher = DefaultHasher::new();
	path.hash(&mut hasher);
	metadata.len().hash(&mut hasher);
	modified.hash(&mut hasher);

	let cache_path = cache_root
		.join(format!("{:016x}", hasher.finish()))
		.join(file_name);
	if std::fs::metadata(&cache_path)
		.is_ok_and(|cached| cached.is_file() && cached.len() == metadata.len())
	{
		return Ok(cache_path);
	}

	if let Some(parent) = cache_path.parent() {
		std::fs::create_dir_all(parent)?;
	}
	std::fs::copy(path, &cache_path)?;
	Ok(cache_path)
}

fn office_preview_cache_dir(
	cache_root: &Path,
	path: &Path,
	metadata: &std::fs::Metadata,
) -> Result<PathBuf, AppError> {
	let mut hasher = DefaultHasher::new();
	path.to_string_lossy().hash(&mut hasher);
	metadata.len().hash(&mut hasher);
	if let Ok(modified) = metadata.modified() {
		modified.hash(&mut hasher);
	}

	Ok(cache_root.join(format!("{:016x}", hasher.finish())))
}

fn find_soffice_command() -> Option<PathBuf> {
	SOFFICE_COMMAND
		.get_or_init(find_soffice_command_uncached)
		.clone()
}

fn find_soffice_command_uncached() -> Option<PathBuf> {
	let candidates: &[&str] = if cfg!(target_os = "macos") {
		&[
			"soffice",
			"libreoffice",
			"/Applications/LibreOffice.app/Contents/MacOS/soffice",
		]
	} else {
		&["soffice", "libreoffice"]
	};

	for candidate in candidates {
		let output = Command::new(candidate).arg("--version").output();
		if matches!(output, Ok(result) if result.status.success()) {
			return Some(PathBuf::from(candidate));
		}
	}

	None
}

pub fn convert_office_file_to_pdf(
	path: &Path,
	cache_root: &Path,
	metadata: &std::fs::Metadata,
) -> Result<PathBuf, AppError> {
	if metadata.len() > OFFICE_PREVIEW_MAX_BYTES {
		return Err(AppError::IoError(std::io::Error::other(
			"Office file too large for preview (> 50MB)",
		)));
	}

	let output_dir = office_preview_cache_dir(cache_root, path, metadata)?;
	std::fs::create_dir_all(&output_dir)?;

	let stem = path
		.file_stem()
		.map(|value| value.to_string_lossy().into_owned())
		.unwrap_or_else(|| "preview".to_string());
	let output_path = output_dir.join(format!("{stem}.pdf"));
	if output_path.is_file() {
		return Ok(output_path);
	}

	let soffice = find_soffice_command().ok_or_else(|| {
		AppError::IoError(std::io::Error::new(
			std::io::ErrorKind::NotFound,
			"LibreOffice is required to preview Office documents. Install LibreOffice or open this file in the default app.",
		))
	})?;

	let output = Command::new(soffice)
		.args(["--headless", "--convert-to", "pdf", "--outdir"])
		.arg(&output_dir)
		.arg(path)
		.output()?;

	if !output.status.success() {
		let stderr = String::from_utf8_lossy(&output.stderr);
		let stdout = String::from_utf8_lossy(&output.stdout);
		return Err(AppError::IoError(std::io::Error::other(format!(
			"Office preview conversion failed: {}{}",
			stderr.trim(),
			stdout.trim()
		))));
	}

	if output_path.is_file() {
		return Ok(output_path);
	}

	let converted_pdf = std::fs::read_dir(&output_dir)?
		.filter_map(Result::ok)
		.map(|entry| entry.path())
		.find(|candidate| is_pdf_file(candidate));

	converted_pdf.ok_or_else(|| {
		AppError::IoError(std::io::Error::other(
			"Office preview conversion did not produce a PDF",
		))
	})
}
