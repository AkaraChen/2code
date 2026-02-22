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
