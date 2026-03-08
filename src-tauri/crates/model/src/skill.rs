use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Skill {
	/// Directory name (kebab-case identifier)
	pub name: String,
	/// Human-readable description from frontmatter
	pub description: String,
	/// Markdown body (the prompt/instructions)
	pub content: String,
}

/// A skill result returned by the skills.sh search API.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct SearchSkillResult {
	pub name: String,
	pub slug: String,
	pub source: String,
	pub installs: i64,
}
