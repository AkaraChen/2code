use gpui::{div, prelude::*, px, Context, Window};
use gpui_component::button::{Button, ButtonVariants};
use gpui_component::input::Input;
use gpui_component::spinner::Spinner;
use gpui_component::{h_flex, v_flex, ActiveTheme, Icon, IconName, Sizable, StyledExt};
use gpui_component::{Disableable, Selectable};

use crate::app::AppView;
use crate::backend;
use crate::state::{project_group_menu_rows, ContextMenu, DialogKind, GroupMenuRow};

pub fn render(app: &mut AppView, window: &mut Window, cx: &mut Context<AppView>) -> impl IntoElement {
	div()
		.id("overlays")
		.absolute()
		.inset_0()
		.child(context_menu(app, cx))
		.child(dialog(app, window, cx))
}

fn dialog(app: &mut AppView, window: &mut Window, cx: &mut Context<AppView>) -> impl IntoElement {
	let Some(kind) = app.data.overlay.dialog else {
		return div().id("no-dialog").into_any_element();
	};
	let theme = cx.theme().clone();
	let view = cx.entity();
	let title = match kind {
		DialogKind::CreateProject => app.t("createProject"),
		DialogKind::DeleteProject => app.t("deleteProject"),
		DialogKind::RenameProject => app.t("rename"),
		DialogKind::ProjectSettings => app.t("projectSettings"),
		DialogKind::CreateProfile => app.t("createProfile"),
		DialogKind::DeleteProfile => app.t("deleteProfile"),
		DialogKind::CloseUnsaved => app.t("closeUnsavedFileTitle"),
		DialogKind::SwitchBranch => app.t("switchBranchTitle"),
		DialogKind::OpenLink => app.t("terminalOpenLink"),
		DialogKind::ChooseFile => app.t("terminalChooseFilePath"),
		DialogKind::EditTemplate => app.t("editTerminalTemplate"),
		DialogKind::ReviewQueue => app.t("reviewQueue"),
		DialogKind::DebugLog => app.t("debugLog"),
		DialogKind::CreateGroup => app.t("createProjectGroup"),
	};

	div()
		.id("dialog-mask")
		.absolute()
		.inset_0()
		.flex()
		.items_center()
		.justify_center()
		.bg(gpui::hsla(0., 0., 0., 0.12))
		.on_click({
			let view = view.clone();
			move |_, _, cx| {
				view.update(cx, |app, cx| {
					app.data.overlay.dialog = None;
					cx.notify();
				});
			}
		})
		.child(
			v_flex()
				.id("dialog-panel")
				.w(px(if matches!(kind, DialogKind::ReviewQueue) {
					720.
				} else if matches!(kind, DialogKind::SwitchBranch) {
					448.
				} else if matches!(kind, DialogKind::ProjectSettings | DialogKind::DebugLog) {
					560.
				} else {
					380.
				}))
				.max_h(px(640.))
				.p_4()
				.gap_3()
				.rounded_xl()
				.bg(theme.background)
				.border_1()
				.border_color(theme.border)
				.shadow_lg()
				.on_click(|_, _, _| {})
				.child(
					h_flex()
						.justify_between()
						.child(
							h_flex()
								.gap_2()
								.items_center()
								.when(kind == DialogKind::CreateProject, |el| {
									el.child(Icon::new(IconName::Folder).w(px(18.)))
								})
								.when(kind == DialogKind::ProjectSettings, |el| {
									el.child(Icon::new(IconName::Settings).w(px(18.)))
								})
								.when(
									kind == DialogKind::DeleteProfile || kind == DialogKind::DeleteProject,
									|el| el.child(Icon::new(IconName::TriangleAlert).w(px(18.))),
								)
								.when(kind == DialogKind::ReviewQueue, |el| {
									el.child(Icon::new(IconName::Inbox).w(px(18.)))
								})
								.when(kind == DialogKind::SwitchBranch, |el| {
									el.child(crate::ui::leftover_branch_glyph(theme.muted_foreground))
								})
								.child(div().font_semibold().child(title)),
						)
						.child(Button::new("dlg-x").ghost().xsmall().icon(IconName::Close).on_click({
							let view = view.clone();
							move |_, _, cx| {
								view.update(cx, |app, cx| {
									app.data.overlay.dialog = None;
									cx.notify();
								});
							}
						})),
				)
				.child(dialog_body(app, kind, window, cx))
				.child(dialog_footer(app, kind, cx)),
		)
		.into_any_element()
}

fn dialog_body(
	app: &mut AppView,
	kind: DialogKind,
	_window: &mut Window,
	cx: &mut Context<AppView>,
) -> impl IntoElement {
	let theme = cx.theme().clone();
	let view = cx.entity();
	match kind {
		DialogKind::CreateProject => {
			let folder = app.data.overlay.dialog_folder.clone();
			let hint = if folder.is_none() {
				app.t("createProjectChooseFolderHint")
			} else if app.inputs.project_name.read(cx).value().is_empty() {
				app.t("createProjectHintFolderEmpty")
			} else {
				app.t("createProjectHintFolderNamed")
			};
			v_flex()
				.gap_3()
				.child(if let Some(folder) = folder.clone() {
					v_flex()
						.gap_1()
						.child(
							h_flex()
								.justify_between()
								.child(div().text_sm().child(app.t("folder")))
								.child(Button::new("rechoose").xsmall().label(app.t("chooseFolder")).on_click({
									let view = view.clone();
									move |_, window, cx| {
										view.update(cx, |app, cx| {
											if let Some(p) = backend::pick_folder() {
												app.apply_picked_folder(p, window, cx);
											}
											cx.notify();
										});
									}
								})),
						)
						.child(
							div()
								.p_2()
								.rounded_md()
								.bg(theme.muted)
								.font_family("monospace")
								.text_xs()
								.child(folder),
						)
						.into_any_element()
				} else {
					div()
						.id("choose-folder-big")
						.w_full()
						.h(px(88.))
						.rounded_lg()
						.border_1()
						.border_dashed()
						.border_color(theme.border)
						.flex()
						.flex_col()
						.items_center()
						.justify_center()
						.gap_2()
						.hover(|el| el.bg(theme.muted))
						.on_click({
							let view = view.clone();
							move |_, window, cx| {
								view.update(cx, |app, cx| {
									if let Some(p) = backend::pick_folder() {
										app.apply_picked_folder(p, window, cx);
									}
									cx.notify();
								});
							}
						})
						.child(Icon::new(IconName::Folder).w(px(24.)))
						.child(div().text_sm().child(app.t("chooseFolder")))
						.into_any_element()
				})
				.child(div().text_sm().child(app.t("projectName")))
				.child(Input::new(&app.inputs.project_name))
				.child(div().text_xs().text_color(theme.muted_foreground).child(hint))
				.into_any_element()
		}
		DialogKind::DeleteProject => div().text_sm().child(app.t("confirmDeleteProject")).into_any_element(),
		DialogKind::RenameProject => v_flex()
			.gap_2()
			.child(div().text_sm().child(app.t("newName")))
			.child(Input::new(&app.inputs.rename))
			.into_any_element(),
		DialogKind::ProjectSettings => v_flex()
			.gap_2()
			.child(
				h_flex()
					.gap_2()
					.child(
						Button::new("ps-scripts")
							.small()
							.selected(app.data.overlay.project_settings_tab == 0)
							.icon(IconName::ALargeSmall)
							.label(app.t("scripts"))
							.on_click({
								let view = view.clone();
								move |_, _, cx| {
									view.update(cx, |app, cx| {
										app.data.overlay.project_settings_tab = 0;
										cx.notify();
									});
								}
							}),
					)
					.child(
						Button::new("ps-templates")
							.small()
							.selected(app.data.overlay.project_settings_tab == 1)
							.icon(IconName::SquareTerminal)
							.label(app.t("templates"))
							.on_click({
								let view = view.clone();
								move |_, _, cx| {
									view.update(cx, |app, cx| {
										app.data.overlay.project_settings_tab = 1;
										cx.notify();
									});
								}
							}),
					),
			)
			.child(if app.data.overlay.project_settings_tab == 0 {
				v_flex()
					.gap_2()
					.child(div().text_sm().child(app.t("projectWorktreeDir")))
					.child(
						div()
							.text_xs()
							.text_color(theme.muted_foreground)
							.child(app.t("projectWorktreeDirDesc")),
					)
					.child(Input::new(&app.inputs.worktree))
					.child(div().text_sm().child(app.t("initScript")))
					.child(
						div()
							.text_xs()
							.text_color(theme.muted_foreground)
							.child(app.t("initScriptDesc")),
					)
					.child(Input::new(&app.inputs.init_script))
					.child(div().text_sm().child(app.t("setupScript")))
					.child(
						div()
							.text_xs()
							.text_color(theme.muted_foreground)
							.child(app.t("setupScriptDesc")),
					)
					.child(Input::new(&app.inputs.setup_script))
					.child(div().text_sm().child(app.t("teardownScript")))
					.child(
						div()
							.text_xs()
							.text_color(theme.muted_foreground)
							.child(app.t("teardownScriptDesc")),
					)
					.child(Input::new(&app.inputs.teardown_script))
					.into_any_element()
			} else {
				let templates = app
					.data
					.workspaces
					.values()
					.find(|w| {
						Some(w.project_id.as_str()) == app.data.overlay.dialog_project.as_deref()
							|| Some(w.project_id.as_str()) == app.data.current_project.as_deref()
					})
					.map(|w| w.config.terminal_templates.clone())
					.unwrap_or_default();
				v_flex()
					.gap_2()
					.child(div().text_sm().child(app.t("projectTerminalTemplates")))
					.child(
						div()
							.text_xs()
							.text_color(theme.muted_foreground)
							.child(app.t("projectTerminalTemplatesDescription")),
					)
					.child(if templates.is_empty() {
						div()
							.p_2()
							.text_sm()
							.child(app.t("noTerminalTemplates"))
							.into_any_element()
					} else {
						v_flex()
							.gap_1()
							.children(templates.into_iter().map(|t| {
								let id = t.id.clone();
								h_flex()
									.id(crate::ui::eid(format!("ptpl-{id}")))
									.justify_between()
									.child(
										v_flex()
											.id(crate::ui::eid(format!("ptpl-edit-{id}")))
											.cursor(gpui::CursorStyle::PointingHand)
											.child(div().font_medium().text_sm().child(t.name.clone()))
											.child(
												div().text_xs().text_color(theme.muted_foreground).child(t.cwd.clone()),
											)
											.on_click({
												let view = view.clone();
												let id = id.clone();
												move |_, window, cx| {
													view.update(cx, |app, cx| {
														app.load_project_template(&id, window, cx);
														cx.notify();
													});
												}
											}),
									)
									.child(
										Button::new(crate::ui::eid(format!("ptpl-del-{id}")))
											.danger()
											.xsmall()
											.label(app.t("delete"))
											.tooltip(app.t("deleteTerminalTemplate"))
											.on_click({
												let view = view.clone();
												move |_, _, cx| {
													view.update(cx, |app, cx| {
														app.remove_project_template(&id);
														cx.notify();
													});
												}
											}),
									)
							}))
							.into_any_element()
					})
					.child(div().text_xs().child(app.t("terminalTemplateName")))
					.child(Input::new(&app.inputs.template_name))
					.child(div().text_xs().child(app.t("terminalTemplateCwd")))
					.child(
						div()
							.text_xs()
							.text_color(theme.muted_foreground)
							.child(app.t("terminalTemplateCwdDescription")),
					)
					.child(Input::new(&app.inputs.template_cwd))
					.child(div().text_xs().child(app.t("terminalTemplateCommands")))
					.child(
						div()
							.text_xs()
							.text_color(theme.muted_foreground)
							.child(app.t("terminalTemplateCommandsDescription")),
					)
					.child(Input::new(&app.inputs.template_commands))
					.child(
						Button::new("add-project-tpl")
							.xsmall()
							.primary()
							.label(if app.data.overlay.editing_template.is_some() {
								app.t("save")
							} else {
								app.t("addTerminalTemplate")
							})
							.on_click({
								let view = view.clone();
								move |_, _, cx| {
									view.update(cx, |app, cx| {
										app.add_project_template(cx);
										cx.notify();
									});
								}
							}),
					)
					.into_any_element()
			})
			.into_any_element(),
		DialogKind::CreateProfile => v_flex()
			.gap_2()
			.child(div().text_sm().child(app.t("branchName")))
			.child(Input::new(&app.inputs.profile_branch))
			.into_any_element(),
		DialogKind::DeleteProfile => v_flex()
			.gap_2()
			.child(div().text_sm().child(app.t("confirmDeleteProfile")))
			.when(app.data.overlay.dialog_busy, |el| {
				el.child(
					h_flex()
						.gap_2()
						.items_center()
						.child(Spinner::new().with_size(gpui_component::Size::Small))
						.child(div().text_xs().child(app.t("deleteProfileCheckingGitStatus"))),
				)
			})
			.when_some(app.data.overlay.delete_warning.clone(), |el, warn| {
				el.child(
					div()
						.p_2()
						.rounded_md()
						.bg(theme.warning)
						.child(div().font_semibold().child(app.t("deleteProfileGitWarningTitle")))
						.child(div().text_sm().child(warn)),
				)
			})
			.into_any_element(),
		DialogKind::CloseUnsaved => div()
			.text_sm()
			.child(crate::i18n::tf(
				app.data.locale,
				"closeUnsavedFileDescription",
				&[("file", app.data.overlay.dialog_file.as_deref().unwrap_or(""))],
			))
			.into_any_element(),
		DialogKind::SwitchBranch => {
			let q = app.inputs.branch_search.read(cx).value().to_string();
			let branches: Vec<_> = app
				.data
				.overlay
				.branches
				.iter()
				.filter(|b| q.is_empty() || b.name.to_ascii_lowercase().contains(&q.to_ascii_lowercase()))
				.cloned()
				.collect();
			v_flex()
				.gap_2()
				.child(Input::new(&app.inputs.branch_search))
				.child(if branches.is_empty() {
					div()
						.py_8()
						.text_sm()
						.text_color(theme.muted_foreground)
						.child(app.t("noBranchesFound"))
						.into_any_element()
				} else {
					v_flex()
						.max_h(px(384.))
						.gap_0()
						.children(
							branches
								.into_iter()
								.map(|b| leftover_branch_row(app, &b, theme.muted, theme.muted_foreground, &view)),
						)
						.into_any_element()
				})
				.into_any_element()
		}
		DialogKind::OpenLink => v_flex()
			.gap_2()
			.child(div().text_sm().child(app.t("terminalOpenLinkConfirmDescription")))
			.child(
				div()
					.text_xs()
					.text_color(theme.muted_foreground)
					.font_family("monospace")
					.child(app.t("terminalOpenLinkUrlLabel")),
			)
			.child(
				div()
					.font_family("monospace")
					.text_xs()
					.child(app.data.overlay.dialog_url.clone().unwrap_or_default()),
			)
			.child(
				div()
					.text_xs()
					.text_color(theme.muted_foreground)
					.child(app.t("browserOpenWith")),
			)
			.child(
				h_flex()
					.gap_1()
					.flex_wrap()
					.children(crate::platform::installed_browsers().into_iter().map(|browser| {
						let cmd = browser.command;
						Button::new(crate::ui::eid(format!("open-with-{cmd}")))
							.xsmall()
							.label(browser.id)
							.on_click({
								let view = view.clone();
								move |_, _, cx| {
									view.update(cx, |app, cx| {
										app.open_url_with(cmd);
										cx.notify();
									});
								}
							})
					})),
			)
			.into_any_element(),
		DialogKind::ChooseFile => v_flex()
			.gap_2()
			.child(div().text_sm().child(app.t("terminalChooseFilePathDescription")))
			.children(app.data.overlay.fuzzy_files.iter().map(|f| {
				let path = f.path.clone();
				div()
					.id(crate::ui::eid(format!("fuzzy-{path}")))
					.px_2()
					.py_1()
					.on_click({
						let view = view.clone();
						let path = path.clone();
						move |_, window, cx| {
							view.update(cx, |app, cx| {
								if let Some(pid) = app.data.current_profile.clone() {
									app.open_file(&pid, &path, window, cx);
								}
								app.data.overlay.dialog = None;
								cx.notify();
							});
						}
					})
					.child(f.name.clone())
			}))
			.into_any_element(),
		DialogKind::EditTemplate => v_flex()
			.gap_2()
			.child(Input::new(&app.inputs.template_name))
			.child(Input::new(&app.inputs.template_shell))
			.child(Input::new(&app.inputs.template_cwd))
			.child(Input::new(&app.inputs.template_commands))
			.into_any_element(),
		DialogKind::ReviewQueue => review_queue_body(app, theme.muted_foreground, cx).into_any_element(),
		DialogKind::DebugLog => crate::ui::debug::render_panel(app, _window, cx).into_any_element(),
		DialogKind::CreateGroup => v_flex()
			.gap_2()
			.child(div().text_sm().child(app.t("projectGroupName")))
			.child(Input::new(&app.inputs.group_name))
			.into_any_element(),
	}
}

fn review_queue_body(app: &AppView, muted: gpui::Hsla, cx: &mut Context<AppView>) -> impl IntoElement {
	let view = cx.entity();
	let theme = cx.theme().clone();
	let editing = app.data.overlay.review_edit_id.clone();
	v_flex()
		.id("review-queue")
		.gap_3()
		.max_h(px(480.))
		.children(app.data.overlay.review_comments.iter().cloned().map(|comment| {
			let id = comment.id.clone();
			let editing_this = editing.as_deref() == Some(id.as_str());
			v_flex()
				.id(crate::ui::eid(format!("review-card-{id}")))
				.gap_2()
				.rounded_lg()
				.border_1()
				.border_color(theme.border)
				.child(
					h_flex()
						.px_3()
						.py_2()
						.gap_2()
						.border_b_1()
						.border_color(theme.border)
						.bg(theme.muted)
						.child(
							v_flex()
								.flex_1()
								.min_w_0()
								.gap_1()
								.child(
									div()
										.font_family("monospace")
										.font_semibold()
										.text_sm()
										.child(comment.display_name.clone()),
								)
								.child(
									h_flex()
										.gap_2()
										.child(
											div()
												.px_1()
												.text_xs()
												.font_family("monospace")
												.rounded_md()
												.bg(gpui::hsla(0.58, 0.4, 0.5, 0.18))
												.child(crate::review::format_review_range(comment.range)),
										)
										.child(div().text_xs().text_color(muted).child("Selected diff")),
								),
						)
						.child(
							Button::new(crate::ui::eid(format!("review-del-{id}")))
								.ghost()
								.xsmall()
								.icon(IconName::Close)
								.tooltip("Delete review comment".to_string())
								.on_click({
									let view = view.clone();
									let id = id.clone();
									move |_, _, cx| {
										view.update(cx, |app, cx| {
											app.delete_review_comment(&id);
											cx.notify();
										});
									}
								}),
						),
				)
				.child(
					div()
						.mx_3()
						.max_h(px(128.))
						.overflow_hidden()
						.rounded_md()
						.border_1()
						.border_color(theme.border)
						.p_2()
						.font_family("monospace")
						.text_xs()
						.child(if comment.selected_text.is_empty() {
							"(no selected text available)".to_string()
						} else {
							comment.selected_text.clone()
						}),
				)
				.child(
					div()
						.px_3()
						.text_xs()
						.font_semibold()
						.text_color(muted)
						.child("Comment"),
				)
				.child(if editing_this {
					div()
						.px_3()
						.pb_3()
						.child(Input::new(&app.inputs.review_comment))
						.into_any_element()
				} else {
					div()
						.id(crate::ui::eid(format!("review-body-{id}")))
						.px_3()
						.pb_3()
						.text_sm()
						.cursor(gpui::CursorStyle::PointingHand)
						.on_click({
							let view = view.clone();
							let id = id.clone();
							move |_, window, cx| {
								view.update(cx, |app, cx| {
									app.begin_review_edit(&id, window, cx);
									cx.notify();
								});
							}
						})
						.child(if comment.body.is_empty() {
							" ".to_string()
						} else {
							comment.body
						})
						.into_any_element()
				})
		}))
		.when(app.data.overlay.review_comments.is_empty(), |el| {
			el.child(div().text_color(muted).child("—"))
		})
}

fn leftover_chip(text: &str, fg: gpui::Hsla, bg: gpui::Hsla, border: gpui::Hsla) -> impl IntoElement {
	div()
		.h(px(16.))
		.px(px(6.))
		.rounded_sm()
		.border_1()
		.border_color(border)
		.bg(bg)
		.text_color(fg)
		.text_xs()
		.child(text.to_string())
}

fn leftover_branch_row(
	app: &AppView,
	branch: &model::project::GitBranchInfo,
	muted: gpui::Hsla,
	muted_fg: gpui::Hsla,
	view: &gpui::Entity<AppView>,
) -> impl IntoElement {
	let name = branch.name.clone();
	let disabled = branch.is_current || branch.is_used;
	let amber = gpui::hsla(38. / 360., 0.92, 0.50, 1.);
	h_flex()
		.id(crate::ui::eid(format!("br-{name}")))
		.w_full()
		.min_w_0()
		.px_3()
		.py_2()
		.gap_2()
		.rounded_md()
		.when(branch.is_current, |el| el.bg(muted))
		.when(disabled && !branch.is_current, |el| el.opacity(0.6))
		.hover(|el| el.bg(muted))
		.on_click({
			let view = view.clone();
			let name = name.clone();
			move |_, _, cx| {
				if disabled {
					return;
				}
				view.update(cx, |app, cx| {
					app.checkout_branch(&name);
					cx.notify();
				});
			}
		})
		.child(crate::ui::leftover_branch_glyph(muted_fg))
		.child(
			div()
				.min_w_0()
				.flex_1()
				.text_sm()
				.overflow_hidden()
				.when(branch.is_current, |el| el.font_medium())
				.child(name),
		)
		.when(branch.is_current, |el| {
			el.child(leftover_chip(&app.t("branchCurrentLabel"), muted_fg, muted, muted))
		})
		.when(branch.is_trunk, |el| {
			el.child(leftover_chip(
				&app.t("branchTrunkLabel"),
				muted_fg,
				gpui::hsla(0., 0., 0., 0.),
				muted_fg.opacity(0.3),
			))
		})
		.when(branch.is_used, |el| {
			el.child(leftover_chip(
				&app.t("branchUsedLabel"),
				amber,
				amber.opacity(0.1),
				amber.opacity(0.3),
			))
		})
		.when(!branch.is_current && (branch.ahead > 0 || branch.behind > 0), |el| {
			el.child(
				h_flex()
					.flex_none()
					.gap_1()
					.font_family("monospace")
					.text_xs()
					.when(branch.ahead > 0, |row| {
						row.child(
							div()
								.text_color(gpui::hsla(0.38, 0.7, 0.45, 1.))
								.child(format!("↑{}", branch.ahead)),
						)
					})
					.when(branch.behind > 0, |row| {
						row.child(
							div()
								.text_color(gpui::hsla(0.02, 0.75, 0.5, 1.))
								.child(format!("↓{}", branch.behind)),
						)
					}),
			)
		})
}

fn dialog_footer(app: &AppView, kind: DialogKind, cx: &mut Context<AppView>) -> impl IntoElement {
	let view = cx.entity();
	let danger = matches!(
		kind,
		DialogKind::DeleteProject | DialogKind::DeleteProfile | DialogKind::CloseUnsaved
	);
	let ok = match kind {
		DialogKind::CreateProject => app.t("create"),
		DialogKind::DeleteProject => app.t("delete"),
		DialogKind::RenameProject => app.t("rename"),
		DialogKind::ProjectSettings => app.t("save"),
		DialogKind::CreateProfile => app.t("create"),
		DialogKind::DeleteProfile => {
			if app.data.overlay.delete_warning.is_some() {
				app.t("deleteProfileAnyway")
			} else {
				app.t("delete")
			}
		}
		DialogKind::CloseUnsaved => app.t("discardChanges"),
		DialogKind::OpenLink => app.t("browserOpenDefault"),
		DialogKind::CreateGroup => app.t("create"),
		DialogKind::EditTemplate => app.t("save"),
		_ => app.t("cancel"),
	};
	let show_ok = !matches!(
		kind,
		DialogKind::SwitchBranch | DialogKind::DebugLog | DialogKind::ChooseFile | DialogKind::ReviewQueue
	);
	let review_empty = app.data.overlay.review_comments.is_empty();

	h_flex()
		.justify_end()
		.gap_2()
		.when(
			kind != DialogKind::ReviewQueue && kind != DialogKind::SwitchBranch,
			|el| {
				el.child(Button::new("dlg-cancel").small().label(app.t("cancel")).on_click({
					let view = view.clone();
					move |_, _, cx| {
						view.update(cx, |app, cx| {
							app.data.overlay.dialog = None;
							cx.notify();
						});
					}
				}))
			},
		)
		.when(kind == DialogKind::ReviewQueue, |el| {
			el.child(
				Button::new("dlg-copy")
					.small()
					.label("Copy".to_string())
					.disabled(review_empty)
					.on_click({
						let view = view.clone();
						move |_, window, cx| {
							view.update(cx, |app, cx| {
								app.copy_review_comments(false, window, cx);
								cx.notify();
							});
						}
					}),
			)
			.child(
				Button::new("dlg-copy-clear")
					.small()
					.danger()
					.label("Copy and clear all".to_string())
					.disabled(review_empty)
					.on_click({
						let view = view.clone();
						move |_, window, cx| {
							view.update(cx, |app, cx| {
								app.copy_review_comments(true, window, cx);
								cx.notify();
							});
						}
					}),
			)
		})
		.when(app.data.overlay.dialog_busy && show_ok, |el| {
			el.child(Spinner::new().with_size(gpui_component::Size::Small))
		})
		.when(show_ok, |el| {
			el.child(
				Button::new("dlg-ok")
					.small()
					.when(danger, |b| b.danger())
					.when(!danger, |b| b.primary())
					.label(ok)
					.disabled(
						(matches!(kind, DialogKind::CreateProject)
							&& (app.data.overlay.dialog_folder.is_none() || app.data.overlay.dialog_busy))
							|| (app.data.overlay.dialog_busy
								&& matches!(
									kind,
									DialogKind::DeleteProject
										| DialogKind::DeleteProfile | DialogKind::ProjectSettings
										| DialogKind::CreateProfile
								)),
					)
					.on_click({
						let view = view.clone();
						move |_, window, cx| {
							view.update(cx, |app, cx| {
								match kind {
									DialogKind::CreateProject => app.create_project_from_dialog(window, cx),
									DialogKind::DeleteProject => app.delete_current_dialog_project(),
									DialogKind::RenameProject => app.rename_dialog_project(cx),
									DialogKind::ProjectSettings => app.save_project_settings(cx),
									DialogKind::CreateProfile => app.create_profile_from_dialog(cx),
									DialogKind::DeleteProfile => app.delete_dialog_profile(),
									DialogKind::EditTemplate => app.save_editing_template(cx),
									DialogKind::CloseUnsaved => {
										if let (Some(pid), Some(path)) = (
											app.data.current_profile.clone(),
											app.data.overlay.pending_close_file.clone(),
										) {
											app.close_file(&pid, &path);
										}
										app.data.overlay.dialog = None;
									}
									DialogKind::OpenLink => {
										app.open_url_with("");
									}
									DialogKind::CreateGroup => {
										app.submit_create_group(None, cx);
									}
									_ => app.data.overlay.dialog = None,
								}
								cx.notify();
							});
						}
					}),
			)
		})
}

fn context_menu(app: &AppView, cx: &mut Context<AppView>) -> impl IntoElement {
	let Some((menu, x, y)) = app.data.overlay.context_menu.clone() else {
		return div().id("no-ctx").into_any_element();
	};
	let theme = cx.theme().clone();
	let view = cx.entity();
	let items = menu_items(app, &menu);

	div()
		.id("ctx-mask")
		.absolute()
		.inset_0()
		.on_click({
			let view = view.clone();
			move |_, _, cx| {
				view.update(cx, |app, cx| {
					app.data.overlay.context_menu = None;
					app.data.overlay.group_menu_creating = false;
					cx.notify();
				});
			}
		})
		.child(
			v_flex()
				.id("ctx-menu")
				.absolute()
				.left(px(x))
				.top(px(y))
				.min_w(px(224.))
				.py_1()
				.rounded_lg()
				.bg(theme.background)
				.border_1()
				.border_color(theme.border)
				.shadow_md()
				.on_click(|_, _, _| {})
				.children(items.into_iter().map(|item| {
					if item.input {
						return div()
							.id(crate::ui::eid(item.id.clone()))
							.px_2()
							.py_1()
							.child(Input::new(&app.inputs.group_name))
							.into_any_element();
					}
					let muted = item.muted || item.header;
					let disabled = item.disabled;
					let keep_open = item.keep_open || item.header || item.muted || item.disabled;
					div()
						.id(crate::ui::eid(item.id.clone()))
						.px_3()
						.py_1()
						.text_sm()
						.when(item.danger, |el| el.text_color(theme.danger))
						.when(muted, |el| el.text_color(theme.muted_foreground))
						.when(item.disabled, |el| el.opacity(0.55))
						.when(!muted && !disabled, |el| el.hover(|el| el.bg(theme.muted)))
						.on_click({
							let view = view.clone();
							let menu = menu.clone();
							let action = item.action.clone();
							move |_, window, cx| {
								if disabled {
									return;
								}
								view.update(cx, |app, cx| {
									run_menu(app, &menu, action.clone(), window, cx);
									if !keep_open {
										app.data.overlay.context_menu = None;
										app.data.overlay.group_menu_creating = false;
									}
									cx.notify();
								});
							}
						})
						.child(if item.checked || matches!(item.action, MenuAction::AssignGroup(_)) {
							h_flex()
								.gap_2()
								.child(div().w(px(12.)).child(if item.checked { "✓" } else { "" }))
								.child(item.label)
								.into_any_element()
						} else {
							div().child(item.label).into_any_element()
						})
						.into_any_element()
				})),
		)
		.into_any_element()
}

#[derive(Clone)]
enum MenuAction {
	AssignGroup(String),
	StartCreateGroup,
	SubmitCreateGroup,
	RemoveGroup,
	ProjectSettings,
	Rename,
	DeleteProject,
	DeleteProfile,
	Open,
	OpenDefault,
	Reveal,
	Refresh,
	NewFile,
	NewFolder,
	RenamePath,
	CopyRel,
	CopyAbs,
	DeletePath,
	Template(usize),
	ProjectTemplate(usize),
	NewTerm,
	Header,
	DiscardGitFile,
}

struct MenuItem {
	id: String,
	label: String,
	danger: bool,
	disabled: bool,
	checked: bool,
	muted: bool,
	header: bool,
	keep_open: bool,
	input: bool,
	action: MenuAction,
}

fn item(id: impl Into<String>, label: impl Into<String>, action: MenuAction) -> MenuItem {
	MenuItem {
		id: id.into(),
		label: label.into(),
		danger: false,
		disabled: false,
		checked: false,
		muted: false,
		header: false,
		keep_open: false,
		input: false,
		action,
	}
}

fn danger(mut item: MenuItem) -> MenuItem {
	item.danger = true;
	item
}

fn header(id: impl Into<String>, label: impl Into<String>) -> MenuItem {
	let mut item = item(id, label, MenuAction::Header);
	item.header = true;
	item.muted = true;
	item
}

fn project_menu_items(app: &AppView, project_id: &str) -> Vec<MenuItem> {
	let current = app
		.data
		.projects
		.iter()
		.find(|p| p.id == project_id)
		.and_then(|p| p.group_id.clone());
	let groups: Vec<(String, String)> = app.data.groups.iter().map(|g| (g.id.clone(), g.name.clone())).collect();
	let rows = project_group_menu_rows(&groups, current.as_deref(), app.data.overlay.group_menu_creating);
	let mut items = vec![header("add-group-h", app.t("addToProjectGroup"))];
	for row in rows {
		match row {
			GroupMenuRow::Empty => {
				let mut empty = item("no-groups", app.t("noProjectGroups"), MenuAction::Header);
				empty.muted = true;
				items.push(empty);
			}
			GroupMenuRow::Group { id, name, current } => {
				let mut row = item(format!("grp-{id}"), name, MenuAction::AssignGroup(id));
				row.checked = current;
				row.disabled = current;
				items.push(row);
			}
			GroupMenuRow::Remove => items.push(item(
				"remove-group",
				app.t("removeFromProjectGroup"),
				MenuAction::RemoveGroup,
			)),
			GroupMenuRow::Create => {
				let mut create = item(
					"create-group",
					app.t("createProjectGroup"),
					MenuAction::StartCreateGroup,
				);
				create.keep_open = true;
				items.push(create);
			}
			GroupMenuRow::CreateInput => {
				items.push(MenuItem {
					id: "create-group-input".into(),
					label: String::new(),
					danger: false,
					disabled: false,
					checked: false,
					muted: false,
					header: false,
					keep_open: true,
					input: true,
					action: MenuAction::SubmitCreateGroup,
				});
			}
		}
	}
	items.push(item(
		"proj-settings",
		app.t("projectSettings"),
		MenuAction::ProjectSettings,
	));
	items.push(item("rename-proj", app.t("renameProject"), MenuAction::Rename));
	items.push(danger(item(
		"del-proj",
		app.t("deleteProject"),
		MenuAction::DeleteProject,
	)));
	items
}

fn menu_items(app: &AppView, menu: &ContextMenu) -> Vec<MenuItem> {
	match menu {
		ContextMenu::Project { id } => project_menu_items(app, id),
		ContextMenu::Profile { .. } => vec![danger(item(
			"del-prof",
			app.t("deleteProfile"),
			MenuAction::DeleteProfile,
		))],
		ContextMenu::GitFile { .. } => vec![danger(item(
			"discard-git-file",
			app.t("gitDiscardFileAction"),
			MenuAction::DiscardGitFile,
		))],
		ContextMenu::File { .. } => vec![
			item("open", app.t("fileTreeContextMenuOpen"), MenuAction::Open),
			item(
				"open-default",
				app.t("fileTreeContextMenuOpenInDefaultApp"),
				MenuAction::OpenDefault,
			),
			item(
				"reveal",
				app.t("fileTreeContextMenuRevealInFileManager"),
				MenuAction::Reveal,
			),
			item("refresh", app.t("fileTreeContextMenuRefresh"), MenuAction::Refresh),
			item("new-file", app.t("fileTreeContextMenuNewFile"), MenuAction::NewFile),
			item(
				"new-folder",
				app.t("fileTreeContextMenuNewFolder"),
				MenuAction::NewFolder,
			),
			item("rename-path", app.t("rename"), MenuAction::RenamePath),
			item(
				"copy-rel",
				app.t("fileTreeContextMenuCopyRelativePath"),
				MenuAction::CopyRel,
			),
			item(
				"copy-abs",
				app.t("fileTreeContextMenuCopyAbsolutePath"),
				MenuAction::CopyAbs,
			),
			danger(item("del-path", app.t("delete"), MenuAction::DeletePath)),
		],
		ContextMenu::TreeBlank => vec![
			item(
				"blank-new-file",
				app.t("fileTreeContextMenuNewFile"),
				MenuAction::NewFile,
			),
			item(
				"blank-new-folder",
				app.t("fileTreeContextMenuNewFolder"),
				MenuAction::NewFolder,
			),
			item(
				"blank-refresh",
				app.t("fileTreeContextMenuRefresh"),
				MenuAction::Refresh,
			),
			item(
				"blank-reveal",
				app.t("fileTreeContextMenuRevealInFileManager"),
				MenuAction::Reveal,
			),
			item(
				"blank-copy-rel",
				app.t("fileTreeContextMenuCopyRelativePath"),
				MenuAction::CopyRel,
			),
			item(
				"blank-copy-abs",
				app.t("fileTreeContextMenuCopyAbsolutePath"),
				MenuAction::CopyAbs,
			),
		],
		ContextMenu::NewTerminal => {
			let mut items = vec![item("new-term", app.t("newTerminal"), MenuAction::NewTerm)];
			let project = app
				.data
				.current_ws()
				.map(|w| w.config.terminal_templates.clone())
				.unwrap_or_default();
			if !project.is_empty() {
				items.push(header("proj-templates", app.t("projectTerminalTemplates")));
				for (i, t) in project.iter().enumerate() {
					let label = if t.cwd.is_empty() {
						t.name.clone()
					} else {
						format!("{name} — {cwd}", name = t.name, cwd = t.cwd)
					};
					items.push(item(format!("pt-{i}"), label, MenuAction::ProjectTemplate(i)));
				}
			}
			if !app.data.prefs.templates.is_empty() {
				items.push(header("global-templates", app.t("globalTerminalTemplates")));
				for (i, t) in app.data.prefs.templates.iter().enumerate() {
					items.push(item(format!("gt-{i}"), t.name.clone(), MenuAction::Template(i)));
				}
			}
			if project.is_empty() && app.data.prefs.templates.is_empty() {
				items.push(header("no-tpl", app.t("noTerminalTemplates")));
				let mut hint = item("no-tpl-hint", app.t("noTemplatesDropdownHint"), MenuAction::Header);
				hint.muted = true;
				items.push(hint);
			}
			items
		}
	}
}

fn run_menu(app: &mut AppView, menu: &ContextMenu, action: MenuAction, window: &mut Window, cx: &mut Context<AppView>) {
	match (menu, action) {
		(ContextMenu::Project { id }, MenuAction::DeleteProject) => {
			app.data.overlay.dialog = Some(DialogKind::DeleteProject);
			app.data.overlay.dialog_project = Some(id.clone());
		}
		(ContextMenu::Project { id }, MenuAction::Rename) => {
			app.data.overlay.dialog = Some(DialogKind::RenameProject);
			app.data.overlay.dialog_project = Some(id.clone());
			if let Some(p) = app.data.project(id) {
				app.inputs.rename.update(cx, |s, cx| {
					s.set_value(p.name.clone(), window, cx);
				});
			}
		}
		(ContextMenu::Project { id }, MenuAction::ProjectSettings) => {
			app.data.overlay.dialog = Some(DialogKind::ProjectSettings);
			app.data.overlay.dialog_project = Some(id.clone());
		}
		(ContextMenu::Project { id }, MenuAction::StartCreateGroup) => {
			app.data.overlay.group_menu_creating = true;
			app.data.overlay.dialog_project = Some(id.clone());
		}
		(ContextMenu::Project { id }, MenuAction::SubmitCreateGroup) => {
			app.submit_create_group(Some(id), cx);
		}
		(ContextMenu::Project { id }, MenuAction::AssignGroup(group_id)) => {
			app.assign_project_to_group(id, Some(group_id));
		}
		(ContextMenu::Project { id }, MenuAction::RemoveGroup) => {
			app.assign_project_to_group(id, None);
		}
		(ContextMenu::Profile { id, .. }, MenuAction::DeleteProfile) => {
			app.prepare_delete_profile(id);
		}
		(ContextMenu::GitFile { path }, MenuAction::DiscardGitFile) => {
			app.discard_file(path);
		}
		(ContextMenu::File { path }, MenuAction::Open) => {
			if let Some(pid) = app.data.current_profile.clone() {
				if crate::app::git_status_kind(
					&app.data
						.workspaces
						.get(&pid)
						.and_then(|w| w.git_files.iter().find(|(p, _)| p == path).map(|(_, s)| s.clone()))
						.unwrap_or_default(),
				) != crate::app::GitStatusKind::Deleted
				{
					app.open_file(&pid, path, window, cx);
				}
			}
		}
		(ContextMenu::File { path }, MenuAction::OpenDefault) => app.open_external(path),
		(ContextMenu::File { path }, MenuAction::Reveal) => app.reveal(Some(path)),
		(_, MenuAction::Reveal) => app.reveal(None),
		(_, MenuAction::Refresh) => {
			if let Some(pid) = app.data.current_profile.clone() {
				app.load_tree_root(&pid);
			}
		}
		(ContextMenu::File { path }, MenuAction::RenamePath) => {
			app.start_rename_path(path, window, cx);
		}
		(ContextMenu::File { path }, MenuAction::NewFile) => {
			let parent = app
				.data
				.current_ws()
				.and_then(|w| crate::app::create_target_directory(&w.tree, Some(path)));
			app.create_path(false, parent.as_deref(), window, cx)
		}
		(ContextMenu::File { path }, MenuAction::NewFolder) => {
			let parent = app
				.data
				.current_ws()
				.and_then(|w| crate::app::create_target_directory(&w.tree, Some(path)));
			app.create_path(true, parent.as_deref(), window, cx)
		}
		(_, MenuAction::NewFile) => app.create_path(false, None, window, cx),
		(_, MenuAction::NewFolder) => app.create_path(true, None, window, cx),
		(ContextMenu::File { path }, MenuAction::CopyRel) => app.copy_path(path, false, cx),
		(ContextMenu::File { path }, MenuAction::CopyAbs) => app.copy_path(path, true, cx),
		(ContextMenu::TreeBlank, MenuAction::CopyRel) => app.copy_path(".", false, cx),
		(ContextMenu::TreeBlank, MenuAction::CopyAbs) => app.copy_path(".", true, cx),
		(ContextMenu::File { path }, MenuAction::DeletePath) => {
			let paths = app
				.data
				.current_ws()
				.map(|w| crate::app::context_action_paths(&w.tree_selected, path))
				.unwrap_or_else(|| vec![path.clone()]);
			app.delete_tree_paths(&paths);
		}
		(_, MenuAction::NewTerm) => app.create_terminal(&app.t("newTerminal"), "", Vec::new()),
		(_, MenuAction::Template(i)) => {
			if let Some(t) = app.data.prefs.templates.get(i).cloned() {
				app.create_terminal(&t.name, &t.cwd, t.commands);
			}
		}
		(_, MenuAction::Header) => {}
		(_, MenuAction::ProjectTemplate(i)) => {
			if let Some(t) = app
				.data
				.current_ws()
				.and_then(|w| w.config.terminal_templates.get(i).cloned())
			{
				app.create_terminal(&t.name, &t.cwd, t.commands);
			}
		}
		_ => {}
	}
}
