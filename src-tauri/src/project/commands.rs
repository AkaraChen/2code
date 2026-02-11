use diesel::prelude::*;
use pinyin::ToPinyin;
use slug::slugify;
use std::path::Path;
use std::process::Command;
use tauri::State;
use uuid::Uuid;

use super::models::{NewProject, Project};
use crate::schema::projects;
use crate::db::DbPool;

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

#[tauri::command]
pub fn create_project_temporary(
	name: Option<String>,
	state: State<'_, DbPool>,
) -> Result<Project, String> {
	let id = Uuid::new_v4().to_string();
	let dir_name = generate_dir_name(&name, &id);
	let dir = format!("/tmp/{}", dir_name);

	std::fs::create_dir_all(&dir)
		.map_err(|e| format!("Failed to create directory: {e}"))?;

	let output = Command::new("git")
		.arg("init")
		.current_dir(&dir)
		.output()
		.map_err(|e| format!("Failed to run git init: {e}"))?;

	if !output.status.success() {
		let _ = std::fs::remove_dir_all(&dir);
		let stderr = String::from_utf8_lossy(&output.stderr);
		return Err(format!("git init failed: {stderr}"));
	}

	let project_name = name.unwrap_or_else(|| "Untitled".to_string());
	let new_project = NewProject {
		id: &id,
		name: &project_name,
		folder: &dir,
	};

	let conn =
		&mut *state.lock().map_err(|e| format!("DB lock poisoned: {e}"))?;

	diesel::insert_into(projects::table)
		.values(&new_project)
		.execute(conn)
		.map_err(|e| format!("Failed to insert project: {e}"))?;

	projects::table
		.find(&id)
		.select(Project::as_select())
		.first(conn)
		.map_err(|e| format!("Failed to fetch project: {e}"))
}

#[tauri::command]
pub fn create_project_from_folder(
	name: String,
	folder: String,
	state: State<'_, DbPool>,
) -> Result<Project, String> {
	if !Path::new(&folder).exists() {
		return Err(format!("Folder does not exist: {folder}"));
	}

	let id = Uuid::new_v4().to_string();
	let new_project = NewProject {
		id: &id,
		name: &name,
		folder: &folder,
	};

	let conn =
		&mut *state.lock().map_err(|e| format!("DB lock poisoned: {e}"))?;

	diesel::insert_into(projects::table)
		.values(&new_project)
		.execute(conn)
		.map_err(|e| format!("Failed to insert project: {e}"))?;

	projects::table
		.find(&id)
		.select(Project::as_select())
		.first(conn)
		.map_err(|e| format!("Failed to fetch project: {e}"))
}

#[tauri::command]
pub fn list_projects(state: State<'_, DbPool>) -> Result<Vec<Project>, String> {
	let conn =
		&mut *state.lock().map_err(|e| format!("DB lock poisoned: {e}"))?;

	projects::table
		.select(Project::as_select())
		.load(conn)
		.map_err(|e| format!("Failed to list projects: {e}"))
}

#[tauri::command]
pub fn get_project(
	id: String,
	state: State<'_, DbPool>,
) -> Result<Project, String> {
	let conn =
		&mut *state.lock().map_err(|e| format!("DB lock poisoned: {e}"))?;

	projects::table
		.find(&id)
		.select(Project::as_select())
		.first(conn)
		.map_err(|_| format!("Project not found: {id}"))
}

#[tauri::command]
pub fn update_project(
	id: String,
	name: Option<String>,
	folder: Option<String>,
	state: State<'_, DbPool>,
) -> Result<Project, String> {
	let conn =
		&mut *state.lock().map_err(|e| format!("DB lock poisoned: {e}"))?;

	// Check project exists
	let existing: Project = projects::table
		.find(&id)
		.select(Project::as_select())
		.first(conn)
		.map_err(|_| format!("Project not found: {id}"))?;

	if let Some(ref new_name) = name {
		diesel::update(projects::table.find(&id))
			.set(projects::name.eq(new_name))
			.execute(conn)
			.map_err(|e| format!("Failed to update name: {e}"))?;
	}

	if let Some(ref new_folder) = folder {
		diesel::update(projects::table.find(&id))
			.set(projects::folder.eq(new_folder))
			.execute(conn)
			.map_err(|e| format!("Failed to update folder: {e}"))?;
	}

	// If nothing was provided, return existing as-is
	if name.is_none() && folder.is_none() {
		return Ok(existing);
	}

	projects::table
		.find(&id)
		.select(Project::as_select())
		.first(conn)
		.map_err(|e| format!("Failed to fetch updated project: {e}"))
}

#[tauri::command]
pub fn delete_project(
	id: String,
	state: State<'_, DbPool>,
) -> Result<(), String> {
	let conn =
		&mut *state.lock().map_err(|e| format!("DB lock poisoned: {e}"))?;

	let rows = diesel::delete(projects::table.find(&id))
		.execute(conn)
		.map_err(|e| format!("Failed to delete project: {e}"))?;

	if rows == 0 {
		return Err(format!("Project not found: {id}"));
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
