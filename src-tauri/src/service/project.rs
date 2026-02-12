use std::path::Path;

use diesel::SqliteConnection;
use uuid::Uuid;

use crate::error::{AppError, AppResult};
use crate::model::project::{GitCommit, Project};

fn generate_dir_name(name: &Option<String>, uuid: &str) -> String {
	let short_id = &uuid[..4];
	match name {
		Some(n) if !n.trim().is_empty() => {
			let slug = crate::infra::slug::slugify_cjk(n);
			if slug.is_empty() {
				uuid.to_string()
			} else {
				format!("{slug}-{short_id}")
			}
		}
		_ => uuid.to_string(),
	}
}

pub fn create_temporary(
	conn: &mut SqliteConnection,
	name: Option<String>,
) -> AppResult<Project> {
	let id = Uuid::new_v4().to_string();
	let dir_name = generate_dir_name(&name, &id);
	let dir = std::env::temp_dir().join(dir_name);

	std::fs::create_dir_all(&dir)?;

	if let Err(e) = crate::infra::git::init(&dir) {
		let _ = std::fs::remove_dir_all(&dir);
		return Err(e);
	}

	let project_name = name.unwrap_or_else(|| "Untitled".to_string());
	let dir_str = dir.to_string_lossy();

	crate::repo::project::insert(conn, &id, &project_name, &dir_str)
}

pub fn create_from_folder(
	conn: &mut SqliteConnection,
	name: &str,
	folder: &str,
) -> AppResult<Project> {
	if !Path::new(folder).exists() {
		return Err(AppError::NotFound(format!("Folder: {folder}")));
	}

	let id = Uuid::new_v4().to_string();
	crate::repo::project::insert(conn, &id, name, folder)
}

pub fn list(conn: &mut SqliteConnection) -> AppResult<Vec<Project>> {
	crate::repo::project::list_all(conn)
}

pub fn get(conn: &mut SqliteConnection, id: &str) -> AppResult<Project> {
	crate::repo::project::find_by_id(conn, id)
}

pub fn update(
	conn: &mut SqliteConnection,
	id: &str,
	name: Option<String>,
	folder: Option<String>,
) -> AppResult<Project> {
	crate::repo::project::update(conn, id, name, folder)
}

pub fn delete(conn: &mut SqliteConnection, id: &str) -> AppResult<()> {
	crate::repo::project::delete(conn, id)
}

pub fn get_branch(folder: &str) -> AppResult<String> {
	crate::infra::git::branch(folder)
}

pub fn get_diff(
	conn: &mut SqliteConnection,
	context_id: &str,
) -> AppResult<String> {
	let folder =
		crate::repo::project::resolve_context_folder(conn, context_id)?;
	crate::infra::git::diff(&folder)
}

pub fn get_log(
	conn: &mut SqliteConnection,
	context_id: &str,
	limit: u32,
) -> AppResult<Vec<GitCommit>> {
	let folder =
		crate::repo::project::resolve_context_folder(conn, context_id)?;
	crate::infra::git::log(&folder, limit)
}

pub fn get_commit_diff(
	conn: &mut SqliteConnection,
	context_id: &str,
	commit_hash: &str,
) -> AppResult<String> {
	let folder =
		crate::repo::project::resolve_context_folder(conn, context_id)?;
	crate::infra::git::show(&folder, commit_hash)
}

#[cfg(test)]
mod tests {
	use super::*;

	const FAKE_UUID: &str = "a3f2b1c4-5678-9abc-def0-123456789abc";

	#[test]
	fn dir_name_none() {
		let result = generate_dir_name(&None, FAKE_UUID);
		assert_eq!(result, FAKE_UUID);
	}

	#[test]
	fn dir_name_empty() {
		let result = generate_dir_name(&Some("".into()), FAKE_UUID);
		assert_eq!(result, FAKE_UUID);
	}

	#[test]
	fn dir_name_whitespace_only() {
		let result = generate_dir_name(&Some("   ".into()), FAKE_UUID);
		assert_eq!(result, FAKE_UUID);
	}

	#[test]
	fn dir_name_english() {
		let result = generate_dir_name(&Some("My Project".into()), FAKE_UUID);
		assert_eq!(result, "my-project-a3f2");
	}

	#[test]
	fn dir_name_chinese() {
		let result = generate_dir_name(&Some("我的项目".into()), FAKE_UUID);
		assert_eq!(result, "wo-de-xiang-mu-a3f2");
	}

	#[test]
	fn dir_name_japanese() {
		let result = generate_dir_name(&Some("プロジェクト".into()), FAKE_UUID);
		assert_eq!(result, "puroziekuto-a3f2");
	}

	#[test]
	fn dir_name_korean() {
		let result = generate_dir_name(&Some("프로젝트".into()), FAKE_UUID);
		assert_eq!(result, "peurojegteu-a3f2");
	}

	#[test]
	fn dir_name_cyrillic() {
		let result = generate_dir_name(&Some("Проект".into()), FAKE_UUID);
		assert_eq!(result, "proekt-a3f2");
	}

	#[test]
	fn dir_name_hebrew() {
		let result = generate_dir_name(&Some("פרויקט".into()), FAKE_UUID);
		assert_eq!(result, "prvyqt-a3f2");
	}

	#[test]
	fn dir_name_arabic() {
		let result = generate_dir_name(&Some("مشروع".into()), FAKE_UUID);
		assert_eq!(result, "mshrw-a3f2");
	}

	#[test]
	fn dir_name_mixed_chinese_english() {
		let result = generate_dir_name(&Some("我的Project".into()), FAKE_UUID);
		assert_eq!(result, "wo-de-project-a3f2");
	}
}
