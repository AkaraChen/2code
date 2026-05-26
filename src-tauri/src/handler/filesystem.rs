use std::collections::hash_map::DefaultHasher;
use std::collections::HashMap;
use std::fs::File;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};
use std::process::Command;

use flate2::read::GzDecoder;
use serde::Serialize;
use tauri::{AppHandle, Manager, State};
use zip::ZipArchive;

use infra::db::DbPool;
use model::error::AppError;
use model::filesystem::{
	FileSearchResult, FileTreeGitStatusEntry, ResolvedFilePath,
};

#[derive(Serialize)]
pub struct FilePreview {
	kind: String,
	file_path: String,
	mime_type: String,
	source_path: Option<String>,
	archive_entries: Option<Vec<ArchivePreviewEntry>>,
}

#[derive(Serialize)]
pub struct ArchivePreviewEntry {
	path: String,
	kind: String,
	size: Option<u64>,
}

const OFFICE_PREVIEW_MAX_BYTES: u64 = 50 * 1024 * 1024;
const ARCHIVE_PREVIEW_MAX_BYTES: u64 = 200 * 1024 * 1024;
const ARCHIVE_PREVIEW_MAX_ENTRIES: usize = 10_000;

fn previewable_image_mime_type(path: &Path) -> Option<&'static str> {
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

fn is_pdf_file(path: &Path) -> bool {
	path.extension()
		.map(|value| value.to_string_lossy().eq_ignore_ascii_case("pdf"))
		.unwrap_or(false)
}

fn is_office_file(path: &Path) -> bool {
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

fn is_archive_file(path: &Path) -> bool {
	let filename = path
		.file_name()
		.map(|value| value.to_string_lossy().to_lowercase())
		.unwrap_or_default();
	let extension = path
		.extension()
		.map(|value| value.to_string_lossy().to_lowercase())
		.unwrap_or_default();

	matches!(extension.as_str(), "zip" | "tar" | "gz" | "tgz")
		|| filename.ends_with(".tar.gz")
}

fn ensure_previewable_file(path: &Path) -> Result<std::fs::Metadata, AppError> {
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

fn normalize_archive_entry_path(path: &str, is_dir: bool) -> Option<String> {
	let normalized = path
		.replace('\\', "/")
		.trim_start_matches('/')
		.split('/')
		.filter(|part| !part.is_empty() && *part != "." && *part != "..")
		.collect::<Vec<_>>()
		.join("/");

	if normalized.is_empty() {
		return None;
	}

	if is_dir {
		Some(format!("{}/", normalized.trim_end_matches('/')))
	} else {
		Some(normalized)
	}
}

fn add_archive_entry(
	entries: &mut HashMap<String, ArchivePreviewEntry>,
	path: String,
	kind: &str,
	size: Option<u64>,
) {
	let mut current = String::new();
	for part in path.trim_end_matches('/').split('/') {
		if !current.is_empty() {
			current.push('/');
		}
		current.push_str(part);
		let directory_path = format!("{current}/");
		if directory_path != path {
			entries.entry(directory_path.clone()).or_insert(
				ArchivePreviewEntry {
					path: directory_path,
					kind: "directory".to_string(),
					size: None,
				},
			);
		}
	}

	entries.entry(path.clone()).or_insert(ArchivePreviewEntry {
		path,
		kind: kind.to_string(),
		size,
	});
}

fn sorted_archive_entries(
	entries: HashMap<String, ArchivePreviewEntry>,
) -> Vec<ArchivePreviewEntry> {
	let mut entries = entries.into_values().collect::<Vec<_>>();
	entries.sort_by(|left, right| {
		left.path
			.to_lowercase()
			.cmp(&right.path.to_lowercase())
			.then_with(|| {
				right.path.ends_with('/').cmp(&left.path.ends_with('/'))
			})
	});
	entries
}

fn ensure_archive_preview_size(
	metadata: &std::fs::Metadata,
) -> Result<(), AppError> {
	if metadata.len() > ARCHIVE_PREVIEW_MAX_BYTES {
		return Err(AppError::IoError(std::io::Error::other(
			"Archive file too large for preview (> 200MB)",
		)));
	}
	Ok(())
}

fn limit_archive_entry_count(count: usize) -> Result<(), AppError> {
	if count >= ARCHIVE_PREVIEW_MAX_ENTRIES {
		return Err(AppError::IoError(std::io::Error::other(
			"Archive contains too many entries to preview",
		)));
	}
	Ok(())
}

fn list_zip_archive_entries(
	path: &Path,
) -> Result<Vec<ArchivePreviewEntry>, AppError> {
	let file = File::open(path)?;
	let mut archive = ZipArchive::new(file)
		.map_err(|err| AppError::IoError(std::io::Error::other(err)))?;
	let mut entries = HashMap::new();

	for index in 0..archive.len() {
		limit_archive_entry_count(entries.len())?;
		let file = archive
			.by_index(index)
			.map_err(|err| AppError::IoError(std::io::Error::other(err)))?;
		let is_dir = file.is_dir();
		let Some(path) = normalize_archive_entry_path(file.name(), is_dir)
		else {
			continue;
		};
		add_archive_entry(
			&mut entries,
			path,
			if is_dir { "directory" } else { "file" },
			if is_dir { None } else { Some(file.size()) },
		);
	}

	Ok(sorted_archive_entries(entries))
}

fn list_tar_entries<R: std::io::Read>(
	reader: R,
) -> Result<Vec<ArchivePreviewEntry>, AppError> {
	let mut archive = tar::Archive::new(reader);
	let mut entries = HashMap::new();

	for entry in archive.entries()? {
		limit_archive_entry_count(entries.len())?;
		let entry = entry?;
		let header = entry.header();
		let is_dir = header.entry_type().is_dir();
		let size = header.size().ok();
		let path = entry.path().map_err(AppError::IoError)?;
		let Some(path) =
			normalize_archive_entry_path(&path.to_string_lossy(), is_dir)
		else {
			continue;
		};
		add_archive_entry(
			&mut entries,
			path,
			if is_dir { "directory" } else { "file" },
			if is_dir { None } else { size },
		);
	}

	Ok(sorted_archive_entries(entries))
}

fn list_gzip_archive_entries(
	path: &Path,
) -> Result<Vec<ArchivePreviewEntry>, AppError> {
	let filename = path
		.file_name()
		.map(|value| value.to_string_lossy().to_string())
		.unwrap_or_else(|| "archive.gz".to_string());
	let lower_filename = filename.to_lowercase();
	let file = File::open(path)?;

	if lower_filename.ends_with(".tar.gz") || lower_filename.ends_with(".tgz") {
		return list_tar_entries(GzDecoder::new(file));
	}

	let display_name = filename
		.strip_suffix(".gz")
		.or_else(|| filename.strip_suffix(".GZ"))
		.unwrap_or("decompressed");
	let mut entries = HashMap::new();
	add_archive_entry(&mut entries, display_name.to_string(), "file", None);
	Ok(sorted_archive_entries(entries))
}

fn list_archive_entries(
	path: &Path,
	metadata: &std::fs::Metadata,
) -> Result<Vec<ArchivePreviewEntry>, AppError> {
	ensure_archive_preview_size(metadata)?;
	let filename = path
		.file_name()
		.map(|value| value.to_string_lossy().to_lowercase())
		.unwrap_or_default();
	let extension = path
		.extension()
		.map(|value| value.to_string_lossy().to_lowercase())
		.unwrap_or_default();

	match extension.as_str() {
		"zip" => list_zip_archive_entries(path),
		"tar" => list_tar_entries(File::open(path)?),
		"gz" | "tgz" => list_gzip_archive_entries(path),
		_ if filename.ends_with(".tar.gz") => list_gzip_archive_entries(path),
		_ => Err(AppError::IoError(std::io::Error::other(
			"Archive format is not supported",
		))),
	}
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

fn convert_office_file_to_pdf(
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

fn profile_worktree_path(
	db: &DbPool,
	profile_id: &str,
) -> Result<String, AppError> {
	let conn = &mut *db.lock().map_err(|_| AppError::LockError)?;
	Ok(repo::profile::find_by_id(conn, profile_id)?.worktree_path)
}

#[tauri::command]
pub async fn list_file_tree_paths(
	path: String,
) -> Result<Vec<String>, AppError> {
	super::run_blocking(move || {
		infra::filesystem::list_file_tree_paths(Path::new(&path))
	})
	.await
}

#[tauri::command]
pub async fn list_file_tree_child_paths(
	root_path: String,
	parent_path: Option<String>,
) -> Result<Vec<String>, AppError> {
	super::run_blocking(move || {
		infra::filesystem::list_file_tree_child_paths(
			Path::new(&root_path),
			parent_path.as_deref(),
		)
	})
	.await
}

#[tauri::command]
pub async fn rename_file_tree_path(
	root_path: String,
	source_path: String,
	destination_path: String,
) -> Result<(), AppError> {
	super::run_blocking(move || {
		infra::filesystem::rename_file_tree_path(
			Path::new(&root_path),
			&source_path,
			&destination_path,
		)
	})
	.await
}

#[tauri::command]
pub async fn move_file_tree_paths(
	root_path: String,
	source_paths: Vec<String>,
	target_dir_path: Option<String>,
) -> Result<(), AppError> {
	super::run_blocking(move || {
		infra::filesystem::move_file_tree_paths(
			Path::new(&root_path),
			&source_paths,
			target_dir_path.as_deref(),
		)
	})
	.await
}

#[tauri::command]
pub async fn delete_file_tree_paths(
	root_path: String,
	paths: Vec<String>,
) -> Result<(), AppError> {
	super::run_blocking(move || {
		infra::filesystem::delete_file_tree_paths(Path::new(&root_path), &paths)
	})
	.await
}

#[tauri::command]
pub async fn create_file_tree_path(
	root_path: String,
	path: String,
	kind: String,
) -> Result<(), AppError> {
	super::run_blocking(move || {
		infra::filesystem::create_file_tree_path(
			Path::new(&root_path),
			&path,
			&kind,
		)
	})
	.await
}

fn reveal_path_in_file_manager_impl(path: &Path) -> Result<(), AppError> {
	if !path.exists() {
		return Err(AppError::NotFound(format!("Path: {}", path.display())));
	}

	#[cfg(target_os = "macos")]
	{
		let status = infra::no_window::command_without_windows_console("open")
			.arg("-R")
			.arg(path)
			.status()?;
		if status.success() {
			return Ok(());
		}

		return Err(AppError::IoError(std::io::Error::other(format!(
			"Failed to reveal path in Finder: {status}"
		))));
	}

	#[cfg(target_os = "windows")]
	{
		let status =
			infra::no_window::command_without_windows_console("explorer")
				.arg(format!("/select,{}", path.display()))
				.status()?;
		if status.success() {
			return Ok(());
		}

		return Err(AppError::IoError(std::io::Error::other(format!(
			"Failed to reveal path in File Explorer: {status}"
		))));
	}

	#[cfg(all(not(target_os = "macos"), not(target_os = "windows")))]
	{
		let target = if path.is_dir() {
			path.to_path_buf()
		} else {
			path.parent()
				.map(Path::to_path_buf)
				.unwrap_or_else(|| path.to_path_buf())
		};
		let status =
			infra::no_window::command_without_windows_console("xdg-open")
				.arg(&target)
				.status()?;
		if status.success() {
			return Ok(());
		}

		Err(AppError::IoError(std::io::Error::other(format!(
			"Failed to reveal path in file manager: {status}"
		))))
	}
}

fn open_path_in_default_app_impl(path: &Path) -> Result<(), AppError> {
	if !path.exists() {
		return Err(AppError::NotFound(format!("Path: {}", path.display())));
	}

	#[cfg(target_os = "macos")]
	{
		let status = infra::no_window::command_without_windows_console("open")
			.arg(path)
			.status()?;
		if status.success() {
			return Ok(());
		}

		return Err(AppError::IoError(std::io::Error::other(format!(
			"Failed to open path in default app: {status}"
		))));
	}

	#[cfg(target_os = "windows")]
	{
		let status = infra::no_window::command_without_windows_console("cmd")
			.args(["/C", "start", ""])
			.arg(path)
			.status()?;
		if status.success() {
			return Ok(());
		}

		return Err(AppError::IoError(std::io::Error::other(format!(
			"Failed to open path in default app: {status}"
		))));
	}

	#[cfg(all(not(target_os = "macos"), not(target_os = "windows")))]
	{
		let status =
			infra::no_window::command_without_windows_console("xdg-open")
				.arg(path)
				.status()?;
		if status.success() {
			return Ok(());
		}

		Err(AppError::IoError(std::io::Error::other(format!(
			"Failed to open path in default app: {status}"
		))))
	}
}

#[tauri::command]
pub async fn reveal_path_in_file_manager(path: String) -> Result<(), AppError> {
	super::run_blocking(move || {
		reveal_path_in_file_manager_impl(Path::new(&path))
	})
	.await
}

#[tauri::command]
pub async fn open_path_in_default_app(path: String) -> Result<(), AppError> {
	super::run_blocking(move || {
		open_path_in_default_app_impl(Path::new(&path))
	})
	.await
}

#[tauri::command]
pub async fn read_file_content(path: String) -> Result<String, AppError> {
	super::run_blocking(move || {
		let file_path = Path::new(&path);
		if !file_path.exists() {
			return Err(AppError::NotFound(format!("File: {path}")));
		}
		if file_path.is_dir() {
			return Err(AppError::IoError(std::io::Error::other(
				"Path is a directory",
			)));
		}

		let metadata = std::fs::metadata(&path)?;
		if metadata.len() > 1_000_000 {
			return Err(AppError::IoError(std::io::Error::other(
				"File too large (> 1MB)",
			)));
		}

		let bytes = std::fs::read(&path)?;

		// Heuristic binary check: presence of null bytes
		if bytes.contains(&0) {
			return Err(AppError::IoError(std::io::Error::other(
				"Binary file",
			)));
		}

		String::from_utf8(bytes).map_err(|_| {
			AppError::IoError(std::io::Error::other("Invalid UTF-8"))
		})
	})
	.await
}

#[tauri::command]
pub async fn write_file_content(
	path: String,
	content: String,
) -> Result<(), AppError> {
	super::run_blocking(move || {
		let file_path = Path::new(&path);
		if !file_path.exists() {
			return Err(AppError::NotFound(format!("File: {path}")));
		}
		if file_path.is_dir() {
			return Err(AppError::IoError(std::io::Error::other(
				"Path is a directory",
			)));
		}
		if content.len() > 1_000_000 {
			return Err(AppError::IoError(std::io::Error::other(
				"File too large (> 1MB)",
			)));
		}

		std::fs::write(&path, content)?;
		Ok(())
	})
	.await
}

#[tauri::command]
pub async fn get_file_preview(
	path: String,
	app: AppHandle,
) -> Result<FilePreview, AppError> {
	let cache_root = app
		.path()
		.app_cache_dir()
		.map_err(|err| AppError::IoError(std::io::Error::other(err)))?
		.join("office-preview");

	super::run_blocking(move || {
		let file_path = PathBuf::from(&path);
		let metadata = ensure_previewable_file(&file_path)?;
		let canonical_path =
			file_path.canonicalize().map_err(AppError::IoError)?;

		if let Some(mime_type) = previewable_image_mime_type(&canonical_path) {
			return Ok(FilePreview {
				kind: "image".to_string(),
				file_path: canonical_path.to_string_lossy().into_owned(),
				mime_type: mime_type.to_string(),
				source_path: None,
				archive_entries: None,
			});
		}

		if is_pdf_file(&canonical_path) {
			return Ok(FilePreview {
				kind: "pdf".to_string(),
				file_path: canonical_path.to_string_lossy().into_owned(),
				mime_type: "application/pdf".to_string(),
				source_path: None,
				archive_entries: None,
			});
		}

		if is_archive_file(&canonical_path) {
			let archive_entries =
				list_archive_entries(&canonical_path, &metadata)?;
			return Ok(FilePreview {
				kind: "archive".to_string(),
				file_path: canonical_path.to_string_lossy().into_owned(),
				mime_type: "application/x-archive".to_string(),
				source_path: None,
				archive_entries: Some(archive_entries),
			});
		}

		if is_office_file(&canonical_path) {
			let pdf_path = convert_office_file_to_pdf(
				&canonical_path,
				&cache_root,
				&metadata,
			)?;
			return Ok(FilePreview {
				kind: "office-pdf".to_string(),
				file_path: pdf_path.to_string_lossy().into_owned(),
				mime_type: "application/pdf".to_string(),
				source_path: Some(
					canonical_path.to_string_lossy().into_owned(),
				),
				archive_entries: None,
			});
		}

		Err(AppError::IoError(std::io::Error::other(
			"File type is not previewable",
		)))
	})
	.await
}

#[tauri::command]
pub async fn search_file(
	profile_id: String,
	query: String,
	state: State<'_, DbPool>,
) -> Result<Vec<FileSearchResult>, AppError> {
	let db = state.inner().clone();
	super::run_blocking(move || {
		let worktree_path = profile_worktree_path(&db, &profile_id)?;
		infra::filesystem::search_files(Path::new(&worktree_path), &query)
	})
	.await
}

#[tauri::command]
pub async fn get_file_tree_git_status(
	profile_id: String,
	state: State<'_, DbPool>,
) -> Result<Vec<FileTreeGitStatusEntry>, AppError> {
	let db = state.inner().clone();
	super::run_blocking(move || {
		let worktree_path = profile_worktree_path(&db, &profile_id)?;
		infra::git::status(&worktree_path)
	})
	.await
}

/// Resolves a (possibly relative) file path against the profile's worktree.
/// Returns either an exact match (canonical absolute path) if the file exists
/// within the worktree, or a list of fuzzy-matched candidates based on the
/// filename when the exact path doesn't exist.
#[tauri::command]
pub async fn resolve_terminal_file_path(
	profile_id: String,
	file_path: String,
	state: State<'_, DbPool>,
) -> Result<ResolvedFilePath, AppError> {
	let db = state.inner().clone();
	super::run_blocking(move || {
		let worktree = profile_worktree_path(&db, &profile_id)?;
		resolve_file_path_in_worktree(Path::new(&worktree), &file_path)
	})
	.await
}

fn resolve_file_path_in_worktree(
	worktree_path: &Path,
	file_path: &str,
) -> Result<ResolvedFilePath, AppError> {
	let requested_path = Path::new(file_path);
	let resolved = if requested_path.is_absolute() {
		requested_path.to_path_buf()
	} else {
		let clean = file_path.strip_prefix("./").unwrap_or(file_path);
		worktree_path.join(clean)
	};

	if resolved.is_file() {
		let canonical_resolved =
			resolved.canonicalize().map_err(AppError::IoError)?;
		let canonical_worktree =
			worktree_path.canonicalize().map_err(AppError::IoError)?;

		if !canonical_resolved.starts_with(&canonical_worktree) {
			return Err(AppError::IoError(std::io::Error::other(
				"Path is outside the workspace",
			)));
		}

		return Ok(ResolvedFilePath::Exact {
			path: canonical_resolved.to_string_lossy().into_owned(),
		});
	}

	let filename = requested_path
		.file_name()
		.map(|value| value.to_string_lossy().into_owned())
		.unwrap_or_else(|| file_path.to_string());
	let candidates = infra::filesystem::search_files(worktree_path, &filename)?;

	Ok(ResolvedFilePath::Fuzzy { candidates })
}

#[cfg(test)]
mod tests {
	use std::sync::{Arc, Mutex};

	use diesel::prelude::*;
	use diesel_migrations::MigrationHarness;
	use model::profile::NewProfile;
	use model::project::NewProject;
	use uuid::Uuid;

	use super::*;

	fn setup_db() -> DbPool {
		let mut conn =
			SqliteConnection::establish(":memory:").expect("in-memory db");
		conn.run_pending_migrations(infra::db::MIGRATIONS)
			.expect("run migrations");

		diesel::insert_into(model::schema::projects::table)
			.values(&NewProject {
				id: "proj-1",
				name: "Project",
				folder: "/repo",
				group_id: None,
			})
			.execute(&mut conn)
			.expect("insert project");

		diesel::insert_into(model::schema::profiles::table)
			.values(&NewProfile {
				id: "profile-1",
				project_id: "proj-1",
				branch_name: "main",
				worktree_path: "/repo/worktree",
				is_default: true,
			})
			.execute(&mut conn)
			.expect("insert profile");

		Arc::new(Mutex::new(conn))
	}

	fn temp_worktree() -> std::path::PathBuf {
		let path = std::env::temp_dir()
			.join(format!("2code-filesystem-test-{}", Uuid::new_v4()));
		std::fs::create_dir_all(&path).expect("create temp worktree");
		path
	}

	#[test]
	fn profile_worktree_path_reads_only_the_needed_field() {
		let db = setup_db();

		let worktree = profile_worktree_path(&db, "profile-1").unwrap();

		assert_eq!(worktree, "/repo/worktree");
	}

	#[test]
	fn profile_worktree_path_returns_not_found_for_missing_profile() {
		let db = setup_db();

		let result = profile_worktree_path(&db, "missing-profile");

		assert!(matches!(result, Err(AppError::NotFound(_))));
	}

	#[test]
	fn resolve_file_path_in_worktree_returns_exact_file_match() {
		let worktree = temp_worktree();
		let file_path = worktree.join("src/main.rs");
		std::fs::create_dir_all(file_path.parent().expect("parent"))
			.expect("create parent");
		std::fs::write(&file_path, "fn main() {}").expect("write file");

		let result =
			resolve_file_path_in_worktree(&worktree, "src/main.rs").unwrap();

		assert!(matches!(
			result,
			ResolvedFilePath::Exact { path } if path == file_path.canonicalize().unwrap().to_string_lossy()
		));
		std::fs::remove_dir_all(worktree).expect("cleanup temp worktree");
	}

	#[test]
	fn resolve_file_path_in_worktree_returns_fuzzy_candidates_when_missing() {
		let worktree = temp_worktree();
		let file_path = worktree.join("src/main.rs");
		std::fs::create_dir_all(file_path.parent().expect("parent"))
			.expect("create parent");
		std::fs::write(&file_path, "fn main() {}").expect("write file");

		let result =
			resolve_file_path_in_worktree(&worktree, "missing/main.rs")
				.unwrap();

		assert!(matches!(
			result,
			ResolvedFilePath::Fuzzy { candidates } if candidates.iter().any(|candidate| candidate.relative_path == "src/main.rs")
		));
		std::fs::remove_dir_all(worktree).expect("cleanup temp worktree");
	}

	#[test]
	fn resolve_file_path_in_worktree_rejects_exact_match_outside_worktree() {
		let temp_dir = temp_worktree();
		let worktree = temp_dir.join("worktree");
		let outside = temp_dir.join("outside.rs");
		std::fs::create_dir_all(&worktree).expect("create worktree");
		std::fs::write(&outside, "fn main() {}").expect("write outside");

		let result = resolve_file_path_in_worktree(
			&worktree,
			outside.to_string_lossy().as_ref(),
		);

		assert!(matches!(result, Err(AppError::IoError(_))));
		std::fs::remove_dir_all(temp_dir).expect("cleanup temp dir");
	}
}
