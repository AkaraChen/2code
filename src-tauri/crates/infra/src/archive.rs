use std::collections::HashMap;
use std::fs::File;
use std::path::Path;

use flate2::read::GzDecoder;
use model::error::AppError;
use model::filesystem::ArchivePreviewEntry;
use zip::ZipArchive;

const ARCHIVE_PREVIEW_MAX_BYTES: u64 = 200 * 1024 * 1024;
const ARCHIVE_PREVIEW_MAX_ENTRIES: usize = 10_000;

pub fn is_archive_file(path: &Path) -> bool {
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
	entries.sort_by_cached_key(|entry| {
		(entry.path.to_lowercase(), !entry.path.ends_with('/'))
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

pub fn list_archive_entries(
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
