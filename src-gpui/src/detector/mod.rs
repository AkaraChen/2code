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
	let mut out: Vec<Clickable> = clickable_hits(screen).into_iter().map(|h| h.token).collect();
	out.dedup();
	out.into_iter().take(8).collect()
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ClickHit {
	pub token: Clickable,
	pub row: u16,
	pub col: usize,
	pub len: usize,
}

impl ClickHit {
	pub fn contains(&self, row: u16, col: usize) -> bool {
		self.row == row && col >= self.col && col < self.col + self.len
	}
}

pub fn clickable_hits(screen: &str) -> Vec<ClickHit> {
	let mut out = Vec::new();
	for (row, line) in screen.lines().enumerate() {
		let mut col = 0usize;
		for part in line.split_inclusive(char::is_whitespace) {
			let token = part.trim_end_matches(char::is_whitespace);
			let clean = token.trim_matches(|c: char| matches!(c, ',' | ';' | ')' | '(' | '[' | ']' | '"' | '\'' | '`'));
			if let Some(extra) = token.find(clean).filter(|_| !clean.is_empty()) {
				let hit = if clean.starts_with("http://") || clean.starts_with("https://") {
					Some(Clickable::Url(clean.to_string()))
				} else if looks_like_path(clean) {
					Some(Clickable::Path(clean.to_string()))
				} else {
					None
				};
				if let Some(token) = hit {
					out.push(ClickHit {
						token,
						row: row as u16,
						col: col + extra,
						len: clean.chars().count(),
					});
				}
			}
			col += part.chars().count();
		}
	}
	out
}

/// OSC 9;4 progress used by xterm's ProgressAddon: `(state, value)`.
/// state 0 hide, 1 set, 2 error, 3 indeterminate, 4 pause.
pub fn parse_osc_progress(raw: &str) -> Option<(u8, u8)> {
	if raw.is_empty() {
		return None;
	}
	let parts: Vec<&str> = raw.split(';').collect();
	for i in 0..parts.len() {
		if parts[i] == "9" && parts.get(i + 1) == Some(&"4") {
			let state = parts.get(i + 2)?.parse().ok()?;
			let value = parts.get(i + 3).and_then(|v| v.parse().ok()).unwrap_or(0);
			return Some((state, value));
		}
	}
	if parts.len() >= 2 {
		if let (Ok(state), Ok(value)) = (parts[0].parse::<u8>(), parts[1].parse::<u8>()) {
			if state <= 4 {
				return Some((state, value));
			}
		}
	}
	None
}

/// iTerm2 inline images (`OSC 1337 ; File=…`). Leftover xterm ImageAddon.
pub fn extract_iterm2_images(carry: &mut Vec<u8>, incoming: &[u8]) -> Vec<Vec<u8>> {
	carry.extend_from_slice(incoming);
	if carry.len() > 4 * 1024 * 1024 {
		carry.drain(..carry.len() - 64);
	}
	let mut images = Vec::new();
	loop {
		let Some(start) = carry.windows(2).position(|w| w == [0x1b, b']']) else {
			if !carry.is_empty() && carry[carry.len() - 1] != 0x1b {
				carry.clear();
			} else if carry.len() > 1 {
				carry.drain(..carry.len() - 1);
			}
			break;
		};
		if start > 0 {
			carry.drain(..start);
		}
		let Some(end) = osc_terminator(carry) else {
			break;
		};
		let seq: Vec<u8> = carry.drain(..end).collect();
		if let Some(img) = parse_iterm2_osc(&seq) {
			images.push(img);
		}
	}
	images
}

fn osc_terminator(buf: &[u8]) -> Option<usize> {
	for i in 2..buf.len() {
		if buf[i] == 0x07 {
			return Some(i + 1);
		}
		if buf[i] == b'\\' && buf[i - 1] == 0x1b {
			return Some(i + 1);
		}
	}
	None
}

pub fn parse_iterm2_file(payload: &str) -> Option<Vec<u8>> {
	let body = payload.strip_prefix("1337;").unwrap_or(payload);
	let rest = body.strip_prefix("File=")?;
	let (meta, data) = rest.rsplit_once(':')?;
	if meta.split(';').any(|part| part.eq_ignore_ascii_case("inline=0")) {
		return None;
	}
	decode_base64(data)
}

fn parse_iterm2_osc(seq: &[u8]) -> Option<Vec<u8>> {
	let inner = seq.strip_prefix(&[0x1b, b']'])?;
	let inner = inner
		.strip_suffix(&[0x07])
		.or_else(|| inner.strip_suffix(&[0x1b, b'\\']))?;
	parse_iterm2_file(&String::from_utf8_lossy(inner))
}

fn decode_base64(input: &str) -> Option<Vec<u8>> {
	fn val(c: u8) -> Option<u8> {
		match c {
			b'A'..=b'Z' => Some(c - b'A'),
			b'a'..=b'z' => Some(c - b'a' + 26),
			b'0'..=b'9' => Some(c - b'0' + 52),
			b'+' => Some(62),
			b'/' => Some(63),
			_ => None,
		}
	}
	let bytes: Vec<u8> = input
		.bytes()
		.filter(|b| !b.is_ascii_whitespace() && *b != b'=')
		.collect();
	if bytes.is_empty() {
		return None;
	}
	let mut out = Vec::with_capacity(bytes.len() * 3 / 4 + 1);
	for chunk in bytes.chunks(4) {
		let a = val(chunk[0])?;
		let b = val(*chunk.get(1)?)?;
		out.push((a << 2) | (b >> 4));
		if chunk.len() >= 3 {
			let c = val(chunk[2])?;
			out.push((b << 4) | (c >> 2));
			if chunk.len() == 4 {
				let d = val(chunk[3])?;
				out.push((c << 6) | d);
			}
		}
	}
	Some(out)
}

pub fn image_format(bytes: &[u8]) -> Option<&'static str> {
	if bytes.starts_with(&[0x89, b'P', b'N', b'G']) {
		Some("png")
	} else if bytes.starts_with(&[0xFF, 0xD8]) {
		Some("jpeg")
	} else if bytes.starts_with(b"GIF8") {
		Some("gif")
	} else if bytes.len() > 12 && &bytes[8..12] == b"WEBP" {
		Some("webp")
	} else {
		None
	}
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
		let hits = clickable_hits("see https://example.com and src/app.rs please");
		assert_eq!(hits[0].col, 4);
		assert_eq!(hits[0].len, "https://example.com".len());
		assert_eq!(hits[1].col, 4 + "https://example.com".len() + 5);
	}

	#[test]
	fn parses_xterm_osc_progress() {
		assert_eq!(parse_osc_progress("9;4;1;40"), Some((1, 40)));
		assert_eq!(parse_osc_progress("1;80"), Some((1, 80)));
		assert_eq!(parse_osc_progress("0;0"), Some((0, 0)));
		assert_eq!(parse_osc_progress(""), None);
	}

	#[test]
	fn parses_iterm2_inline_png() {
		const PNG: &str =
			"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
		let decoded = parse_iterm2_file(&format!("1337;File=inline=1;name=dot:{PNG}")).unwrap();
		assert_eq!(image_format(&decoded), Some("png"));
		assert!(parse_iterm2_file(&format!("1337;File=inline=0:{PNG}")).is_none());

		let mut carry = Vec::new();
		let mut seq = vec![0x1b, b']'];
		seq.extend(format!("1337;File=inline=1:{PNG}").bytes());
		seq.push(0x07);
		let imgs = extract_iterm2_images(&mut carry, &seq);
		assert_eq!(imgs.len(), 1);
		assert_eq!(image_format(&imgs[0]), Some("png"));
		assert!(carry.is_empty());
	}
}
