use crate::state::{AgentKind, AgentStatus};

pub fn detect(title: &str, screen: &str, previous: AgentStatus) -> (AgentKind, AgentStatus) {
	let hay = format!("{title}\n{screen}").to_ascii_lowercase();
	let kind = detect_kind(&hay);
	let status = detect_status(&hay, previous);
	(kind, status)
}

fn detect_kind(hay: &str) -> AgentKind {
	const RULES: &[(&str, AgentKind)] = &[
		("claude-code", AgentKind::Claude),
		("claude", AgentKind::Claude),
		("codex", AgentKind::Codex),
		("gemini", AgentKind::Gemini),
		("cursor", AgentKind::Cursor),
		("github copilot", AgentKind::Copilot),
		("copilot", AgentKind::Copilot),
		("amp", AgentKind::Amp),
		("cline", AgentKind::Cline),
		("opencode", AgentKind::OpenCode),
		("grok", AgentKind::Grok),
		("kimi", AgentKind::Kimi),
		("devin", AgentKind::Devin),
		("droid", AgentKind::Droid),
		("factory droid", AgentKind::Droid),
		("hermes", AgentKind::Hermes),
		("kilo", AgentKind::Kilo),
		("kiro", AgentKind::Kiro),
		("qoder", AgentKind::Qoder),
		("qodercli", AgentKind::Qoder),
		("agy", AgentKind::Agy),
		("pi agent", AgentKind::Pi),
		("aider", AgentKind::Other),
	];
	for (needle, kind) in RULES {
		if hay.contains(needle) {
			return *kind;
		}
	}
	AgentKind::Unknown
}

fn detect_status(hay: &str, previous: AgentStatus) -> AgentStatus {
	if is_blocked(hay) {
		return AgentStatus::Waiting;
	}
	if is_working(hay) {
		return AgentStatus::Running;
	}
	if is_idle_prompt(hay) {
		return if matches!(previous, AgentStatus::Running | AgentStatus::Waiting) {
			AgentStatus::Completed
		} else {
			AgentStatus::Idle
		};
	}
	previous
}

fn is_blocked(hay: &str) -> bool {
	const PHRASES: &[&str] = &[
		"waiting for permission",
		"waiting for",
		"waiting on",
		"allow command?",
		"action required",
		"press enter to confirm or esc to cancel",
		"enter to submit answer",
		"enter to select",
		"esc to cancel",
		"do you want to continue",
		"do you want to proceed",
		"run a dynamic workflow?",
		"waiting for permission",
		"allow this command",
		"bash command",
		"[y/n]",
		"yes (y)",
		"would you like to",
		"enter to set as default",
	];
	PHRASES.iter().any(|p| hay.contains(p))
}

fn is_working(hay: &str) -> bool {
	const PHRASES: &[&str] = &[
		"thinking",
		"running",
		"working",
		"compiling",
		"generating",
		"esc to cancel",
	];
	if hay.contains("esc to cancel") && hay.contains("enter to select") {
		return false;
	}
	PHRASES.iter().any(|p| hay.contains(p)) || has_braille_spinner(hay)
}

fn is_idle_prompt(hay: &str) -> bool {
	hay.contains("❯")
		|| hay.contains("idle")
		|| hay.lines().rev().take(6).any(|line| {
			let t = line.trim();
			t == ">" || t.ends_with(" $") || t.ends_with('$') || t.starts_with("❯")
		})
}

fn has_braille_spinner(hay: &str) -> bool {
	hay.chars().any(|c| ('\u{2800}'..='\u{28FF}').contains(&c))
}

pub fn clickable_tokens(screen: &str) -> Vec<Clickable> {
	let mut out = Vec::new();
	for token in screen.split_whitespace() {
		let clean = token.trim_matches(|c: char| matches!(c, ',' | ';' | ')' | '(' | '[' | ']' | '"' | '\'' | '`'));
		if clean.starts_with("http://") || clean.starts_with("https://") {
			out.push(Clickable::Url(clean.to_string()));
		} else if looks_like_path(clean) {
			out.push(Clickable::Path(clean.to_string()));
		}
	}
	out.dedup();
	out.into_iter().take(8).collect()
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Clickable {
	Url(String),
	Path(String),
}

fn looks_like_path(token: &str) -> bool {
	if token.len() < 3 || token.contains("://") {
		return false;
	}
	(token.contains('/') || token.contains('.'))
		&& token
			.chars()
			.all(|c| c.is_ascii_alphanumeric() || matches!(c, '/' | '.' | '_' | '-' | '~'))
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn detects_claude_waiting() {
		let (kind, status) = detect("claude", "waiting for permission", AgentStatus::Running);
		assert_eq!(kind, AgentKind::Claude);
		assert_eq!(status, AgentStatus::Waiting);
	}

	#[test]
	fn detects_codex_working() {
		let (kind, status) = detect("codex", "thinking about the change", AgentStatus::Idle);
		assert_eq!(kind, AgentKind::Codex);
		assert_eq!(status, AgentStatus::Running);
	}

	#[test]
	fn extracts_urls_and_paths() {
		let tokens = clickable_tokens("see https://example.com and src/app.rs please");
		assert!(tokens.contains(&Clickable::Url("https://example.com".into())));
		assert!(tokens.contains(&Clickable::Path("src/app.rs".into())));
	}
}
