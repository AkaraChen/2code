use std::time::Duration;

use gpui::{
	AppContext, Context, Entity, FocusHandle, InteractiveElement, IntoElement,
	ParentElement, Render, Styled, Window, div, prelude::FluentBuilder, px,
};
use gpui_component::{
	ActiveTheme, Theme, ThemeMode, TitleBar, h_flex, input::InputState,
	v_flex,
};

use crate::backend::{Backend, ProfileVm, ProjectVm};
use crate::settings::AppSettings;
use crate::theme::TwoCodePalette;

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
	About,
}

pub struct AppRoot {
	pub backend: Backend,
	pub settings: AppSettings,
	pub route: Route,
	pub projects: Vec<ProjectVm>,
	pub sidebar_collapsed: bool,
	pub settings_tab: SettingsTab,
	pub error: Option<String>,
	pub show_create_project: bool,
	pub show_create_profile: bool,
	pub show_delete_project: Option<String>,
	pub create_name: Entity<InputState>,
	pub create_folder: Entity<InputState>,
	pub profile_branch: Entity<InputState>,
	pub terminal_input: Entity<InputState>,
	pub active_session: Option<String>,
	pub terminal_output: String,
	pub git_branch: String,
	pub git_stats_label: String,
	pub git_diff: String,
	pub files: Vec<String>,
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
			error: None,
			show_create_project: false,
			show_create_profile: false,
			show_delete_project: None,
			create_name,
			create_folder,
			profile_branch,
			terminal_input,
			active_session: None,
			terminal_output: String::new(),
			git_branch: String::new(),
			git_stats_label: String::new(),
			git_diff: String::new(),
			files: Vec::new(),
			focus: cx.focus_handle(),
		};
		app.apply_theme(window, cx);
		app.reload_projects(cx);
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
			self.git_stats_label =
				format!("+{} −{}", stats.insertions, stats.deletions);
			self.git_diff = self.backend.git_diff(&profile_id);
			self.files = self.backend.list_files(&profile_id);
		}
		self.refresh_terminal();
	}

	pub fn refresh_terminal(&mut self) {
		if let Some(session_id) = &self.active_session {
			self.terminal_output = self.backend.take_output(session_id);
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
				self.show_create_project = false;
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
				self.show_create_profile = false;
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

	pub fn confirm_delete_project(&mut self, cx: &mut Context<Self>) {
		if let Some(id) = self.show_delete_project.take() {
			if let Err(error) = self.backend.delete_project(&id) {
				self.error = Some(error.to_string());
			}
			self.reload_projects(cx);
			if self.projects.is_empty() {
				self.route = Route::Home;
			} else if let Some((project_id, profile_id)) =
				self.projects.first().and_then(|project| {
					project.default_profile().map(|profile| {
						(project.id.clone(), profile.id.clone())
					})
				}) {
				self.open_workspace(&project_id, &profile_id, cx);
			}
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
				self.active_session = Some(session_id);
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

	pub fn close_terminal(&mut self, cx: &mut Context<Self>) {
		if let Some(session_id) = self.active_session.take() {
			let _ = self.backend.close_terminal(&session_id);
		}
		self.terminal_output.clear();
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
									self.render_home(cx).into_any_element()
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
			.child(self.render_dialogs(window, cx))
			.child(
				div()
					.h(px(0.))
					.w(px(TwoCodePalette::SIDEBAR_WIDTH))
					.bg(palette.sidebar),
			)
	}
}
