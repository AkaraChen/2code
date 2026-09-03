use std::time::Duration;

use gpui::{
	AppContext, Context, Entity, FocusHandle, InteractiveElement, IntoElement,
	ParentElement, Render, Styled, Window, div, prelude::FluentBuilder, px,
};
use gpui_component::{
	ActiveTheme, Theme, ThemeMode, TitleBar, WindowExt, h_flex, input::InputState,
	v_flex,
};

use std::collections::HashMap;

use crate::backend::{Backend, ProfileVm, ProjectVm};
use crate::detector::{AgentStatus, AgentStatusDetector, DetectionInput};
use crate::i18n;
use crate::settings::AppSettings;
use crate::theme::TwoCodePalette;
use model::project::GitCommit;

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Route {
	Home,
	Workspace {
		project_id: String,
		profile_id: String,
	},
	Settings,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SettingsTab {
	General,
	Terminal,
	Notifications,
	About,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum WorkspacePane {
	Files,
	Git,
	Terminal,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum GitPane {
	Changes,
	History,
}

#[derive(Clone, Debug)]
pub struct TerminalTab {
	pub id: String,
	pub title: String,
	pub status: Option<AgentStatus>,
}

pub struct AppRoot {
	pub backend: Backend,
	pub settings: AppSettings,
	pub route: Route,
	pub projects: Vec<ProjectVm>,
	pub sidebar_collapsed: bool,
	pub settings_tab: SettingsTab,
	pub workspace_pane: WorkspacePane,
	pub git_pane: GitPane,
	pub error: Option<String>,
	pub create_name: Entity<InputState>,
	pub create_folder: Entity<InputState>,
	pub profile_branch: Entity<InputState>,
	pub terminal_input: Entity<InputState>,
	pub terminals: Vec<TerminalTab>,
	pub active_session: Option<String>,
	pub terminal_output: String,
	pub git_branch: String,
	pub git_stats_label: String,
	pub git_diff: String,
	pub commits: Vec<GitCommit>,
	pub selected_commit: Option<String>,
	pub commit_diff: String,
	pub files: Vec<String>,
	pub file_parent: Option<String>,
	pub selected_file: Option<String>,
	pub file_preview: String,
	pub file_is_markdown: bool,
	pub detectors: HashMap<String, AgentStatusDetector>,
	pub pending_notification: Option<String>,
	#[allow(dead_code)]
	pub focus: FocusHandle,
}

impl AppRoot {
	pub fn new(window: &mut Window, cx: &mut Context<Self>) -> Self {
		let backend = Backend::boot().expect("failed to initialize 2code backend");
		let settings = AppSettings::load(&backend.settings_path());
		let create_name = cx.new(|cx| {
			InputState::new(window, cx).placeholder("Optional project name")
		});
		let create_folder = cx.new(|cx| {
			InputState::new(window, cx).placeholder("Project folder")
		});
		let profile_branch = cx.new(|cx| {
			InputState::new(window, cx).placeholder("feature/my-lane")
		});
		let terminal_input = cx.new(|cx| {
			InputState::new(window, cx).placeholder("Send to the PTY and press Enter")
		});
		let mut app = Self {
			backend,
			settings,
			route: Route::Home,
			projects: Vec::new(),
			sidebar_collapsed: false,
			settings_tab: SettingsTab::General,
			workspace_pane: WorkspacePane::Files,
			git_pane: GitPane::Changes,
			error: None,
			create_name,
			create_folder,
			profile_branch,
			terminal_input,
			terminals: Vec::new(),
			active_session: None,
			terminal_output: String::new(),
			git_branch: String::new(),
			git_stats_label: String::new(),
			git_diff: String::new(),
			commits: Vec::new(),
			selected_commit: None,
			commit_diff: String::new(),
			files: Vec::new(),
			file_parent: None,
			selected_file: None,
			file_preview: String::new(),
			file_is_markdown: false,
			detectors: HashMap::new(),
			pending_notification: None,
			focus: cx.focus_handle(),
		};
		app.apply_theme(window, cx);
		app.reload_projects(cx);
		app.seed_project_if_requested(cx);
		if let Some(project) = app.projects.first().cloned() {
			if let Some(profile) = project.default_profile().cloned() {
				app.open_workspace(&project.id, &profile.id, cx);
			}
		}
		app.start_output_poller(cx);
		app
	}

	fn start_output_poller(&self, cx: &mut Context<Self>) {
		cx.spawn(async move |this, cx| {
			loop {
				cx.background_executor()
					.timer(Duration::from_millis(80))
					.await;
				if this
					.update(cx, |this, cx| {
						this.refresh_terminal();
						cx.notify();
					})
					.is_err()
				{
					break;
				}
			}
		})
		.detach();
	}

	pub fn apply_theme(&self, window: &mut Window, cx: &mut Context<Self>) {
		let dark = self.settings.is_dark(false);
		Theme::change(
			if dark {
				ThemeMode::Dark
			} else {
				ThemeMode::Light
			},
			Some(window),
			cx,
		);
		TwoCodePalette::for_mode(dark).apply(cx);
		window.refresh();
	}

	pub fn t<'a>(&self, en: &'a str, zh: &'a str) -> &'a str {
		i18n::t(&self.settings.locale, en, zh)
	}

	fn seed_project_if_requested(&mut self, cx: &mut Context<Self>) {
		if !self.projects.is_empty() {
			return;
		}
		let Ok(folder) = std::env::var("TWOCODE_SEED_FOLDER") else {
			return;
		};
		if folder.trim().is_empty() {
			return;
		}
		let name = std::path::Path::new(&folder)
			.file_name()
			.and_then(|name| name.to_str())
			.unwrap_or("Seed")
			.to_string();
		if let Ok(project) = self.backend.create_project(&name, &folder) {
			self.reload_projects(cx);
			if let Some(profile) = project.default_profile() {
				self.open_workspace(&project.id, &profile.id, cx);
			}
		}
	}

	pub fn persist_settings(&self) {
		let _ = self.settings.save(&self.backend.settings_path());
	}

	pub fn reload_projects(&mut self, _cx: &mut Context<Self>) {
		match self.backend.list_projects() {
			Ok(projects) => {
				self.projects = projects;
				self.error = None;
			}
			Err(error) => self.error = Some(error.to_string()),
		}
	}

	pub fn current_project(&self) -> Option<&ProjectVm> {
		match &self.route {
			Route::Workspace { project_id, .. } => {
				self.projects.iter().find(|project| project.id == *project_id)
			}
			_ => None,
		}
	}

	pub fn current_profile(&self) -> Option<&ProfileVm> {
		let Route::Workspace { profile_id, .. } = &self.route else {
			return None;
		};
		self.current_project()?
			.profiles
			.iter()
			.find(|profile| profile.id == *profile_id)
	}

	pub fn open_home(&mut self, cx: &mut Context<Self>) {
		self.route = Route::Home;
		cx.notify();
	}

	pub fn open_settings(&mut self, cx: &mut Context<Self>) {
		self.route = Route::Settings;
		cx.notify();
	}

	pub fn open_workspace(
		&mut self,
		project_id: &str,
		profile_id: &str,
		cx: &mut Context<Self>,
	) {
		self.route = Route::Workspace {
			project_id: project_id.to_string(),
			profile_id: profile_id.to_string(),
		};
		self.file_parent = None;
		self.selected_file = None;
		self.file_preview.clear();
		self.selected_commit = None;
		self.commit_diff.clear();
		self.refresh_workspace();
		cx.notify();
	}

	pub fn refresh_workspace(&mut self) {
		if let Some(folder) = self.current_project().map(|project| project.folder.clone())
		{
			self.git_branch = self.backend.git_branch(&folder);
		}
		if let Some(profile_id) =
			self.current_profile().map(|profile| profile.id.clone())
		{
			let stats = self.backend.git_diff_stats(&profile_id);
			self.git_stats_label = format!(
				"+{} −{} · {} files",
				stats.insertions, stats.deletions, stats.files_changed
			);
			self.git_diff = self.backend.git_diff(&profile_id);
			self.commits = self.backend.git_log(&profile_id);
			self.files = self
				.backend
				.list_files(&profile_id, self.file_parent.as_deref());
			if let Some(hash) = self.selected_commit.clone() {
				self.commit_diff = self.backend.git_commit_diff(&profile_id, &hash);
			}
			if let Some(path) = self.selected_file.clone() {
				self.load_file_preview(&profile_id, &path);
			}
		}
		self.refresh_terminal();
	}

	fn load_file_preview(&mut self, profile_id: &str, path: &str) {
		match self.backend.read_file(profile_id, path) {
			Ok(content) => {
				self.file_preview = content;
				self.file_is_markdown = path.ends_with(".md") || path.ends_with(".mdx");
				self.error = None;
			}
			Err(error) => {
				self.file_preview = error.to_string();
				self.file_is_markdown = false;
			}
		}
	}

	pub fn open_path(&mut self, path: &str, cx: &mut Context<Self>) {
		let Some(profile_id) = self.current_profile().map(|profile| profile.id.clone())
		else {
			return;
		};
		let children = self.backend.list_files(&profile_id, Some(path));
		if !children.is_empty() && self.backend.read_file(&profile_id, path).is_err() {
			self.file_parent = Some(path.to_string());
			self.files = children;
			self.selected_file = None;
			self.file_preview.clear();
			self.workspace_pane = WorkspacePane::Files;
			cx.notify();
			return;
		}
		self.selected_file = Some(path.to_string());
		self.workspace_pane = WorkspacePane::Files;
		self.load_file_preview(&profile_id, path);
		cx.notify();
	}

	pub fn open_parent_dir(&mut self, cx: &mut Context<Self>) {
		let Some(current) = self.file_parent.clone() else {
			return;
		};
		let parent = std::path::Path::new(&current)
			.parent()
			.and_then(|path| path.to_str())
			.filter(|path| !path.is_empty())
			.map(str::to_string);
		self.file_parent = parent;
		self.selected_file = None;
		self.file_preview.clear();
		self.refresh_workspace();
		cx.notify();
	}

	pub fn select_commit(&mut self, hash: &str, cx: &mut Context<Self>) {
		self.selected_commit = Some(hash.to_string());
		self.git_pane = GitPane::History;
		if let Some(profile_id) = self.current_profile().map(|profile| profile.id.clone())
		{
			self.commit_diff = self.backend.git_commit_diff(&profile_id, hash);
		}
		cx.notify();
	}

	pub fn refresh_terminal(&mut self) {
		if let Some(session_id) = &self.active_session {
			self.terminal_output = self.backend.take_output(session_id);
			let title = self.backend.session_title(session_id);
			let detector = self
				.detectors
				.entry(session_id.clone())
				.or_insert_with(AgentStatusDetector::new);
			let previous = self
				.terminals
				.iter()
				.find(|tab| tab.id == *session_id)
				.and_then(|tab| tab.status);
			let result = detector.detect(DetectionInput {
				screen: self.terminal_output.clone(),
				osc_title: title,
			});
			if let Some(tab) = self
				.terminals
				.iter_mut()
				.find(|tab| tab.id == *session_id)
			{
				tab.status = result.status;
			}
			if self.settings.notifications_enabled
				&& previous != Some(AgentStatus::Waiting)
				&& result.status == Some(AgentStatus::Waiting)
			{
				let agent = result.agent_id.unwrap_or_else(|| "agent".into());
				self.pending_notification =
					Some(format!("{agent} is waiting for input"));
			}
		}
	}

	pub fn pick_folder(&mut self, window: &mut Window, cx: &mut Context<Self>) {
		if let Some(folder) = rfd::FileDialog::new().pick_folder() {
			let path = folder.to_string_lossy().to_string();
			self.create_folder.update(cx, |state, cx| {
				state.set_value(path, window, cx);
			});
			cx.notify();
		}
	}

	pub fn submit_create_project(
		&mut self,
		window: &mut Window,
		cx: &mut Context<Self>,
	) {
		let name = self.create_name.read(cx).value().to_string();
		let folder = self.create_folder.read(cx).value().to_string();
		if folder.trim().is_empty() {
			self.error = Some("Choose a folder first.".into());
			cx.notify();
			return;
		}
		let display_name = if name.trim().is_empty() {
			std::path::Path::new(&folder)
				.file_name()
				.and_then(|name| name.to_str())
				.unwrap_or("Untitled")
				.to_string()
		} else {
			name
		};
		match self.backend.create_project(&display_name, &folder) {
			Ok(project) => {
				self.reload_projects(cx);
				if let Some(profile) = project.default_profile() {
					self.open_workspace(&project.id, &profile.id, cx);
				}
			}
			Err(error) => self.error = Some(error.to_string()),
		}
		self.create_name.update(cx, |state, cx| {
			state.set_value("", window, cx);
		});
		cx.notify();
	}

	pub fn submit_create_profile(
		&mut self,
		window: &mut Window,
		cx: &mut Context<Self>,
	) {
		let Some(project) = self.current_project().cloned() else {
			return;
		};
		let branch = self.profile_branch.read(cx).value().to_string();
		let worktree = if self.settings.worktree_dir.is_empty() {
			None
		} else {
			Some(self.settings.worktree_dir.as_str())
		};
		match self
			.backend
			.create_profile(&project.id, &branch, worktree)
		{
			Ok(profile) => {
				self.reload_projects(cx);
				self.open_workspace(&project.id, &profile.id, cx);
			}
			Err(error) => self.error = Some(error.to_string()),
		}
		self.profile_branch.update(cx, |state, cx| {
			state.set_value("", window, cx);
		});
		cx.notify();
	}

	pub fn confirm_delete_project(&mut self, project_id: &str, cx: &mut Context<Self>) {
		if let Err(error) = self.backend.delete_project(project_id) {
			self.error = Some(error.to_string());
		}
		self.reload_projects(cx);
		if self.projects.is_empty() {
			self.route = Route::Home;
		} else if let Some((next_project, next_profile)) =
			self.projects.first().and_then(|project| {
				project.default_profile().map(|profile| {
					(project.id.clone(), profile.id.clone())
				})
			}) {
			self.open_workspace(&next_project, &next_profile, cx);
		}
		cx.notify();
	}

	pub fn new_terminal(&mut self, cx: &mut Context<Self>) {
		let Some(profile) = self.current_profile().cloned() else {
			return;
		};
		match self
			.backend
			.create_terminal(&profile.id, &profile.worktree_path, "Terminal")
		{
			Ok(session_id) => {
				let title = format!("Terminal {}", self.terminals.len() + 1);
				self.terminals.push(TerminalTab {
					id: session_id.clone(),
					title,
					status: None,
				});
				self.active_session = Some(session_id);
				self.workspace_pane = WorkspacePane::Terminal;
				self.terminal_output.clear();
				self.error = None;
			}
			Err(error) => self.error = Some(error.to_string()),
		}
		cx.notify();
	}

	pub fn send_terminal_input(
		&mut self,
		window: &mut Window,
		cx: &mut Context<Self>,
	) {
		let Some(session_id) = self.active_session.clone() else {
			return;
		};
		let mut command = self.terminal_input.read(cx).value().to_string();
		if !command.ends_with('\n') {
			command.push('\n');
		}
		if let Err(error) = self.backend.write_pty(&session_id, command.as_bytes())
		{
			self.error = Some(error.to_string());
		}
		self.terminal_input.update(cx, |state, cx| {
			state.set_value("", window, cx);
		});
		self.refresh_terminal();
		cx.notify();
	}

	pub fn activate_terminal(&mut self, session_id: &str, cx: &mut Context<Self>) {
		self.active_session = Some(session_id.to_string());
		self.workspace_pane = WorkspacePane::Terminal;
		self.refresh_terminal();
		cx.notify();
	}

	pub fn close_terminal(&mut self, cx: &mut Context<Self>) {
		if let Some(session_id) = self.active_session.take() {
			let _ = self.backend.close_terminal(&session_id);
			self.terminals.retain(|tab| tab.id != session_id);
			self.detectors.remove(&session_id);
		}
		self.active_session = self.terminals.last().map(|tab| tab.id.clone());
		self.terminal_output.clear();
		self.refresh_terminal();
		cx.notify();
	}

	pub fn set_theme_mode(
		&mut self,
		theme: &str,
		window: &mut Window,
		cx: &mut Context<Self>,
	) {
		self.settings.theme = theme.to_string();
		self.persist_settings();
		self.apply_theme(window, cx);
		cx.notify();
	}

	pub fn set_locale(&mut self, locale: &str, cx: &mut Context<Self>) {
		self.settings.locale = locale.to_string();
		self.persist_settings();
		cx.notify();
	}
}

impl Render for AppRoot {
	fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
		if let Some(message) = self.pending_notification.take() {
			window.push_notification(message, cx);
		}
		let palette = TwoCodePalette::for_mode(self.settings.is_dark(false));
		v_flex()
			.size_full()
			.bg(cx.theme().background)
			.text_color(cx.theme().foreground)
			.child(
				TitleBar::new()
					.child("2code")
					.child(div().text_xs().text_color(cx.theme().muted_foreground).child(
						match &self.route {
							Route::Home => "Home".to_string(),
							Route::Settings => "Settings".to_string(),
							Route::Workspace { .. } => self
								.current_project()
								.map(|project| project.name.clone())
								.unwrap_or_else(|| "Workspace".into()),
						},
					)),
			)
			.child(
				h_flex()
					.id("shell")
					.flex_1()
					.min_h_0()
					.child(self.render_sidebar(cx))
					.child(
						v_flex()
							.flex_1()
							.min_w_0()
							.min_h_0()
							.bg(cx.theme().background)
							.when_some(self.error.clone(), |this, error| {
								this.child(
									div()
										.px_4()
										.py_2()
										.text_sm()
										.text_color(cx.theme().danger_foreground)
										.child(error),
								)
							})
							.child(match self.route {
								Route::Home => {
									self.render_home(window, cx).into_any_element()
								}
								Route::Settings => {
									self.render_settings(window, cx).into_any_element()
								}
								Route::Workspace { .. } => {
									self.render_workspace(window, cx).into_any_element()
								}
							}),
					),
			)
			.child(
				div()
					.h(px(0.))
					.w(px(TwoCodePalette::SIDEBAR_WIDTH))
					.bg(palette.sidebar),
			)
	}
}
