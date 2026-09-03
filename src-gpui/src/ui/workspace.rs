use gpui::{div, prelude::*, px, rgb, Context, Window};
use gpui_component::button::{Button, ButtonVariants};
use gpui_component::tab::Tab;
use gpui_component::{h_flex, v_flex, ActiveTheme, Icon, IconName, Sizable, StyledExt};
use gpui_component::{Disableable, Selectable};

use crate::app::AppView;
use crate::state::{
	leftover_new_terminal_split, leftover_template_rows, AgentKind, DialogKind, LeftoverTemplateRow, SidebarMode,
	UnifiedTab,
};
use crate::ui::{file_tree, file_viewer, git, leftover_branch_glyph, notes, sidebar, terminal, tip};

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
	let pr_error = ws.pr_error.clone();
	let collapsed = app.data.prefs.sidebar_collapsed;
	let pad_left = if cfg!(target_os = "macos") && collapsed {
		px(84.)
	} else {
		px(16.)
	};
	let pad_right = if cfg!(target_os = "windows") { px(118.) } else { px(16.) };
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
		.relative()
		.child(
			h_flex()
				.id("topbar-title")
				.absolute()
				.left_0()
				.right_0()
				.bottom(px(6.))
				.px(px(128.))
				.min_w_0()
				.items_center()
				.justify_center()
				.gap_2()
				.child(
					div()
						.id("topbar-project-name")
						.min_w_0()
						.font_semibold()
						.truncate()
						.tooltip(tip(worktree.clone()))
						.on_click({
							let view = view.clone();
							move |_, _, cx| {
								view.update(cx, |app, _| {
									let _ = app
										.backend
										.reveal_path(app.data.current_profile.as_deref().unwrap_or(""), None);
								});
							}
						})
						.child(name),
				)
				.child(
					h_flex()
						.id("topbar-branch")
						.min_w_0()
						.gap_1()
						.items_center()
						.text_color(theme.muted_foreground)
						.hover(|el| el.text_color(theme.foreground))
						.tooltip(tip(app.t("switchBranchTitle")))
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
						.child(leftover_branch_glyph(theme.muted_foreground))
						.child(div().min_w_0().truncate().child(branch)),
				),
		)
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
				.child(mode_switch(app, mode, open, stats.insertions, stats.deletions, cx)),
		)
		.child(
			h_flex()
				.gap_1()
				.children(
					controls
						.into_iter()
						.map(|id| topbar_control(app, &id, pr.as_ref(), pr_error.as_deref(), cx)),
				)
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
												s.set_value(cfg.worktree_dir.clone().unwrap_or_default(), window, cx);
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

pub fn leftover_show_git_diff_stats(insertions: u32, deletions: u32) -> bool {
	insertions != 0 || deletions != 0
}

fn mode_switch(
	app: &AppView,
	mode: SidebarMode,
	open: bool,
	ins: u32,
	del: u32,
	cx: &mut Context<AppView>,
) -> impl IntoElement {
	let view = cx.entity();
	let theme = cx.theme().clone();
	let git_selected = open && mode == SidebarMode::Git;
	h_flex()
		.id("sidebar-mode-switch")
		.h(px(28.))
		.rounded_md()
		.bg(theme.muted)
		.p(px(2.))
		.gap_1()
		.child(mode_btn(
			"files",
			IconName::Folder,
			app.t("sidebarFilesTab"),
			open && mode == SidebarMode::Files,
			SidebarMode::Files,
			view.clone(),
		))
		.child(
			h_flex()
				.id("git-mode-btn")
				.h(px(24.))
				.px_2()
				.gap_1()
				.items_center()
				.rounded_md()
				.when(git_selected, |el| el.bg(theme.background))
				.tooltip(tip(app.t("sidebarGitTab")))
				.on_click({
					let view = view.clone();
					move |_, _, cx| {
						view.update(cx, |app, cx| {
							if let Some(ws) = app.data.current_ws_mut() {
								if ws.sidebar_open && ws.sidebar_mode == SidebarMode::Git {
									ws.sidebar_open = false;
								} else {
									ws.sidebar_mode = SidebarMode::Git;
									ws.sidebar_open = true;
								}
								app.data.prefs.profile_sidebar_open = ws.sidebar_open;
								app.persist_prefs();
							}
							cx.notify();
						});
					}
				})
				.child(leftover_branch_glyph(if git_selected {
					theme.foreground
				} else {
					theme.muted_foreground
				}))
				.when(leftover_show_git_diff_stats(ins, del), |el| {
					el.child(div().text_xs().text_color(rgb(0x22c55e)).child(format!("+{ins}")))
						.child(div().text_xs().text_color(rgb(0xef4444)).child(format!("-{del}")))
				}),
		)
		.child(mode_btn(
			"notes",
			IconName::BookOpen,
			app.t("notes"),
			open && mode == SidebarMode::Notes,
			SidebarMode::Notes,
			view,
		))
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
	pr_error: Option<&str>,
	cx: &mut Context<AppView>,
) -> impl IntoElement {
	let view = cx.entity();
	match id {
		"github-desktop" => Button::new("tb-gh")
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
				None if pr_error.is_some() => (app.t("topbarPrNoPr"), app.t("topbarPrCheckFailedDescription")),
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

fn profile_sidebar(app: &mut AppView, window: &mut Window, cx: &mut Context<AppView>) -> impl IntoElement {
	let Some(ws) = app.data.current_ws() else {
		return div().id("no-profile-sidebar").into_any_element();
	};
	let open = ws.sidebar_open;
	let stored_width = app.data.prefs.profile_sidebar_width.clamp(180.0, 560.0);
	let width = if open { stored_width } else { 0.0 };
	let mode = ws.sidebar_mode;
	let theme = cx.theme().clone();

	let view = cx.entity();
	div()
		.id("profile-sidebar-wrap")
		.relative()
		.h_full()
		.w(px(width))
		.overflow_hidden()
		.when(!open, |el| el.invisible())
		.child(
			div()
				.id("profile-sidebar")
				.w(px(stored_width))
				.h_full()
				.border_r_1()
				.border_color(theme.border)
				.min_w_0()
				.child(
					// Keep all three mounted across Files/Git/Notes and while the sidebar is closed.
					v_flex()
						.size_full()
						.child(visible(mode == SidebarMode::Files, file_tree::render(app, window, cx)))
						.child(visible(mode == SidebarMode::Git, git::render_panel(app, window, cx)))
						.child(visible(mode == SidebarMode::Notes, notes::render(app, window, cx))),
				),
		)
		.when(open, |el| {
			el.child(sidebar::resize_handle(
				"profile-sidebar-resize",
				view,
				true,
				app.data.overlay.sidebar_resize_focus == Some(true),
				app.t("profileSidebarResizeSeparator"),
			))
		})
		.into_any_element()
}

fn visible(show: bool, child: impl IntoElement) -> impl IntoElement {
	div()
		.size_full()
		.when(!show, |el| el.h(px(0.)).overflow_hidden().invisible())
		.when(show, |el| el.flex_1())
		.child(child)
}

fn main_column(app: &mut AppView, window: &mut Window, cx: &mut Context<AppView>) -> impl IntoElement {
	let Some(ws) = app.data.current_ws() else {
		return persistent_terminals(app, window, cx).into_any_element();
	};
	if !ws.has_tabs() {
		return v_flex()
			.id("workspace-empty")
			.flex_1()
			.min_h_0()
			.relative()
			.child(empty_cta(app, cx))
			.child(persistent_terminals(app, window, cx))
			.into_any_element();
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
		.gap_4()
		.child(
			div()
				.size(px(32.))
				.rounded_lg()
				.bg(theme.muted)
				.flex()
				.items_center()
				.justify_center()
				.child(Icon::new(IconName::SquareTerminal).w(px(16.))),
		)
		.child(div().text_sm().font_medium().child(app.t("noTerminalsOpen")))
		.child(
			div()
				.text_sm()
				.text_color(theme.muted_foreground)
				.child(app.t("noTerminalsOpenDescription")),
		)
		.child(new_terminal_control(app, view.clone(), true))
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
			let show_completed = term.agent == crate::state::AgentStatus::Completed && !term.completed_hidden;
			let show_live = matches!(
				term.agent,
				crate::state::AgentStatus::Running | crate::state::AgentStatus::Waiting
			);
			Tab::new()
				.label(term.title.clone())
				.prefix(terminal_tab_icon(&term.title, term.agent_kind))
				.max_w(px(224.))
				.selected(selected)
				.suffix(
					h_flex()
						.gap_1()
						.when(show_live, |el| el.child(sidebar::agent_dot(term.agent)))
						.when(show_completed, |el| {
							let view = view.clone();
							let id = id.clone();
							el.child(
								div()
									.id(crate::ui::eid(format!("done-{id}")))
									.size(px(8.))
									.rounded_full()
									.bg(gpui::rgb(0x22c55e))
									.cursor(gpui::CursorStyle::PointingHand)
									.tooltip(crate::ui::tip("Dismiss completion notification"))
									.on_click({
										let view = view.clone();
										let id = id.clone();
										move |_, _, cx| {
											view.update(cx, |app, cx| {
												if let Some(term) = app
													.data
													.current_ws_mut()
													.and_then(|w| w.terminals.iter_mut().find(|t| t.id == id))
												{
													term.completed_hidden = true;
												}
												cx.notify();
											});
										}
									}),
							)
						})
						.child(
							Button::new(crate::ui::eid(format!("close-term-{id}")))
								.ghost()
								.xsmall()
								.icon(IconName::Close)
								.tooltip(format!("Close {title}", title = term.title))
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
				.on_drop({
					let view = view.clone();
					let id = id.clone();
					move |drag: &crate::ui::TreeDrag, _, cx| {
						view.update(cx, |app, cx| {
							app.write_path_to_pty(&id, &drag.path);
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
				.prefix(crate::ui::file_icons::file_glyph(&file.path, false, false, 14.))
				.max_w(px(224.))
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
								.tooltip(format!("Close {title}", title = file.title))
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
									let path = file.path.clone();
									app.bind_file_editor(&path, &draft, window, cx);
								}
							}
							cx.notify();
						});
					}
				})
		}))
		.child(leftover_new_terminal_tab(app, view, cx))
		.into_any_element()
}

fn leftover_new_terminal_tab(
	app: &AppView,
	view: gpui::Entity<AppView>,
	cx: &mut Context<AppView>,
) -> impl IntoElement {
	let theme = cx.theme().clone();
	let hover = app.data.overlay.new_terminal_hover;
	let project: Vec<(String, String)> = app
		.data
		.current_ws()
		.map(|w| {
			w.config
				.terminal_templates
				.iter()
				.map(|t| (t.name.clone(), t.cwd.clone()))
				.collect()
		})
		.unwrap_or_default();
	let global: Vec<String> = app.data.prefs.templates.iter().map(|t| t.name.clone()).collect();
	let rows = leftover_template_rows(&project, &global, true);
	div()
		.id("new-term-tab")
		.relative()
		.ml_2()
		.max_w(px(224.))
		.on_hover({
			let view = view.clone();
			move |hovered, _, cx| {
				view.update(cx, |app, cx| {
					if app.data.overlay.new_terminal_hover != *hovered {
						app.data.overlay.new_terminal_hover = *hovered;
						cx.notify();
					}
				});
			}
		})
		.child(
			Button::new("new-term")
				.ghost()
				.small()
				.icon(IconName::Plus)
				.label(app.t("newTerminal"))
				.on_click({
					let view = view.clone();
					move |_, _, cx| {
						view.update(cx, |app, cx| {
							app.create_terminal(&app.t("newTerminal"), "", Vec::new());
							app.data.overlay.new_terminal_hover = false;
							cx.notify();
						});
					}
				}),
		)
		.when(hover, |el| {
			el.child(leftover_template_dropdown(app, &rows, view.clone(), theme.clone()))
		})
}

fn leftover_template_dropdown(
	app: &AppView,
	rows: &[LeftoverTemplateRow],
	view: gpui::Entity<AppView>,
	theme: gpui_component::Theme,
) -> impl IntoElement {
	let border = theme.border;
	let popover = theme.popover;
	let muted = theme.muted;
	let muted_fg = theme.muted_foreground;
	v_flex()
		.id("new-term-hover-menu")
		.absolute()
		.top(px(36.))
		.left_0()
		.min_w(px(224.))
		.p_1()
		.gap_1()
		.rounded_lg()
		.border_1()
		.border_color(border)
		.bg(popover)
		.shadow_md()
		.children(rows.iter().cloned().map(|row| {
			match row {
				LeftoverTemplateRow::EmptyTitle => div()
					.px_2()
					.py_1()
					.text_sm()
					.text_color(muted_fg)
					.child(app.t("noTerminalTemplates"))
					.into_any_element(),
				LeftoverTemplateRow::EmptyHint => div()
					.px_2()
					.py_1()
					.text_xs()
					.text_color(muted_fg)
					.child(app.t("noTemplatesDropdownHint"))
					.into_any_element(),
				LeftoverTemplateRow::ProjectHeader => div()
					.px_2()
					.py_1()
					.text_xs()
					.font_medium()
					.text_color(muted_fg)
					.child(app.t("projectTerminalTemplates"))
					.into_any_element(),
				LeftoverTemplateRow::GlobalHeader => div()
					.px_2()
					.py_1()
					.text_xs()
					.font_medium()
					.text_color(muted_fg)
					.child(app.t("globalTerminalTemplates"))
					.into_any_element(),
				LeftoverTemplateRow::Project { index, name, cwd } => div()
					.id(crate::ui::eid(format!("hover-pt-{index}")))
					.px_2()
					.py_2()
					.rounded_md()
					.hover(|el| el.bg(muted))
					.on_click({
						let view = view.clone();
						move |_, _, cx| {
							view.update(cx, |app, cx| {
								if let Some(t) = app
									.data
									.current_ws()
									.and_then(|w| w.config.terminal_templates.get(index).cloned())
								{
									app.create_terminal(&t.name, &t.cwd, t.commands);
								}
								app.data.overlay.new_terminal_hover = false;
								cx.notify();
							});
						}
					})
					.child(
						v_flex()
							.gap(px(2.))
							.child(div().text_sm().child(name))
							.when(!cwd.is_empty(), |el| {
								el.child(div().text_xs().text_color(muted_fg).child(cwd))
							}),
					)
					.into_any_element(),
				LeftoverTemplateRow::Global { index, name } => div()
					.id(crate::ui::eid(format!("hover-gt-{index}")))
					.px_2()
					.py_2()
					.rounded_md()
					.hover(|el| el.bg(muted))
					.on_click({
						let view = view.clone();
						move |_, _, cx| {
							view.update(cx, |app, cx| {
								if let Some(t) = app.data.prefs.templates.get(index).cloned() {
									app.create_terminal(&t.name, &t.cwd, t.commands);
								}
								app.data.overlay.new_terminal_hover = false;
								cx.notify();
							});
						}
					})
					.child(div().text_sm().child(name))
					.into_any_element(),
			}
		}))
}

fn new_terminal_control(app: &AppView, view: gpui::Entity<AppView>, empty_cta: bool) -> impl IntoElement {
	let has_templates = !app.data.prefs.templates.is_empty()
		|| app
			.data
			.current_ws()
			.map(|w| !w.config.terminal_templates.is_empty())
			.unwrap_or(false);
	if leftover_new_terminal_split(has_templates, empty_cta) {
		h_flex()
			.gap_0()
			.child(
				Button::new("new-term")
					.primary()
					.small()
					.icon(IconName::Plus)
					.label(app.t("newTerminal"))
					.on_click({
						let view = view.clone();
						move |_, _, cx| {
							view.update(cx, |app, cx| {
								app.create_terminal(&app.t("newTerminal"), "", Vec::new());
								cx.notify();
							});
						}
					}),
			)
			.child(
				Button::new("new-term-split")
					.primary()
					.small()
					.icon(IconName::ChevronDown)
					.tooltip("Choose template".to_string())
					.on_click({
						let view = view.clone();
						move |_, _, cx| {
							view.update(cx, |app, cx| {
								app.data.overlay.context_menu =
									Some((crate::state::ContextMenu::NewTerminal, 200.0, 80.0));
								cx.notify();
							});
						}
					}),
			)
			.into_any_element()
	} else {
		Button::new("new-term")
			.primary()
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

fn terminal_tab_icon(title: &str, detected: AgentKind) -> impl IntoElement {
	match AgentKind::tab_icon_kind(title, detected) {
		AgentKind::Unknown => Icon::new(IconName::SquareTerminal).w(px(14.)).into_any_element(),
		kind => agent_kind_mark(kind).into_any_element(),
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
		AgentKind::Devin => ("D", gpui::rgb(0x14b8a6)),
		AgentKind::Droid => ("F", gpui::rgb(0xa855f7)),
		AgentKind::Hermes => ("H", gpui::rgb(0xf97316)),
		AgentKind::Kilo => ("I", gpui::rgb(0x84cc16)),
		AgentKind::Kiro => ("W", gpui::rgb(0x06b6d4)),
		AgentKind::Pi => ("π", gpui::rgb(0x64748b)),
		AgentKind::Qoder => ("Q", gpui::rgb(0x6366f1)),
		AgentKind::Agy => ("Y", gpui::rgb(0xec4899)),
		AgentKind::OpenClaw => ("C", gpui::rgb(0x334155)),
		AgentKind::Other => ("•", gpui::rgb(0x9ca3af)),
		AgentKind::Unknown => return Icon::new(IconName::SquareTerminal).w(px(14.)).into_any_element(),
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

fn tab_bodies(app: &mut AppView, window: &mut Window, cx: &mut Context<AppView>) -> impl IntoElement {
	let file_active = app
		.data
		.current_ws()
		.is_some_and(|ws| matches!(ws.active, Some(UnifiedTab::File { .. })));

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
		.child(persistent_terminals(app, window, cx))
		.into_any_element()
}

fn persistent_terminals(app: &mut AppView, window: &mut Window, cx: &mut Context<AppView>) -> impl IntoElement {
	let current = app.data.current_profile.clone();
	let mut slots = app
		.data
		.workspaces
		.iter()
		.flat_map(|(profile_id, ws)| {
			ws.terminals.iter().enumerate().map(|(index, term)| {
				let visible = current.as_deref() == Some(profile_id.as_str())
					&& matches!(ws.active, Some(UnifiedTab::Terminal { index: active }) if active == index);
				(profile_id.clone(), index, term.id.clone(), visible)
			})
		})
		.collect::<Vec<_>>();
	slots.sort_by(|a, b| a.2.cmp(&b.2));

	div()
		.id("pty-layer")
		.size_full()
		.relative()
		.children(slots.into_iter().map(|(profile_id, index, id, visible)| {
			div()
				.id(crate::ui::eid(format!("term-slot-{id}")))
				.size_full()
				.child(terminal::render(app, &profile_id, index, visible, window, cx))
		}))
}

#[cfg(test)]
mod tests {
	use super::leftover_show_git_diff_stats;

	#[test]
	fn leftover_git_stats_hide_clean_trees() {
		assert!(!leftover_show_git_diff_stats(0, 0));
		assert!(leftover_show_git_diff_stats(1, 0));
		assert!(leftover_show_git_diff_stats(0, 4));
		assert!(leftover_show_git_diff_stats(2, 3));
	}
}
