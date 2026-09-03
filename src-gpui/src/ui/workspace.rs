use gpui::{div, prelude::*, px, rgb, Context, Window};
use gpui_component::button::{Button, ButtonVariants};
use gpui_component::{Disableable, Selectable};
use gpui_component::tab::Tab;
use gpui_component::{h_flex, v_flex, ActiveTheme, Icon, IconName, Sizable, StyledExt};

use crate::app::AppView;
use crate::state::{AgentKind, DialogKind, SidebarMode, UnifiedTab};
use crate::ui::{file_tree, file_viewer, git, notes, sidebar, terminal};

pub fn render(app: &mut AppView, window: &mut Window, cx: &mut Context<AppView>) -> impl IntoElement {
	v_flex()
		.id("profile-workspace")
		.size_full()
		.min_w_0()
		.min_h_0()
		.child(topbar(app, window, cx))
		.child(
			h_flex()
				.id("workspace-body")
				.flex_1()
				.min_w_0()
				.min_h_0()
				.child(profile_sidebar(app, window, cx))
				.child(main_column(app, window, cx)),
		)
}

fn topbar(app: &mut AppView, _window: &mut Window, cx: &mut Context<AppView>) -> impl IntoElement {
	let theme = cx.theme().clone();
	let view = cx.entity();
	let Some(ws) = app.data.current_ws() else {
		return div().id("empty-topbar").into_any_element();
	};
	let mode = ws.sidebar_mode;
	let open = ws.sidebar_open;
	let stats = ws.git_stats.clone();
	let name = ws.project_name.clone();
	let branch = if ws.branch.is_empty() {
		"main".to_string()
	} else {
		ws.branch.clone()
	};
	let worktree = ws.worktree.clone();
	let pr = ws.pr.clone();
	let collapsed = app.data.prefs.sidebar_collapsed;
	let pad_left = if cfg!(target_os = "macos") && collapsed {
		px(84.)
	} else {
		px(16.)
	};
	let pad_right = if cfg!(target_os = "windows") {
		px(118.)
	} else {
		px(16.)
	};
	let controls = app.data.prefs.topbar_controls.clone();

	div()
		.id("project-topbar")
		.w_full()
		.min_h(px(44.))
		.pt(px(4.))
		.pb(px(6.))
		.pl(pad_left)
		.pr(pad_right)
		.border_b_1()
		.border_color(theme.border)
		.flex()
		.items_end()
		.justify_between()
		.child(
			h_flex()
				.gap_2()
				.when(collapsed, |el| {
					el.child(
						Button::new("expand-app-sidebar")
							.ghost()
							.small()
							.icon(IconName::PanelLeftOpen)
							.tooltip(app.t("expandSidebar"))
							.on_click({
								let view = view.clone();
								move |_, _, cx| {
									view.update(cx, |app, cx| {
										app.data.prefs.sidebar_collapsed = false;
										app.persist_prefs();
										cx.notify();
									});
								}
							}),
					)
				})
				.child(mode_switch(app, mode, open, stats.files_changed, stats.insertions, stats.deletions, cx)),
		)
		.child(
			h_flex()
				.absolute()
				.left_0()
				.right_0()
				.justify_center()
				.gap_2()
				.child(
					div()
						.id("topbar-project-name")
						.font_semibold()
						.text_sm()
						.on_click({
							let view = view.clone();
							let worktree = worktree.clone();
							move |_, _, cx| {
								view.update(cx, |app, _| {
									let _ = app.backend.reveal_path(
										app.data.current_profile.as_deref().unwrap_or(""),
										None,
									);
									let _ = worktree;
								});
							}
						})
						.child(name),
				)
				.child(
					h_flex()
						.id("topbar-branch")
						.gap_1()
						.text_color(theme.muted_foreground)
						.hover(|el| el.text_color(theme.foreground))
						.on_click({
							let view = view.clone();
							move |_, _, cx| {
								view.update(cx, |app, cx| {
									if let Some(ws) = app.data.current_ws() {
										app.data.overlay.branches =
											app.backend.list_branches(&ws.worktree).unwrap_or_default();
									}
									app.data.overlay.dialog = Some(DialogKind::SwitchBranch);
									cx.notify();
								});
							}
						})
						.child(Icon::new(IconName::GitHub).w(px(12.)))
						.child(div().text_sm().child(branch)),
				),
		)
		.child(
			h_flex()
				.gap_1()
				.children(controls.into_iter().map(|id| {
					topbar_control(app, &id, pr.as_ref(), cx)
				}))
				.child(
					Button::new("project-settings")
						.small()
						.icon(IconName::Settings)
						.tooltip(app.t("projectSettings"))
						.on_click({
							let view = view.clone();
							move |_, window, cx| {
								view.update(cx, |app, cx| {
									app.data.overlay.dialog = Some(DialogKind::ProjectSettings);
									app.data.overlay.dialog_project = app.data.current_project.clone();
									if let Some(pid) = app.data.current_project.clone() {
										if let Ok(cfg) = app.backend.project_config(&pid) {
											app.inputs.worktree.update(cx, |s, cx| {
												s.set_value(
													cfg.worktree_dir.clone().unwrap_or_default(),
													window,
													cx,
												);
											});
											app.inputs.init_script.update(cx, |s, cx| {
												s.set_value(cfg.init_script.join("\n"), window, cx);
											});
											app.inputs.setup_script.update(cx, |s, cx| {
												s.set_value(cfg.setup_script.join("\n"), window, cx);
											});
											app.inputs.teardown_script.update(cx, |s, cx| {
												s.set_value(cfg.teardown_script.join("\n"), window, cx);
											});
										}
									}
									cx.notify();
								});
							}
						}),
				),
		)
		.into_any_element()
}

fn mode_switch(
	app: &AppView,
	mode: SidebarMode,
	open: bool,
	files: u32,
	ins: u32,
	del: u32,
	cx: &mut Context<AppView>,
) -> impl IntoElement {
	let view = cx.entity();
	let theme = cx.theme().clone();
	h_flex()
		.id("sidebar-mode-switch")
		.h(px(28.))
		.rounded_md()
		.bg(theme.muted)
		.p(px(2.))
		.gap_1()
		.child(mode_btn("files", IconName::Folder, app.t("sidebarFilesTab"), open && mode == SidebarMode::Files, SidebarMode::Files, view.clone()))
		.child(
			h_flex()
				.id("git-mode-btn")
				.child(mode_btn("git", IconName::GitHub, app.t("sidebarGitTab"), open && mode == SidebarMode::Git, SidebarMode::Git, view.clone()))
				.when(files > 0, |el| {
					el.child(
						h_flex()
							.gap_1()
							.pr_1()
							.text_xs()
							.child(
								div()
									.text_color(rgb(0x22c55e))
									.child(format!("+{ins}")),
							)
							.child(
								div()
									.text_color(rgb(0xef4444))
									.child(format!("-{del}")),
							),
					)
				}),
		)
		.child(mode_btn("notes", IconName::BookOpen, app.t("notes"), open && mode == SidebarMode::Notes, SidebarMode::Notes, view))
}

fn mode_btn(
	id: &'static str,
	icon: IconName,
	tip: String,
	selected: bool,
	mode: SidebarMode,
	view: gpui::Entity<AppView>,
) -> impl IntoElement {
	Button::new(id)
		.ghost()
		.xsmall()
		.icon(icon)
		.selected(selected)
		.tooltip(tip)
		.on_click(move |_, _, cx| {
			view.update(cx, |app, cx| {
				if let Some(ws) = app.data.current_ws_mut() {
					if ws.sidebar_open && ws.sidebar_mode == mode {
						ws.sidebar_open = false;
					} else {
						ws.sidebar_mode = mode;
						ws.sidebar_open = true;
					}
					app.data.prefs.profile_sidebar_open = ws.sidebar_open;
					app.persist_prefs();
				}
				cx.notify();
			});
		})
}

fn topbar_control(
	app: &AppView,
	id: &str,
	pr: Option<&model::project::GitPullRequestStatus>,
	cx: &mut Context<AppView>,
) -> impl IntoElement {
	let view = cx.entity();
	match id {
		"github-desktop" => Button::new("tb-gh")
			.ghost()
			.small()
			.icon(IconName::GitHub)
			.tooltip(app.t("topbarGithubDesktop"))
			.on_click({
				let view = view.clone();
				move |_, _, cx| {
					view.update(cx, |app, _| app.open_topbar_app("github-desktop"));
				}
			})
			.into_any_element(),
		"editor" => Button::new("tb-ed")
			.ghost()
			.small()
			.icon(IconName::ALargeSmall)
			.tooltip(app.t("topbarEditor"))
			.on_click({
				let view = view.clone();
				move |_, _, cx| {
					view.update(cx, |app, _| app.open_topbar_app("editor"));
				}
			})
			.into_any_element(),
		"terminal" => Button::new("tb-term")
			.ghost()
			.small()
			.icon(IconName::SquareTerminal)
			.tooltip(app.t("topbarTerminal"))
			.on_click({
				let view = view.clone();
				move |_, _, cx| {
					view.update(cx, |app, _| app.open_topbar_app("terminal"));
				}
			})
			.into_any_element(),
		"pr-status" => {
			let (label, tip) = match pr {
				None => (app.t("topbarPrNoPr"), app.t("topbarPrNoPrTooltip")),
				Some(p) if p.is_draft => (
					app.t("topbarPrDraft"),
					crate::i18n::tf(
						app.data.locale,
						"topbarPrTooltip",
						&[
							("number", &p.number.to_string()),
							("title", &p.title),
							("state", "draft"),
						],
					),
				),
				Some(p) => (
					match p.state.as_str() {
						"MERGED" => app.t("topbarPrMerged"),
						"CLOSED" => app.t("topbarPrClosed"),
						_ => app.t("topbarPrOpen"),
					},
					crate::i18n::tf(
						app.data.locale,
						"topbarPrTooltip",
						&[
							("number", &p.number.to_string()),
							("title", &p.title),
							("state", &p.state),
						],
					),
				),
			};
			Button::new("tb-pr")
				.ghost()
				.small()
				.icon(IconName::GitHub)
				.label(label)
				.tooltip(tip)
				.on_click({
					let view = view.clone();
					move |_, _, cx| {
						view.update(cx, |app, _| app.open_pr());
					}
				})
				.into_any_element()
		}
		_ => div().into_any_element(),
	}
}

fn profile_sidebar(
	app: &mut AppView,
	window: &mut Window,
	cx: &mut Context<AppView>,
) -> impl IntoElement {
	let Some(ws) = app.data.current_ws() else {
		return div().id("no-profile-sidebar").into_any_element();
	};
	if !ws.sidebar_open {
		return div().id("profile-sidebar-closed").into_any_element();
	}
	let width = app.data.prefs.profile_sidebar_width.clamp(180.0, 560.0);
	let mode = ws.sidebar_mode;
	let theme = cx.theme().clone();

	let view = cx.entity();
	div()
		.id("profile-sidebar-wrap")
		.relative()
		.h_full()
		.child(
			div()
				.id("profile-sidebar")
				.w(px(width))
				.h_full()
				.border_r_1()
				.border_color(theme.border)
				.min_w_0()
				.child(
					// Keep all three mounted; hide inactive ones.
					v_flex()
						.size_full()
						.child(visible(mode == SidebarMode::Files, file_tree::render(app, window, cx)))
						.child(visible(mode == SidebarMode::Git, git::render_panel(app, window, cx)))
						.child(visible(mode == SidebarMode::Notes, notes::render(app, window, cx))),
				),
		)
		.child(sidebar::resize_handle("profile-sidebar-resize", view, true))
		.into_any_element()
}

fn visible(show: bool, child: impl IntoElement) -> impl IntoElement {
	div()
		.size_full()
		.when(!show, |el| el.h(px(0.)).overflow_hidden().invisible())
		.when(show, |el| el.flex_1())
		.child(child)
}

fn main_column(
	app: &mut AppView,
	window: &mut Window,
	cx: &mut Context<AppView>,
) -> impl IntoElement {
	let Some(ws) = app.data.current_ws() else {
		return div().id("no-main").flex_1().into_any_element();
	};
	if !ws.has_tabs() {
		return empty_cta(app, cx).into_any_element();
	}
	v_flex()
		.id("workspace-main")
		.flex_1()
		.min_w_0()
		.min_h_0()
		.child(tab_bar(app, cx))
		.child(tab_bodies(app, window, cx))
		.into_any_element()
}

fn empty_cta(app: &AppView, cx: &mut Context<AppView>) -> impl IntoElement {
	let theme = cx.theme().clone();
	let view = cx.entity();
	v_flex()
		.id("empty-terminals")
		.flex_1()
		.items_center()
		.justify_center()
		.gap_3()
		.child(Icon::new(IconName::SquareTerminal).w(px(28.)))
		.child(div().font_semibold().child(app.t("noTerminalsOpen")))
		.child(
			div()
				.text_sm()
				.text_color(theme.muted_foreground)
				.child(app.t("noTerminalsOpenDescription")),
		)
		.child(new_terminal_control(app, view))
}

fn tab_bar(app: &AppView, cx: &mut Context<AppView>) -> impl IntoElement {
	let theme = cx.theme().clone();
	let view = cx.entity();
	let Some(ws) = app.data.current_ws() else {
		return div().id("no-tabs").into_any_element();
	};
	let active = ws.active;

	h_flex()
		.id("unified-tabs")
		.w_full()
		.border_b_1()
		.border_color(theme.border)
		.overflow_x_scroll()
		.children(ws.terminals.iter().enumerate().map(|(ix, term)| {
			let selected = matches!(active, Some(UnifiedTab::Terminal { index }) if index == ix);
			let id = term.id.clone();
			let profile = term.profile_id.clone();
			Tab::new()
				.label(term.title.clone())
				.icon(IconName::SquareTerminal)
				.selected(selected)
				.suffix(
					h_flex()
						.gap_1()
						.child(agent_kind_mark(term.agent_kind))
						.child(sidebar::agent_dot(term.agent))
						.child(
							Button::new(crate::ui::eid(format!("close-term-{id}")))
								.ghost()
								.xsmall()
								.icon(IconName::Close)
								.on_click({
									let view = view.clone();
									let id = id.clone();
									let profile = profile.clone();
									move |_, _, cx| {
										view.update(cx, |app, cx| {
											app.close_terminal(&profile, &id);
											cx.notify();
										});
									}
								}),
						),
				)
				.on_click({
					let view = view.clone();
					move |_, _, cx| {
						view.update(cx, |app, cx| {
							if let Some(ws) = app.data.current_ws_mut() {
								ws.active = Some(UnifiedTab::Terminal { index: ix });
							}
							cx.notify();
						});
					}
				})
		}))
		.children(ws.files.iter().enumerate().map(|(ix, file)| {
			let selected = matches!(active, Some(UnifiedTab::File { index }) if index == ix);
			let path = file.path.clone();
			let profile = ws.profile_id.clone();
			Tab::new()
				.label(file.title.clone())
				.icon(IconName::File)
				.selected(selected)
				.suffix(
					h_flex()
						.gap_1()
						.when(file.dirty(), |el| {
							el.child(div().size(px(8.)).rounded_full().bg(theme.muted_foreground))
						})
						.child(
							Button::new(crate::ui::eid(format!("close-file-{path}")))
								.ghost()
								.xsmall()
								.icon(IconName::Close)
								.on_click({
									let view = view.clone();
									let path = path.clone();
									let profile = profile.clone();
									move |_, _, cx| {
										view.update(cx, |app, cx| {
											app.request_close_file(&profile, &path);
											cx.notify();
										});
									}
								}),
						),
				)
				.on_click({
					let view = view.clone();
					move |_, window, cx| {
						view.update(cx, |app, cx| {
							if let Some(ws) = app.data.current_ws_mut() {
								ws.active = Some(UnifiedTab::File { index: ix });
							}
							if let Some(file) = app.data.current_ws().and_then(|w| w.files.get(ix)) {
								if !file.preview {
									let draft = file.draft.clone();
									app.inputs.file_editor.update(cx, |s, cx| {
										s.set_value(draft, window, cx);
									});
								}
							}
							cx.notify();
						});
					}
				})
		}))
		.child(new_terminal_control(app, view))
		.into_any_element()
}

fn new_terminal_control(app: &AppView, view: gpui::Entity<AppView>) -> impl IntoElement {
	let has_templates = !app.data.prefs.templates.is_empty()
		|| app
			.data
			.current_ws()
			.map(|w| !w.config.terminal_templates.is_empty())
			.unwrap_or(false);
	if has_templates {
		Button::new("new-term-split")
			.ghost()
			.small()
			.icon(IconName::Plus)
			.label(app.t("newTerminal"))
			.on_click({
				let view = view.clone();
				move |_, _, cx| {
					view.update(cx, |app, cx| {
						app.data.overlay.context_menu = Some((
							crate::state::ContextMenu::NewTerminal,
							200.0,
							80.0,
						));
						cx.notify();
					});
				}
			})
			.into_any_element()
	} else {
		Button::new("new-term")
			.ghost()
			.small()
			.icon(IconName::Plus)
			.label(app.t("newTerminal"))
			.on_click(move |_, _, cx| {
				view.update(cx, |app, cx| {
					app.create_terminal(&app.t("newTerminal"), "", Vec::new());
					cx.notify();
				});
			})
			.into_any_element()
	}
}

fn agent_kind_mark(kind: AgentKind) -> impl IntoElement {
	let (label, color) = match kind {
		AgentKind::Claude => ("C", gpui::rgb(0xd97757)),
		AgentKind::Codex => ("X", gpui::rgb(0x6b7280)),
		AgentKind::Gemini => ("G", gpui::rgb(0x4285f4)),
		AgentKind::Cursor => ("R", gpui::rgb(0xf59e0b)),
		AgentKind::Copilot => ("P", gpui::rgb(0x818cf8)),
		AgentKind::Amp => ("A", gpui::rgb(0x22c55e)),
		AgentKind::Cline => ("L", gpui::rgb(0x38bdf8)),
		AgentKind::OpenCode => ("O", gpui::rgb(0x94a3b8)),
		AgentKind::Grok => ("K", gpui::rgb(0xe5e7eb)),
		AgentKind::Kimi => ("M", gpui::rgb(0xf472b6)),
		AgentKind::Other => ("•", gpui::rgb(0x9ca3af)),
		AgentKind::Unknown => return div().into_any_element(),
	};
	div()
		.size(px(14.))
		.rounded_sm()
		.bg(color)
		.text_color(gpui::white())
		.flex()
		.items_center()
		.justify_center()
		.text_xs()
		.child(label)
		.into_any_element()
}

fn tab_bodies(
	app: &mut AppView,
	window: &mut Window,
	cx: &mut Context<AppView>,
) -> impl IntoElement {
	let Some(ws) = app.data.current_ws() else {
		return div().into_any_element();
	};
	let active = ws.active;
	let term_count = ws.terminals.len();
	let file_active = matches!(active, Some(UnifiedTab::File { .. }));

	div()
		.id("tab-bodies")
		.flex_1()
		.min_h_0()
		.min_w_0()
		.relative()
		.child(
			div()
				.id("file-viewer-slot")
				.size_full()
				.when(!file_active, |el| el.invisible().h(px(0.)))
				.child(file_viewer::render(app, window, cx)),
		)
		.children((0..term_count).map(|ix| {
			let show = matches!(active, Some(UnifiedTab::Terminal { index }) if index == ix);
			div()
				.id(crate::ui::eid(format!("term-slot-{ix}")))
				.size_full()
				.when(!show, |el| el.invisible())
				.child(terminal::render(app, ix, window, cx))
		}))
		.into_any_element()
}
