use std::collections::{HashMap, HashSet};
use std::time::Instant;

use model::debug::LogEntry;
use model::filesystem::FileSearchResult;
use model::profile::Profile;
use model::project::{
	GitBranchInfo, GitCommit, GitDiffStats, GitPullRequestStatus, ProjectConfig, ProjectWithProfiles,
};
use model::project_group::ProjectGroup;

use crate::i18n::Locale;
use crate::prefs::Prefs;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum Route {
	#[default]
	Home,
	Workspace,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum SidebarMode {
	#[default]
	Files,
	Git,
	Notes,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum SettingsTab {
	#[default]
	General,
	Terminal,
	Templates,
	Notification,
	TopBar,
	About,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum GitDiffTab {
	#[default]
	Changes,
	History,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MdMenu {
	Command,
	Table,
	Link,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum DiffPreviewMode {
	#[default]
	Unified,
	Split,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum AgentStatus {
	#[default]
	Idle,
	Running,
	Waiting,
	Completed,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum AgentKind {
	#[default]
	Unknown,
	Claude,
	Codex,
	Gemini,
	Cursor,
	Copilot,
	Amp,
	Cline,
	OpenCode,
	Grok,
	Kimi,
	Devin,
	Droid,
	Hermes,
	Kilo,
	Kiro,
	Pi,
	Qoder,
	Agy,
	OpenClaw,
	Other,
}

impl AgentKind {
	pub fn label(self) -> &'static str {
		match self {
			Self::Claude => "Claude",
			Self::Codex => "Codex",
			Self::Gemini => "Gemini",
			Self::Cursor => "Cursor",
			Self::Copilot => "Copilot",
			Self::Amp => "Amp",
			Self::Cline => "Cline",
			Self::OpenCode => "OpenCode",
			Self::Grok => "Grok",
			Self::Kimi => "Kimi",
			Self::Devin => "Devin",
			Self::Droid => "Droid",
			Self::Hermes => "Hermes",
			Self::Kilo => "Kilo",
			Self::Kiro => "Kiro",
			Self::Pi => "Pi",
			Self::Qoder => "Qoder",
			Self::Agy => "Agy",
			Self::OpenClaw => "OpenClaw",
			Self::Other | Self::Unknown => "Agent",
		}
	}

	/// Inventory §9.1: tab icons come from the title keywords, then the detector.
	pub fn from_tab_title(title: &str) -> Option<Self> {
		let lower = title.to_ascii_lowercase();
		const KEYS: &[(&str, AgentKind)] = &[
			("openclaw", AgentKind::OpenClaw),
			("opencode", AgentKind::OpenCode),
			("claude", AgentKind::Claude),
			("codex", AgentKind::Codex),
			("gemini", AgentKind::Gemini),
			("kimi", AgentKind::Kimi),
			("cline", AgentKind::Cline),
			("qoder", AgentKind::Qoder),
		];
		KEYS.iter().find(|(key, _)| lower.contains(key)).map(|(_, kind)| *kind)
	}

	pub fn tab_icon_kind(title: &str, detected: Self) -> Self {
		Self::from_tab_title(title).unwrap_or(detected)
	}
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ToastAction {
	OpenAbout,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DialogKind {
	CreateProject,
	DeleteProject,
	RenameProject,
	ProjectSettings,
	CreateProfile,
	DeleteProfile,
	CloseUnsaved,
	SwitchBranch,
	OpenLink,
	ChooseFile,
	EditTemplate,
	ReviewQueue,
	DebugLog,
	CreateGroup,
}

#[derive(Debug, Clone)]
pub enum ContextMenu {
	Project { id: String },
	Profile { id: String, project_id: String },
	File { path: String },
	GitFile { path: String },
	TreeBlank,
	NewTerminal,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SidebarNavItem {
	Home,
	Project(String),
	Profile { project_id: String, profile_id: String },
}

#[derive(Debug, Clone)]
pub struct Toast {
	pub id: u64,
	pub kind: ToastKind,
	pub title: String,
	pub body: String,
	pub action: Option<ToastAction>,
	pub created: Instant,
}

impl Toast {
	pub fn ttl_secs(&self) -> u64 {
		if self.action.is_some() {
			12
		} else {
			5
		}
	}

	pub fn alive(&self) -> bool {
		self.created.elapsed().as_secs() < self.ttl_secs()
	}
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ToastKind {
	Success,
	Info,
	Warning,
	Error,
}

#[derive(Debug, Clone)]
pub struct OpenFileTab {
	pub path: String,
	pub title: String,
	pub content: String,
	pub draft: String,
	pub preview: bool,
	pub preview_kind: String,
	pub binary_note: String,
	pub preview_path: String,
	pub archive_entries: Vec<(String, String)>,
	pub load_error: Option<String>,
}

impl OpenFileTab {
	pub fn dirty(&self) -> bool {
		!self.preview && self.draft != self.content
	}
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UnifiedTab {
	Terminal { index: usize },
	File { index: usize },
}

pub struct TermSession {
	pub id: String,
	pub title: String,
	pub profile_id: String,
	pub parser: vt100::Parser<crate::detector::OscSink>,
	pub detector: crate::detector::AgentStatusDetector,
	pub search_open: bool,
	pub search_ix: usize,
	pub search_query: String,
	pub agent: AgentStatus,
	pub agent_kind: AgentKind,
	pub completed_hidden: bool,
	pub cols: u16,
	pub rows: u16,
	pub selection: Option<((u16, usize), (u16, usize))>,
	pub selecting: bool,
	pub click_cell: Option<(u16, usize)>,
	pub osc_carry: Vec<u8>,
	pub images: Vec<TermImage>,
}

#[derive(Clone)]
pub struct TermImage {
	pub row: u16,
	pub col: u16,
	pub bytes: Vec<u8>,
}

impl TermSession {
	pub fn new(id: String, title: String, profile_id: String) -> Self {
		Self {
			id,
			title,
			profile_id,
			parser: vt100::Parser::new_with_callbacks(32, 120, 10_000, crate::detector::OscSink::default()),
			detector: crate::detector::AgentStatusDetector::default(),
			search_open: false,
			search_ix: 0,
			search_query: String::new(),
			agent: AgentStatus::Idle,
			agent_kind: AgentKind::Unknown,
			completed_hidden: false,
			cols: 120,
			rows: 32,
			selection: None,
			selecting: false,
			click_cell: None,
			osc_carry: Vec::new(),
			images: Vec::new(),
		}
	}

	pub fn osc_progress(&self) -> String {
		self.parser.callbacks().progress.clone()
	}

	pub fn clear_screen(&mut self) {
		self.parser =
			vt100::Parser::new_with_callbacks(self.rows, self.cols, 10_000, crate::detector::OscSink::default());
		self.selection = None;
		self.selecting = false;
		self.click_cell = None;
		self.osc_carry.clear();
		self.images.clear();
	}

	pub fn feed(&mut self, bytes: &[u8]) {
		let images = crate::detector::extract_iterm2_images(&mut self.osc_carry, bytes);
		self.parser.process(bytes);
		if !images.is_empty() {
			let (row, col) = self.parser.screen().cursor_position();
			for data in images {
				self.images.push(TermImage { row, col, bytes: data });
			}
			if self.images.len() > 16 {
				let extra = self.images.len() - 16;
				self.images.drain(0..extra);
			}
		}
		self.detect_agent();
	}

	pub fn set_size(&mut self, rows: u16, cols: u16) -> bool {
		if self.rows == rows && self.cols == cols {
			return false;
		}
		self.rows = rows;
		self.cols = cols;
		self.parser.screen_mut().set_size(rows, cols);
		true
	}

	fn detect_agent(&mut self) {
		let text = self.parser.screen().contents();
		let osc = self.parser.callbacks();
		let prev = self.agent;
		let (kind, mut status) = self.detector.detect(&self.title, &text, &osc.title, &osc.progress);
		if matches!(prev, AgentStatus::Running | AgentStatus::Waiting) && status == AgentStatus::Idle {
			status = AgentStatus::Completed;
		}
		if kind != AgentKind::Unknown {
			self.agent_kind = kind;
		}
		if status != prev && matches!(status, AgentStatus::Completed) {
			self.completed_hidden = false;
		}
		self.agent = status;
	}

	pub fn screen_text(&self) -> String {
		self.parser.screen().contents()
	}

	pub fn begin_selection(&mut self, row: u16, col: usize, extend: bool) {
		if extend {
			if let Some((anchor, _)) = self.selection {
				self.selection = Some((anchor, (row, col)));
				self.selecting = true;
				return;
			}
		}
		self.selection = Some(((row, col), (row, col)));
		self.selecting = true;
	}

	pub fn extend_selection(&mut self, row: u16, col: usize) {
		if !self.selecting {
			return;
		}
		if let Some((anchor, _)) = self.selection {
			self.selection = Some((anchor, (row, col)));
		}
	}

	pub fn finish_selection(&mut self) -> bool {
		self.selecting = false;
		!self.selected_text().is_empty()
	}

	pub fn has_selection(&self) -> bool {
		!self.selected_text().is_empty()
	}

	pub fn cell_selected(&self, row: u16, col: usize) -> bool {
		let Some(((ar, ac), (br, bc))) = self.normalized_selection() else {
			return false;
		};
		if row < ar || row > br {
			return false;
		}
		if ar == br {
			return col >= ac && col < bc;
		}
		if row == ar {
			return col >= ac;
		}
		if row == br {
			return col < bc;
		}
		true
	}

	pub fn normalized_selection(&self) -> Option<((u16, usize), (u16, usize))> {
		let (a, b) = self.selection?;
		if (a.0, a.1) <= (b.0, b.1) {
			Some((a, b))
		} else {
			Some((b, a))
		}
	}

	pub fn selected_text(&self) -> String {
		selected_from_lines(&self.screen_text(), self.selection)
	}

	pub fn search_hits(&self, query: &str) -> Vec<(u16, usize, usize)> {
		if query.is_empty() {
			return Vec::new();
		}
		let needle = query.to_ascii_lowercase();
		self.screen_text()
			.lines()
			.enumerate()
			.flat_map(|(row, line)| {
				let hay = line.to_ascii_lowercase();
				hay.match_indices(&needle)
					.map(|(col, _)| (row as u16, col, needle.len()))
					.collect::<Vec<_>>()
			})
			.collect()
	}
}

pub fn selected_from_lines(text: &str, sel: Option<((u16, usize), (u16, usize))>) -> String {
	let Some((a, b)) = sel else {
		return String::new();
	};
	let (start, end) = if (a.0, a.1) <= (b.0, b.1) { (a, b) } else { (b, a) };
	if start == end {
		return String::new();
	}
	let lines: Vec<&str> = text.lines().collect();
	let mut out = String::new();
	for row in start.0..=end.0 {
		let line = lines.get(row as usize).copied().unwrap_or("");
		let from = if row == start.0 { start.1.min(line.len()) } else { 0 };
		let to = if row == end.0 {
			end.1.min(line.len())
		} else {
			line.len()
		};
		if row > start.0 {
			out.push('\n');
		}
		if from < to {
			out.extend(line.chars().skip(from).take(to - from));
		}
	}
	out
}

#[derive(Debug, Clone)]
pub struct TreeNode {
	pub path: String,
	pub name: String,
	pub is_dir: bool,
	pub expanded: bool,
	pub children_loaded: bool,
	pub children: Vec<String>,
}

/// Inventory §8.1: dirty/untracked paths show even when their parent was never scanned.
pub fn inject_git_paths(tree: &mut HashMap<String, TreeNode>, files: impl IntoIterator<Item = impl AsRef<str>>) {
	if !tree.contains_key("") {
		return;
	}
	for path in files {
		let path = path.as_ref();
		if path.is_empty() || tree.contains_key(path) {
			continue;
		}
		let mut parent = String::new();
		let parts: Vec<&str> = path.split('/').filter(|p| !p.is_empty()).collect();
		for (i, part) in parts.iter().enumerate() {
			let current = if parent.is_empty() {
				(*part).to_string()
			} else {
				format!("{parent}/{part}")
			};
			let is_last = i + 1 == parts.len();
			tree.entry(current.clone()).or_insert_with(|| TreeNode {
				path: current.clone(),
				name: (*part).to_string(),
				is_dir: !is_last,
				expanded: false,
				children_loaded: is_last,
				children: Vec::new(),
			});
			if let Some(pnode) = tree.get_mut(&parent) {
				if !pnode.children.contains(&current) {
					pnode.children.push(current.clone());
				}
			}
			parent = current;
		}
	}
}

pub struct Workspace {
	pub project_id: String,
	pub profile_id: String,
	pub branch: String,
	pub worktree: String,
	pub project_name: String,
	pub is_default: bool,
	pub sidebar_mode: SidebarMode,
	pub sidebar_open: bool,
	pub terminals: Vec<TermSession>,
	pub files: Vec<OpenFileTab>,
	pub active: Option<UnifiedTab>,
	pub tree: HashMap<String, TreeNode>,
	pub tree_selected: HashSet<String>,
	pub tree_anchor: Option<String>,
	pub tree_error: Option<String>,
	pub git_files: Vec<(String, String)>,
	pub git_included: HashSet<String>,
	pub git_stats: GitDiffStats,
	pub git_ahead: u32,
	pub notes: String,
	pub notes_status: NotesStatus,
	pub pr: Option<GitPullRequestStatus>,
	pub pr_error: Option<String>,
	pub avatar: Option<String>,
	pub config: ProjectConfig,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum NotesStatus {
	#[default]
	Saved,
	Saving,
	Failed,
}

impl Workspace {
	pub fn active_terminal(&self) -> Option<&TermSession> {
		match self.active {
			Some(UnifiedTab::Terminal { index }) => self.terminals.get(index),
			_ => None,
		}
	}

	pub fn active_terminal_mut(&mut self) -> Option<&mut TermSession> {
		match self.active {
			Some(UnifiedTab::Terminal { index }) => self.terminals.get_mut(index),
			_ => None,
		}
	}

	pub fn active_file(&self) -> Option<&OpenFileTab> {
		match self.active {
			Some(UnifiedTab::File { index }) => self.files.get(index),
			_ => None,
		}
	}

	pub fn active_file_mut(&mut self) -> Option<&mut OpenFileTab> {
		match self.active {
			Some(UnifiedTab::File { index }) => self.files.get_mut(index),
			_ => None,
		}
	}

	pub fn has_tabs(&self) -> bool {
		!self.terminals.is_empty() || !self.files.is_empty()
	}
}

#[derive(Default)]
pub struct OverlayState {
	pub dialog: Option<DialogKind>,
	pub dialog_project: Option<String>,
	pub dialog_profile: Option<String>,
	pub dialog_file: Option<String>,
	pub dialog_url: Option<String>,
	pub dialog_folder: Option<String>,
	pub dialog_error: Option<String>,
	pub dialog_busy: bool,
	pub delete_warning: Option<String>,
	pub context_menu: Option<(ContextMenu, f32, f32)>,
	pub palette_open: bool,
	pub palette_results: Vec<FileSearchResult>,
	pub palette_index: usize,
	pub palette_query: String,
	pub palette_error: Option<String>,
	pub git_diff_open: bool,
	pub git_diff_tab: GitDiffTab,
	pub git_diff_mode: DiffPreviewMode,
	pub git_diff_text: String,
	pub git_diff_file: Option<String>,
	pub git_commits: Vec<GitCommit>,
	pub git_commit_files: Vec<String>,
	pub git_selected_commit: Option<String>,
	pub git_file_index: usize,
	pub git_commit_index: Option<usize>,
	pub git_commit_file_index: usize,
	pub git_large_revealed: HashSet<String>,
	pub review_comments: Vec<crate::review::ReviewComment>,
	pub review_selection: Option<crate::review::ReviewSelection>,
	pub review_edit_id: Option<String>,
	pub branches: Vec<GitBranchInfo>,
	pub fuzzy_files: Vec<FileSearchResult>,
	pub onboarding: bool,
	pub sort_mode: bool,
	pub settings_open: bool,
	pub settings_tab: SettingsTab,
	pub debug_open: bool,
	pub debug_logs: Vec<LogEntry>,
	pub collapsed_projects: HashSet<String>,
	pub pending_close_file: Option<String>,
	pub editing_template: Option<String>,
	pub project_settings_tab: usize,
	pub sidebar_drag: Option<(f32, f32)>,
	pub profile_sidebar_drag: Option<(f32, f32)>,
	pub sidebar_resize_focus: Option<bool>,
	pub sidebar_nav: Option<SidebarNavItem>,
	pub drag_project: Option<String>,
	pub drag_file: Option<String>,
	pub renaming_path: Option<String>,
	pub update_checked: bool,
	pub group_menu_creating: bool,
	pub file_search_open: bool,
	pub file_search_ix: usize,
	pub md_menu: Option<MdMenu>,
	pub md_preview: bool,
	pub new_terminal_hover: bool,
	pub delete_check_failed: bool,
	pub open_link_menu: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum GroupMenuRow {
	Empty,
	Group { id: String, name: String, current: bool },
	Remove,
	Create,
	CreateInput,
}

pub fn project_group_menu_rows(
	groups: &[(String, String)],
	current_group: Option<&str>,
	creating: bool,
) -> Vec<GroupMenuRow> {
	let mut rows = Vec::new();
	if groups.is_empty() {
		rows.push(GroupMenuRow::Empty);
	} else {
		for (id, name) in groups {
			rows.push(GroupMenuRow::Group {
				id: id.clone(),
				name: name.clone(),
				current: current_group == Some(id.as_str()),
			});
		}
	}
	if current_group.is_some() {
		rows.push(GroupMenuRow::Remove);
	}
	if creating || groups.is_empty() {
		rows.push(GroupMenuRow::CreateInput);
	} else {
		rows.push(GroupMenuRow::Create);
	}
	rows
}

pub struct AppData {
	pub prefs: Prefs,
	pub projects: Vec<ProjectWithProfiles>,
	pub groups: Vec<ProjectGroup>,
	pub route: Route,
	pub current_project: Option<String>,
	pub current_profile: Option<String>,
	pub workspaces: HashMap<String, Workspace>,
	pub overlay: OverlayState,
	pub toasts: Vec<Toast>,
	pub toast_seq: u64,
	pub sidebar_error: Option<String>,
	pub locale: Locale,
	pub notes_dirty_since: Option<Instant>,
	pub notes_bound_profile: Option<String>,
	pub file_dirty_since: Option<Instant>,
	pub avatars: HashMap<String, String>,
}

impl AppData {
	pub fn current_ws(&self) -> Option<&Workspace> {
		self.current_profile.as_ref().and_then(|id| self.workspaces.get(id))
	}

	pub fn current_ws_mut(&mut self) -> Option<&mut Workspace> {
		let id = self.current_profile.clone()?;
		self.workspaces.get_mut(&id)
	}

	pub fn default_profile_of(&self, project_id: &str) -> Option<Profile> {
		self.projects.iter().find(|p| p.id == project_id).and_then(|p| {
			p.profiles
				.iter()
				.find(|pr| pr.is_default)
				.cloned()
				.or_else(|| p.profiles.first().cloned())
		})
	}

	pub fn project(&self, id: &str) -> Option<&ProjectWithProfiles> {
		self.projects.iter().find(|p| p.id == id)
	}

	pub fn push_toast(&mut self, kind: ToastKind, title: impl Into<String>, body: impl Into<String>) {
		self.push_toast_action(kind, title, body, None);
	}

	pub fn push_toast_action(
		&mut self,
		kind: ToastKind,
		title: impl Into<String>,
		body: impl Into<String>,
		action: Option<ToastAction>,
	) {
		self.toast_seq += 1;
		self.toasts.push(Toast {
			id: self.toast_seq,
			kind,
			title: title.into(),
			body: body.into(),
			action,
			created: Instant::now(),
		});
	}

	pub fn expire_toasts(&mut self) {
		self.toasts.retain(Toast::alive);
	}
}

pub fn leftover_profile_sublist_open(has_extras: bool, collapsed: bool) -> bool {
	has_extras && !collapsed
}

pub fn leftover_project_row_active(has_extras: bool, default_is_current: bool) -> bool {
	!has_extras && default_is_current
}

pub fn leftover_rename_disabled(name: &str, init: &str) -> bool {
	let trimmed = name.trim();
	trimmed.is_empty() || trimmed == init
}

pub fn leftover_delete_profile_warning(parts: &[String]) -> Option<String> {
	if parts.is_empty() {
		None
	} else {
		Some(parts.join(" "))
	}
}

pub fn leftover_new_terminal_split(has_templates: bool, empty_cta: bool) -> bool {
	empty_cta && has_templates
}

pub fn leftover_dialog_width(kind: DialogKind) -> f32 {
	match kind {
		DialogKind::ReviewQueue => 896.0,
		DialogKind::SwitchBranch => 448.0,
		DialogKind::ProjectSettings => 512.0,
		DialogKind::DebugLog => 512.0,
		DialogKind::ChooseFile => 576.0,
		_ => 384.0,
	}
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LeftoverTemplateRow {
	EmptyTitle,
	EmptyHint,
	ProjectHeader,
	Project { index: usize, name: String, cwd: String },
	GlobalHeader,
	Global { index: usize, name: String },
}

pub fn leftover_template_rows(
	project: &[(String, String)],
	global: &[String],
	show_empty: bool,
) -> Vec<LeftoverTemplateRow> {
	if project.is_empty() && global.is_empty() {
		return if show_empty {
			vec![LeftoverTemplateRow::EmptyTitle, LeftoverTemplateRow::EmptyHint]
		} else {
			Vec::new()
		};
	}
	let mut rows = Vec::new();
	if !project.is_empty() {
		rows.push(LeftoverTemplateRow::ProjectHeader);
		for (index, (name, cwd)) in project.iter().enumerate() {
			rows.push(LeftoverTemplateRow::Project {
				index,
				name: name.clone(),
				cwd: cwd.clone(),
			});
		}
	}
	if !global.is_empty() {
		rows.push(LeftoverTemplateRow::GlobalHeader);
		for (index, name) in global.iter().enumerate() {
			rows.push(LeftoverTemplateRow::Global {
				index,
				name: name.clone(),
			});
		}
	}
	rows
}

pub fn leftover_browser_name(id: &str) -> &'static str {
	match leftover_normalize_app_id(id) {
		"safari" => "Safari",
		"chrome" => "Google Chrome",
		"chrome-canary" => "Google Chrome Canary",
		"edge" => "Microsoft Edge",
		"firefox" => "Firefox",
		"arc" => "Arc",
		"brave" => "Brave Browser",
		"vivaldi" => "Vivaldi",
		"orion" => "Orion",
		"chromium" => "Chromium",
		_ => "",
	}
}

pub fn leftover_normalize_app_id(id: &str) -> &str {
	match id {
		"code" | "vscode" => "vscode",
		"sublime" | "subl" | "sublime-text" => "sublime-text",
		"google-chrome" | "chrome" => "chrome",
		other => other,
	}
}

pub const LEFTOVER_EDITOR_APP_IDS: &[&str] = &["vscode", "windsurf", "cursor", "zed", "sublime-text"];
pub const LEFTOVER_TERMINAL_APP_IDS: &[&str] = &["ghostty", "iterm2", "kitty", "warp"];

pub fn leftover_configured_app<'a>(preferred: &str, category: &[&'a str], installed: &[&str]) -> Option<&'a str> {
	let preferred = leftover_normalize_app_id(preferred);
	if installed.iter().any(|id| leftover_normalize_app_id(id) == preferred) {
		return category.iter().copied().find(|id| *id == preferred);
	}
	category.iter().copied().find(|id| {
		installed
			.iter()
			.any(|installed| leftover_normalize_app_id(installed) == *id)
	})
}

pub fn leftover_launch_app_i18n(id: &str) -> &'static str {
	match leftover_normalize_app_id(id) {
		"vscode" => "topbarVscode",
		"windsurf" => "topbarWindsurf",
		"cursor" => "topbarCursor",
		"zed" => "topbarZed",
		"sublime-text" => "topbarSublimeText",
		"ghostty" => "topbarGhostty",
		"iterm2" => "topbarIterm2",
		"kitty" => "topbarKitty",
		"warp" => "topbarWarp",
		"github-desktop" => "topbarGithubDesktop",
		_ => "topbarEditor",
	}
}

pub fn leftover_topbar_app_tooltip(kind: &str, app_label: &str) -> String {
	format!("{kind} · {app_label}")
}

pub fn leftover_pr_visible(has_pr: bool) -> bool {
	has_pr
}

pub fn leftover_pr_label(number: u32, state_label: &str) -> String {
	format!("#{number} {state_label}")
}

pub fn leftover_about_copyright(year: i32) -> String {
	format!("© {year} AkaraChen")
}

pub fn leftover_about_max_width() -> f32 {
	672.0
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LeftoverUpdateBadge {
	Hidden,
	Available,
	NotAvailable,
}

pub fn leftover_update_badge(has_update: bool, checked_not_available: bool) -> LeftoverUpdateBadge {
	if has_update {
		LeftoverUpdateBadge::Available
	} else if checked_not_available {
		LeftoverUpdateBadge::NotAvailable
	} else {
		LeftoverUpdateBadge::Hidden
	}
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct LeftoverFileMenuFlags {
	pub can_open: bool,
	pub can_open_default: bool,
	pub can_reveal: bool,
	pub can_rename: bool,
	pub can_delete: bool,
}

pub fn leftover_file_menu_flags(is_file: bool, exists: bool) -> LeftoverFileMenuFlags {
	LeftoverFileMenuFlags {
		can_open: is_file && exists,
		can_open_default: exists,
		can_reveal: exists,
		can_rename: exists,
		can_delete: exists,
	}
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LeftoverFileMenuRow {
	Open,
	OpenDefault,
	Reveal,
	Refresh,
	NewFile,
	NewFolder,
	Rename,
	CopyRel,
	CopyAbs,
	Delete,
	Separator,
}

pub fn leftover_file_menu_rows() -> &'static [LeftoverFileMenuRow] {
	&[
		LeftoverFileMenuRow::Open,
		LeftoverFileMenuRow::OpenDefault,
		LeftoverFileMenuRow::Reveal,
		LeftoverFileMenuRow::Separator,
		LeftoverFileMenuRow::Refresh,
		LeftoverFileMenuRow::Separator,
		LeftoverFileMenuRow::NewFile,
		LeftoverFileMenuRow::NewFolder,
		LeftoverFileMenuRow::Rename,
		LeftoverFileMenuRow::Separator,
		LeftoverFileMenuRow::CopyRel,
		LeftoverFileMenuRow::CopyAbs,
		LeftoverFileMenuRow::Separator,
		LeftoverFileMenuRow::Delete,
	]
}

pub fn collect_sidebar_nav_items(
	projects: &[ProjectWithProfiles],
	groups: &[ProjectGroup],
	collapsed_groups: &[String],
	collapsed_projects: &HashSet<String>,
	_current_project: Option<&str>,
) -> Vec<SidebarNavItem> {
	let mut items = Vec::new();
	if projects.is_empty() {
		items.push(SidebarNavItem::Home);
		return items;
	}
	let mut push_project = |project: &ProjectWithProfiles| {
		items.push(SidebarNavItem::Project(project.id.clone()));
		let has_extras = project.profiles.iter().any(|p| !p.is_default);
		if leftover_profile_sublist_open(has_extras, collapsed_projects.contains(&project.id)) {
			for profile in &project.profiles {
				items.push(SidebarNavItem::Profile {
					project_id: project.id.clone(),
					profile_id: profile.id.clone(),
				});
			}
		}
	};
	for project in projects.iter().filter(|p| p.pinned_at.is_some()) {
		push_project(project);
	}
	for group in groups {
		if collapsed_groups.contains(&group.id) {
			continue;
		}
		for project in projects
			.iter()
			.filter(|p| p.group_id.as_deref() == Some(group.id.as_str()) && p.pinned_at.is_none())
		{
			push_project(project);
		}
	}
	for project in projects
		.iter()
		.filter(|p| p.pinned_at.is_none() && p.group_id.is_none())
	{
		push_project(project);
	}
	items
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn inject_git_paths_adds_unscanned_dirty_files() {
		let mut tree = HashMap::new();
		tree.insert(
			String::new(),
			TreeNode {
				path: String::new(),
				name: String::new(),
				is_dir: true,
				expanded: true,
				children_loaded: true,
				children: vec!["src".into()],
			},
		);
		tree.insert(
			"src".into(),
			TreeNode {
				path: "src".into(),
				name: "src".into(),
				is_dir: true,
				expanded: false,
				children_loaded: false,
				children: Vec::new(),
			},
		);
		inject_git_paths(&mut tree, ["src/new.rs", "notes.md"]);
		assert!(tree.contains_key("src/new.rs"));
		assert!(tree.contains_key("notes.md"));
		assert!(tree["src"].children.contains(&"src/new.rs".to_string()));
		assert!(tree[""].children.contains(&"notes.md".to_string()));
		assert!(!tree["src/new.rs"].is_dir);
		assert!(tree["src"].is_dir);
	}

	#[test]
	fn empty_sidebar_starts_at_home() {
		assert_eq!(
			collect_sidebar_nav_items(&[], &[], &[], &HashSet::new(), None),
			vec![SidebarNavItem::Home]
		);
	}

	#[test]
	fn leftover_profile_sublist_only_when_extras_exist() {
		assert!(!leftover_profile_sublist_open(false, false));
		assert!(!leftover_profile_sublist_open(false, true));
		assert!(leftover_profile_sublist_open(true, false));
		assert!(!leftover_profile_sublist_open(true, true));
		assert!(leftover_project_row_active(false, true));
		assert!(!leftover_project_row_active(true, true));
		assert!(!leftover_project_row_active(false, false));
	}

	#[test]
	fn leftover_dialog_chrome_matches_inventory() {
		assert_eq!(leftover_dialog_width(DialogKind::CreateProject), 384.0);
		assert_eq!(leftover_dialog_width(DialogKind::CreateProfile), 384.0);
		assert_eq!(leftover_dialog_width(DialogKind::ProjectSettings), 512.0);
		assert_eq!(leftover_dialog_width(DialogKind::SwitchBranch), 448.0);
		assert_eq!(leftover_dialog_width(DialogKind::DebugLog), 512.0);
		assert_eq!(leftover_dialog_width(DialogKind::ReviewQueue), 896.0);
		assert_eq!(leftover_dialog_width(DialogKind::ChooseFile), 576.0);
		assert!(leftover_rename_disabled("", "App"));
		assert!(leftover_rename_disabled("App", "App"));
		assert!(leftover_rename_disabled("  App  ", "App"));
		assert!(!leftover_rename_disabled("Next", "App"));
		assert_eq!(leftover_delete_profile_warning(&[]), None);
		assert_eq!(
			leftover_delete_profile_warning(&["local".into(), "ahead".into()]),
			Some("local ahead".into())
		);
		assert!(!leftover_new_terminal_split(true, false));
		assert!(leftover_new_terminal_split(true, true));
		assert!(!leftover_new_terminal_split(false, true));
	}

	#[test]
	fn leftover_topbar_and_browser_chrome_match_inventory() {
		assert_eq!(leftover_browser_name("chrome"), "Google Chrome");
		assert_eq!(leftover_browser_name("google-chrome"), "Google Chrome");
		assert_eq!(leftover_browser_name("firefox"), "Firefox");
		assert_eq!(leftover_browser_name("safari"), "Safari");
		assert_eq!(leftover_browser_name("brave"), "Brave Browser");
		assert_eq!(leftover_normalize_app_id("code"), "vscode");
		assert_eq!(leftover_normalize_app_id("sublime"), "sublime-text");
		assert_eq!(
			leftover_configured_app("code", LEFTOVER_EDITOR_APP_IDS, &["cursor", "vscode"]),
			Some("vscode")
		);
		assert_eq!(
			leftover_configured_app("missing", LEFTOVER_EDITOR_APP_IDS, &["zed"]),
			Some("zed")
		);
		assert_eq!(leftover_configured_app("cursor", LEFTOVER_EDITOR_APP_IDS, &[]), None);
		assert_eq!(leftover_topbar_app_tooltip("Editor", "VS Code"), "Editor · VS Code");
		assert!(!leftover_pr_visible(false));
		assert!(leftover_pr_visible(true));
		assert_eq!(leftover_pr_label(12, "Open"), "#12 Open");
		assert_eq!(leftover_launch_app_i18n("code"), "topbarVscode");
		assert_eq!(leftover_about_copyright(2026), "© 2026 AkaraChen");
		assert_eq!(leftover_about_max_width(), 672.0);
		assert_eq!(leftover_update_badge(true, false), LeftoverUpdateBadge::Available);
		assert_eq!(leftover_update_badge(false, true), LeftoverUpdateBadge::NotAvailable);
		assert_eq!(leftover_update_badge(false, false), LeftoverUpdateBadge::Hidden);
	}

	#[test]
	fn leftover_file_menu_matches_inventory() {
		let file = leftover_file_menu_flags(true, true);
		assert!(file.can_open && file.can_rename && file.can_delete);
		let folder = leftover_file_menu_flags(false, true);
		assert!(!folder.can_open);
		assert!(folder.can_reveal && folder.can_rename);
		let missing = leftover_file_menu_flags(true, false);
		assert!(!missing.can_open && !missing.can_delete);
		assert!(leftover_file_menu_rows().contains(&LeftoverFileMenuRow::Separator));
		assert_eq!(
			leftover_file_menu_rows()
				.iter()
				.filter(|row| matches!(row, LeftoverFileMenuRow::Separator))
				.count(),
			4
		);
	}

	#[test]
	fn leftover_template_dropdown_matches_inventory() {
		assert_eq!(
			leftover_template_rows(&[], &[], true),
			vec![LeftoverTemplateRow::EmptyTitle, LeftoverTemplateRow::EmptyHint]
		);
		assert!(leftover_template_rows(&[], &[], false).is_empty());
		assert_eq!(
			leftover_template_rows(&[("Dev".into(), "apps/web".into())], &["zsh".into()], true),
			vec![
				LeftoverTemplateRow::ProjectHeader,
				LeftoverTemplateRow::Project {
					index: 0,
					name: "Dev".into(),
					cwd: "apps/web".into(),
				},
				LeftoverTemplateRow::GlobalHeader,
				LeftoverTemplateRow::Global {
					index: 0,
					name: "zsh".into(),
				},
			]
		);
	}

	#[test]
	fn project_group_menu_rows_match_inventory() {
		assert_eq!(
			project_group_menu_rows(&[], None, false),
			vec![GroupMenuRow::Empty, GroupMenuRow::CreateInput]
		);
		assert_eq!(
			project_group_menu_rows(&[("g1".into(), "Work".into())], None, false),
			vec![
				GroupMenuRow::Group {
					id: "g1".into(),
					name: "Work".into(),
					current: false,
				},
				GroupMenuRow::Create,
			]
		);
		assert_eq!(
			project_group_menu_rows(&[("g1".into(), "Work".into())], Some("g1"), false),
			vec![
				GroupMenuRow::Group {
					id: "g1".into(),
					name: "Work".into(),
					current: true,
				},
				GroupMenuRow::Remove,
				GroupMenuRow::Create,
			]
		);
		assert_eq!(
			project_group_menu_rows(&[("g1".into(), "Work".into())], Some("g1"), true),
			vec![
				GroupMenuRow::Group {
					id: "g1".into(),
					name: "Work".into(),
					current: true,
				},
				GroupMenuRow::Remove,
				GroupMenuRow::CreateInput,
			]
		);
	}

	#[test]
	fn update_toasts_live_twelve_seconds() {
		let update = Toast {
			id: 1,
			kind: ToastKind::Info,
			title: "update".into(),
			body: String::new(),
			action: Some(ToastAction::OpenAbout),
			created: Instant::now(),
		};
		let plain = Toast {
			id: 2,
			kind: ToastKind::Success,
			title: "ok".into(),
			body: String::new(),
			action: None,
			created: Instant::now(),
		};
		assert_eq!(update.ttl_secs(), 12);
		assert_eq!(plain.ttl_secs(), 5);
		assert!(update.alive());
		assert!(plain.alive());
	}

	#[test]
	fn terminal_tab_icon_follows_title_keywords() {
		assert_eq!(AgentKind::from_tab_title("claude --resume"), Some(AgentKind::Claude));
		assert_eq!(AgentKind::from_tab_title("Codex"), Some(AgentKind::Codex));
		assert_eq!(AgentKind::from_tab_title("gemini-cli"), Some(AgentKind::Gemini));
		assert_eq!(AgentKind::from_tab_title("kimi"), Some(AgentKind::Kimi));
		assert_eq!(AgentKind::from_tab_title("cline agent"), Some(AgentKind::Cline));
		assert_eq!(AgentKind::from_tab_title("openclaw"), Some(AgentKind::OpenClaw));
		assert_eq!(AgentKind::from_tab_title("opencode"), Some(AgentKind::OpenCode));
		assert_eq!(AgentKind::from_tab_title("qoder"), Some(AgentKind::Qoder));
		assert_eq!(AgentKind::from_tab_title("zsh"), None);
		assert_eq!(AgentKind::tab_icon_kind("zsh", AgentKind::Cursor), AgentKind::Cursor);
		assert_eq!(AgentKind::tab_icon_kind("claude", AgentKind::Codex), AgentKind::Claude);
	}

	#[test]
	fn terminal_selection_extracts_range_and_normalizes() {
		assert_eq!(selected_from_lines("hello\nworld", None), "");
		assert_eq!(selected_from_lines("hello\nworld", Some(((0, 1), (0, 4)))), "ell");
		assert_eq!(selected_from_lines("hello\nworld", Some(((0, 3), (1, 3)))), "lo\nwor");
		assert_eq!(selected_from_lines("hello\nworld", Some(((1, 3), (0, 3)))), "lo\nwor");
		assert_eq!(selected_from_lines("hello", Some(((0, 2), (0, 2)))), "");
		let mut term = TermSession::new("1".into(), "t".into(), "p".into());
		term.begin_selection(0, 1, false);
		term.extend_selection(0, 4);
		assert!(term.cell_selected(0, 1));
		assert!(term.cell_selected(0, 3));
		assert!(!term.cell_selected(0, 4));
		assert!(!term.cell_selected(1, 0));
	}
}
