use std::collections::{HashMap, HashSet};
use std::path::Path;
use std::time::Duration;

use gpui::{
	div, prelude::*, px, Action, App, ClipboardEntry, ClipboardItem, Context, Entity, EntityInputHandler, FocusHandle,
	Focusable, KeyBinding, Timer, Window, WindowHandle,
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
#[derive(Clone, PartialEq, Default, Debug, Action)]
#[action(namespace = twocode, no_json)]
pub struct DismissOverlay;
#[derive(Clone, PartialEq, Default, Debug, Action)]
#[action(namespace = twocode, no_json)]
pub struct FindInTerminal;
#[derive(Clone, PartialEq, Default, Debug, Action)]
#[action(namespace = twocode, no_json)]
pub struct IncreaseFontSize;
#[derive(Clone, PartialEq, Default, Debug, Action)]
#[action(namespace = twocode, no_json)]
pub struct DecreaseFontSize;
#[derive(Clone, PartialEq, Default, Debug, Action)]
#[action(namespace = twocode, no_json)]
pub struct WrapBold;
#[derive(Clone, PartialEq, Default, Debug, Action)]
#[action(namespace = twocode, no_json)]
pub struct WrapItalic;
use crate::backend::{self, Backend};
use crate::i18n::{self, Locale};
use crate::prefs::{term_theme_by_name, Prefs, ThemePref};
use crate::state::{
	AgentStatus, AppData, ContextMenu, DialogKind, DiffPreviewMode, GitDiffTab, MdMenu, NotesStatus, OpenFileTab,
	OverlayState, Route, SettingsTab, SidebarMode, SidebarNavItem, TermSession, ToastKind, TreeNode, UnifiedTab,
	Workspace,
};
use crate::ui;
use gpui_component::input::{Input, InputState};
use gpui_component::{Root, WindowExt};

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
	pub review_comment: Entity<InputState>,
	pub md_link: Entity<InputState>,
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
		fn input(window: &mut Window, cx: &mut Context<AppView>, placeholder: &str, multi: bool) -> Entity<InputState> {
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
			notes_bound_profile: None,
			file_dirty_since: None,
			avatars: HashMap::new(),
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
			file_editor: cx.new(|cx| {
				InputState::new(window, cx)
					.multi_line(true)
					.code_editor("text")
					.line_number(true)
					.soft_wrap(false)
			}),
			file_search: input(window, cx, &i18n::t(locale, "fileViewerFindInFile"), false),
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
			review_comment: input(window, cx, "", true),
			md_link: input(window, cx, "https://", false),
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
		inputs.file_search.update(cx, |s, cx| {
			s.set_placeholder(i18n::t(locale, "fileViewerFindInFile"), window, cx);
		});
		inputs.review_comment.update(cx, |s, cx| {
			s.set_placeholder(i18n::t(locale, "gitReviewCommentPlaceholder"), window, cx);
		});
		inputs.worktree.update(cx, |s, cx| {
			s.set_placeholder(i18n::t(locale, "projectWorktreeDirPlaceholder"), window, cx);
		});
		inputs.default_worktree.update(cx, |s, cx| {
			s.set_placeholder(i18n::t(locale, "defaultWorktreeDirPlaceholder"), window, cx);
			s.set_value(prefs.worktree_dir.clone(), window, cx);
		});
		inputs.init_script.update(cx, |s, cx| {
			s.set_placeholder(i18n::t(locale, "scriptPlaceholder"), window, cx);
		});
		inputs.setup_script.update(cx, |s, cx| {
			s.set_placeholder(i18n::t(locale, "scriptPlaceholder"), window, cx);
		});
		inputs.teardown_script.update(cx, |s, cx| {
			s.set_placeholder(i18n::t(locale, "scriptPlaceholder"), window, cx);
		});
		inputs.template_name.update(cx, |s, cx| {
			s.set_placeholder(i18n::t(locale, "terminalTemplateNamePlaceholder"), window, cx);
		});
		inputs.template_shell.update(cx, |s, cx| {
			s.set_placeholder(i18n::t(locale, "terminalTemplateShellPlaceholder"), window, cx);
		});
		inputs.template_cwd.update(cx, |s, cx| {
			s.set_placeholder(i18n::t(locale, "terminalTemplateCwdPlaceholder"), window, cx);
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
			let accept_beta = this.update(cx, |app, _| app.data.prefs.accept_beta).unwrap_or(false);
			let result = crate::updater::check_for_update(accept_beta);
			let _ = this.update(cx, |app, cx| {
				app.apply_update_result(result, true);
				cx.notify();
			});
		})
		.detach();

		let mut view = view;
		view.reload_projects();
		view.restore_all_sessions();
		if view.data.projects.is_empty() {
			cx.spawn(async move |this, cx| {
				Timer::after(Duration::from_millis(300)).await;
				let _ = this.update(cx, |app, cx| {
					if app.data.projects.is_empty() && app.data.overlay.dialog.is_none() {
						app.data.overlay.onboarding = true;
						cx.notify();
					}
				});
			})
			.detach();
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
		self.data.avatars = self
			.data
			.projects
			.iter()
			.filter_map(|p| self.backend.github_avatar(&p.id).map(|url| (p.id.clone(), url)))
			.collect();
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
				tree_selected: HashSet::new(),
				tree_anchor: None,
				tree_error: None,
				git_files: Vec::new(),
				git_included: HashSet::new(),
				git_stats: Default::default(),
				git_ahead: 0,
				notes: profile.notes.clone(),
				notes_status: NotesStatus::Saved,
				pr: None,
				pr_error: None,
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
			match self.backend.pr_status(&ws.worktree, Some(&ws.branch)) {
				Ok(pr) => {
					ws.pr = pr;
					ws.pr_error = None;
				}
				Err(err) => {
					ws.pr = None;
					ws.pr_error = Some(err.to_string());
				}
			}
			if ws.is_default {
				if let Ok(branch) = self.backend.git_branch(&ws.worktree) {
					ws.branch = branch;
				}
			}
		}
		self.inject_git_paths(profile_id);
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
		self.inject_git_paths(profile_id);
	}

	fn inject_git_paths(&mut self, profile_id: &str) {
		let Some(ws) = self.data.workspaces.get_mut(profile_id) else {
			return;
		};
		let files: Vec<String> = ws.git_files.iter().map(|(p, _)| p.clone()).collect();
		crate::state::inject_git_paths(&mut ws.tree, files);
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
		let (content, load_error) = if previewable {
			(String::new(), None)
		} else {
			match self.backend.read_file(profile_id, path) {
				Ok(content) => (content, None),
				Err(err) => (String::new(), Some(err.to_string())),
			}
		};
		let preview = if previewable {
			self.backend.file_preview(profile_id, path).ok()
		} else {
			None
		};
		let preview_path = preview.as_ref().map(|p| p.file_path.clone()).unwrap_or_default();
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
				let draft = ws.files[ix].draft.clone();
				let file_path = ws.files[ix].path.clone();
				self.bind_file_editor(&file_path, &draft, window, cx);
			}
			return;
		}
		let tab = OpenFileTab {
			path: path.to_string(),
			title: backend::file_name(path),
			content: content.clone(),
			draft: content.clone(),
			preview: previewable,
			preview_kind: preview.as_ref().map(|p| p.kind.clone()).unwrap_or_default(),
			binary_note: preview.map(|p| p.mime_type).unwrap_or_default(),
			preview_path,
			archive_entries,
			load_error,
		};
		ws.files.push(tab);
		ws.active = Some(UnifiedTab::File {
			index: ws.files.len() - 1,
		});
		if !previewable {
			self.bind_file_editor(path, &content, window, cx);
		}
	}

	pub fn bind_file_editor(&mut self, path: &str, content: &str, window: &mut Window, cx: &mut Context<Self>) {
		let lang = backend::language_from_path(path);
		let show_gutter = !backend::is_markdown(path);
		self.inputs.file_editor.update(cx, |s, cx| {
			s.set_highlighter(lang, cx);
			s.set_line_number(show_gutter, window, cx);
			s.set_soft_wrap(!show_gutter, window, cx);
			s.set_value(content.to_string(), window, cx);
		});
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
				self.data.push_toast(ToastKind::Success, self.t("save"), title);
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
					ws.terminals.push(TermSession::new(id, title, profile_id.clone()));
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

	pub fn write_path_to_pty(&mut self, session_id: &str, path: &str) {
		let quoted = if path.contains(' ') {
			format!("\"{path}\" ")
		} else {
			format!("{path} ")
		};
		let _ = self.backend.write_pty(session_id, quoted.as_bytes());
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

	pub fn clear_active_terminal(&mut self) {
		let Some(id) = self
			.data
			.current_ws()
			.and_then(|w| w.active_terminal())
			.map(|t| t.id.clone())
		else {
			return;
		};
		let _ = self.backend.clear_pty_output(&id);
		if let Some(term) = self.data.current_ws_mut().and_then(|w| w.active_terminal_mut()) {
			term.clear_screen();
		}
		self.write_to_active_pty(&[0x0c]);
	}

	pub fn tick(&mut self, cx: &mut Context<Self>) {
		let started = std::time::Instant::now();
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
		self.drain_debug_logs();
		self.autosave_notes(cx);
		self.sync_file_draft(cx);
		if self.data.prefs.performance_profile {
			let tick_ms = started.elapsed().as_millis();
			if tick_ms >= 8 {
				tracing::info!(target: "perf", tick_ms, "ui tick");
				let dir = self.backend.app_data_dir.join("profiles");
				let _ = std::fs::create_dir_all(&dir);
				let line = format!(
					"{{\"tick_ms\":{tick_ms},\"ts\":{}}}\n",
					std::time::SystemTime::now()
						.duration_since(std::time::UNIX_EPOCH)
						.unwrap_or_default()
						.as_millis()
				);
				if let Ok(mut file) = std::fs::OpenOptions::new()
					.create(true)
					.append(true)
					.open(dir.join("frontend-perf.jsonl"))
				{
					use std::io::Write;
					let _ = file.write_all(line.as_bytes());
				}
			}
		}
	}

	fn drain_debug_logs(&mut self) {
		let incoming = self.backend.take_debug_logs();
		if incoming.is_empty() {
			return;
		}
		self.data.overlay.debug_logs.extend(incoming);
		if self.data.overlay.debug_logs.len() > crate::backend::DEBUG_LOG_CAP {
			let extra = self.data.overlay.debug_logs.len() - crate::backend::DEBUG_LOG_CAP;
			self.data.overlay.debug_logs.drain(0..extra);
		}
	}

	fn notify_agent_waiting(&self) {
		if !self.data.prefs.notifications {
			return;
		}
		let sound = self.data.prefs.notification_sound.clone();
		if !sound.is_empty() {
			let _ = crate::platform::play_system_sound(&sound);
		}
		if let Some(term) = self
			.data
			.workspaces
			.values()
			.flat_map(|ws| ws.terminals.iter())
			.find(|t| t.agent == AgentStatus::Waiting)
		{
			let title = if term.agent_kind == crate::state::AgentKind::Unknown {
				self.t("agentWaitingNotificationTitleGeneric")
			} else {
				i18n::tf(
					self.data.locale,
					"agentWaitingNotificationTitle",
					&[("agent", term.agent_kind.label())],
				)
			};
			let body = i18n::tf(
				self.data.locale,
				"agentWaitingNotificationBody",
				&[("tab", term.title.as_str())],
			);
			crate::platform::send_notification(&title, &body);
		}
	}

	fn sync_file_draft(&mut self, cx: &mut Context<Self>) {
		let Some(profile_id) = self.data.current_profile.clone() else {
			return;
		};
		let live = self.inputs.file_editor.read(cx).value().to_string();
		let Some(ws) = self.data.workspaces.get_mut(&profile_id) else {
			return;
		};
		let Some(file) = ws.active_file_mut() else {
			self.data.file_dirty_since = None;
			return;
		};
		if file.preview || file.draft == live {
			self.data.file_dirty_since = None;
			return;
		}
		match self.data.file_dirty_since {
			None => self.data.file_dirty_since = Some(std::time::Instant::now()),
			Some(since) if since.elapsed() < Duration::from_millis(400) => {}
			Some(_) => {
				file.draft = live;
				self.data.file_dirty_since = None;
			}
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

	fn restore_all_sessions(&mut self) {
		let Ok(sessions) = self.backend.list_all_sessions() else {
			return;
		};
		for record in sessions {
			let Some(project_id) = self
				.data
				.projects
				.iter()
				.find(|p| p.profiles.iter().any(|pr| pr.id == record.profile_id))
				.map(|p| p.id.clone())
			else {
				continue;
			};
			self.ensure_workspace(&project_id, &record.profile_id);
			match self.backend.restore_session(&record) {
				Ok((new_id, history)) => {
					if let Some(ws) = self.data.workspaces.get_mut(&record.profile_id) {
						let mut term = TermSession::new(new_id, record.title.clone(), record.profile_id.clone());
						let _ = term.set_size(record.rows.max(1) as u16, record.cols.max(1) as u16);
						if !history.is_empty() {
							term.feed(&history);
						}
						ws.terminals.push(term);
						ws.active = Some(UnifiedTab::Terminal {
							index: ws.terminals.len() - 1,
						});
					}
				}
				Err(err) => {
					tracing::warn!(
						error = %err,
						session = %record.id,
						"failed to restore pty session"
					);
				}
			}
		}
	}

	fn sync_notes_input(&mut self, window: &mut Window, cx: &mut Context<Self>) {
		let Some(profile_id) = self.data.current_profile.clone() else {
			return;
		};
		if self.data.notes_bound_profile.as_deref() == Some(profile_id.as_str()) {
			return;
		}
		if let Some(prev) = self.data.notes_bound_profile.clone() {
			if self.data.notes_dirty_since.is_some() {
				let notes = self.inputs.notes.read(cx).value().to_string();
				if let Some(ws) = self.data.workspaces.get_mut(&prev) {
					ws.notes = notes.clone();
					ws.notes_status = NotesStatus::Saving;
				}
				match self.backend.update_notes(&prev, &notes) {
					Ok(()) => {
						if let Some(ws) = self.data.workspaces.get_mut(&prev) {
							ws.notes_status = NotesStatus::Saved;
						}
					}
					Err(_) => {
						if let Some(ws) = self.data.workspaces.get_mut(&prev) {
							ws.notes_status = NotesStatus::Failed;
						}
					}
				}
				self.data.notes_dirty_since = None;
			}
		}
		let notes = self
			.data
			.workspaces
			.get(&profile_id)
			.map(|w| w.notes.clone())
			.unwrap_or_default();
		self.inputs.notes.update(cx, |s, cx| {
			s.set_value(notes, window, cx);
		});
		self.data.notes_bound_profile = Some(profile_id);
	}

	pub fn click_tree_path(
		&mut self,
		path: &str,
		is_dir: bool,
		multi: bool,
		range: bool,
		window: &mut Window,
		cx: &mut Context<Self>,
	) {
		let Some(profile) = self.data.current_profile.clone() else {
			return;
		};
		if range {
			let paths = self
				.data
				.workspaces
				.get(&profile)
				.map(visible_tree_paths)
				.unwrap_or_default();
			let anchor = self
				.data
				.workspaces
				.get(&profile)
				.and_then(|w| w.tree_anchor.clone())
				.unwrap_or_else(|| path.to_string());
			if let (Some(a), Some(b)) = (
				paths.iter().position(|p| p == &anchor),
				paths.iter().position(|p| p == path),
			) {
				let (lo, hi) = if a <= b { (a, b) } else { (b, a) };
				if let Some(ws) = self.data.workspaces.get_mut(&profile) {
					ws.tree_selected = paths[lo..=hi].iter().cloned().collect();
					ws.tree_anchor = Some(anchor);
				}
			}
			return;
		}
		if multi {
			if let Some(ws) = self.data.workspaces.get_mut(&profile) {
				if !ws.tree_selected.remove(path) {
					ws.tree_selected.insert(path.to_string());
				}
				ws.tree_anchor = Some(path.to_string());
			}
			return;
		}
		if let Some(ws) = self.data.workspaces.get_mut(&profile) {
			ws.tree_selected.clear();
			ws.tree_selected.insert(path.to_string());
			ws.tree_anchor = Some(path.to_string());
		}
		if is_dir {
			self.toggle_dir(&profile, path);
		} else if !self.is_deleted_tree_path(&profile, path) {
			self.open_file(&profile, path, window, cx);
		}
	}

	pub fn nudge_sidebar(&mut self, profile: bool, key: &str) -> bool {
		let (min, max) = if profile {
			(180.0_f32, 560.0_f32)
		} else {
			(220.0_f32, 420.0_f32)
		};
		let width = if profile {
			&mut self.data.prefs.profile_sidebar_width
		} else {
			&mut self.data.prefs.sidebar_width
		};
		let next = match key {
			"left" => *width - 16.0,
			"right" => *width + 16.0,
			"home" => min,
			"end" => max,
			_ => return false,
		}
		.clamp(min, max);
		if (*width - next).abs() < f32::EPSILON {
			return false;
		}
		*width = next;
		self.persist_prefs();
		true
	}

	fn autosave_notes(&mut self, cx: &mut Context<Self>) {
		let Some(profile_id) = self.data.current_profile.clone() else {
			return;
		};
		if self.data.notes_bound_profile.as_deref() != Some(profile_id.as_str()) {
			return;
		}
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

	fn is_deleted_tree_path(&self, profile: &str, path: &str) -> bool {
		self.data
			.workspaces
			.get(profile)
			.and_then(|w| w.git_files.iter().find(|(p, _)| p == path || p.ends_with(path)))
			.is_some_and(|(_, status)| git_status_kind(status) == GitStatusKind::Deleted)
	}

	pub fn open_find(&mut self, window: &mut Window, cx: &mut Context<Self>) {
		let file_tab = self
			.data
			.current_ws()
			.and_then(|w| w.active.as_ref())
			.is_some_and(|tab| matches!(tab, UnifiedTab::File { .. }));
		if file_tab {
			self.data.overlay.file_search_open = true;
			self.data.overlay.file_search_ix = 0;
			self.inputs.file_search.update(cx, |input, cx| {
				input.focus(window, cx);
			});
			return;
		}
		if let Some(term) = self.data.current_ws_mut().and_then(|w| w.active_terminal_mut()) {
			term.search_open = true;
		}
		self.inputs.term_search.update(cx, |input, cx| {
			input.focus(window, cx);
		});
	}

	pub fn bump_font_size(&mut self, delta: f32) {
		self.data.prefs.font_size = (self.data.prefs.font_size + delta).clamp(10.0, 20.0);
		self.persist_prefs();
	}

	pub fn paste_to_pty(&mut self, cx: &mut Context<Self>) {
		let Some(item) = cx.read_from_clipboard() else {
			return;
		};
		if let Some(text) = item.text().filter(|t| !t.is_empty()) {
			self.write_to_active_pty(text.as_bytes());
			return;
		}
		if item
			.entries()
			.iter()
			.any(|entry| matches!(entry, ClipboardEntry::Image(_)))
		{
			self.write_to_active_pty(&[0x16]);
		}
	}

	pub fn copy_term_selection(&mut self, cx: &mut Context<Self>) -> bool {
		let Some(text) = self
			.data
			.current_ws()
			.and_then(|w| w.active_terminal())
			.map(|t| t.selected_text())
		else {
			return false;
		};
		if text.is_empty() {
			return false;
		}
		cx.write_to_clipboard(ClipboardItem::new_string(text));
		true
	}

	pub fn copy_term_or_interrupt(&mut self, cx: &mut Context<Self>) {
		if self
			.data
			.current_ws()
			.and_then(|w| w.active_terminal())
			.is_some_and(|t| t.has_selection())
		{
			self.copy_term_selection(cx);
		} else {
			self.write_to_active_pty(&[0x03]);
		}
	}

	pub fn toggle_md_menu(
		&mut self,
		menu: MdMenu,
		target: crate::ui::markdown::MarkupTarget,
		window: &mut Window,
		cx: &mut Context<Self>,
	) {
		if self.data.overlay.md_menu == Some(menu) {
			self.data.overlay.md_menu = None;
			return;
		}
		self.data.overlay.md_menu = Some(menu);
		if menu == MdMenu::Link {
			let input = crate::ui::markdown::md_input(self, target);
			let text = input.read(cx).value().to_string();
			let caret = input.read(cx).cursor();
			let href = crate::ui::markdown::link_href_at(&text, caret).unwrap_or_default();
			self.inputs.md_link.update(cx, |s, cx| {
				s.set_placeholder("https://", window, cx);
				s.set_value(href, window, cx);
			});
		}
	}

	pub fn run_md(
		&mut self,
		target: crate::ui::markdown::MarkupTarget,
		action: crate::ui::markdown::MdAction,
		window: &mut Window,
		cx: &mut Context<Self>,
	) {
		use crate::ui::markdown::{
			apply_block_prefix, apply_link, apply_slash_at, apply_table_op, insert_snippet, remove_link, MdAction,
		};
		let input = crate::ui::markdown::md_input(self, target).clone();
		match action {
			MdAction::Wrap(prefix, suffix) => {
				wrap_markup(&input, prefix, suffix, window, cx);
				self.data.overlay.md_menu = None;
			}
			MdAction::Block(prefix) => {
				input.update(cx, |state, cx| {
					let text = state.value().to_string();
					let caret = state.cursor().min(text.len());
					let (next, at) = apply_block_prefix(&text, caret, prefix);
					state.set_value(next.clone(), window, cx);
					let (line, character) = offset_line_col(&next, at);
					state.set_cursor_position(gpui_component::input::Position::new(line, character), window, cx);
				});
				self.data.overlay.md_menu = None;
			}
			MdAction::Slash(prefix, suffix) => {
				input.update(cx, |state, cx| {
					let text = state.value().to_string();
					let caret = state.cursor().min(text.len());
					let (next, at) = apply_slash_at(&text, caret, prefix, suffix);
					state.set_value(next.clone(), window, cx);
					let (line, character) = offset_line_col(&next, at);
					state.set_cursor_position(gpui_component::input::Position::new(line, character), window, cx);
				});
				self.data.overlay.md_menu = None;
			}
			MdAction::Insert(snippet) => {
				input.update(cx, |state, cx| {
					let text = state.value().to_string();
					let caret = state.cursor().min(text.len());
					let (next, at) = insert_snippet(&text, caret, snippet);
					state.set_value(next.clone(), window, cx);
					let (line, character) = offset_line_col(&next, at);
					state.set_cursor_position(gpui_component::input::Position::new(line, character), window, cx);
				});
				self.data.overlay.md_menu = None;
			}
			MdAction::Table(op) => {
				input.update(cx, |state, cx| {
					let text = state.value().to_string();
					let caret = state.cursor().min(text.len());
					let (next, at) = apply_table_op(&text, caret, op);
					state.set_value(next.clone(), window, cx);
					let (line, character) = offset_line_col(&next, at);
					state.set_cursor_position(gpui_component::input::Position::new(line, character), window, cx);
				});
				self.data.overlay.md_menu = None;
			}
			MdAction::ApplyLink => {
				let href = self.inputs.md_link.read(cx).value().to_string();
				input.update(cx, |state, cx| {
					let text = state.value().to_string();
					let (start, end) = match state.selected_text_range(true, window, cx) {
						Some(sel) => (
							utf16_offset_to_bytes(&text, sel.range.start),
							utf16_offset_to_bytes(&text, sel.range.end),
						),
						None => {
							let caret = state.cursor().min(text.len());
							(caret, caret)
						}
					};
					let (next, at) = apply_link(&text, start, end, &href);
					state.set_value(next.clone(), window, cx);
					let (line, character) = offset_line_col(&next, at);
					state.set_cursor_position(gpui_component::input::Position::new(line, character), window, cx);
				});
				self.data.overlay.md_menu = None;
			}
			MdAction::RemoveLink => {
				input.update(cx, |state, cx| {
					let text = state.value().to_string();
					let caret = state.cursor().min(text.len());
					let (next, at) = remove_link(&text, caret);
					state.set_value(next.clone(), window, cx);
					let (line, character) = offset_line_col(&next, at);
					state.set_cursor_position(gpui_component::input::Position::new(line, character), window, cx);
				});
				self.data.overlay.md_menu = None;
			}
		}
		if target == crate::ui::markdown::MarkupTarget::Notes {
			self.data.notes_dirty_since = Some(std::time::Instant::now());
		} else {
			self.data.file_dirty_since = Some(std::time::Instant::now());
			let draft = input.read(cx).value().to_string();
			if let Some(file) = self.data.current_ws_mut().and_then(|w| w.active_file_mut()) {
				file.draft = draft;
			}
		}
	}

	pub fn set_md_fence_language(
		&mut self,
		target: crate::ui::markdown::MarkupTarget,
		lang: &str,
		window: &mut Window,
		cx: &mut Context<Self>,
	) {
		let input = crate::ui::markdown::md_input(self, target).clone();
		input.update(cx, |state, cx| {
			let text = state.value().to_string();
			let caret = state.cursor().min(text.len());
			let (next, at) = crate::ui::markdown::set_fence_language(&text, caret, lang);
			state.set_value(next.clone(), window, cx);
			let (line, character) = offset_line_col(&next, at);
			state.set_cursor_position(gpui_component::input::Position::new(line, character), window, cx);
		});
		if target == crate::ui::markdown::MarkupTarget::Notes {
			self.data.notes_dirty_since = Some(std::time::Instant::now());
		} else if let Some(file) = self.data.current_ws_mut().and_then(|w| w.active_file_mut()) {
			file.draft = input.read(cx).value().to_string();
			self.data.file_dirty_since = Some(std::time::Instant::now());
		}
	}

	pub fn copy_md_fence(&mut self, target: crate::ui::markdown::MarkupTarget, cx: &mut Context<Self>) {
		let input = crate::ui::markdown::md_input(self, target);
		let text = input.read(cx).value().to_string();
		let caret = input.read(cx).cursor();
		if let Some(body) = crate::ui::markdown::fence_body(&text, caret) {
			cx.write_to_clipboard(ClipboardItem::new_string(body));
		}
	}

	pub fn wrap_active_markup(&mut self, prefix: &str, suffix: &str, window: &mut Window, cx: &mut Context<Self>) {
		let markdown_file = self.data.current_ws().and_then(|w| match w.active {
			Some(UnifiedTab::File { index }) => w.files.get(index).map(|f| backend::is_markdown(&f.path)),
			_ => None,
		});
		if markdown_file == Some(true) {
			wrap_markup(&self.inputs.file_editor, prefix, suffix, window, cx);
			return;
		}
		if self
			.data
			.current_ws()
			.is_some_and(|w| w.sidebar_open && w.sidebar_mode == SidebarMode::Notes)
		{
			wrap_markup(&self.inputs.notes, prefix, suffix, window, cx);
		}
	}

	pub fn cycle_file_search(&mut self, window: &mut Window, cx: &mut Context<Self>, next: bool) {
		let query = self.inputs.file_search.read(cx).value().to_string();
		let draft = self.inputs.file_editor.read(cx).value().to_string();
		let hits = search_match_offsets(&draft, &query);
		if hits.is_empty() {
			self.data.overlay.file_search_ix = 0;
			return;
		}
		if next {
			self.data.overlay.file_search_ix = (self.data.overlay.file_search_ix + 1) % hits.len();
		} else {
			self.data.overlay.file_search_ix = if self.data.overlay.file_search_ix == 0 {
				hits.len() - 1
			} else {
				self.data.overlay.file_search_ix - 1
			};
		}
		let offset = hits[self.data.overlay.file_search_ix];
		self.inputs.file_editor.update(cx, |state, cx| {
			let (line, character) = offset_line_col(&draft, offset);
			state.set_cursor_position(gpui_component::input::Position::new(line, character), window, cx);
		});
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
		let (cell_w, cell_h) =
			ui::terminal::measure_pty_cell(window, self.data.prefs.font_family.clone(), self.data.prefs.font_size);
		ui::terminal::pty_grid_size(
			f32::from(size.width),
			f32::from(size.height),
			cell_w,
			cell_h,
			self.data.prefs.sidebar_collapsed,
			self.data.prefs.sidebar_width,
			self.data.current_ws().map(|w| w.sidebar_open).unwrap_or(false),
			self.data.prefs.profile_sidebar_width,
		)
	}

	pub fn apply_update_result(&mut self, result: Result<crate::updater::UpdateInfo, String>, silent: bool) {
		match result {
			Ok(info) if info.available => {
				let title = self.tf("updateAvailableTitle", &[("version", &info.latest_version)]);
				let body = self.tf(
					"updateAvailableDescription",
					&[
						("currentVersion", &info.current_version),
						("version", &info.latest_version),
					],
				);
				self.data
					.push_toast_action(ToastKind::Info, title, body, Some(crate::state::ToastAction::OpenAbout));
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
					self.data
						.push_toast(ToastKind::Error, self.t("updateCheckFailedTitle"), err);
				}
			}
		}
		self.data.overlay.update_checked = true;
	}

	pub fn move_sidebar_project(&mut self, id: &str, delta: i32) {
		if let Err(err) = self.backend.move_project(id, delta) {
			self.data
				.push_toast(ToastKind::Error, self.t("sidebarOrderUpdateFailed"), err.to_string());
			return;
		}
		self.reload_projects();
	}

	pub fn set_project_pinned(&mut self, id: &str, pinned: bool) {
		if let Err(err) = self.backend.set_pinned(id, pinned) {
			self.data
				.push_toast(ToastKind::Error, self.t("sidebarOrderUpdateFailed"), err.to_string());
			return;
		}
		self.reload_projects();
	}

	pub fn drop_tree_paths(&mut self, sources: &[String], target_dir: Option<&str>) {
		let Some(profile_id) = self.data.current_profile.clone() else {
			return;
		};
		if sources.is_empty() {
			return;
		}
		if let Err(err) = self.backend.move_paths(&profile_id, sources, target_dir) {
			self.data
				.push_toast(ToastKind::Error, self.t("somethingWentWrong"), err.to_string());
			return;
		}
		self.load_tree_root(&profile_id);
	}

	pub fn drop_sidebar_project(&mut self, dragged: &str, target: Option<&str>, unpin: bool) {
		if let Err(err) = self.backend.drop_project(dragged, target, unpin) {
			self.data
				.push_toast(ToastKind::Error, self.t("sidebarOrderUpdateFailed"), err.to_string());
			return;
		}
		self.reload_projects();
	}

	pub fn open_project_menu(&mut self, id: String, x: f32, y: f32, window: &mut Window, cx: &mut Context<Self>) {
		self.inputs.group_name.update(cx, |s, cx| {
			s.set_value("", window, cx);
		});
		self.data.overlay.group_menu_creating = self.data.groups.is_empty();
		self.data.overlay.context_menu = Some((ContextMenu::Project { id }, x, y));
	}

	pub fn assign_project_to_group(&mut self, project_id: &str, group_id: Option<String>) {
		if let Err(err) = self.backend.assign_to_group(project_id, group_id) {
			self.data
				.push_toast(ToastKind::Error, self.t("somethingWentWrong"), err.to_string());
			return;
		}
		self.reload_projects();
		self.data.overlay.context_menu = None;
		self.data.overlay.group_menu_creating = false;
	}

	pub fn submit_create_group(&mut self, project_id: Option<&str>, cx: &mut Context<Self>) {
		let name = self.inputs.group_name.read(cx).value().trim().to_string();
		if name.is_empty() {
			return;
		}
		let pid = project_id
			.map(|id| id.to_string())
			.or_else(|| self.data.overlay.dialog_project.clone());
		match self.backend.create_group(&name) {
			Ok(group) => {
				if let Some(pid) = pid {
					if let Err(err) = self.backend.assign_to_group(&pid, Some(group.id)) {
						self.data
							.push_toast(ToastKind::Error, self.t("somethingWentWrong"), err.to_string());
					}
				}
				self.reload_projects();
				self.data.overlay.dialog = None;
				self.data.overlay.context_menu = None;
				self.data.overlay.group_menu_creating = false;
			}
			Err(err) => self
				.data
				.push_toast(ToastKind::Error, self.t("somethingWentWrong"), err.to_string()),
		}
	}

	pub fn apply_picked_folder(&mut self, folder: String, window: &mut Window, cx: &mut Context<Self>) {
		let empty = self.inputs.project_name.read(cx).value().trim().is_empty();
		self.data.overlay.dialog_folder = Some(folder.clone());
		if empty {
			let name = suggested_project_name(&folder, "");
			self.inputs.project_name.update(cx, |s, cx| {
				s.set_value(name, window, cx);
			});
		}
	}

	pub fn create_project_from_dialog(&mut self, window: &mut Window, cx: &mut Context<Self>) {
		let folder = match self.data.overlay.dialog_folder.clone() {
			Some(f) => f,
			None => return,
		};
		let name = suggested_project_name(&folder, &self.inputs.project_name.read(cx).value());
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
				if check.total_diff.files_changed > 0 {
					parts.push(i18n::tf(
						self.data.locale,
						"deleteProfileTotalDiffWarning",
						&[
							("files", &check.total_diff.files_changed.to_string()),
							("insertions", &check.total_diff.insertions.to_string()),
							("deletions", &check.total_diff.deletions.to_string()),
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
					"{}\n{}\n{}",
					self.t("deleteProfileGitCheckFailedTitle"),
					self.t("deleteProfileGitCheckFailedDescription"),
					err
				));
			}
		}
	}

	pub fn commit_selected(&mut self, window: &mut Window, cx: &mut Context<Self>) {
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
				let short = crate::ui::git::leftover_short_hash(&hash);
				self.data.push_toast(
					ToastKind::Success,
					self.t("gitCommitSuccessTitle"),
					i18n::tf(self.data.locale, "gitCommitSuccessDescription", &[("hash", &short)]),
				);
				self.inputs.commit_summary.update(cx, |s, cx| {
					s.set_value("", window, cx);
				});
				self.inputs.commit_body.update(cx, |s, cx| {
					s.set_value("", window, cx);
				});
				self.refresh_workspace(&profile_id);
			}
			Err(err) => self
				.data
				.push_toast(ToastKind::Error, self.t("gitCommitErrorTitle"), err.to_string()),
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
			Err(err) => self
				.data
				.push_toast(ToastKind::Error, self.t("gitPushErrorTitle"), err.to_string()),
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
					i18n::tf(self.data.locale, "gitDiscardFileSuccessDescription", &[("file", path)]),
				);
				self.refresh_workspace(&profile_id);
			}
			Err(err) => self
				.data
				.push_toast(ToastKind::Error, self.t("gitDiscardFileErrorTitle"), err.to_string()),
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
		self.data.overlay.git_selected_commit = None;
		self.data.overlay.git_commit_files.clear();
		self.data.overlay.git_file_index = 0;
		self.data.overlay.git_commit_index = None;
		self.data.overlay.git_commit_file_index = 0;
		self.refresh_workspace(&profile_id);
		if let Some(path) = self
			.data
			.current_ws()
			.and_then(|ws| ws.git_files.first().map(|(p, _)| p.clone()))
		{
			self.select_diff_file(&path);
		}
	}

	pub fn switch_git_tab(&mut self, tab: GitDiffTab) {
		self.data.overlay.git_diff_tab = tab;
		self.data.overlay.git_selected_commit = None;
		self.data.overlay.git_commit_files.clear();
		self.data.overlay.git_commit_file_index = 0;
		self.data.overlay.git_commit_index = None;
		if tab == GitDiffTab::Changes {
			self.data.overlay.git_file_index = 0;
			if let Some(path) = self
				.data
				.current_ws()
				.and_then(|ws| ws.git_files.first().map(|(p, _)| p.clone()))
			{
				self.select_diff_file(&path);
			}
		}
	}

	pub fn commit_back(&mut self) {
		self.data.overlay.git_selected_commit = None;
		self.data.overlay.git_commit_files.clear();
		self.data.overlay.git_commit_file_index = 0;
		self.data.overlay.git_diff_file = None;
	}

	pub fn select_diff_file(&mut self, path: &str) {
		self.data.overlay.git_diff_file = Some(path.to_string());
		if let Some(ix) = self
			.data
			.current_ws()
			.and_then(|ws| ws.git_files.iter().position(|(p, _)| p == path))
		{
			self.data.overlay.git_file_index = ix;
		}
		if let Some(profile_id) = self.data.current_profile.clone() {
			if self.data.overlay.git_selected_commit.is_none() {
				self.data.overlay.git_diff_text = self.backend.git_diff(&profile_id).unwrap_or_default();
			}
		}
	}

	pub fn select_review_line(&mut self, file: &str, side: crate::review::ReviewSide, line_no: u32, extend: bool) {
		if line_no == 0 {
			return;
		}
		let hunk = extract_file_hunk(&self.data.overlay.git_diff_text, file);
		let prev_name = crate::diff::rename_paths(&hunk).map(|(old, _)| old);
		let display_name = match &prev_name {
			Some(prev) if prev != file => format!("{prev} -> {file}"),
			_ => file.to_string(),
		};
		let range = if extend {
			if let Some(sel) = self.data.overlay.review_selection.as_ref().filter(|s| s.file == file) {
				crate::review::ReviewRange {
					start: sel.range.start,
					end: line_no,
					side: sel.range.side,
					end_side: side,
				}
			} else {
				crate::review::ReviewRange {
					start: line_no,
					end: line_no,
					side,
					end_side: side,
				}
			}
		} else {
			crate::review::ReviewRange {
				start: line_no,
				end: line_no,
				side,
				end_side: side,
			}
		};
		self.data.overlay.review_selection = Some(crate::review::ReviewSelection {
			file: file.to_string(),
			display_name,
			prev_name,
			range,
		});
	}

	pub fn cancel_review_comment(&mut self, window: &mut Window, cx: &mut Context<Self>) {
		self.data.overlay.review_selection = None;
		self.inputs.review_comment.update(cx, |s, cx| {
			s.set_value("", window, cx);
		});
	}

	pub fn add_review_comment(&mut self, window: &mut Window, cx: &mut Context<Self>) {
		let body = self.inputs.review_comment.read(cx).value().to_string();
		let Some(sel) = self.data.overlay.review_selection.clone() else {
			return;
		};
		if body.trim().is_empty() {
			return;
		}
		let hunk = extract_file_hunk(&self.data.overlay.git_diff_text, &sel.file);
		let selected_text = crate::review::selected_text_from_hunk(&hunk, sel.range);
		self.data
			.overlay
			.review_comments
			.push(crate::review::create_review_comment(
				sel.file,
				sel.prev_name,
				sel.range,
				selected_text,
				body.trim(),
			));
		self.cancel_review_comment(window, cx);
	}

	pub fn delete_review_comment(&mut self, id: &str) {
		self.data.overlay.review_comments.retain(|c| c.id != id);
		if self.data.overlay.review_edit_id.as_deref() == Some(id) {
			self.data.overlay.review_edit_id = None;
		}
	}

	pub fn begin_review_edit(&mut self, id: &str, window: &mut Window, cx: &mut Context<Self>) {
		self.flush_review_edit(window, cx);
		let body = self
			.data
			.overlay
			.review_comments
			.iter()
			.find(|c| c.id == id)
			.map(|c| c.body.clone())
			.unwrap_or_default();
		self.data.overlay.review_edit_id = Some(id.to_string());
		self.inputs.review_comment.update(cx, |s, cx| {
			s.set_value(&body, window, cx);
		});
	}

	fn flush_review_edit(&mut self, window: &mut Window, cx: &mut Context<Self>) {
		let Some(id) = self.data.overlay.review_edit_id.clone() else {
			return;
		};
		let body = self.inputs.review_comment.read(cx).value().to_string();
		if let Some(comment) = self.data.overlay.review_comments.iter_mut().find(|c| c.id == id) {
			comment.body = body;
		}
		self.data.overlay.review_edit_id = None;
		self.inputs.review_comment.update(cx, |s, cx| {
			s.set_value("", window, cx);
		});
	}

	pub fn select_commit(&mut self, hash: &str) {
		self.data.overlay.git_selected_commit = Some(hash.to_string());
		self.data.overlay.git_commit_index = self
			.data
			.overlay
			.git_commits
			.iter()
			.position(|c| c.hash == hash || c.full_hash == hash);
		self.data.overlay.git_commit_file_index = 0;
		if let Some(profile_id) = self.data.current_profile.clone() {
			let diff = self.backend.commit_diff(&profile_id, hash).unwrap_or_default();
			self.data.overlay.git_commit_files = parse_diff_files(&diff);
			self.data.overlay.git_diff_text = diff;
			self.data.overlay.git_diff_file = self.data.overlay.git_commit_files.first().cloned();
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
			Err(err) => self
				.data
				.push_toast(ToastKind::Error, self.t("gitCheckoutErrorTitle"), err.to_string()),
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

	pub fn add_project_template(&mut self, cx: &mut Context<Self>) {
		self.upsert_project_template(cx);
	}

	pub fn load_project_template(&mut self, id: &str, window: &mut Window, cx: &mut Context<Self>) {
		let Some(template) = self
			.data
			.workspaces
			.values()
			.find(|w| {
				Some(w.project_id.as_str()) == self.data.overlay.dialog_project.as_deref()
					|| Some(w.project_id.as_str()) == self.data.current_project.as_deref()
			})
			.and_then(|w| w.config.terminal_templates.iter().find(|t| t.id == id).cloned())
		else {
			return;
		};
		self.data.overlay.editing_template = Some(id.to_string());
		self.inputs.template_name.update(cx, |s, cx| {
			s.set_value(template.name.clone(), window, cx);
		});
		self.inputs.template_cwd.update(cx, |s, cx| {
			s.set_value(template.cwd.clone(), window, cx);
		});
		self.inputs.template_commands.update(cx, |s, cx| {
			s.set_value(template.commands.join("\n"), window, cx);
		});
	}

	pub fn upsert_project_template(&mut self, cx: &mut Context<Self>) {
		let name = self.inputs.template_name.read(cx).value().to_string();
		if name.trim().is_empty() {
			return;
		}
		let Some(project_id) = self
			.data
			.overlay
			.dialog_project
			.clone()
			.or_else(|| self.data.current_project.clone())
		else {
			return;
		};
		let editing = self.data.overlay.editing_template.clone();
		let cwd = self.inputs.template_cwd.read(cx).value().to_string();
		let commands = lines(&self.inputs.template_commands.read(cx).value());
		if let Some(ws) = self.data.workspaces.values_mut().find(|w| w.project_id == project_id) {
			if let Some(id) = editing.as_deref() {
				if let Some(template) = ws.config.terminal_templates.iter_mut().find(|t| t.id == id) {
					template.name = name;
					template.cwd = cwd;
					template.commands = commands;
					self.data.overlay.editing_template = None;
					return;
				}
			}
			ws.config
				.terminal_templates
				.push(model::project::ProjectTerminalTemplate {
					id: uuid::Uuid::new_v4().to_string(),
					name,
					cwd,
					commands,
				});
		}
		self.data.overlay.editing_template = None;
	}

	pub fn save_editing_template(&mut self, cx: &mut Context<Self>) {
		let name = self.inputs.template_name.read(cx).value().to_string();
		if name.trim().is_empty() {
			return;
		}
		let id = self.data.overlay.editing_template.clone();
		let shell = self.inputs.template_shell.read(cx).value().to_string();
		let cwd = self.inputs.template_cwd.read(cx).value().to_string();
		let commands = lines(&self.inputs.template_commands.read(cx).value());
		if id.as_ref().is_some_and(|id| {
			self.data
				.workspaces
				.values()
				.any(|w| w.config.terminal_templates.iter().any(|t| t.id == *id))
		}) {
			self.upsert_project_template(cx);
		} else {
			crate::prefs::upsert_template(
				&mut self.data.prefs.templates,
				id.as_deref(),
				name,
				shell,
				cwd,
				commands,
			);
			self.persist_prefs();
		}
		self.data.overlay.editing_template = None;
		self.data.overlay.dialog = None;
	}

	pub fn remove_project_template(&mut self, id: &str) {
		let Some(project_id) = self
			.data
			.overlay
			.dialog_project
			.clone()
			.or_else(|| self.data.current_project.clone())
		else {
			return;
		};
		if let Some(ws) = self.data.workspaces.values_mut().find(|w| w.project_id == project_id) {
			ws.config.terminal_templates.retain(|t| t.id != id);
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
		let templates = self
			.data
			.workspaces
			.values()
			.find(|w| w.project_id == project_id)
			.map(|w| w.config.terminal_templates.clone())
			.unwrap_or_else(|| config.terminal_templates.clone());
		config.terminal_templates = templates;
		if let Err(err) = self.backend.save_project_config(&project_id, &config) {
			self.data
				.push_toast(ToastKind::Error, self.t("somethingWentWrong"), err.to_string());
			return;
		}
		if let Some(ws) = self.data.workspaces.values_mut().find(|w| w.project_id == project_id) {
			ws.config = config;
		}
		self.data.overlay.dialog = None;
	}

	pub fn search_palette(&mut self, cx: &mut Context<Self>) {
		let Some(profile_id) = self.data.current_profile.clone() else {
			return;
		};
		let q = self.inputs.palette.read(cx).value().to_string();
		if q == self.data.overlay.palette_query {
			return;
		}
		self.data.overlay.palette_query = q.clone();
		if q.trim().is_empty() {
			self.data.overlay.palette_results.clear();
			self.data.overlay.palette_index = 0;
			return;
		}
		self.data.overlay.palette_results = self.backend.search_files(&profile_id, &q).unwrap_or_default();
		self.data.overlay.palette_index = 0;
	}

	pub fn open_palette_selection(&mut self, window: &mut Window, cx: &mut Context<Self>) {
		let Some(profile_id) = self.data.current_profile.clone() else {
			return;
		};
		let ix = self.data.overlay.palette_index;
		let path = self.data.overlay.palette_results.get(ix).map(|r| r.path.clone());
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
			self.data
				.push_toast(ToastKind::Error, self.t("fileTreeCreateErrorTitle"), err.to_string());
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

	pub fn copy_review_comments(&mut self, clear: bool, window: &mut Window, cx: &mut Context<Self>) {
		self.flush_review_edit(window, cx);
		let text = crate::review::format_review_comments_for_agent(&self.data.overlay.review_comments);
		cx.write_to_clipboard(gpui::ClipboardItem::new_string(text));
		if clear {
			self.data.overlay.review_comments.clear();
			self.data
				.push_toast(ToastKind::Success, self.t("reviewCommentsCopiedAndCleared"), "");
		} else {
			self.data
				.push_toast(ToastKind::Success, self.t("reviewCommentsCopied"), "");
		}
		self.data.overlay.dialog = None;
	}

	pub fn open_url_with(&mut self, browser: &str) {
		let Some(url) = self.data.overlay.dialog_url.clone() else {
			return;
		};
		if browser.is_empty() {
			let _ = open::that(&url);
		} else {
			let _ = std::process::Command::new(browser).arg(&url).spawn();
		}
		self.data.overlay.dialog = None;
	}

	pub fn open_clickable(
		&mut self,
		token: &crate::detector::Clickable,
		skip_confirm: bool,
		window: &mut Window,
		cx: &mut Context<Self>,
	) {
		match token {
			crate::detector::Clickable::Url(url) => {
				if skip_confirm {
					let _ = open::that(url);
					return;
				}
				self.data.overlay.dialog_url = Some(url.clone());
				self.data.overlay.dialog = Some(DialogKind::OpenLink);
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
					Err(err) => {
						let raw = err.to_string();
						let body = if raw.to_ascii_lowercase().contains("outside the workspace") {
							self.t("terminalFilePathOutsideWorkspace")
						} else {
							raw
						};
						self.data
							.push_toast(ToastKind::Error, self.t("somethingWentWrong"), body);
					}
				}
			}
		}
	}

	pub fn create_path(&mut self, is_dir: bool, parent: Option<&str>, window: &mut Window, cx: &mut Context<Self>) {
		let Some(profile_id) = self.data.current_profile.clone() else {
			return;
		};
		if let Some(parent) = parent {
			let loaded = self
				.data
				.workspaces
				.get(&profile_id)
				.and_then(|w| w.tree.get(parent))
				.is_some_and(|n| n.children_loaded);
			if !loaded {
				self.load_tree_children(&profile_id, Some(parent));
			}
		}
		let name = self.inputs.new_path.read(cx).value().to_string();
		let existing = self
			.data
			.workspaces
			.get(&profile_id)
			.map(|w| sibling_names(&w.tree, parent))
			.unwrap_or_default();
		let name = if name.trim().is_empty() {
			unique_tree_name(&existing, if is_dir { "New Folder" } else { "New File" })
		} else {
			name
		};
		let path = join_tree_path(parent, &name);
		if let Err(err) = self.backend.create_path(&profile_id, &path, is_dir) {
			self.data
				.push_toast(ToastKind::Error, self.t("fileTreeCreateErrorTitle"), err.to_string());
			return;
		}
		if let Some(parent) = parent {
			self.load_tree_children(&profile_id, Some(parent));
		} else {
			self.load_tree_root(&profile_id);
		}
		self.start_rename_path(&path, window, cx);
	}

	pub fn delete_tree_paths(&mut self, paths: &[String]) {
		let Some(profile_id) = self.data.current_profile.clone() else {
			return;
		};
		if paths.is_empty() {
			return;
		}
		if let Err(err) = self.backend.delete_paths(&profile_id, paths) {
			self.data
				.push_toast(ToastKind::Error, self.t("fileTreeDeleteErrorTitle"), err.to_string());
			return;
		}
		if let Some(ws) = self.data.workspaces.get_mut(&profile_id) {
			ws.files.retain(|f| !paths.iter().any(|p| p == &f.path));
			if let Some(UnifiedTab::File { index }) = ws.active {
				if index >= ws.files.len() {
					ws.active = ws.files.last().map(|_| UnifiedTab::File {
						index: ws.files.len() - 1,
					});
				}
			}
			ws.tree_selected.retain(|p| !paths.iter().any(|gone| gone == p));
		}
		self.load_tree_root(&profile_id);
	}

	pub fn tree_key(&mut self, key: &str, shift: bool, window: &mut Window, cx: &mut Context<Self>) -> bool {
		if self.data.overlay.renaming_path.is_some()
			|| self.data.overlay.palette_open
			|| self.data.overlay.dialog.is_some()
			|| self.data.overlay.context_menu.is_some()
		{
			return false;
		}
		let Some(profile) = self.data.current_profile.clone() else {
			return false;
		};
		let Some(ws) = self.data.workspaces.get(&profile) else {
			return false;
		};
		if ws.sidebar_mode != SidebarMode::Files {
			return false;
		}
		let paths = visible_tree_paths(ws);
		if paths.is_empty() {
			return false;
		}
		let current = ws
			.tree_anchor
			.clone()
			.or_else(|| ws.tree_selected.iter().next().cloned())
			.unwrap_or_else(|| paths[0].clone());
		let ix = paths.iter().position(|p| p == &current).unwrap_or(0);
		let is_dir = ws.tree.get(&current).is_some_and(|n| n.is_dir);
		let expanded = ws.tree.get(&current).is_some_and(|n| n.expanded);
		let parent = create_target_directory(&ws.tree, Some(&current));
		let next_child = paths
			.get(ix + 1)
			.filter(|p| p.starts_with(&format!("{current}/")))
			.cloned();
		match key {
			"up" | "down" => {
				let next = if key == "up" {
					ix.saturating_sub(1)
				} else {
					(ix + 1).min(paths.len() - 1)
				};
				self.select_tree_path(&paths[next], shift);
				true
			}
			"left" => {
				if is_dir && expanded {
					self.toggle_dir(&profile, &current);
				} else if let Some(parent) = parent {
					if parent != current {
						self.select_tree_path(&parent, false);
					}
				}
				true
			}
			"right" => {
				if is_dir && !expanded {
					self.toggle_dir(&profile, &current);
				} else if let Some(child) = next_child {
					self.select_tree_path(&child, false);
				}
				true
			}
			"enter" => {
				let is_dir = self
					.data
					.workspaces
					.get(&profile)
					.and_then(|w| w.tree.get(&current))
					.is_some_and(|n| n.is_dir);
				if is_dir {
					self.toggle_dir(&profile, &current);
				} else if !self.is_deleted_tree_path(&profile, &current) {
					self.open_file(&profile, &current, window, cx);
				}
				true
			}
			"delete" | "backspace" => {
				let selected = self
					.data
					.workspaces
					.get(&profile)
					.map(|w| context_action_paths(&w.tree_selected, &current))
					.unwrap_or_else(|| vec![current]);
				self.delete_tree_paths(&selected);
				true
			}
			"f2" => {
				self.start_rename_path(&current, window, cx);
				true
			}
			_ => false,
		}
	}

	fn select_tree_path(&mut self, path: &str, range: bool) {
		let Some(profile) = self.data.current_profile.clone() else {
			return;
		};
		let Some(ws) = self.data.workspaces.get_mut(&profile) else {
			return;
		};
		if range {
			let paths = visible_tree_paths(ws);
			let anchor = ws.tree_anchor.clone().unwrap_or_else(|| path.to_string());
			if let (Some(a), Some(b)) = (
				paths.iter().position(|p| p == &anchor),
				paths.iter().position(|p| p == path),
			) {
				let (lo, hi) = if a <= b { (a, b) } else { (b, a) };
				ws.tree_selected = paths[lo..=hi].iter().cloned().collect();
				ws.tree_anchor = Some(anchor);
				return;
			}
		}
		ws.tree_selected.clear();
		ws.tree_selected.insert(path.to_string());
		ws.tree_anchor = Some(path.to_string());
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
				"sublime" | "subl" => "subl",
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
		if kind == "terminal" && self.data.prefs.terminal_app == "iterm2" {
			let _ = std::process::Command::new("open").args(["-a", "iTerm", folder]).spawn();
			return;
		}
		let _ = std::process::Command::new(cmd).arg(folder).spawn();
	}

	pub fn open_pr(&self) {
		if let Some(url) = self
			.data
			.current_ws()
			.and_then(|w| w.pr.as_ref().map(|p| p.url.clone()))
		{
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
			KeyBinding::new("escape", DismissOverlay, None),
			KeyBinding::new("cmd-f", FindInTerminal, None),
			KeyBinding::new("ctrl-shift-f", FindInTerminal, None),
			KeyBinding::new("cmd-=", IncreaseFontSize, None),
			KeyBinding::new("cmd-+", IncreaseFontSize, None),
			KeyBinding::new("ctrl-=", IncreaseFontSize, None),
			KeyBinding::new("cmd--", DecreaseFontSize, None),
			KeyBinding::new("ctrl--", DecreaseFontSize, None),
			KeyBinding::new("cmd-b", WrapBold, None),
			KeyBinding::new("ctrl-b", WrapBold, None),
			KeyBinding::new("cmd-i", WrapItalic, None),
			KeyBinding::new("ctrl-i", WrapItalic, None),
		]);
	}

	pub fn open_debug_log(&mut self, window: &mut Window, cx: &mut Context<Self>) {
		if !self.data.prefs.debug_mode {
			return;
		}
		self.inputs.debug_search.update(cx, |s, cx| {
			s.set_value("", window, cx);
		});
		self.data.overlay.dialog = Some(DialogKind::DebugLog);
		self.data.overlay.debug_open = true;
	}

	pub fn toggle_debug_log(&mut self, window: &mut Window, cx: &mut Context<Self>) {
		if !self.data.prefs.debug_mode {
			return;
		}
		if self.data.overlay.dialog == Some(DialogKind::DebugLog) {
			self.data.overlay.dialog = None;
			self.data.overlay.debug_open = false;
			return;
		}
		self.open_debug_log(window, cx);
	}

	/// Close the topmost overlay. Returns true when something was dismissed.
	pub fn dismiss_overlay(&mut self) -> bool {
		if self.data.overlay.context_menu.is_some()
			&& self.data.overlay.group_menu_creating
			&& !self.data.groups.is_empty()
		{
			self.data.overlay.group_menu_creating = false;
			return true;
		}
		if self.data.overlay.context_menu.take().is_some() {
			self.data.overlay.group_menu_creating = false;
			return true;
		}
		if self.data.overlay.renaming_path.take().is_some() {
			return true;
		}
		if self.data.overlay.file_search_open {
			self.data.overlay.file_search_open = false;
			return true;
		}
		if self.data.overlay.palette_open {
			self.data.overlay.palette_open = false;
			self.data.overlay.palette_results.clear();
			self.data.overlay.palette_query.clear();
			return true;
		}
		if let Some(term) = self.data.current_ws_mut().and_then(|w| w.active_terminal_mut()) {
			if term.search_open {
				term.search_open = false;
				term.search_query.clear();
				term.search_ix = 0;
				return true;
			}
		}
		if self.data.overlay.git_diff_open {
			if self.data.overlay.git_selected_commit.is_some() {
				self.commit_back();
				return true;
			}
			self.data.overlay.git_diff_open = false;
			return true;
		}
		if self.data.overlay.dialog.take().is_some() {
			self.data.overlay.dialog_error = None;
			self.data.overlay.dialog_busy = false;
			self.data.overlay.debug_open = false;
			return true;
		}
		if self.data.overlay.debug_open {
			self.data.overlay.debug_open = false;
			return true;
		}
		if self.data.overlay.onboarding {
			self.data.overlay.onboarding = false;
			return true;
		}
		false
	}

	pub fn move_palette(&mut self, delta: i32) {
		let len = self.data.overlay.palette_results.len();
		if len == 0 {
			return;
		}
		let cur = self.data.overlay.palette_index as i32;
		self.data.overlay.palette_index = (cur + delta).rem_euclid(len as i32) as usize;
	}

	pub fn sidebar_nav_items(&self) -> Vec<SidebarNavItem> {
		crate::state::collect_sidebar_nav_items(
			&self.data.projects,
			&self.data.groups,
			&self.data.prefs.collapsed_groups,
			&self.data.overlay.expanded_projects,
			self.data.current_project.as_deref(),
		)
	}

	pub fn move_sidebar_nav(&mut self, delta: i32) -> bool {
		let items = self.sidebar_nav_items();
		if items.is_empty() {
			return false;
		}
		let cur = self
			.data
			.overlay
			.sidebar_nav
			.as_ref()
			.and_then(|cur| items.iter().position(|item| item == cur))
			.unwrap_or_else(|| {
				if let Some(pid) = &self.data.current_profile {
					items
						.iter()
						.position(
							|item| matches!(item, SidebarNavItem::Profile { profile_id, .. } if profile_id == pid),
						)
						.unwrap_or(0)
				} else {
					0
				}
			});
		let next = (cur as i32 + delta).clamp(0, items.len() as i32 - 1) as usize;
		self.data.overlay.sidebar_nav = Some(items[next].clone());
		true
	}

	pub fn activate_sidebar_nav(&mut self) -> bool {
		let item = self
			.data
			.overlay
			.sidebar_nav
			.clone()
			.or_else(|| self.sidebar_nav_items().into_iter().next());
		let Some(item) = item else {
			return false;
		};
		match item {
			SidebarNavItem::Home => {
				self.data.route = Route::Home;
				self.data.current_project = None;
				self.data.current_profile = None;
			}
			SidebarNavItem::Project(id) => {
				if let Some(profile) = self.data.default_profile_of(&id) {
					self.open_profile(&id, &profile.id);
				}
			}
			SidebarNavItem::Profile { project_id, profile_id } => {
				self.open_profile(&project_id, &profile_id);
			}
		}
		true
	}

	fn leftover_interactive_focused(&self, window: &Window, cx: &App) -> bool {
		[
			&self.inputs.commit_summary,
			&self.inputs.commit_body,
			&self.inputs.review_comment,
			&self.inputs.palette,
			&self.inputs.file_search,
			&self.inputs.branch_search,
			&self.inputs.debug_search,
			&self.inputs.term_search,
			&self.inputs.file_editor,
			&self.inputs.notes,
			&self.inputs.md_link,
			&self.inputs.rename,
			&self.inputs.new_path,
		]
		.iter()
		.any(|input| input.read(cx).focus_handle(cx).is_focused(window))
	}

	pub fn handle_git_list_key(&mut self, key: &str) -> bool {
		if !self.data.overlay.git_diff_open {
			return false;
		}
		match (self.data.overlay.git_diff_tab, key) {
			(GitDiffTab::Changes, "up" | "down") => {
				let count = self.data.current_ws().map(|ws| ws.git_files.len()).unwrap_or(0);
				let next = crate::ui::git::leftover_step_index(
					self.data.overlay.git_file_index,
					if key == "down" { 1 } else { -1 },
					count,
				);
				self.data.overlay.git_file_index = next;
				if let Some(path) = self
					.data
					.current_ws()
					.and_then(|ws| ws.git_files.get(next).map(|(p, _)| p.clone()))
				{
					self.select_diff_file(&path);
				}
				true
			}
			(GitDiffTab::Changes, "space") => {
				let path = self.data.current_ws().and_then(|ws| {
					ws.git_files
						.get(self.data.overlay.git_file_index)
						.map(|(p, _)| p.clone())
				});
				let Some(path) = path else {
					return false;
				};
				if let Some(ws) = self.data.current_ws_mut() {
					if !ws.git_included.remove(&path) {
						ws.git_included.insert(path);
					}
				}
				true
			}
			(GitDiffTab::History, "up" | "down") if self.data.overlay.git_selected_commit.is_some() => {
				let count = self.data.overlay.git_commit_files.len();
				let next = crate::ui::git::leftover_step_index(
					self.data.overlay.git_commit_file_index,
					if key == "down" { 1 } else { -1 },
					count,
				);
				self.data.overlay.git_commit_file_index = next;
				self.data.overlay.git_diff_file = self.data.overlay.git_commit_files.get(next).cloned();
				true
			}
			(GitDiffTab::History, "up" | "down") => {
				self.data.overlay.git_commit_index = crate::ui::git::leftover_step_commit_index(
					self.data.overlay.git_commit_index,
					if key == "down" { 1 } else { -1 },
					self.data.overlay.git_commits.len(),
				);
				true
			}
			(GitDiffTab::History, "enter") if self.data.overlay.git_selected_commit.is_none() => {
				if let Some(ix) = self.data.overlay.git_commit_index {
					if let Some(hash) = self.data.overlay.git_commits.get(ix).map(|c| c.hash.clone()) {
						self.select_commit(&hash);
						return true;
					}
				}
				false
			}
			(GitDiffTab::History, "backspace") if self.data.overlay.git_selected_commit.is_some() => {
				self.commit_back();
				true
			}
			_ => false,
		}
	}

	pub fn handle_overlay_key(&mut self, key: &str, shift: bool, window: &mut Window, cx: &mut Context<Self>) -> bool {
		if self.data.overlay.dialog == Some(DialogKind::CreateProject) && key == "enter" {
			self.create_project_from_dialog(window, cx);
			return true;
		}
		if self.data.overlay.dialog == Some(DialogKind::CreateProfile) && key == "enter" {
			self.create_profile_from_dialog(cx);
			return true;
		}
		if self.data.overlay.dialog == Some(DialogKind::RenameProject) && key == "enter" {
			self.rename_dialog_project(cx);
			return true;
		}
		if self.data.overlay.dialog == Some(DialogKind::CreateGroup) && key == "enter" {
			self.submit_create_group(None, cx);
			return true;
		}
		if key == "enter" {
			if let Some((ContextMenu::Project { id }, _, _)) = self.data.overlay.context_menu.clone() {
				if self.data.overlay.group_menu_creating || self.data.groups.is_empty() {
					self.submit_create_group(Some(&id), cx);
					return true;
				}
			}
		}
		if self.data.overlay.file_search_open && key == "enter" {
			self.cycle_file_search(window, cx, !shift);
			return true;
		}
		if self.data.overlay.palette_open {
			return match key {
				"up" => {
					self.move_palette(-1);
					true
				}
				"down" => {
					self.move_palette(1);
					true
				}
				"enter" => {
					self.open_palette_selection(window, cx);
					true
				}
				_ => false,
			};
		}
		if self
			.data
			.current_ws()
			.and_then(|w| w.active_terminal())
			.is_some_and(|t| t.search_open)
		{
			return match key {
				"enter" => {
					self.cycle_term_search(cx, !shift);
					true
				}
				_ => false,
			};
		}
		if self.data.overlay.renaming_path.is_some() && key == "enter" {
			self.commit_rename_path(cx);
			return true;
		}
		if self.data.overlay.git_diff_open && !self.leftover_interactive_focused(window, cx) {
			return self.handle_git_list_key(key);
		}
		false
	}

	pub fn handle_sidebar_key(&mut self, key: &str) -> bool {
		if self.data.overlay.palette_open
			|| self.data.overlay.dialog.is_some()
			|| self.data.overlay.git_diff_open
			|| self.data.overlay.context_menu.is_some()
			|| self.data.overlay.renaming_path.is_some()
			|| self.data.overlay.sidebar_resize_focus.is_some()
		{
			return false;
		}
		match key {
			"up" => self.move_sidebar_nav(-1),
			"down" => self.move_sidebar_nav(1),
			"enter" | "space" => self.activate_sidebar_nav(),
			_ => false,
		}
	}
}

pub fn create_target_directory(tree: &HashMap<String, TreeNode>, context: Option<&str>) -> Option<String> {
	let path = context?.trim_end_matches('/');
	if path.is_empty() {
		return None;
	}
	if tree.get(path).is_some_and(|node| node.is_dir) {
		return Some(path.to_string());
	}
	path.rfind('/').map(|i| path[..i].to_string()).filter(|p| !p.is_empty())
}

pub fn join_tree_path(parent: Option<&str>, name: &str) -> String {
	match parent.map(str::trim).filter(|p| !p.is_empty()) {
		Some(parent) => format!("{parent}/{name}"),
		None => name.to_string(),
	}
}

pub fn sibling_names(tree: &HashMap<String, TreeNode>, parent: Option<&str>) -> Vec<String> {
	let key = parent.unwrap_or("");
	tree.get(key)
		.map(|node| {
			node.children
				.iter()
				.filter_map(|child| tree.get(child).map(|n| n.name.clone()))
				.collect()
		})
		.unwrap_or_default()
}

pub fn context_action_paths(selected: &HashSet<String>, clicked: &str) -> Vec<String> {
	if selected.contains(clicked) {
		let mut paths: Vec<String> = selected.iter().cloned().collect();
		paths.sort();
		paths
	} else {
		vec![clicked.to_string()]
	}
}

pub fn unique_tree_name(existing: &[String], base: &str) -> String {
	if !existing.iter().any(|n| n == base) {
		return base.to_string();
	}
	let mut n = 2;
	loop {
		let candidate = format!("{base} {n}");
		if !existing.iter().any(|name| name == &candidate) {
			return candidate;
		}
		n += 1;
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

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GitStatusKind {
	Added,
	Untracked,
	Deleted,
	Renamed,
	Ignored,
	Modified,
}

pub fn git_status_kind(status: &str) -> GitStatusKind {
	let s = status.trim().to_ascii_lowercase();
	if s.contains("untrack") || s.contains('?') {
		GitStatusKind::Untracked
	} else if s.contains("added") || s == "a" || s.contains("add") {
		GitStatusKind::Added
	} else if s.contains("delet") || s == "d" {
		GitStatusKind::Deleted
	} else if s.contains("renam") || s == "r" {
		GitStatusKind::Renamed
	} else if s.contains("ignor") {
		GitStatusKind::Ignored
	} else {
		GitStatusKind::Modified
	}
}

pub fn file_status_badge(status: &str) -> &'static str {
	match git_status_kind(status) {
		GitStatusKind::Added | GitStatusKind::Untracked => "A",
		GitStatusKind::Deleted => "D",
		GitStatusKind::Renamed => "R",
		GitStatusKind::Ignored => "I",
		GitStatusKind::Modified => "M",
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

fn visible_tree_paths(ws: &Workspace) -> Vec<String> {
	let mut out = Vec::new();
	fn walk(ws: &Workspace, path: &str, out: &mut Vec<String>) {
		let Some(node) = ws.tree.get(path) else {
			return;
		};
		for child in &node.children {
			out.push(child.clone());
			if ws.tree.get(child).is_some_and(|c| c.is_dir && c.expanded) {
				walk(ws, child, out);
			}
		}
	}
	walk(ws, "", &mut out);
	out
}

impl gpui::Render for AppView {
	fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
		self.apply_theme(window, cx);
		self.sync_pty_size(window);
		self.sync_notes_input(window, cx);
		if self.data.overlay.palette_open {
			self.search_palette(cx);
		}
		div()
			.id("app-root")
			.track_focus(&self.focus)
			.key_context("App")
			.size_full()
			.on_action(cx.listener(|this, _: &OpenSettings, window, cx| {
				ui::settings::open_settings_window(this, window, cx);
			}))
			.on_action(cx.listener(|this, _: &ToggleDebug, window, cx| {
				this.toggle_debug_log(window, cx);
				cx.notify();
			}))
			.on_action(cx.listener(|this, _: &OpenPalette, _, cx| {
				if this.data.route == Route::Workspace {
					this.data.overlay.palette_open = !this.data.overlay.palette_open;
					if !this.data.overlay.palette_open {
						this.data.overlay.palette_results.clear();
						this.data.overlay.palette_query.clear();
					}
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
			.on_action(cx.listener(|this, _: &CommitChanges, window, cx| {
				let (no_files, ahead) = this
					.data
					.current_ws()
					.map(|ws| (ws.git_files.is_empty(), ws.git_ahead))
					.unwrap_or((true, 0));
				if no_files && ahead > 0 {
					this.push_current();
				} else {
					this.commit_selected(window, cx);
				}
				cx.notify();
			}))
			.on_action(cx.listener(|this, _: &DismissOverlay, _, cx| {
				if this.dismiss_overlay() {
					cx.notify();
				}
			}))
			.on_action(cx.listener(|this, _: &FindInTerminal, window, cx| {
				this.open_find(window, cx);
				cx.notify();
			}))
			.on_action(cx.listener(|this, _: &IncreaseFontSize, _, cx| {
				this.bump_font_size(1.0);
				cx.notify();
			}))
			.on_action(cx.listener(|this, _: &DecreaseFontSize, _, cx| {
				this.bump_font_size(-1.0);
				cx.notify();
			}))
			.on_action(cx.listener(|this, _: &WrapBold, window, cx| {
				this.wrap_active_markup("**", "**", window, cx);
				cx.notify();
			}))
			.on_action(cx.listener(|this, _: &WrapItalic, window, cx| {
				this.wrap_active_markup("*", "*", window, cx);
				cx.notify();
			}))
			.child(ui::shell::render(self, window, cx))
	}
}

#[allow(dead_code)]
pub fn input_el(state: &Entity<InputState>) -> Input {
	Input::new(state)
}

pub fn suggested_project_name(folder: &str, current_name: &str) -> String {
	if current_name.trim().is_empty() {
		backend::file_name(folder)
	} else {
		current_name.to_string()
	}
}

pub fn search_match_offsets(text: &str, query: &str) -> Vec<usize> {
	if query.is_empty() {
		return Vec::new();
	}
	text.match_indices(query).map(|(ix, _)| ix).collect()
}

pub fn offset_line_col(text: &str, offset: usize) -> (u32, u32) {
	let mut cursor = offset.min(text.len());
	while cursor > 0 && !text.is_char_boundary(cursor) {
		cursor -= 1;
	}
	let before = &text[..cursor];
	let line = before.matches('\n').count() as u32;
	let character = before.rsplit('\n').next().unwrap_or("").chars().count() as u32;
	(line, character)
}

pub fn wrap_markup_text(text: &str, start: usize, end: usize, prefix: &str, suffix: &str) -> (String, usize) {
	let start = snap_char_boundary(text, start.min(text.len()));
	let end = snap_char_boundary(text, end.min(text.len()));
	let (a, b) = if start <= end { (start, end) } else { (end, start) };
	let mut out = String::with_capacity(text.len() + prefix.len() + suffix.len());
	out.push_str(&text[..a]);
	out.push_str(prefix);
	out.push_str(&text[a..b]);
	out.push_str(suffix);
	out.push_str(&text[b..]);
	(out, a + prefix.len() + (b - a))
}

fn snap_char_boundary(text: &str, mut offset: usize) -> usize {
	while offset > 0 && !text.is_char_boundary(offset) {
		offset -= 1;
	}
	offset
}

fn utf16_offset_to_bytes(text: &str, utf16: usize) -> usize {
	let mut seen = 0;
	for (byte, ch) in text.char_indices() {
		if seen >= utf16 {
			return byte;
		}
		seen += ch.len_utf16();
	}
	text.len()
}

pub fn apply_slash_command(text: &str, prefix: &str, suffix: &str) -> String {
	crate::ui::markdown::apply_slash_at(text, text.len(), prefix, suffix).0
}

pub fn wrap_markup(
	input: &Entity<InputState>,
	prefix: &str,
	suffix: &str,
	window: &mut Window,
	cx: &mut Context<AppView>,
) {
	input.update(cx, |state, cx| {
		let text = state.value().to_string();
		let (start, end) = match state.selected_text_range(true, window, cx) {
			Some(sel) => (
				utf16_offset_to_bytes(&text, sel.range.start),
				utf16_offset_to_bytes(&text, sel.range.end),
			),
			None => {
				let cursor = snap_char_boundary(&text, state.cursor().min(text.len()));
				(cursor, cursor)
			}
		};
		let (new_text, caret) = wrap_markup_text(&text, start, end, prefix, suffix);
		state.set_value(new_text.clone(), window, cx);
		let (line, character) = offset_line_col(&new_text, caret);
		state.set_cursor_position(gpui_component::input::Position::new(line, character), window, cx);
	});
}

#[cfg(test)]
mod tests {
	use super::{
		apply_slash_command, context_action_paths, create_target_directory, file_status_badge, git_status_kind,
		join_tree_path, offset_line_col, search_match_offsets, sibling_names, suggested_project_name, unique_tree_name,
		wrap_markup_text, GitStatusKind,
	};
	use crate::state::TreeNode;
	use std::collections::{HashMap, HashSet};

	#[test]
	fn unique_tree_name_adds_numbers() {
		assert_eq!(unique_tree_name(&[], "New File"), "New File");
		assert_eq!(unique_tree_name(&["New File".into()], "New File"), "New File 2");
		assert_eq!(
			unique_tree_name(&["New File".into(), "New File 2".into()], "New File"),
			"New File 3"
		);
	}

	fn node(path: &str, is_dir: bool, children: Vec<String>) -> TreeNode {
		TreeNode {
			path: path.into(),
			name: path.rsplit('/').next().unwrap_or(path).into(),
			is_dir,
			expanded: is_dir,
			children_loaded: true,
			children,
		}
	}

	#[test]
	fn create_target_directory_uses_folder_or_parent() {
		let mut tree = HashMap::new();
		tree.insert("".into(), node("", true, vec!["src".into(), "README.md".into()]));
		tree.insert("src".into(), node("src", true, vec!["src/main.rs".into()]));
		tree.insert("src/main.rs".into(), node("src/main.rs", false, Vec::new()));
		tree.insert("README.md".into(), node("README.md", false, Vec::new()));
		assert_eq!(create_target_directory(&tree, Some("src")).as_deref(), Some("src"));
		assert_eq!(
			create_target_directory(&tree, Some("src/main.rs")).as_deref(),
			Some("src")
		);
		assert_eq!(create_target_directory(&tree, Some("README.md")), None);
		assert_eq!(create_target_directory(&tree, None), None);
		assert_eq!(join_tree_path(Some("src"), "New File"), "src/New File");
		assert_eq!(join_tree_path(None, "New File"), "New File");
		assert_eq!(sibling_names(&tree, Some("src")), vec!["main.rs".to_string()]);
	}

	#[test]
	fn context_action_paths_uses_selection_when_clicked_is_selected() {
		let selected = HashSet::from(["a".into(), "b".into()]);
		assert_eq!(
			context_action_paths(&selected, "a"),
			vec!["a".to_string(), "b".to_string()]
		);
		assert_eq!(context_action_paths(&selected, "c"), vec!["c".to_string()]);
	}

	#[test]
	fn suggested_project_name_uses_basename_when_empty() {
		assert_eq!(suggested_project_name("/tmp/my-app", ""), "my-app");
		assert_eq!(suggested_project_name("/tmp/my-app", "   "), "my-app");
		assert_eq!(suggested_project_name("/tmp/my-app", "Custom"), "Custom");
	}

	#[test]
	fn file_status_badge_maps_word_and_letter_status() {
		assert_eq!(file_status_badge("untracked"), "A");
		assert_eq!(file_status_badge("added"), "A");
		assert_eq!(file_status_badge("deleted"), "D");
		assert_eq!(file_status_badge("renamed"), "R");
		assert_eq!(file_status_badge("ignored"), "I");
		assert_eq!(file_status_badge("modified"), "M");
		assert_eq!(git_status_kind("deleted"), GitStatusKind::Deleted);
		assert_eq!(git_status_kind("??"), GitStatusKind::Untracked);
	}

	#[test]
	fn offset_line_col_tracks_lines() {
		assert_eq!(offset_line_col("abc", 2), (0, 2));
		assert_eq!(offset_line_col("ab\ncd", 4), (1, 1));
		assert_eq!(offset_line_col("", 0), (0, 0));
	}

	#[test]
	fn search_match_offsets_finds_each_hit() {
		assert_eq!(search_match_offsets("abcabc", "bc"), vec![1, 4]);
		assert!(search_match_offsets("abc", "").is_empty());
		assert!(search_match_offsets("abc", "z").is_empty());
	}

	#[test]
	fn wrap_markup_text_wraps_selection_or_caret() {
		assert_eq!(wrap_markup_text("hello", 2, 2, "**", "**"), ("he****llo".into(), 4));
		assert_eq!(wrap_markup_text("hello", 1, 4, "*", "*"), ("h*ell*o".into(), 5));
		assert_eq!(wrap_markup_text("hello", 4, 1, "*", "*"), ("h*ell*o".into(), 5));
	}

	#[test]
	fn apply_slash_command_replaces_the_slash_line() {
		assert_eq!(apply_slash_command("/h1", "# ", ""), "# ");
		assert_eq!(
			apply_slash_command("intro\n/code", "```\n", "\n```"),
			"intro\n```\n\n```"
		);
	}
}
