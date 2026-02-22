use model::error::AppError;
use model::skill::Skill;

#[tauri::command]
pub fn list_skills() -> Result<Vec<Skill>, AppError> {
	service::skill::list()
}

#[tauri::command]
pub fn get_skill(name: String) -> Result<Skill, AppError> {
	service::skill::get(&name)
}

#[tauri::command]
pub fn create_skill(
	name: String,
	description: String,
	content: String,
) -> Result<Skill, AppError> {
	service::skill::create(&name, &description, &content)
}

#[tauri::command]
pub fn update_skill(
	name: String,
	description: Option<String>,
	content: Option<String>,
) -> Result<Skill, AppError> {
	service::skill::update(
		&name,
		description.as_deref(),
		content.as_deref(),
	)
}

#[tauri::command]
pub fn delete_skill(name: String) -> Result<(), AppError> {
	service::skill::delete(&name)
}
