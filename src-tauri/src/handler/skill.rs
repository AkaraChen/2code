use model::error::AppError;
use model::skill::{SearchSkillResult, Skill};

#[tauri::command]
pub fn list_skills() -> Result<Vec<Skill>, AppError> {
	service::skill::list()
}

#[tauri::command]
pub fn get_skill(name: String) -> Result<Skill, AppError> {
	service::skill::get(&name)
}

#[tauri::command]
pub fn delete_skill(name: String) -> Result<(), AppError> {
	service::skill::delete(&name)
}

/// Search for skills on skills.sh via their API.
/// Proxied through the backend to avoid CORS issues in the webview.
#[tauri::command]
pub async fn search_skills(
	query: String,
	limit: Option<u32>,
) -> Result<Vec<SearchSkillResult>, AppError> {
	service::skill::search(&query, limit.unwrap_or(10)).await
}

#[tauri::command]
pub fn install_skill_from_registry(
	source: String,
	skill: String,
) -> Result<(), AppError> {
	service::skill::install_from_registry(&source, &skill)
}
