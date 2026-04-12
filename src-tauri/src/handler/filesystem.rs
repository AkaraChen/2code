use std::path::Path;

use model::error::AppError;
use model::filesystem::FileEntry;

#[tauri::command]
pub async fn list_directory(path: String) -> Result<Vec<FileEntry>, AppError> {
    super::run_blocking(move || {
        let dir = Path::new(&path);
        if !dir.is_dir() {
            return Err(AppError::NotFound(format!("Directory: {path}")));
        }

        let mut entries = Vec::new();
        for entry in std::fs::read_dir(dir)? {
            let entry = entry?;
            let name = entry.file_name().to_string_lossy().to_string();
            // Skip hidden files/dirs and the .git directory
            if name.starts_with('.') {
                continue;
            }
            let file_type = entry.file_type()?;
            entries.push(FileEntry {
                name,
                path: entry.path().to_string_lossy().to_string(),
                is_dir: file_type.is_dir(),
            });
        }

        // Directories first, then files, both case-insensitively alphabetical
        entries.sort_by(|a, b| match (a.is_dir, b.is_dir) {
            (true, false) => std::cmp::Ordering::Less,
            (false, true) => std::cmp::Ordering::Greater,
            _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
        });

        Ok(entries)
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
            return Err(AppError::IoError(std::io::Error::other("Binary file")));
        }

        String::from_utf8(bytes)
            .map_err(|_| AppError::IoError(std::io::Error::other("Invalid UTF-8")))
    })
    .await
}
