use std::collections::{HashMap, HashSet};
use std::time::Instant;

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
			Self::Other | Self::Unknown => "Agent",
		}
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
		}
	}

	pub fn feed(&mut self, bytes: &[u8]) {
		self.parser.process(bytes);
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

#[derive(Debug, Clone)]
pub struct TreeNode {
	pub path: String,
	pub name: String,
	pub is_dir: bool,
	pub expanded: bool,
	pub children_loaded: bool,
	pub children: Vec<String>,
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
	pub git_diff_open: bool,
	pub git_diff_tab: GitDiffTab,
	pub git_diff_mode: DiffPreviewMode,
	pub git_diff_text: String,
	pub git_diff_file: Option<String>,
	pub git_commits: Vec<GitCommit>,
	pub git_commit_files: Vec<String>,
	pub git_selected_commit: Option<String>,
	pub git_large_revealed: HashSet<String>,
	pub review_comments: Vec<String>,
	pub review_line: Option<(String, String)>,
	pub branches: Vec<GitBranchInfo>,
	pub fuzzy_files: Vec<FileSearchResult>,
	pub onboarding: bool,
	pub sort_mode: bool,
	pub settings_open: bool,
	pub settings_tab: SettingsTab,
	pub debug_open: bool,
	pub debug_logs: Vec<String>,
	pub expanded_projects: HashSet<String>,
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

pub fn collect_sidebar_nav_items(
	projects: &[ProjectWithProfiles],
	groups: &[ProjectGroup],
	collapsed_groups: &[String],
	expanded_projects: &HashSet<String>,
	current_project: Option<&str>,
) -> Vec<SidebarNavItem> {
	let mut items = Vec::new();
	if projects.is_empty() {
		items.push(SidebarNavItem::Home);
		return items;
	}
	let mut push_project = |project: &ProjectWithProfiles| {
		items.push(SidebarNavItem::Project(project.id.clone()));
		let extras: Vec<_> = project.profiles.iter().filter(|p| !p.is_default).collect();
		let selected = current_project == Some(project.id.as_str());
		let expanded = expanded_projects.contains(&project.id) || extras.is_empty() || selected;
		if expanded {
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
	fn empty_sidebar_starts_at_home() {
		assert_eq!(
			collect_sidebar_nav_items(&[], &[], &[], &HashSet::new(), None),
			vec![SidebarNavItem::Home]
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
}
