//! Agent-status detector ported from `src/features/terminal/detector`.

use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AgentStatus {
	Running,
	Waiting,
	Idle,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AgentState {
	Idle,
	Working,
	Blocked,
	Unknown,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DetectionResult {
	pub agent_id: Option<String>,
	pub rule_id: Option<String>,
	pub state: AgentState,
	pub status: Option<AgentStatus>,
}

#[derive(Clone, Debug)]
pub struct DetectionInput {
	pub screen: String,
	pub osc_title: String,
}

fn now_ms() -> u128 {
	SystemTime::now()
		.duration_since(UNIX_EPOCH)
		.map(|d| d.as_millis())
		.unwrap_or(0)
}

fn normalize(value: &str) -> String {
	value.to_lowercase()
}

fn bottom_lines(text: &str, count: usize, non_empty: bool) -> String {
	let lines: Vec<&str> = text.split('\n').collect();
	let selected: Vec<&str> = if non_empty {
		lines
			.into_iter()
			.filter(|line| !line.trim().is_empty())
			.collect()
	} else {
		lines
	};
	let start = selected.len().saturating_sub(count);
	selected[start..].join("\n")
}

fn after_last_horizontal_rule(text: &str) -> String {
	let lines: Vec<&str> = text.split('\n').collect();
	for i in (0..lines.len()).rev() {
		let trimmed = lines[i].trim();
		if trimmed.chars().count() >= 3
			&& trimmed
				.chars()
				.all(|ch| matches!(ch, '─' | '━' | '═' | '-'))
		{
			return lines[i + 1..].join("\n");
		}
	}
	text.to_string()
}

fn after_last_prompt_marker(text: &str) -> String {
	let lines: Vec<&str> = text.split('\n').collect();
	for i in (0..lines.len()).rev() {
		if lines[i].contains('❯') || lines[i].contains('›') || lines[i].contains('❭') {
			return lines[i..].join("\n");
		}
	}
	text.to_string()
}

fn prompt_box_body(text: &str) -> String {
	bottom_lines(&after_last_prompt_marker(&after_last_horizontal_rule(text)), 12, false)
}

fn region<'a>(input: &'a DetectionInput, name: &str) -> String {
	match name {
		"osc_title" => input.osc_title.clone(),
		"after_last_horizontal_rule" => after_last_horizontal_rule(&input.screen),
		"after_last_prompt_marker" => after_last_prompt_marker(&input.screen),
		"prompt_box_body" => prompt_box_body(&input.screen),
		"whole_recent" => input.screen.clone(),
		other if other.starts_with("bottom_non_empty_lines(") => {
			let n = other
				.trim_start_matches("bottom_non_empty_lines(")
				.trim_end_matches(')')
				.parse()
				.unwrap_or(8);
			bottom_lines(&input.screen, n, true)
		}
		other if other.starts_with("bottom_lines(") => {
			let n = other
				.trim_start_matches("bottom_lines(")
				.trim_end_matches(')')
				.parse()
				.unwrap_or(8);
			bottom_lines(&input.screen, n, false)
		}
		_ => input.screen.clone(),
	}
}

#[derive(Clone)]
struct Gate {
	contains: &'static [&'static str],
	regex: &'static [&'static str],
	line_regex: &'static [&'static str],
	any_contains: &'static [&'static [&'static str]],
	not_contains: &'static [&'static str],
}

impl Gate {
	const fn empty() -> Self {
		Self {
			contains: &[],
			regex: &[],
			line_regex: &[],
			any_contains: &[],
			not_contains: &[],
		}
	}

	fn matches(&self, text: &str) -> bool {
		let lower = normalize(text);
		for needle in self.contains {
			if !lower.contains(&normalize(needle)) {
				return false;
			}
		}
		for pattern in self.regex {
			if regex_is_match(pattern, text).is_none_or(|ok| !ok) {
				return false;
			}
		}
		for pattern in self.line_regex {
			if !text.lines().any(|line| regex_is_match(pattern, line).unwrap_or(false)) {
				return false;
			}
		}
		if !self.any_contains.is_empty() {
			let any = self.any_contains.iter().any(|group| {
				group.iter().all(|needle| lower.contains(&normalize(needle)))
			});
			if !any {
				return false;
			}
		}
		for needle in self.not_contains {
			if lower.contains(&normalize(needle)) {
				return false;
			}
		}
		true
	}
}

fn regex_is_match(pattern: &str, text: &str) -> Option<bool> {
	regex::Regex::new(pattern).ok().map(|re| re.is_match(text))
}

struct Rule {
	id: &'static str,
	agent: &'static str,
	state: AgentState,
	priority: i32,
	region: &'static str,
	skip_state: bool,
	visible_idle: bool,
	gate: Gate,
	aliases: &'static [&'static str],
}

fn rules() -> Vec<Rule> {
	vec![
		Rule {
			id: "osc_title_blocked",
			agent: "codex",
			state: AgentState::Blocked,
			priority: 1100,
			region: "osc_title",
			skip_state: false,
			visible_idle: false,
			gate: Gate {
				contains: &["Action Required"],
				..Gate::empty()
			},
			aliases: &["codex"],
		},
		Rule {
			id: "osc_title_working",
			agent: "codex",
			state: AgentState::Working,
			priority: 1050,
			region: "osc_title",
			skip_state: false,
			visible_idle: false,
			gate: Gate {
				regex: &[r"^[\u{2800}-\u{28FF}] "],
				..Gate::empty()
			},
			aliases: &["codex", "claude"],
		},
		Rule {
			id: "transcript_viewer",
			agent: "codex",
			state: AgentState::Unknown,
			priority: 1000,
			region: "after_last_prompt_marker",
			skip_state: true,
			visible_idle: false,
			gate: Gate {
				contains: &["↑/↓ to scroll", "pgup/pgdn to", "home/end to jump", "q to quit"],
				any_contains: &[&["esc to edit prev"], &["esc/← to edit prev"]],
				..Gate::empty()
			},
			aliases: &["codex"],
		},
		Rule {
			id: "live_strong_blocker",
			agent: "codex",
			state: AgentState::Blocked,
			priority: 900,
			region: "after_last_prompt_marker",
			skip_state: false,
			visible_idle: false,
			gate: Gate {
				any_contains: &[
					&["press enter to confirm or esc to cancel"],
					&["enter to submit answer"],
					&["allow command?"],
				],
				..Gate::empty()
			},
			aliases: &["codex"],
		},
		Rule {
			id: "generic_permission_prompt",
			agent: "claude",
			state: AgentState::Blocked,
			priority: 840,
			region: "after_last_horizontal_rule",
			skip_state: false,
			visible_idle: false,
			gate: Gate {
				contains: &["do you want to proceed?", "esc to cancel"],
				..Gate::empty()
			},
			aliases: &["claude", "claude-code"],
		},
		Rule {
			id: "live_prompt_box",
			agent: "claude",
			state: AgentState::Idle,
			priority: 950,
			region: "prompt_box_body",
			skip_state: false,
			visible_idle: true,
			gate: Gate {
				line_regex: &[r"^\s*❯"],
				not_contains: &["enter to select", "esc to cancel"],
				..Gate::empty()
			},
			aliases: &["claude"],
		},
		Rule {
			id: "approval_prompt",
			agent: "cursor",
			state: AgentState::Blocked,
			priority: 300,
			region: "whole_recent",
			skip_state: false,
			visible_idle: false,
			gate: Gate {
				any_contains: &[
					&["waiting for approval", "run this command?"],
					&["(y) (enter)"],
					&["skip (esc or n)"],
				],
				..Gate::empty()
			},
			aliases: &["cursor", "cursor-agent"],
		},
		Rule {
			id: "stop_hint_working",
			agent: "cursor",
			state: AgentState::Working,
			priority: 100,
			region: "bottom_non_empty_lines(6)",
			skip_state: false,
			visible_idle: false,
			gate: Gate {
				contains: &["ctrl+c to stop"],
				..Gate::empty()
			},
			aliases: &["cursor"],
		},
		Rule {
			id: "gemini_apply_change",
			agent: "gemini",
			state: AgentState::Blocked,
			priority: 300,
			region: "whole_recent",
			skip_state: false,
			visible_idle: false,
			gate: Gate {
				any_contains: &[
					&["│ Apply this change"],
					&["│ Allow execution"],
					&["waiting for user confirmation"],
					&["│ Do you want to proceed"],
				],
				..Gate::empty()
			},
			aliases: &["gemini"],
		},
		Rule {
			id: "gemini_esc_cancel",
			agent: "gemini",
			state: AgentState::Working,
			priority: 100,
			region: "whole_recent",
			skip_state: false,
			visible_idle: false,
			gate: Gate {
				contains: &["esc to cancel"],
				..Gate::empty()
			},
			aliases: &["gemini"],
		},
		Rule {
			id: "copilot_selection_blocker",
			agent: "copilot",
			state: AgentState::Blocked,
			priority: 300,
			region: "whole_recent",
			skip_state: false,
			visible_idle: false,
			gate: Gate {
				any_contains: &[
					&["esc to cancel", "enter to select"],
					&["esc to cancel", "enter to confirm"],
					&["esc cancel", "enter accept"],
				],
				..Gate::empty()
			},
			aliases: &["copilot", "github-copilot", "ghcs"],
		},
		Rule {
			id: "copilot_working_cancel",
			agent: "copilot",
			state: AgentState::Working,
			priority: 100,
			region: "whole_recent",
			skip_state: false,
			visible_idle: false,
			gate: Gate {
				any_contains: &[
					&["esc to cancel"],
					&["esc cancel"],
					&["esc again to cancel"],
				],
				..Gate::empty()
			},
			aliases: &["copilot", "github-copilot"],
		},
	]
}

fn mentions_agent(text: &str, agent: &str, aliases: &[&str]) -> bool {
	let lower = normalize(text);
	std::iter::once(agent)
		.chain(aliases.iter().copied())
		.any(|name| lower.contains(&normalize(name)))
}

fn infer_agents(input: &DetectionInput) -> Vec<&'static str> {
	let title = normalize(&input.osc_title);
	if title.contains("action required") {
		return vec!["codex"];
	}
	let haystack = format!(
		"{}\n{}",
		input.osc_title,
		bottom_lines(&input.screen, 20, true)
	);
	let mut named = Vec::new();
	for rule in rules() {
		if mentions_agent(&haystack, rule.agent, rule.aliases) && !named.contains(&rule.agent)
		{
			named.push(rule.agent);
		}
	}
	if !named.is_empty() {
		return named;
	}
	if regex_is_match(r"^[\u{2800}-\u{28FF}] ", &input.osc_title).unwrap_or(false) {
		return vec!["claude", "codex"];
	}
	Vec::new()
}

fn status_for(state: AgentState) -> Option<AgentStatus> {
	match state {
		AgentState::Blocked => Some(AgentStatus::Waiting),
		AgentState::Working => Some(AgentStatus::Running),
		AgentState::Idle => Some(AgentStatus::Idle),
		AgentState::Unknown => None,
	}
}

#[derive(Default)]
pub struct AgentStatusDetector {
	agent_id: Option<String>,
	state: AgentState,
	pending_idle_since: Option<u128>,
	pending_idle_count: u8,
}

impl Default for AgentState {
	fn default() -> Self {
		Self::Unknown
	}
}

impl AgentStatusDetector {
	pub fn new() -> Self {
		Self::default()
	}

	pub fn detect(&mut self, input: DetectionInput) -> DetectionResult {
		let inferred = infer_agents(&input);
		let match_rule = self.best_match(&input, &inferred);
		if match_rule.is_none() {
			if self.agent_id.is_none() && inferred.len() == 1 {
				self.agent_id = Some(inferred[0].to_string());
			}
			if self.agent_id.is_some() {
				self.state = AgentState::Idle;
			}
			self.pending_idle_since = None;
			self.pending_idle_count = 0;
			return DetectionResult {
				agent_id: self.agent_id.clone(),
				rule_id: None,
				state: self.state,
				status: status_for(self.state),
			};
		}
		let (agent, rule_id, next_state, skip, visible_idle) = match_rule.unwrap();
		self.agent_id = Some(agent);
		if skip {
			return DetectionResult {
				agent_id: self.agent_id.clone(),
				rule_id: Some(rule_id),
				state: self.state,
				status: status_for(self.state),
			};
		}
		if let Some(state) = self.confirm_idle(next_state, visible_idle) {
			self.state = state;
		}
		DetectionResult {
			agent_id: self.agent_id.clone(),
			rule_id: Some(rule_id),
			state: self.state,
			status: status_for(self.state),
		}
	}

	fn best_match(
		&self,
		input: &DetectionInput,
		inferred: &[&str],
	) -> Option<(String, String, AgentState, bool, bool)> {
		let mut candidates: Vec<String> = inferred.iter().map(|s| (*s).to_string()).collect();
		if let Some(current) = &self.agent_id {
			if !candidates.iter().any(|c| c == current) {
				candidates.push(current.clone());
			}
		}
		if candidates.is_empty() {
			return None;
		}
		let mut best: Option<(i32, String, String, AgentState, bool, bool)> = None;
		for rule in rules() {
			if !candidates.iter().any(|c| c == rule.agent) {
				continue;
			}
			let text = region(input, rule.region);
			if !rule.gate.matches(&text) {
				continue;
			}
			if best.as_ref().is_none_or(|item| rule.priority > item.0) {
				best = Some((
					rule.priority,
					rule.agent.to_string(),
					rule.id.to_string(),
					rule.state,
					rule.skip_state,
					rule.visible_idle,
				));
			}
		}
		best.map(|(_, agent, id, state, skip, visible)| (agent, id, state, skip, visible))
	}

	fn confirm_idle(&mut self, next: AgentState, visible_idle: bool) -> Option<AgentState> {
		if next != AgentState::Idle || self.state != AgentState::Working || visible_idle {
			self.pending_idle_since = None;
			self.pending_idle_count = 0;
			return Some(next);
		}
		let now = now_ms();
		if self.pending_idle_since.is_none() {
			self.pending_idle_since = Some(now);
			self.pending_idle_count = 1;
			return None;
		}
		self.pending_idle_count = self.pending_idle_count.saturating_add(1);
		if self.pending_idle_count >= 3
			|| now.saturating_sub(self.pending_idle_since.unwrap_or(now)) >= 700
		{
			self.pending_idle_since = None;
			self.pending_idle_count = 0;
			return Some(AgentState::Idle);
		}
		None
	}
}

#[cfg_attr(not(test), allow(dead_code))]
pub fn detect_agent_status(input: DetectionInput) -> DetectionResult {
	AgentStatusDetector::new().detect(input)
}

pub fn last_osc_title(bytes: &[u8]) -> String {
	let text = String::from_utf8_lossy(bytes);
	let mut title = String::new();
	let mut rest = text.as_ref();
	while let Some(start) = rest.find("\u{1b}]") {
		rest = &rest[start + 2..];
		let payload = if let Some(end) = rest.find('\u{7}') {
			let value = &rest[..end];
			rest = &rest[end + 1..];
			value
		} else if let Some(end) = rest.find("\u{1b}\\") {
			let value = &rest[..end];
			rest = &rest[end + 2..];
			value
		} else {
			break;
		};
		if let Some((_, value)) = payload.split_once(';') {
			title = value.to_string();
		}
	}
	title
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn detects_codex_blocked_from_osc_title() {
		let result = detect_agent_status(DetectionInput {
			screen: String::new(),
			osc_title: "Action Required".into(),
		});
		assert_eq!(result.agent_id.as_deref(), Some("codex"));
		assert_eq!(result.rule_id.as_deref(), Some("osc_title_blocked"));
		assert_eq!(result.status, Some(AgentStatus::Waiting));
	}

	#[test]
	fn detects_codex_working_from_braille_title() {
		let result = detect_agent_status(DetectionInput {
			screen: "codex".into(),
			osc_title: "⠋ thinking".into(),
		});
		assert_eq!(result.agent_id.as_deref(), Some("codex"));
		assert_eq!(result.rule_id.as_deref(), Some("osc_title_working"));
		assert_eq!(result.status, Some(AgentStatus::Running));
	}

	#[test]
	fn ignores_prompt_marker_alone() {
		let result = detect_agent_status(DetectionInput {
			screen: "› ".into(),
			osc_title: String::new(),
		});
		assert_eq!(result.agent_id, None);
		assert_eq!(result.status, None);
	}

	#[test]
	fn spinner_only_title_is_working() {
		let result = detect_agent_status(DetectionInput {
			screen: String::new(),
			osc_title: "⠋ thinking".into(),
		});
		assert_eq!(result.rule_id.as_deref(), Some("osc_title_working"));
		assert_eq!(result.status, Some(AgentStatus::Running));
	}

	#[test]
	fn transcript_viewer_keeps_previous_state() {
		let mut detector = AgentStatusDetector::new();
		let working = detector.detect(DetectionInput {
			screen: "codex".into(),
			osc_title: "⠋ thinking".into(),
		});
		let transcript = detector.detect(DetectionInput {
			screen: [
				"❯ previous prompt",
				"↑/↓ to scroll",
				"pgup/pgdn to page",
				"home/end to jump",
				"q to quit",
				"esc to edit prev",
			]
			.join("\n"),
			osc_title: String::new(),
		});
		assert_eq!(working.status, Some(AgentStatus::Running));
		assert_eq!(transcript.rule_id.as_deref(), Some("transcript_viewer"));
		assert_eq!(transcript.status, Some(AgentStatus::Running));
	}

	#[test]
	fn detects_claude_permission_after_rule() {
		let result = detect_agent_status(DetectionInput {
			screen: [
				"Claude Code",
				"────────────────",
				"Do you want to proceed?",
				"esc to cancel",
			]
			.join("\n"),
			osc_title: String::new(),
		});
		assert_eq!(result.agent_id.as_deref(), Some("claude"));
		assert_eq!(result.status, Some(AgentStatus::Waiting));
	}

	#[test]
	fn extracts_osc_title_from_raw_bytes() {
		let bytes = b"\x1b]0;Action Required\x07hello";
		assert_eq!(last_osc_title(bytes), "Action Required");
	}

	#[test]
	fn detects_gemini_apply_change() {
		let result = detect_agent_status(DetectionInput {
			screen: "gemini\n│ Apply this change".into(),
			osc_title: String::new(),
		});
		assert_eq!(result.agent_id.as_deref(), Some("gemini"));
		assert_eq!(result.status, Some(AgentStatus::Waiting));
	}

	#[test]
	fn detects_copilot_selection_blocker() {
		let result = detect_agent_status(DetectionInput {
			screen: "github-copilot\nesc to cancel\nenter to select".into(),
			osc_title: String::new(),
		});
		assert_eq!(result.agent_id.as_deref(), Some("copilot"));
		assert_eq!(result.status, Some(AgentStatus::Waiting));
	}
}
