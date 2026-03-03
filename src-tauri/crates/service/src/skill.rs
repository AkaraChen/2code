use std::fs;
use std::path::PathBuf;

use model::error::AppError;
use model::skill::Skill;

/// Global skills directory: ~/.claude/skills/
fn skills_dir() -> Result<PathBuf, AppError> {
	let home = dirs::home_dir()
		.ok_or_else(|| AppError::IoError(std::io::Error::other("no home dir")))?;
	Ok(home.join(".claude").join("skills"))
}

/// Parse YAML frontmatter and markdown body from SKILL.md content.
/// Format:
/// ```text
/// ---
/// name: my-skill
/// description: Does something useful
/// ---
/// Body content here...
/// ```
fn parse_skill_md(raw: &str) -> (String, String) {
	let trimmed = raw.trim_start();
	if !trimmed.starts_with("---") {
		// No frontmatter — entire content is the body
		return (String::new(), raw.to_string());
	}

	// Find the closing ---
	let after_open = &trimmed[3..];
	if let Some(close_pos) = after_open.find("\n---") {
		let frontmatter = &after_open[..close_pos];
		let body = &after_open[close_pos + 4..]; // skip \n---
		let body = body.strip_prefix('\n').unwrap_or(body);

		// Extract description from frontmatter (simple line-based parsing)
		let mut description = String::new();
		for line in frontmatter.lines() {
			let line = line.trim();
			if let Some(rest) = line.strip_prefix("description:") {
				description = rest.trim().trim_matches('"').to_string();
			}
		}

		(description, body.to_string())
	} else {
		// Malformed frontmatter — treat as body
		(String::new(), raw.to_string())
	}
}

/// Serialize a skill back into SKILL.md format with frontmatter.
fn serialize_skill_md(name: &str, description: &str, content: &str) -> String {
	format!(
		"---\nname: {name}\ndescription: \"{description}\"\n---\n{content}"
	)
}

pub fn list() -> Result<Vec<Skill>, AppError> {
	let dir = skills_dir()?;
	if !dir.exists() {
		return Ok(Vec::new());
	}

	let mut skills = Vec::new();
	let entries = fs::read_dir(&dir).map_err(AppError::IoError)?;

	for entry in entries {
		let entry = entry.map_err(AppError::IoError)?;
		let path = entry.path();
		if !path.is_dir() {
			continue;
		}

		let skill_file = path.join("SKILL.md");
		if !skill_file.exists() {
			continue;
		}

		let name = path
			.file_name()
			.map(|n| n.to_string_lossy().to_string())
			.unwrap_or_default();

		let raw = fs::read_to_string(&skill_file)?;
		let (description, content) = parse_skill_md(&raw);

		skills.push(Skill {
			name,
			description,
			content,
		});
	}

	skills.sort_by(|a, b| a.name.cmp(&b.name));
	Ok(skills)
}

pub fn get(name: &str) -> Result<Skill, AppError> {
	let dir = skills_dir()?.join(name);
	let skill_file = dir.join("SKILL.md");

	if !skill_file.exists() {
		return Err(AppError::NotFound(format!("Skill: {name}")));
	}

	let raw = fs::read_to_string(&skill_file)?;
	let (description, content) = parse_skill_md(&raw);

	Ok(Skill {
		name: name.to_string(),
		description,
		content,
	})
}

pub fn create(name: &str, description: &str, content: &str) -> Result<Skill, AppError> {
	let dir = skills_dir()?;
	fs::create_dir_all(&dir)?;

	let skill_dir = dir.join(name);
	if skill_dir.exists() {
		return Err(AppError::DbError(format!(
			"Skill '{name}' already exists"
		)));
	}

	fs::create_dir_all(&skill_dir)?;
	let skill_file = skill_dir.join("SKILL.md");
	let md = serialize_skill_md(name, description, content);
	fs::write(&skill_file, md)?;

	Ok(Skill {
		name: name.to_string(),
		description: description.to_string(),
		content: content.to_string(),
	})
}

pub fn update(
	name: &str,
	description: Option<&str>,
	content: Option<&str>,
) -> Result<Skill, AppError> {
	let mut skill = get(name)?;

	if let Some(d) = description {
		skill.description = d.to_string();
	}
	if let Some(c) = content {
		skill.content = c.to_string();
	}

	let skill_file = skills_dir()?.join(name).join("SKILL.md");
	let md = serialize_skill_md(name, &skill.description, &skill.content);
	fs::write(&skill_file, md)?;

	Ok(skill)
}

pub fn delete(name: &str) -> Result<(), AppError> {
	let dir = skills_dir()?.join(name);
	if !dir.exists() {
		return Err(AppError::NotFound(format!("Skill: {name}")));
	}

	fs::remove_dir_all(&dir)?;
	Ok(())
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn parse_with_frontmatter() {
		let raw = "---\nname: test\ndescription: \"A test skill\"\n---\nBody here";
		let (desc, body) = parse_skill_md(raw);
		assert_eq!(desc, "A test skill");
		assert_eq!(body, "Body here");
	}

	#[test]
	fn parse_without_frontmatter() {
		let raw = "Just body content";
		let (desc, body) = parse_skill_md(raw);
		assert!(desc.is_empty());
		assert_eq!(body, "Just body content");
	}

	#[test]
	fn parse_description_without_quotes() {
		let raw = "---\nname: test\ndescription: A test skill\n---\nBody";
		let (desc, _) = parse_skill_md(raw);
		assert_eq!(desc, "A test skill");
	}

	#[test]
	fn roundtrip() {
		let md = serialize_skill_md("my-skill", "Does things", "# Hello\nWorld");
		let (desc, body) = parse_skill_md(&md);
		assert_eq!(desc, "Does things");
		assert_eq!(body, "# Hello\nWorld");
	}
}
