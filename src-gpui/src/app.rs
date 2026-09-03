use std::collections::{HashMap, HashSet};
use std::path::Path;
use std::time::Duration;

use gpui::{
	div, prelude::*, px, Action, App, Context, Entity, FocusHandle, KeyBinding, Timer, Window,
	WindowHandle,
};

#[derive(Clone, PartialEq, Default, Debug, Action)]
#[action(namespace = twocode, no_json)]
pub struct OpenSettings;
#[derive(Clone, PartialEq, Default, Debug, Action)]
#[action(namespace = twocode, no_json)]
pub struct ToggleDebug;
#[derive(Clone, PartialEq, Default, Debug, Action)]
#[action(namespace = twocode, no_json)]
pub struct OpenPalette;
#[derive(Clone, PartialEq, Default, Debug, Action)]
#[action(namespace = twocode, no_json)]
pub struct NewTerminal;
#[derive(Clone, PartialEq, Default, Debug, Action)]
#[action(namespace = twocode, no_json)]
pub struct CloseActiveTab;
#[derive(Clone, PartialEq, Default, Debug, Action)]
#[action(namespace = twocode, no_json)]
pub struct ToggleProfileSidebar;
#[derive(Clone, PartialEq, Default, Debug, Action)]
#[action(namespace = twocode, no_json)]
pub struct OpenGitDiff;
#[derive(Clone, PartialEq, Default, Debug, Action)]
#[action(namespace = twocode, no_json)]
pub struct SaveFile;
#[derive(Clone, PartialEq, Default, Debug, Action)]
#[action(namespace = twocode, no_json)]
pub struct CommitChanges;
use gpui_component::input::{Input, InputState};
use gpui_component::{Root, WindowExt};
use crate::backend::{self, Backend};
use crate::i18n::{self, Locale};
use crate::prefs::{term_theme_by_name, Prefs, ThemePref};
use crate::state::{
	AgentStatus, AppData, ContextMenu, DialogKind, DiffPreviewMode, GitDiffTab, NotesStatus,
	OpenFileTab, OverlayState, Route, SettingsTab, SidebarMode, TermSession, ToastKind, TreeNode,
	UnifiedTab, Workspace,
};
use crate::ui;

pub struct Inputs {
	pub project_name: Entity<InputState>,
	pub profile_branch: Entity<InputState>,
	pub group_name: Entity<InputState>,
	pub rename: Entity<InputState>,
	pub commit_summary: Entity<InputState>,
	pub commit_body: Entity<InputState>,
	pub notes: Entity<InputState>,
	pub palette: Entity<InputState>,
	pub file_editor: Entity<InputState>,
	pub file_search: Entity<InputState>,
	pub debug_search: Entity<InputState>,
	pub branch_search: Entity<InputState>,
	pub new_path: Entity<InputState>,
	pub worktree: Entity<InputState>,
	pub init_script: Entity<InputState>,
	pub setup_script: Entity<InputState>,
	pub teardown_script: Entity<InputState>,
	pub template_name: Entity<InputState>,
	pub template_shell: Entity<InputState>,
	pub template_cwd: Entity<InputState>,
	pub template_commands: Entity<InputState>,
	pub custom_shell: Entity<InputState>,
	pub default_worktree: Entity<InputState>,
	pub term_search: Entity<InputState>,
}

pub struct AppView {
	pub backend: Backend,
	pub data: AppData,
	pub inputs: Inputs,
	pub focus: FocusHandle,
	pub settings_window: Option<WindowHandle<Root>>,
	pub settings_view: Option<gpui::WeakEntity<ui::settings::SettingsView>>,
}

impl AppView {
	pub fn new(backend: Backend, window: &mut Window, cx: &mut Context<Self>) -> Self {
		fn input(
			window: &mut Window,
			cx: &mut Context<AppView>,
			placeholder: &str,
			multi: bool,
		) -> Entity<InputState> {
			let ph = placeholder.to_string();
			cx.new(|cx| {
				let mut state = InputState::new(window, cx).placeholder(ph);
				if multi {
					state = state.multi_line(true);
				}
				state
			})
		}

		let prefs = Prefs::load(&backend.app_data_dir);
		let locale = prefs.language;
		let data = AppData {
			locale,
			prefs: prefs.clone(),
			projects: Vec::new(),
			groups: Vec::new(),
			route: Route::Home,
			current_project: None,
			current_profile: None,
			workspaces: HashMap::new(),
			overlay: OverlayState::default(),
			toasts: Vec::new(),
			toast_seq: 0,
			sidebar_error: None,
			notes_dirty_since: None,
		};

		let inputs = Inputs {
			project_name: input(window, cx, "", false),
			profile_branch: input(window, cx, "", false),
			group_name: input(window, cx, "", false),
			rename: input(window, cx, "", false),
			commit_summary: input(window, cx, "", false),
			commit_body: input(window, cx, "", true),
			notes: input(window, cx, "", true),
			palette: input(window, cx, "", false),
			file_editor: input(window, cx, "", true),
			file_search: input(window, cx, "", false),
			debug_search: input(window, cx, "", false),
			branch_search: input(window, cx, "", false),
			new_path: input(window, cx, "", false),
			worktree: input(window, cx, "", false),
			init_script: input(window, cx, "", true),
			setup_script: input(window, cx, "", true),
			teardown_script: input(window, cx, "", true),
			template_name: input(window, cx, "", false),
			template_shell: input(window, cx, "", false),
			template_cwd: input(window, cx, "", false),
			template_commands: input(window, cx, "", true),
			custom_shell: input(window, cx, "", false),
			default_worktree: input(window, cx, "", false),
			term_search: input(window, cx, "", false),
		};

		inputs.project_name.update(cx, |s, cx| {
			s.set_placeholder(i18n::t(locale, "projectNamePlaceholderFolder"), window, cx);
		});
		inputs.profile_branch.update(cx, |s, cx| {
			s.set_placeholder(i18n::t(locale, "branchNamePlaceholder"), window, cx);
		});
		inputs.group_name.update(cx, |s, cx| {
			s.set_placeholder(i18n::t(locale, "projectGroupNamePlaceholder"), window, cx);
		});
		inputs.commit_summary.update(cx, |s, cx| {
			s.set_placeholder(i18n::t(locale, "gitCommitSummaryPlaceholder"), window, cx);
		});
		inputs.commit_body.update(cx, |s, cx| {
			s.set_placeholder(i18n::t(locale, "gitCommitBodyPlaceholder"), window, cx);
		});
		inputs.notes.update(cx, |s, cx| {
			s.set_placeholder(i18n::t(locale, "notesPlaceholder"), window, cx);
		});
		inputs.palette.update(cx, |s, cx| {
			s.set_placeholder(i18n::t(locale, "commandPalettePlaceholder"), window, cx);
		});
		inputs.branch_search.update(cx, |s, cx| {
			s.set_placeholder(i18n::t(locale, "searchBranchesPlaceholder"), window, cx);
		});
		inputs.debug_search.update(cx, |s, cx| {
			s.set_placeholder(i18n::t(locale, "debugSearchPlaceholder"), window, cx);
		});
		inputs.term_search.update(cx, |s, cx| {
			s.set_placeholder(i18n::t(locale, "terminalSearchPlaceholder"), window, cx);
		});
		inputs.default_worktree.update(cx, |s, cx| {
			s.set_placeholder(i18n::t(locale, "defaultWorktreeDirPlaceholder"), window, cx);
			s.set_value(prefs.worktree_dir.clone(), window, cx);
		});
		inputs.custom_shell.update(cx, |s, cx| {
			s.set_placeholder(i18n::t(locale, "customShellPlaceholder"), window, cx);
			s.set_value(prefs.custom_shell.clone(), window, cx);
		});

		let view = Self {
			backend,
			data,
			inputs,
			focus: cx.focus_handle(),
			settings_window: None,
			settings_view: None,
		};

		cx.spawn(async move |this, cx| loop {
			Timer::after(Duration::from_millis(50)).await;
			if this
				.update(cx, |this, cx| {
					this.tick(cx);
					cx.notify();
				})
				.is_err()
			{
				break;
			}
		})
		.detach();

		cx.spawn(async move |this, cx| {
			Timer::after(Duration::from_secs(1)).await;
			let accept_beta = this
				.update(cx, |app, _| app.data.prefs.accept_beta)
				.unwrap_or(false);
			let result = crate::updater::check_for_update(accept_beta);
			let _ = this.update(cx, |app, cx| {
				app.apply_update_result(result, true);
				cx.notify();
			});
		})
		.detach();

		let mut view = view;
		view.reload_projects();
		if view.data.projects.is_empty() {
			view.data.overlay.onboarding = true;
		} else if let Some((project_id, profile_id)) = view.data.projects.first().and_then(|first| {
			first
				.profiles
				.iter()
				.find(|p| p.is_default)
				.or_else(|| first.profiles.first())
				.map(|p| (first.id.clone(), p.id.clone()))
		}) {
			view.open_profile(&project_id, &profile_id);
		}
		view
	}

	pub fn t(&self, key: &str) -> String {
		i18n::t(self.data.locale, key)
	}

	pub fn tf(&self, key: &str, pairs: &[(&str, &str)]) -> String {
		i18n::tf(self.data.locale, key, pairs)
	}

	pub fn persist_prefs(&self) {
		self.data.prefs.save(&self.backend.app_data_dir);
	}

	pub fn apply_theme(&self, window: &mut Window, cx: &mut App) {
		let mode = match self.data.prefs.theme {
			ThemePref::Dark => gpui_component::ThemeMode::Dark,
			ThemePref::Light => gpui_component::ThemeMode::Light,
			ThemePref::System => cx.window_appearance().into(),
		};
		gpui_component::Theme::change(mode, Some(window), cx);
		let scale = self.data.prefs.radius.scale();
		let theme = gpui_component::Theme::global_mut(cx);
		theme.radius = px(6.0 * scale);
		theme.radius_lg = px(8.0 * scale);
		if !self.data.prefs.font_family.is_empty() {
			theme.mono_font_family = self.data.prefs.font_family.clone().into();
			theme.mono_font_size = px(self.data.prefs.font_size);
		}
	}

	pub fn reload_projects(&mut self) {
		match self.backend.list_projects() {
			Ok(list) => {
				self.data.projects = list;
				self.data.sidebar_error = None;
			}
			Err(err) => self.data.sidebar_error = Some(err.to_string()),
		}
		self.data.groups = self.backend.list_groups().unwrap_or_default();
	}

	pub fn open_profile(&mut self, project_id: &str, profile_id: &str) {
		self.data.current_project = Some(project_id.to_string());
		self.data.current_profile = Some(profile_id.to_string());
		self.data.route = Route::Workspace;
		self.ensure_workspace(project_id, profile_id);
		self.refresh_workspace(profile_id);
	}

	fn ensure_workspace(&mut self, project_id: &str, profile_id: &str) {
		if self.data.workspaces.contains_key(profile_id) {
			return;
		}
		let project = self.data.project(project_id);
		let profile = project.and_then(|p| p.profiles.iter().find(|pr| pr.id == profile_id));
		let Some(project) = project.cloned() else {
			return;
		};
		let Some(profile) = profile.cloned() else {
			return;
		};
		let branch = if profile.is_default {
			self.backend
				.git_branch(&profile.worktree_path)
				.unwrap_or_else(|_| profile.branch_name.clone())
		} else {
			profile.branch_name.clone()
		};
		let config = self.backend.project_config(project_id).unwrap_or_default();
		self.data.workspaces.insert(
			profile_id.to_string(),
			Workspace {
				project_id: project.id.clone(),
				profile_id: profile.id.clone(),
				branch,
				worktree: profile.worktree_path.clone(),
				project_name: project.name.clone(),
				is_default: profile.is_default,
				sidebar_mode: SidebarMode::Files,
				sidebar_open: self.data.prefs.profile_sidebar_open,
				terminals: Vec::new(),
				files: Vec::new(),
				active: None,
				tree: HashMap::new(),
				tree_error: None,
				git_files: Vec::new(),
				git_included: HashSet::new(),
				git_stats: Default::default(),
				git_ahead: 0,
				notes: profile.notes.clone(),
				notes_status: NotesStatus::Saved,
				pr: None,
				avatar: self.backend.github_avatar(project_id),
				config,
			},
		);
		self.load_tree_root(profile_id);
	}

	pub fn refresh_workspace(&mut self, profile_id: &str) {
		if let Some(ws) = self.data.workspaces.get_mut(profile_id) {
			ws.git_stats = self.backend.git_diff_stats(profile_id).unwrap_or_default();
			ws.git_ahead = self.backend.git_ahead(profile_id).unwrap_or(0);
			ws.git_files = self
				.backend
				.tree_git_status(profile_id)
				.unwrap_or_default()
				.into_iter()
				.map(|e| (e.path, e.status))
				.collect();
			ws.git_included = ws.git_files.iter().map(|(p, _)| p.clone()).collect();
			ws.pr = self
				.backend
				.pr_status(&ws.worktree, Some(&ws.branch))
				.ok()
				.flatten();
			if ws.is_default {
				if let Ok(branch) = self.backend.git_branch(&ws.worktree) {
					ws.branch = branch;
				}
			}
		}
	}

	pub fn load_tree_root(&mut self, profile_id: &str) {
		self.load_tree_children(profile_id, None);
	}

	pub fn load_tree_children(&mut self, profile_id: &str, parent: Option<&str>) {
		let result = self.backend.list_tree_children(profile_id, parent);
		let worktree = self
			.data
			.workspaces
			.get(profile_id)
			.map(|w| w.worktree.clone())
			.unwrap_or_default();
		let Some(ws) = self.data.workspaces.get_mut(profile_id) else {
			return;
		};
		match result {
			Ok(paths) => {
				ws.tree_error = None;
				let mut names = Vec::new();
				for path in paths {
					let abs = Path::new(&worktree).join(&path);
					let is_dir = abs.is_dir();
					let name = backend::file_name(&path);
					names.push(path.clone());
					ws.tree.entry(path.clone()).or_insert_with(|| TreeNode {
						path: path.clone(),
						name,
						is_dir,
						expanded: false,
						children_loaded: false,
						children: Vec::new(),
					});
				}
				if let Some(parent) = parent {
					if let Some(node) = ws.tree.get_mut(parent) {
						node.children = names;
						node.children_loaded = true;
						node.expanded = true;
					}
				} else {
					ws.tree.insert(
						String::new(),
						TreeNode {
							path: String::new(),
							name: ".".into(),
							is_dir: true,
							expanded: true,
							children_loaded: true,
							children: names,
						},
					);
				}
			}
			Err(err) => ws.tree_error = Some(err.to_string()),
		}
	}

	pub fn toggle_dir(&mut self, profile_id: &str, path: &str) {
		let needs_load = self
			.data
			.workspaces
			.get(profile_id)
			.and_then(|w| w.tree.get(path))
			.map(|n| n.is_dir && !n.children_loaded)
			.unwrap_or(false);
		if needs_load {
			self.load_tree_children(profile_id, Some(path));
			return;
		}
		if let Some(node) = self
			.data
			.workspaces
			.get_mut(profile_id)
			.and_then(|w| w.tree.get_mut(path))
		{
			if node.is_dir {
				node.expanded = !node.expanded;
			}
		}
	}

	pub fn open_file(&mut self, profile_id: &str, path: &str, window: &mut Window, cx: &mut Context<Self>) {
		let previewable = backend::is_previewable(path);
		let content = if previewable {
			String::new()
		} else {
			self.backend.read_file(profile_id, path).unwrap_or_default()
		};
		let preview = if previewable {
			self.backend.file_preview(profile_id, path).ok()
		} else {
			None
		};
		let preview_path = preview
			.as_ref()
			.map(|p| p.file_path.clone())
			.unwrap_or_default();
		let archive_entries = preview
			.as_ref()
			.and_then(|p| p.archive_entries.clone())
			.unwrap_or_default()
			.into_iter()
			.map(|e| (e.path, e.kind))
			.collect();
		let Some(ws) = self.data.workspaces.get_mut(profile_id) else {
			return;
		};
		if let Some(ix) = ws.files.iter().position(|f| f.path == path) {
			ws.active = Some(UnifiedTab::File { index: ix });
			if !ws.files[ix].preview {
				self.inputs.file_editor.update(cx, |s, cx| {
					s.set_value(ws.files[ix].draft.clone(), window, cx);
				});
			}
			return;
		}
		let tab = OpenFileTab {
			path: path.to_string(),
			title: backend::file_name(path),
			content: content.clone(),
			draft: content.clone(),
			preview: previewable,
			preview_kind: preview
				.as_ref()
				.map(|p| p.kind.clone())
				.unwrap_or_default(),
			binary_note: preview.map(|p| p.mime_type).unwrap_or_default(),
			preview_path,
			archive_entries,
		};
		ws.files.push(tab);
		ws.active = Some(UnifiedTab::File {
			index: ws.files.len() - 1,
		});
		if !previewable {
			self.inputs.file_editor.update(cx, |s, cx| {
				s.set_value(content, window, cx);
			});
		}
	}

	pub fn save_active_file(&mut self, window: &mut Window, cx: &mut Context<Self>) {
		let Some(profile_id) = self.data.current_profile.clone() else {
			return;
		};
		let draft = self.inputs.file_editor.read(cx).value().to_string();
		let (title, path) = {
			let Some(ws) = self.data.workspaces.get_mut(&profile_id) else {
				return;
			};
			let Some(file) = ws.active_file_mut() else {
				return;
			};
			if file.preview {
				return;
			}
			file.draft = draft.clone();
			(file.title.clone(), file.path.clone())
		};
		match self.backend.write_file(&profile_id, &path, &draft) {
			Ok(()) => {
				if let Some(file) = self
					.data
					.workspaces
					.get_mut(&profile_id)
					.and_then(|w| w.active_file_mut())
				{
					file.content = draft;
					file.draft = file.content.clone();
				}
				self.data
					.push_toast(ToastKind::Success, self.t("save"), title);
			}
			Err(err) => self
				.data
				.push_toast(ToastKind::Error, self.t("somethingWentWrong"), err.to_string()),
		}
		let _ = window;
	}

	pub fn request_close_file(&mut self, profile_id: &str, path: &str) {
		let dirty = self
			.data
			.workspaces
			.get(profile_id)
			.and_then(|w| w.files.iter().find(|f| f.path == path))
			.map(|f| f.dirty())
			.unwrap_or(false);
		if dirty {
			self.data.overlay.dialog = Some(DialogKind::CloseUnsaved);
			self.data.overlay.dialog_file = Some(path.to_string());
			self.data.overlay.pending_close_file = Some(path.to_string());
		} else {
			self.close_file(profile_id, path);
		}
	}

	pub fn close_file(&mut self, profile_id: &str, path: &str) {
		if let Some(ws) = self.data.workspaces.get_mut(profile_id) {
			if let Some(ix) = ws.files.iter().position(|f| f.path == path) {
				ws.files.remove(ix);
				ws.active = if !ws.terminals.is_empty() {
					Some(UnifiedTab::Terminal { index: 0 })
				} else if !ws.files.is_empty() {
					Some(UnifiedTab::File { index: 0 })
				} else {
					None
				};
			}
		}
	}

	pub fn create_terminal(&mut self, title: &str, cwd: &str, commands: Vec<String>) {
		let Some(profile_id) = self.data.current_profile.clone() else {
			return;
		};
		let Some(ws) = self.data.workspaces.get(&profile_id) else {
			return;
		};
		let worktree = ws.worktree.clone();
		let cwd_abs = if cwd.is_empty() {
			worktree
		} else {
			Path::new(&worktree).join(cwd).to_string_lossy().into_owned()
		};
		let shell = self.data.prefs.effective_shell();
		let title = if title.is_empty() {
			self.t("terminal")
		} else {
			title.to_string()
		};
		match self
			.backend
			.create_terminal(&profile_id, &title, &cwd_abs, &shell, commands)
		{
			Ok(id) => {
				if let Some(ws) = self.data.workspaces.get_mut(&profile_id) {
					ws.terminals
						.push(TermSession::new(id, title, profile_id.clone()));
					ws.active = Some(UnifiedTab::Terminal {
						index: ws.terminals.len() - 1,
					});
				}
			}
			Err(err) => self
				.data
				.push_toast(ToastKind::Error, self.t("somethingWentWrong"), err.to_string()),
		}
	}

	pub fn close_terminal(&mut self, profile_id: &str, session_id: &str) {
		let _ = self.backend.close_terminal(session_id);
		if let Some(ws) = self.data.workspaces.get_mut(profile_id) {
			ws.terminals.retain(|t| t.id != session_id);
			ws.active = if !ws.terminals.is_empty() {
				Some(UnifiedTab::Terminal { index: 0 })
			} else if !ws.files.is_empty() {
				Some(UnifiedTab::File { index: 0 })
			} else {
				None
			};
		}
	}

	pub fn write_to_active_pty(&mut self, bytes: &[u8]) {
		if let Some(ws) = self.data.current_ws() {
			if let Some(UnifiedTab::Terminal { index }) = ws.active {
				if let Some(term) = ws.terminals.get(index) {
					let _ = self.backend.write_pty(&term.id, bytes);
				}
			}
		}
	}

	pub fn tick(&mut self, cx: &mut Context<Self>) {
		self.data.expire_toasts();
		let ids: Vec<(String, String)> = self
			.data
			.workspaces
			.iter()
			.flat_map(|(pid, ws)| {
				ws.terminals
					.iter()
					.map(|t| (pid.clone(), t.id.clone()))
					.collect::<Vec<_>>()
			})
			.collect();
		for (profile_id, session_id) in ids {
			let bytes = self.backend.take_output(&session_id);
			if bytes.is_empty() {
				continue;
			}
			let mut became_waiting = false;
			if let Some(term) = self
				.data
				.workspaces
				.get_mut(&profile_id)
				.and_then(|w| w.terminals.iter_mut().find(|t| t.id == session_id))
			{
				let before = term.agent;
				term.feed(&bytes);
				became_waiting = before != AgentStatus::Waiting && term.agent == AgentStatus::Waiting;
			}
			if became_waiting {
				self.notify_agent_waiting();
			}
		}
		if let Ok(exits) = self.backend.exits.lock() {
			let _ = exits.len();
		}
		self.drain_watch_events();
		self.autosave_notes(cx);
	}

	fn notify_agent_waiting(&self) {
		if !self.data.prefs.notifications {
			return;
		}
		let sound = self.data.prefs.notification_sound.clone();
		if !sound.is_empty() {
			let _ = crate::platform::play_system_sound(&sound);
		}
	}

	fn drain_watch_events(&mut self) {
		let events = self.backend.take_watch_events();
		if events.is_empty() {
			return;
		}
		let mut profiles = std::collections::HashSet::new();
		for event in events {
			if let Some(pid) = event.profile_id {
				profiles.insert(pid);
			} else if let Some(default) = self.data.default_profile_of(&event.project_id) {
				profiles.insert(default.id);
			}
		}
		for profile_id in profiles {
			if self.data.workspaces.contains_key(&profile_id) {
				self.load_tree_root(&profile_id);
				self.refresh_workspace(&profile_id);
			}
		}
	}

	fn autosave_notes(&mut self, cx: &mut Context<Self>) {
		let Some(profile_id) = self.data.current_profile.clone() else {
			return;
		};
		let live = self.inputs.notes.read(cx).value().to_string();
		let Some(ws) = self.data.workspaces.get_mut(&profile_id) else {
			return;
		};
		if live == ws.notes {
			return;
		}
		ws.notes_status = NotesStatus::Saving;
		match self.data.notes_dirty_since {
			None => self.data.notes_dirty_since = Some(std::time::Instant::now()),
			Some(since) if since.elapsed() < Duration::from_millis(800) => {}
			Some(_) => {
				self.data.notes_dirty_since = None;
				self.save_notes(cx);
			}
		}
	}

	pub fn cycle_term_search(&mut self, cx: &mut Context<Self>, next: bool) {
		let query = self.inputs.term_search.read(cx).value().to_string();
		if let Some(term) = self.data.current_ws_mut().and_then(|w| w.active_terminal_mut()) {
			term.search_query = query.clone();
			let hits = term.search_hits(&query);
			if hits.is_empty() {
				term.search_ix = 0;
				return;
			}
			if next {
				term.search_ix = (term.search_ix + 1) % hits.len();
			} else {
				term.search_ix = if term.search_ix == 0 {
					hits.len() - 1
				} else {
					term.search_ix - 1
				};
			}
		}
	}

	pub fn sync_pty_size(&mut self, window: &Window) {
		let (rows, cols) = self.estimate_pty_size(window);
		let mut resized = Vec::new();
		if let Some(ws) = self.data.current_ws_mut() {
			for term in &mut ws.terminals {
				if term.set_size(rows, cols) {
					resized.push(term.id.clone());
				}
			}
		}
		for id in resized {
			let _ = self.backend.resize_pty(&id, rows, cols);
		}
	}

	fn estimate_pty_size(&self, window: &Window) -> (u16, u16) {
		let size = window.viewport_size();
		let mut chrome = 48.0;
		if !self.data.prefs.sidebar_collapsed {
			chrome += self.data.prefs.sidebar_width;
		}
		if self.data.current_ws().map(|w| w.sidebar_open).unwrap_or(false) {
			chrome += self.data.prefs.profile_sidebar_width;
		}
		let font = self.data.prefs.font_size.max(10.0);
		let cols = ((f32::from(size.width) - chrome - 24.0) / (font * 0.62)).floor() as i32;
		let rows = ((f32::from(size.height) - 96.0) / (font * 1.35)).floor() as i32;
		(rows.clamp(10, 120) as u16, cols.clamp(40, 300) as u16)
	}

	pub fn apply_update_result(&mut self, result: Result<crate::updater::UpdateInfo, String>, silent: bool) {
		match result {
			Ok(info) if info.available => {
				let title = self.tf(
					"updateAvailableTitle",
					&[("version", &info.latest_version)],
				);
				let body = self.tf(
					"updateAvailableDescription",
					&[
						("currentVersion", &info.current_version),
						("version", &info.latest_version),
					],
				);
				self.data.push_toast_action(
					ToastKind::Info,
					title,
					body,
					Some(crate::state::ToastAction::OpenAbout),
				);
			}
			Ok(_) => {
				if !silent {
					self.data.push_toast(
						ToastKind::Info,
						self.t("updateNotAvailableTitle"),
						self.t("updateNotAvailableDescription"),
					);
				}
			}
			Err(err) => {
				if !silent {
					self.data.push_toast(
						ToastKind::Error,
						self.t("updateCheckFailedTitle"),
						err,
					);
				}
			}
		}
		self.data.overlay.update_checked = true;
	}

	pub fn move_sidebar_project(&mut self, id: &str, delta: i32) {
		if let Err(err) = self.backend.move_project(id, delta) {
			self.data
				.push_toast(ToastKind::Error, self.t("somethingWentWrong"), err.to_string());
			return;
		}
		self.reload_projects();
	}

	pub fn drop_sidebar_project(&mut self, dragged: &str, target: Option<&str>, unpin: bool) {
		if let Err(err) = self.backend.drop_project(dragged, target, unpin) {
			self.data
				.push_toast(ToastKind::Error, self.t("somethingWentWrong"), err.to_string());
			return;
		}
		self.reload_projects();
	}

	pub fn create_project_from_dialog(&mut self, window: &mut Window, cx: &mut Context<Self>) {
		let folder = match self.data.overlay.dialog_folder.clone() {
			Some(f) => f,
			None => return,
		};
		let name = self.inputs.project_name.read(cx).value().to_string();
		let name = if name.trim().is_empty() {
			backend::file_name(&folder)
		} else {
			name
		};
		self.data.overlay.dialog_busy = true;
		match self.backend.create_project(&name, &folder) {
			Ok(project) => {
				self.reload_projects();
				self.data.overlay.dialog = None;
				self.data.overlay.dialog_busy = false;
				self.data.overlay.onboarding = false;
				if let Some(profile) = self.data.default_profile_of(&project.id) {
					self.open_profile(&project.id, &profile.id);
				}
			}
			Err(err) => {
				self.data.overlay.dialog_busy = false;
				self.data.overlay.dialog_error = Some(err.to_string());
			}
		}
		let _ = window;
	}

	pub fn delete_current_dialog_project(&mut self) {
		let Some(id) = self.data.overlay.dialog_project.clone() else {
			return;
		};
		if let Err(err) = self.backend.delete_project(&id) {
			self.data
				.push_toast(ToastKind::Error, self.t("somethingWentWrong"), err.to_string());
			return;
		}
		let was_current = self.data.current_project.as_deref() == Some(id.as_str());
		self.reload_projects();
		self.data.overlay.dialog = None;
		if was_current {
			if let Some(next) = self.data.projects.first().cloned() {
				if let Some(profile) = self.data.default_profile_of(&next.id) {
					self.open_profile(&next.id, &profile.id);
					return;
				}
			}
			self.data.route = Route::Home;
			self.data.current_project = None;
			self.data.current_profile = None;
		}
	}

	pub fn rename_dialog_project(&mut self, cx: &mut Context<Self>) {
		let Some(id) = self.data.overlay.dialog_project.clone() else {
			return;
		};
		let name = self.inputs.rename.read(cx).value().to_string();
		if name.trim().is_empty() {
			return;
		}
		if let Err(err) = self.backend.rename_project(&id, &name) {
			self.data
				.push_toast(ToastKind::Error, self.t("somethingWentWrong"), err.to_string());
			return;
		}
		self.reload_projects();
		self.data.overlay.dialog = None;
	}

	pub fn create_profile_from_dialog(&mut self, cx: &mut Context<Self>) {
		let Some(project_id) = self.data.overlay.dialog_project.clone() else {
			return;
		};
		let branch = self.inputs.profile_branch.read(cx).value().to_string();
		match self.backend.create_profile(&project_id, branch.trim()) {
			Ok(profile) => {
				self.reload_projects();
				self.data.overlay.dialog = None;
				self.open_profile(&project_id, &profile.id);
			}
			Err(err) => self.data.overlay.dialog_error = Some(err.to_string()),
		}
	}

	pub fn delete_dialog_profile(&mut self) {
		let Some(id) = self.data.overlay.dialog_profile.clone() else {
			return;
		};
		let was_current = self.data.current_profile.as_deref() == Some(id.as_str());
		let project_id = self.data.current_project.clone();
		if let Err(err) = self.backend.delete_profile(&id) {
			self.data
				.push_toast(ToastKind::Error, self.t("somethingWentWrong"), err.to_string());
			return;
		}
		self.data.workspaces.remove(&id);
		self.reload_projects();
		self.data.overlay.dialog = None;
		if was_current {
			if let Some(project_id) = project_id {
				if let Some(profile) = self.data.default_profile_of(&project_id) {
					self.open_profile(&project_id, &profile.id);
					return;
				}
			}
			self.data.route = Route::Home;
		}
	}

	pub fn prepare_delete_profile(&mut self, id: &str) {
		self.data.overlay.dialog = Some(DialogKind::DeleteProfile);
		self.data.overlay.dialog_profile = Some(id.to_string());
		self.data.overlay.dialog_busy = true;
		self.data.overlay.delete_warning = None;
		match self.backend.delete_profile_check(id) {
			Ok(check) => {
				self.data.overlay.dialog_busy = false;
				let mut parts = Vec::new();
				if check.working_tree_diff.files_changed > 0 {
					parts.push(i18n::tf(
						self.data.locale,
						"deleteProfileLocalChangesWarning",
						&[
							("files", &check.working_tree_diff.files_changed.to_string()),
							("insertions", &check.working_tree_diff.insertions.to_string()),
							("deletions", &check.working_tree_diff.deletions.to_string()),
						],
					));
				}
				if check.unpushed_commit_count > 0 {
					parts.push(i18n::tf(
						self.data.locale,
						"deleteProfileUnpushedCommitsWarning",
						&[
							("count", &check.unpushed_commit_count.to_string()),
							("files", &check.unpushed_commit_diff.files_changed.to_string()),
							("insertions", &check.unpushed_commit_diff.insertions.to_string()),
							("deletions", &check.unpushed_commit_diff.deletions.to_string()),
						],
					));
				}
				if !parts.is_empty() {
					self.data.overlay.delete_warning = Some(parts.join("\n"));
				}
			}
			Err(err) => {
				self.data.overlay.dialog_busy = false;
				self.data.overlay.delete_warning = Some(format!(
					"{}\n{}",
					self.t("deleteProfileGitCheckFailedTitle"),
					err
				));
			}
		}
	}

	pub fn commit_selected(&mut self, cx: &mut Context<Self>) {
		let Some(profile_id) = self.data.current_profile.clone() else {
			return;
		};
		let summary = self.inputs.commit_summary.read(cx).value().to_string();
		let body = self.inputs.commit_body.read(cx).value().to_string();
		let Some(ws) = self.data.workspaces.get(&profile_id) else {
			return;
		};
		let files: Vec<String> = ws.git_included.iter().cloned().collect();
		if summary.trim().is_empty() || files.is_empty() {
			return;
		}
		let body = if body.trim().is_empty() {
			None
		} else {
			Some(body.as_str())
		};
		match self.backend.commit_changes(&profile_id, &files, &summary, body) {
			Ok(hash) => {
				self.data.push_toast(
					ToastKind::Success,
					self.t("gitCommitSuccessTitle"),
					i18n::tf(
						self.data.locale,
						"gitCommitSuccessDescription",
						&[("hash", &hash)],
					),
				);
				self.refresh_workspace(&profile_id);
			}
			Err(err) => self.data.push_toast(
				ToastKind::Error,
				self.t("gitCommitErrorTitle"),
				err.to_string(),
			),
		}
	}

	pub fn push_current(&mut self) {
		let Some(profile_id) = self.data.current_profile.clone() else {
			return;
		};
		match self.backend.git_push(&profile_id) {
			Ok(()) => {
				self.data
					.push_toast(ToastKind::Success, self.t("gitPushSuccessTitle"), "");
				self.refresh_workspace(&profile_id);
			}
			Err(err) => self.data.push_toast(
				ToastKind::Error,
				self.t("gitPushErrorTitle"),
				err.to_string(),
			),
		}
	}

	pub fn discard_file(&mut self, path: &str) {
		let Some(profile_id) = self.data.current_profile.clone() else {
			return;
		};
		match self.backend.discard_file(&profile_id, &[path.to_string()]) {
			Ok(()) => {
				self.data.push_toast(
					ToastKind::Success,
					self.t("gitDiscardFileSuccessTitle"),
					i18n::tf(
						self.data.locale,
						"gitDiscardFileSuccessDescription",
						&[("file", path)],
					),
				);
				self.refresh_workspace(&profile_id);
			}
			Err(err) => self.data.push_toast(
				ToastKind::Error,
				self.t("gitDiscardFileErrorTitle"),
				err.to_string(),
			),
		}
	}

	pub fn open_git_diff(&mut self) {
		let Some(profile_id) = self.data.current_profile.clone() else {
			return;
		};
		self.data.overlay.git_diff_open = true;
		self.data.overlay.git_diff_tab = GitDiffTab::Changes;
		self.data.overlay.git_diff_text = self.backend.git_diff(&profile_id).unwrap_or_default();
		self.data.overlay.git_commits = self.backend.git_log(&profile_id, 80).unwrap_or_default();
		self.refresh_workspace(&profile_id);
	}

	pub fn select_diff_file(&mut self, path: &str) {
		self.data.overlay.git_diff_file = Some(path.to_string());
		if let Some(profile_id) = self.data.current_profile.clone() {
			self.data.overlay.git_diff_text = self.backend.git_diff(&profile_id).unwrap_or_default();
		}
	}

	pub fn select_commit(&mut self, hash: &str) {
		self.data.overlay.git_selected_commit = Some(hash.to_string());
		if let Some(profile_id) = self.data.current_profile.clone() {
			let diff = self.backend.commit_diff(&profile_id, hash).unwrap_or_default();
			self.data.overlay.git_commit_files = parse_diff_files(&diff);
			self.data.overlay.git_diff_text = diff;
		}
	}

	pub fn checkout_branch(&mut self, name: &str) {
		let Some(ws) = self.data.current_ws() else {
			return;
		};
		let folder = ws.worktree.clone();
		match self.backend.checkout_branch(&folder, name) {
			Ok(()) => {
				self.data.push_toast(
					ToastKind::Success,
					i18n::tf(self.data.locale, "gitCheckoutSuccessTitle", &[("branch", name)]),
					"",
				);
				if let Some(pid) = self.data.current_profile.clone() {
					self.refresh_workspace(&pid);
				}
				self.data.overlay.dialog = None;
			}
			Err(err) => self.data.push_toast(
				ToastKind::Error,
				self.t("gitCheckoutErrorTitle"),
				err.to_string(),
			),
		}
	}

	pub fn save_notes(&mut self, cx: &mut Context<Self>) {
		let Some(profile_id) = self.data.current_profile.clone() else {
			return;
		};
		let notes = self.inputs.notes.read(cx).value().to_string();
		if let Some(ws) = self.data.workspaces.get_mut(&profile_id) {
			ws.notes_status = NotesStatus::Saving;
			ws.notes = notes.clone();
		}
		match self.backend.update_notes(&profile_id, &notes) {
			Ok(()) => {
				if let Some(ws) = self.data.workspaces.get_mut(&profile_id) {
					ws.notes_status = NotesStatus::Saved;
				}
			}
			Err(_) => {
				if let Some(ws) = self.data.workspaces.get_mut(&profile_id) {
					ws.notes_status = NotesStatus::Failed;
				}
				self.data
					.push_toast(ToastKind::Error, self.t("notesSaveFailedTitle"), "");
			}
		}
	}

	pub fn save_project_settings(&mut self, cx: &mut Context<Self>) {
		let Some(project_id) = self
			.data
			.overlay
			.dialog_project
			.clone()
			.or_else(|| self.data.current_project.clone())
		else {
			return;
		};
		let mut config = self.backend.project_config(&project_id).unwrap_or_default();
		let worktree = self.inputs.worktree.read(cx).value().to_string();
		config.worktree_dir = if worktree.trim().is_empty() {
			None
		} else {
			Some(worktree)
		};
		config.init_script = lines(&self.inputs.init_script.read(cx).value());
		config.setup_script = lines(&self.inputs.setup_script.read(cx).value());
		config.teardown_script = lines(&self.inputs.teardown_script.read(cx).value());
		if let Err(err) = self.backend.save_project_config(&project_id, &config) {
			self.data
				.push_toast(ToastKind::Error, self.t("somethingWentWrong"), err.to_string());
			return;
		}
		if let Some(ws) = self
			.data
			.workspaces
			.values_mut()
			.find(|w| w.project_id == project_id)
		{
			ws.config = config;
		}
		self.data.overlay.dialog = None;
	}

	pub fn search_palette(&mut self, cx: &mut Context<Self>) {
		let Some(profile_id) = self.data.current_profile.clone() else {
			return;
		};
		let q = self.inputs.palette.read(cx).value().to_string();
		if q.trim().is_empty() {
			self.data.overlay.palette_results.clear();
			return;
		}
		self.data.overlay.palette_results = self
			.backend
			.search_files(&profile_id, &q)
			.unwrap_or_default();
		self.data.overlay.palette_index = 0;
	}

	pub fn open_palette_selection(&mut self, window: &mut Window, cx: &mut Context<Self>) {
		let Some(profile_id) = self.data.current_profile.clone() else {
			return;
		};
		let ix = self.data.overlay.palette_index;
		let path = self
			.data
			.overlay
			.palette_results
			.get(ix)
			.map(|r| r.path.clone());
		if let Some(path) = path {
			self.data.overlay.palette_open = false;
			self.open_file(&profile_id, &path, window, cx);
		}
	}

	pub fn start_rename_path(&mut self, path: &str, window: &mut Window, cx: &mut Context<Self>) {
		self.data.overlay.renaming_path = Some(path.to_string());
		let name = backend::file_name(path);
		self.inputs.rename.update(cx, |s, cx| {
			s.set_value(name, window, cx);
		});
	}

	pub fn commit_rename_path(&mut self, cx: &mut Context<Self>) {
		let Some(from) = self.data.overlay.renaming_path.clone() else {
			return;
		};
		let name = self.inputs.rename.read(cx).value().to_string();
		if name.trim().is_empty() {
			self.data.overlay.renaming_path = None;
			return;
		}
		let Some(profile_id) = self.data.current_profile.clone() else {
			return;
		};
		let parent = std::path::Path::new(&from)
			.parent()
			.map(|p| p.to_string_lossy().into_owned())
			.unwrap_or_default();
		let to = if parent.is_empty() {
			name
		} else {
			format!("{parent}/{name}")
		};
		if let Err(err) = self.backend.rename_path(&profile_id, &from, &to) {
			self.data.push_toast(
				ToastKind::Error,
				self.t("fileTreeCreateErrorTitle"),
				err.to_string(),
			);
			return;
		}
		self.data.overlay.renaming_path = None;
		self.load_tree_root(&profile_id);
	}

	pub fn drop_file_on_terminal(&mut self) {
		let Some(path) = self.data.overlay.drag_file.take() else {
			return;
		};
		let quoted = if path.contains(' ') {
			format!("\"{path}\" ")
		} else {
			format!("{path} ")
		};
		self.write_to_active_pty(quoted.as_bytes());
	}

	pub fn open_clickable(&mut self, token: &crate::detector::Clickable, window: &mut Window, cx: &mut Context<Self>) {
		match token {
			crate::detector::Clickable::Url(url) => {
				self.data.overlay.dialog = Some(DialogKind::OpenLink);
				self.data.overlay.dialog_url = Some(url.clone());
			}
			crate::detector::Clickable::Path(path) => {
				let Some(profile_id) = self.data.current_profile.clone() else {
					return;
				};
				match self.backend.resolve_file(&profile_id, path) {
					Ok(model::filesystem::ResolvedFilePath::Exact { path }) => {
						self.open_file(&profile_id, &path, window, cx);
					}
					Ok(model::filesystem::ResolvedFilePath::Fuzzy { candidates }) => {
						self.data.overlay.dialog = Some(DialogKind::ChooseFile);
						self.data.overlay.fuzzy_files = candidates;
					}
					Err(err) => self.data.push_toast(
						ToastKind::Error,
						self.t("somethingWentWrong"),
						err.to_string(),
					),
				}
			}
		}
	}

	pub fn create_path(&mut self, is_dir: bool, window: &mut Window, cx: &mut Context<Self>) {
		let Some(profile_id) = self.data.current_profile.clone() else {
			return;
		};
		let name = self.inputs.new_path.read(cx).value().to_string();
		let name = if name.trim().is_empty() {
			if is_dir {
				"New Folder".into()
			} else {
				"New File".into()
			}
		} else {
			name
		};
		if let Err(err) = self.backend.create_path(&profile_id, &name, is_dir) {
			self.data.push_toast(
				ToastKind::Error,
				self.t("fileTreeCreateErrorTitle"),
				err.to_string(),
			);
			return;
		}
		self.load_tree_root(&profile_id);
		self.start_rename_path(&name, window, cx);
	}

	pub fn delete_tree_path(&mut self, path: &str) {
		let Some(profile_id) = self.data.current_profile.clone() else {
			return;
		};
		if let Err(err) = self.backend.delete_paths(&profile_id, &[path.to_string()]) {
			self.data.push_toast(
				ToastKind::Error,
				self.t("fileTreeDeleteErrorTitle"),
				err.to_string(),
			);
			return;
		}
		self.load_tree_root(&profile_id);
	}

	pub fn reveal(&mut self, path: Option<&str>) {
		let Some(profile_id) = self.data.current_profile.clone() else {
			return;
		};
		let _ = self.backend.reveal_path(&profile_id, path);
	}

	pub fn open_external(&mut self, path: &str) {
		let Some(profile_id) = self.data.current_profile.clone() else {
			return;
		};
		let _ = self.backend.open_in_default_app(&profile_id, path);
	}

	pub fn copy_path(&self, path: &str, absolute: bool, cx: &mut App) {
		let abs = self
			.data
			.current_ws()
			.map(|w| Path::new(&w.worktree).join(path).to_string_lossy().into_owned())
			.unwrap_or_else(|| path.to_string());
		let text = if absolute { abs } else { path.to_string() };
		cx.write_to_clipboard(gpui::ClipboardItem::new_string(text));
	}

	pub fn open_topbar_app(&self, kind: &str) {
		let Some(ws) = self.data.current_ws() else {
			return;
		};
		let folder = &ws.worktree;
		let cmd = match kind {
			"github-desktop" => "github",
			"editor" => match self.data.prefs.editor_app.as_str() {
				"cursor" => "cursor",
				"windsurf" => "windsurf",
				"zed" => "zed",
				"sublime" => "subl",
				_ => "code",
			},
			"terminal" => match self.data.prefs.terminal_app.as_str() {
				"ghostty" => "ghostty",
				"iterm2" => "open",
				"kitty" => "kitty",
				"warp" => "warp",
				_ => "x-terminal-emulator",
			},
			_ => return,
		};
		let _ = std::process::Command::new(cmd).arg(folder).spawn();
	}

	pub fn open_pr(&self) {
		if let Some(url) = self.data.current_ws().and_then(|w| w.pr.as_ref().map(|p| p.url.clone())) {
			let _ = open::that(url);
		}
	}

	pub fn current_term_theme(&self) -> &'static crate::prefs::TermTheme {
		let dark = window_is_dark_pref(&self.data.prefs);
		let name = if self.data.prefs.sync_terminal_theme {
			&self.data.prefs.terminal_theme_dark
		} else if dark {
			&self.data.prefs.terminal_theme_dark
		} else {
			&self.data.prefs.terminal_theme_light
		};
		term_theme_by_name(name)
	}

	pub fn agent_for_project(&self, project_id: &str) -> AgentStatus {
		self.data
			.project(project_id)
			.and_then(|p| p.profiles.iter().find(|pr| pr.is_default))
			.and_then(|pr| self.data.workspaces.get(&pr.id))
			.and_then(|ws| ws.terminals.iter().map(|t| t.agent).max_by_key(|a| agent_rank(*a)))
			.unwrap_or(AgentStatus::Idle)
	}

	pub fn agent_for_profile(&self, profile_id: &str) -> AgentStatus {
		self.data
			.workspaces
			.get(profile_id)
			.and_then(|ws| ws.terminals.iter().map(|t| t.agent).max_by_key(|a| agent_rank(*a)))
			.unwrap_or(AgentStatus::Idle)
	}

	pub fn bind_keys(cx: &mut App) {
		cx.bind_keys([
			KeyBinding::new("cmd-,", OpenSettings, None),
			KeyBinding::new("ctrl-,", OpenSettings, None),
			KeyBinding::new("cmd-shift-d", ToggleDebug, None),
			KeyBinding::new("ctrl-shift-d", ToggleDebug, None),
			KeyBinding::new("cmd-k", OpenPalette, None),
			KeyBinding::new("ctrl-k", OpenPalette, None),
			KeyBinding::new("cmd-t", NewTerminal, None),
			KeyBinding::new("ctrl-t", NewTerminal, None),
			KeyBinding::new("cmd-w", CloseActiveTab, None),
			KeyBinding::new("ctrl-w", CloseActiveTab, None),
			KeyBinding::new("cmd-e", ToggleProfileSidebar, None),
			KeyBinding::new("ctrl-e", ToggleProfileSidebar, None),
			KeyBinding::new("cmd-g", OpenGitDiff, None),
			KeyBinding::new("ctrl-g", OpenGitDiff, None),
			KeyBinding::new("cmd-s", SaveFile, None),
			KeyBinding::new("ctrl-s", SaveFile, None),
			KeyBinding::new("cmd-enter", CommitChanges, None),
			KeyBinding::new("ctrl-enter", CommitChanges, None),
		]);
	}
}

fn agent_rank(status: AgentStatus) -> u8 {
	match status {
		AgentStatus::Running => 3,
		AgentStatus::Waiting => 2,
		AgentStatus::Completed => 1,
		AgentStatus::Idle => 0,
	}
}

fn window_is_dark_pref(prefs: &Prefs) -> bool {
	matches!(prefs.theme, ThemePref::Dark)
}

fn lines(s: &str) -> Vec<String> {
	s.lines()
		.map(|l| l.trim_end().to_string())
		.filter(|l| !l.is_empty())
		.collect()
}

pub fn parse_diff_files(diff: &str) -> Vec<String> {
	let mut files = Vec::new();
	for line in diff.lines() {
		if let Some(rest) = line.strip_prefix("diff --git ") {
			if let Some((_, b)) = rest.split_once(' ') {
				files.push(b.trim_start_matches("b/").to_string());
			}
		}
	}
	files
}

pub fn file_status_badge(status: &str) -> &'static str {
	let s = status.to_ascii_uppercase();
	if s.contains('A') || s.contains('?') {
		"A"
	} else if s.contains('D') {
		"D"
	} else if s.contains('R') {
		"R"
	} else {
		"M"
	}
}

pub fn extract_file_hunk(diff: &str, path: &str) -> String {
	let marker = format!("b/{path}");
	let mut out = String::new();
	let mut take = false;
	for line in diff.lines() {
		if line.starts_with("diff --git ") {
			take = line.contains(&marker) || line.ends_with(path);
			if take {
				out.push_str(line);
				out.push('\n');
			}
			continue;
		}
		if take {
			out.push_str(line);
			out.push('\n');
		}
	}
	if out.is_empty() {
		diff.to_string()
	} else {
		out
	}
}

impl gpui::Render for AppView {
	fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
		self.apply_theme(window, cx);
		self.sync_pty_size(window);
		if self.data.overlay.palette_open {
			let q = self.inputs.palette.read(cx).value().to_string();
			if self.data.overlay.palette_results.is_empty() && !q.is_empty() {
				self.search_palette(cx);
			}
		}
		if matches!(self.data.current_ws().map(|w| w.sidebar_mode), Some(SidebarMode::Notes)) {
			// keep notes editor mounted
		}
		if let Some(ws) = self.data.current_ws() {
			if let Some(UnifiedTab::File { index }) = ws.active {
				if let Some(file) = ws.files.get(index) {
					if !file.preview {
						let live = self.inputs.file_editor.read(cx).value().to_string();
						if let Some(ws) = self.data.current_ws_mut() {
							if let Some(file) = ws.active_file_mut() {
								file.draft = live;
							}
						}
					}
				}
			}
		}

		div()
			.id("app-root")
			.track_focus(&self.focus)
			.key_context("App")
			.size_full()
			.on_action(cx.listener(|this, _: &OpenSettings, window, cx| {
				ui::settings::open_settings_window(this, window, cx);
			}))
			.on_action(cx.listener(|this, _: &ToggleDebug, _, cx| {
				this.data.prefs.debug_mode = !this.data.prefs.debug_mode;
				this.data.overlay.debug_open = this.data.prefs.debug_mode;
				this.persist_prefs();
				cx.notify();
			}))
			.on_action(cx.listener(|this, _: &OpenPalette, _, cx| {
				if this.data.route == Route::Workspace {
					this.data.overlay.palette_open = !this.data.overlay.palette_open;
					cx.notify();
				}
			}))
			.on_action(cx.listener(|this, _: &NewTerminal, _, cx| {
				this.create_terminal(&this.t("newTerminal"), "", Vec::new());
				cx.notify();
			}))
			.on_action(cx.listener(|this, _: &CloseActiveTab, _, cx| {
				if let Some(profile_id) = this.data.current_profile.clone() {
					if let Some(ws) = this.data.workspaces.get(&profile_id) {
						match ws.active {
							Some(UnifiedTab::Terminal { index }) => {
								if let Some(id) = ws.terminals.get(index).map(|t| t.id.clone()) {
									this.close_terminal(&profile_id, &id);
								}
							}
							Some(UnifiedTab::File { index }) => {
								if let Some(path) = ws.files.get(index).map(|f| f.path.clone()) {
									this.request_close_file(&profile_id, &path);
								}
							}
							None => {}
						}
					}
				}
				cx.notify();
			}))
			.on_action(cx.listener(|this, _: &ToggleProfileSidebar, _, cx| {
				if let Some(ws) = this.data.current_ws_mut() {
					ws.sidebar_open = !ws.sidebar_open;
					this.data.prefs.profile_sidebar_open = ws.sidebar_open;
					this.persist_prefs();
				}
				cx.notify();
			}))
			.on_action(cx.listener(|this, _: &OpenGitDiff, _, cx| {
				this.open_git_diff();
				cx.notify();
			}))
			.on_action(cx.listener(|this, _: &SaveFile, window, cx| {
				this.save_active_file(window, cx);
				cx.notify();
			}))
			.on_action(cx.listener(|this, _: &CommitChanges, _, cx| {
				this.commit_selected(cx);
				cx.notify();
			}))
			.child(ui::shell::render(self, window, cx))
	}
}

#[allow(dead_code)]
pub fn input_el(state: &Entity<InputState>) -> Input {
	Input::new(state)
}
