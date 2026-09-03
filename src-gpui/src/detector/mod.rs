//! Agent-status detector ported from `src/features/terminal/detector`.
//! Regions, gates, idle confirmation, and per-agent manifests match the TS engine.

mod manifests;

use std::cell::RefCell;
use std::collections::HashMap;
use std::time::Instant;

use regex::Regex;

use crate::state::{AgentKind, AgentStatus};

use manifests::MANIFESTS;

const IDLE_CONFIRMATIONS: u32 = 3;
const IDLE_CONFIRM_CAP_MS: u128 = 700;
const PROMPT_MARKERS: &[&str] = &["❯", "❭", "›"];
const SPINNER_TITLE: &str = r"^[\u{2800}-\u{28FF}] ";

#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
pub enum Semantic {
	Idle,
	Working,
	Blocked,
	#[default]
	Unknown,
}

#[derive(Clone, Copy, Debug)]
pub enum Region {
	OscTitle,
	OscProgress,
	AfterLastHorizontalRule,
	AfterLastPromptMarker,
	PromptBoxBody,
	WholeRecent,
	BottomLines(usize),
	BottomNonEmpty(usize),
}

#[derive(Clone, Copy, Debug)]
pub struct Gate {
	pub contains: &'static [&'static str],
	pub regex: &'static [&'static str],
	pub line_regex: &'static [&'static str],
	pub all: &'static [Gate],
	pub any: &'static [Gate],
	pub not: &'static [Gate],
}

impl Gate {
	pub const EMPTY: Self = Self {
		contains: &[],
		regex: &[],
		line_regex: &[],
		all: &[],
		any: &[],
		not: &[],
	};
}

#[derive(Clone, Copy, Debug)]
pub struct Rule {
	pub id: &'static str,
	pub state: Semantic,
	pub priority: i32,
	pub region: Region,
	pub visible_idle: bool,
	pub skip_state: bool,
	pub gate: Gate,
}

#[derive(Clone, Copy, Debug)]
pub struct Manifest {
	pub id: AgentKind,
	pub aliases: &'static [&'static str],
	pub rules: &'static [Rule],
}

#[derive(Default)]
pub struct OscSink {
	pub title: String,
	pub progress: String,
}

impl vt100::Callbacks for OscSink {
	fn set_window_title(&mut self, _: &mut vt100::Screen, title: &[u8]) {
		self.title = String::from_utf8_lossy(title).into_owned();
	}

	fn unhandled_osc(&mut self, _: &mut vt100::Screen, params: &[&[u8]]) {
		self.progress = params
			.iter()
			.map(|p| String::from_utf8_lossy(p).into_owned())
			.collect::<Vec<_>>()
			.join(";");
	}
}

#[derive(Default)]
pub struct AgentStatusDetector {
	kind: AgentKind,
	state: Semantic,
	pending_idle_since: Option<Instant>,
	pending_idle_count: u32,
}

impl AgentStatusDetector {
	pub fn detect(
		&mut self,
		tab_title: &str,
		screen: &str,
		osc_title: &str,
		osc_progress: &str,
	) -> (AgentKind, AgentStatus) {
		let osc = if osc_title.is_empty() { tab_title } else { osc_title };
		let input = DetectionInput {
			screen,
			osc_title: osc,
			osc_progress,
		};
		let inferred = infer_agents(&input);
		let match_ = find_best(self.kind, &inferred, &input);

		if match_.is_none() {
			if self.kind == AgentKind::Unknown && inferred.len() == 1 {
				self.kind = inferred[0];
			}
			if self.kind != AgentKind::Unknown {
				self.state = Semantic::Idle;
			}
			self.pending_idle_since = None;
			self.pending_idle_count = 0;
			return (self.kind, status_for(self.state, AgentStatus::Idle));
		}

		let (kind, rule) = match_.unwrap();
		self.kind = kind;
		if rule.skip_state {
			return (self.kind, status_for(self.state, AgentStatus::Idle));
		}
		if let Some(next) = self.confirm_idle(rule) {
			self.state = next;
		}
		(self.kind, status_for(self.state, AgentStatus::Idle))
	}

	fn confirm_idle(&mut self, rule: &Rule) -> Option<Semantic> {
		if rule.state != Semantic::Idle || self.state != Semantic::Working || rule.visible_idle {
			self.pending_idle_since = None;
			self.pending_idle_count = 0;
			return Some(rule.state);
		}
		let now = Instant::now();
		if self.pending_idle_since.is_none() {
			self.pending_idle_since = Some(now);
			self.pending_idle_count = 1;
			return None;
		}
		self.pending_idle_count += 1;
		let elapsed = self.pending_idle_since.unwrap().elapsed().as_millis();
		if self.pending_idle_count >= IDLE_CONFIRMATIONS || elapsed >= IDLE_CONFIRM_CAP_MS {
			self.pending_idle_since = None;
			self.pending_idle_count = 0;
			return Some(Semantic::Idle);
		}
		None
	}
}

struct DetectionInput<'a> {
	screen: &'a str,
	osc_title: &'a str,
	osc_progress: &'a str,
}

pub fn detect(title: &str, screen: &str, previous: AgentStatus) -> (AgentKind, AgentStatus) {
	let mut det = AgentStatusDetector {
		kind: AgentKind::Unknown,
		state: match previous {
			AgentStatus::Running => Semantic::Working,
			AgentStatus::Waiting => Semantic::Blocked,
			AgentStatus::Completed | AgentStatus::Idle => Semantic::Idle,
		},
		pending_idle_since: None,
		pending_idle_count: 0,
	};
	let (kind, status) = det.detect(title, screen, title, "");
	if matches!(previous, AgentStatus::Running | AgentStatus::Waiting) && status == AgentStatus::Idle {
		(kind, AgentStatus::Completed)
	} else {
		(kind, status)
	}
}

fn status_for(state: Semantic, fallback: AgentStatus) -> AgentStatus {
	match state {
		Semantic::Blocked => AgentStatus::Waiting,
		Semantic::Working => AgentStatus::Running,
		Semantic::Idle => AgentStatus::Idle,
		Semantic::Unknown => fallback,
	}
}

fn infer_agents(input: &DetectionInput) -> Vec<AgentKind> {
	let bottom = bottom_lines(input.screen, 20, true);
	let hay = format!("{}\n{}\n{bottom}", input.osc_title, input.osc_progress);
	if hay.to_ascii_lowercase().contains("action required") {
		return vec![AgentKind::Codex];
	}
	let named: Vec<AgentKind> = MANIFESTS.iter().filter(|m| mentions(&hay, m)).map(|m| m.id).collect();
	if !named.is_empty() {
		return named;
	}
	if regex_is_match(SPINNER_TITLE, input.osc_title) {
		return vec![AgentKind::Claude, AgentKind::Codex];
	}
	Vec::new()
}

fn mentions(text: &str, manifest: &Manifest) -> bool {
	let lower = text.to_ascii_lowercase();
	std::iter::once(kind_name(manifest.id))
		.chain(manifest.aliases.iter().copied())
		.any(|name| lower.contains(&name.to_ascii_lowercase()))
}

fn kind_name(kind: AgentKind) -> &'static str {
	match kind {
		AgentKind::Claude => "claude",
		AgentKind::Codex => "codex",
		AgentKind::Gemini => "gemini",
		AgentKind::Cursor => "cursor",
		AgentKind::Copilot => "copilot",
		AgentKind::Amp => "amp",
		AgentKind::Cline => "cline",
		AgentKind::OpenCode => "opencode",
		AgentKind::Grok => "grok",
		AgentKind::Kimi => "kimi",
		AgentKind::Devin => "devin",
		AgentKind::Droid => "droid",
		AgentKind::Hermes => "hermes",
		AgentKind::Kilo => "kilo",
		AgentKind::Kiro => "kiro",
		AgentKind::Pi => "pi",
		AgentKind::Qoder => "qodercli",
		AgentKind::Agy => "agy",
		AgentKind::OpenClaw => "openclaw",
		AgentKind::Other | AgentKind::Unknown => "",
	}
}

fn find_best(current: AgentKind, inferred: &[AgentKind], input: &DetectionInput) -> Option<(AgentKind, &'static Rule)> {
	let mut candidates = Vec::new();
	if current != AgentKind::Unknown {
		candidates.push(current);
	}
	for kind in inferred {
		if !candidates.contains(kind) {
			candidates.push(*kind);
		}
	}
	let mut best: Option<(AgentKind, &'static Rule)> = None;
	for kind in candidates {
		let Some(manifest) = MANIFESTS.iter().find(|m| m.id == kind) else {
			continue;
		};
		if let Some(rule) = evaluate(manifest, input) {
			if best.is_none_or(|(_, b)| rule.priority > b.priority) {
				best = Some((kind, rule));
			}
		}
	}
	best
}

fn evaluate(manifest: &Manifest, input: &DetectionInput) -> Option<&'static Rule> {
	let mut best = None;
	for rule in manifest.rules {
		let text = select_region(input, rule.region);
		if gate_matches(&rule.gate, &text) && best.is_none_or(|b: &Rule| rule.priority > b.priority) {
			best = Some(rule);
		}
	}
	best
}

fn select_region(input: &DetectionInput, region: Region) -> String {
	match region {
		Region::OscTitle => input.osc_title.to_string(),
		Region::OscProgress => input.osc_progress.to_string(),
		Region::AfterLastHorizontalRule => after_last_hr(input.screen),
		Region::AfterLastPromptMarker => after_last_prompt(input.screen),
		Region::PromptBoxBody => {
			let after = after_last_prompt(&after_last_hr(input.screen));
			bottom_lines(&after, 12, false)
		}
		Region::WholeRecent => input.screen.to_string(),
		Region::BottomLines(n) => bottom_lines(input.screen, n, false),
		Region::BottomNonEmpty(n) => bottom_lines(input.screen, n, true),
	}
}

fn bottom_lines(text: &str, count: usize, non_empty: bool) -> String {
	let lines: Vec<&str> = if non_empty {
		text.lines().filter(|l| !l.trim().is_empty()).collect()
	} else {
		text.lines().collect()
	};
	let start = lines.len().saturating_sub(count);
	lines[start..].join("\n")
}

fn after_last_hr(text: &str) -> String {
	let lines: Vec<&str> = text.lines().collect();
	for i in (0..lines.len()).rev() {
		if regex_is_match(r"^\s*[─━═-]{3,}\s*$", lines[i]) {
			return lines[i + 1..].join("\n");
		}
	}
	text.to_string()
}

fn after_last_prompt(text: &str) -> String {
	let lines: Vec<&str> = text.lines().collect();
	for i in (0..lines.len()).rev() {
		if PROMPT_MARKERS.iter().any(|m| lines[i].contains(m)) {
			return lines[i..].join("\n");
		}
	}
	text.to_string()
}

fn gate_matches(gate: &Gate, text: &str) -> bool {
	let lower = text.to_ascii_lowercase();
	for needle in gate.contains {
		if !lower.contains(&needle.to_ascii_lowercase()) {
			return false;
		}
	}
	for pat in gate.regex {
		if !regex_is_match(pat, text) {
			return false;
		}
	}
	if !gate.line_regex.is_empty() {
		let lines: Vec<&str> = text.lines().collect();
		for pat in gate.line_regex {
			if !lines.iter().any(|line| regex_is_match(pat, line)) {
				return false;
			}
		}
	}
	if !gate.all.is_empty() && !gate.all.iter().all(|g| gate_matches(g, text)) {
		return false;
	}
	if !gate.any.is_empty() && !gate.any.iter().any(|g| gate_matches(g, text)) {
		return false;
	}
	if gate.not.iter().any(|g| gate_matches(g, text)) {
		return false;
	}
	true
}

fn regex_is_match(pat: &str, text: &str) -> bool {
	thread_local! {
		static CACHE: RefCell<HashMap<String, Option<Regex>>> = RefCell::new(HashMap::new());
	}
	CACHE.with(|cache| {
		let mut map = cache.borrow_mut();
		let re = map
			.entry(pat.to_string())
			.or_insert_with(|| Regex::new(pat).ok())
			.as_ref();
		re.is_some_and(|r| r.is_match(text))
	})
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
		let (kind, status) = detect(
			"claude",
			"do you want to proceed?\nesc to cancel\n1. yes",
			AgentStatus::Running,
		);
		assert_eq!(kind, AgentKind::Claude);
		assert_eq!(status, AgentStatus::Waiting);
	}

	#[test]
	fn detects_codex_working() {
		let (kind, status) = detect("codex", "press enter to confirm or esc to cancel", AgentStatus::Idle);
		assert_eq!(kind, AgentKind::Codex);
		assert_eq!(status, AgentStatus::Waiting);
	}

	#[test]
	fn extracts_urls_and_paths() {
		let tokens = clickable_tokens("see https://example.com and src/app.rs please");
		assert!(tokens.contains(&Clickable::Url("https://example.com".into())));
		assert!(tokens.contains(&Clickable::Path("src/app.rs".into())));
	}
}
