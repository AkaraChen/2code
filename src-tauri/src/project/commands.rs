use diesel::prelude::*;
use pinyin::ToPinyin;
use slug::slugify;
use std::path::Path;
use std::process::Command;
use tauri::State;
use uuid::Uuid;

use super::models::{NewProject, Project, UpdateProject};
use crate::db::DbPool;
use crate::error::{AppError, AppResult};
use crate::schema::projects;

fn generate_dir_name(name: &Option<String>, uuid: &str) -> String {
	let short_id = &uuid[..4];
	match name {
		Some(n) if !n.trim().is_empty() => {
			// Group consecutive non-pinyin chars together;
			// only insert spaces between pinyin syllables.
			let mut parts: Vec<String> = Vec::new();
			let mut buf = String::new();
			for c in n.chars() {
				if let Some(py) = c.to_pinyin() {
					if !buf.is_empty() {
						parts.push(buf.clone());
						buf.clear();
					}
					parts.push(py.plain().to_string());
				} else {
					buf.push(c);
				}
			}
			if !buf.is_empty() {
				parts.push(buf);
			}
			let slug = slugify(&parts.join(" "));
			if slug.is_empty() {
				uuid.to_string()
			} else {
				format!("{slug}-{short_id}")
			}
		}
		_ => uuid.to_string(),
	}
}

fn insert_and_fetch(
	conn: &mut SqliteConnection,
	id: &str,
	name: &str,
	folder: &str,
) -> AppResult<Project> {
	diesel::insert_into(projects::table)
		.values(&NewProject { id, name, folder })
		.execute(conn)
		.map_err(|e| AppError::DbError(e.to_string()))?;
	projects::table
		.find(id)
		.select(Project::as_select())
		.first(conn)
		.map_err(|e| AppError::DbError(e.to_string()))
}

#[tauri::command]
pub fn create_project_temporary(
	name: Option<String>,
	state: State<'_, DbPool>,
) -> AppResult<Project> {
	let id = Uuid::new_v4().to_string();
	let dir_name = generate_dir_name(&name, &id);
	let dir = std::env::temp_dir().join(dir_name);

	std::fs::create_dir_all(&dir)?;

	let output = Command::new("git")
		.arg("init")
		.current_dir(&dir)
		.output()?;

	if !output.status.success() {
		let _ = std::fs::remove_dir_all(&dir);
		let stderr = String::from_utf8_lossy(&output.stderr);
		return Err(AppError::PtyError(format!("git init failed: {stderr}")));
	}

	let project_name = name.unwrap_or_else(|| "Untitled".to_string());
	let conn = &mut *state.lock().map_err(|_| AppError::LockError)?;
	let dir_str = dir.to_string_lossy();

	insert_and_fetch(conn, &id, &project_name, &dir_str)
}

#[tauri::command]
pub fn create_project_from_folder(
	name: String,
	folder: String,
	state: State<'_, DbPool>,
) -> AppResult<Project> {
	if !Path::new(&folder).exists() {
		return Err(AppError::NotFound(format!("Folder: {folder}")));
	}

	let id = Uuid::new_v4().to_string();
	let conn = &mut *state.lock().map_err(|_| AppError::LockError)?;

	insert_and_fetch(conn, &id, &name, &folder)
}

#[tauri::command]
pub fn list_projects(state: State<'_, DbPool>) -> AppResult<Vec<Project>> {
	let conn = &mut *state.lock().map_err(|_| AppError::LockError)?;
	projects::table
		.select(Project::as_select())
		.load(conn)
		.map_err(|e| AppError::DbError(e.to_string()))
}

#[tauri::command]
pub fn get_project(id: String, state: State<'_, DbPool>) -> AppResult<Project> {
	let conn = &mut *state.lock().map_err(|_| AppError::LockError)?;
	projects::table
		.find(&id)
		.select(Project::as_select())
		.first(conn)
		.map_err(|_| AppError::NotFound(format!("Project: {id}")))
}

#[tauri::command]
pub fn update_project(
	id: String,
	name: Option<String>,
	folder: Option<String>,
	state: State<'_, DbPool>,
) -> AppResult<Project> {
	let conn = &mut *state.lock().map_err(|_| AppError::LockError)?;
	let target = projects::table.find(&id);

	if name.is_none() && folder.is_none() {
		return target
			.select(Project::as_select())
			.first(conn)
			.map_err(|_| AppError::NotFound(format!("Project: {id}")));
	}

	let changeset = UpdateProject { name, folder };
	let rows = diesel::update(target)
		.set(&changeset)
		.execute(conn)
		.map_err(|e| AppError::DbError(e.to_string()))?;

	if rows == 0 {
		return Err(AppError::NotFound(format!("Project: {id}")));
	}

	target
		.select(Project::as_select())
		.first(conn)
		.map_err(|e| AppError::DbError(e.to_string()))
}

#[tauri::command]
pub fn delete_project(id: String, state: State<'_, DbPool>) -> AppResult<()> {
	let conn = &mut *state.lock().map_err(|_| AppError::LockError)?;
	let rows = diesel::delete(projects::table.find(&id))
		.execute(conn)
		.map_err(|e| AppError::DbError(e.to_string()))?;
	if rows == 0 {
		return Err(AppError::NotFound(format!("Project: {id}")));
	}
	Ok(())
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
