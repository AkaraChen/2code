use gpui::{div, img, prelude::*, px, Context, KeyDownEvent, MouseButton, Window};
use gpui_component::button::{Button, ButtonVariants};
use gpui_component::{h_flex, v_flex, ActiveTheme, Icon, IconName, Sizable, StyledExt};
use gpui_component::{Disableable, Selectable};

use crate::app::AppView;
use crate::backend;
use crate::state::{AgentStatus, ContextMenu, DialogKind, Route, SidebarNavItem};
use crate::ui::settings;

#[derive(Clone)]
struct SidebarDrag {
	id: String,
	name: String,
}

pub fn render(app: &mut AppView, window: &mut Window, cx: &mut Context<AppView>) -> impl IntoElement {
	if app.data.prefs.sidebar_collapsed {
		return div().id("app-sidebar-collapsed").into_any_element();
	}

	let theme = cx.theme().clone();
	let width = app.data.prefs.sidebar_width.clamp(220.0, 420.0);
	let view = cx.entity();
	let has_projects = !app.data.projects.is_empty();
	let pad_top = if cfg!(target_os = "macos") { px(32.) } else { px(8.) };

	div()
		.id("app-sidebar-wrap")
		.relative()
		.h_full()
		.child(onboarding_popover(app, width, cx))
		.child(
			v_flex()
				.id("app-sidebar")
				.w(px(width))
				.h_full()
				.bg(theme.sidebar)
				.border_r_1()
				.border_color(theme.border)
				.tab_index(0)
				.on_key_down({
					let view = view.clone();
					move |ev: &KeyDownEvent, _, cx| {
						view.update(cx, |app, cx| {
							if app.handle_sidebar_key(ev.keystroke.key.as_str()) {
								cx.notify();
							}
						});
					}
				})
				.child(
					h_flex()
						.id("sidebar-header")
						.w_full()
						.pt(pad_top)
						.px_3()
						.pb_2()
						.justify_between()
						.child(div().font_semibold().text_sm().child("2Code"))
						.child(
							Button::new("collapse-sidebar")
								.ghost()
								.xsmall()
								.icon(IconName::PanelLeftClose)
								.tooltip(app.t("collapseSidebar"))
								.on_click({
									let view = view.clone();
									move |_, _, cx| {
										view.update(cx, |app, cx| {
											app.data.prefs.sidebar_collapsed = true;
											app.persist_prefs();
											cx.notify();
										});
									}
								}),
						),
				)
				.child(
					v_flex()
						.id("sidebar-content")
						.flex_1()
						.min_h_0()
						.px_2()
						.py_1()
						.gap_1()
						.overflow_hidden()
						.when(!has_projects, |el| {
							el.child(nav_row(
								"home-row",
								IconName::Inbox,
								app.t("home"),
								app.data.route == Route::Home
									|| app.data.overlay.sidebar_nav == Some(SidebarNavItem::Home),
								{
									let view = view.clone();
									move |cx| {
										view.update(cx, |app, cx| {
											app.data.route = Route::Home;
											cx.notify();
										});
									}
								},
							))
						})
						.when_some(app.data.sidebar_error.clone(), |el, err| {
							el.child(
								v_flex()
									.p_4()
									.gap_2()
									.child(
										div()
											.text_color(theme.danger)
											.font_semibold()
											.child(app.t("somethingWentWrong")),
									)
									.child(div().text_xs().child(err))
									.child(
										Button::new("sidebar-retry")
											.xsmall()
											.label(app.t("tryAgain"))
											.on_click({
												let view = view.clone();
												move |_, _, cx| {
													view.update(cx, |app, cx| {
														app.reload_projects();
														cx.notify();
													});
												}
											}),
									),
							)
						})
						.child(project_sections(app, window, cx)),
				)
				.child(
					h_flex()
						.id("sidebar-footer")
						.w_full()
						.px_2()
						.py_2()
						.border_t_1()
						.border_color(theme.border)
						.child(
							Button::new("open-settings")
								.ghost()
								.small()
								.icon(IconName::Settings)
								.label(app.t("settings"))
								.on_click({
									let view = view.clone();
									move |_, window, cx| {
										view.update(cx, |app, cx| {
											settings::open_settings_window(app, window, cx);
										});
									}
								}),
						),
				),
		)
		.child(resize_handle(
			"app-sidebar-resize",
			view,
			false,
			app.data.overlay.sidebar_resize_focus == Some(false),
		))
		.into_any_element()
}

fn drop_zone(
	id: impl Into<gpui::SharedString>,
	label: String,
	border: gpui::Hsla,
	muted: gpui::Hsla,
	on_drop: impl Fn(&SidebarDrag, &mut gpui::App) + 'static,
) -> impl IntoElement {
	div()
		.id(id.into())
		.mt_2()
		.px_2()
		.py_3()
		.rounded_md()
		.border_1()
		.border_dashed()
		.border_color(border)
		.text_xs()
		.text_color(muted)
		.child(label)
		.on_drop(move |drag: &SidebarDrag, _, cx| on_drop(drag, cx))
}

pub(crate) fn resize_handle(
	id: &'static str,
	view: gpui::Entity<AppView>,
	profile: bool,
	focused: bool,
) -> impl IntoElement {
	div()
		.id(id)
		.absolute()
		.top_0()
		.right_0()
		.w(px(8.))
		.h_full()
		.tab_index(0)
		.cursor(gpui::CursorStyle::ResizeColumn)
		.when(focused, |el| el.bg(gpui::hsla(0., 0., 0.5, 0.3)))
		.on_mouse_down(MouseButton::Left, {
			let view = view.clone();
			move |ev, _, cx| {
				view.update(cx, |app, cx| {
					let start = f32::from(ev.position.x);
					app.data.overlay.sidebar_resize_focus = Some(profile);
					if profile {
						app.data.overlay.profile_sidebar_drag = Some((start, app.data.prefs.profile_sidebar_width));
					} else {
						app.data.overlay.sidebar_drag = Some((start, app.data.prefs.sidebar_width));
					}
					cx.notify();
				});
			}
		})
		.on_key_down({
			let view = view.clone();
			move |ev: &KeyDownEvent, _, cx| {
				view.update(cx, |app, cx| {
					if app.nudge_sidebar(profile, ev.keystroke.key.as_str()) {
						cx.notify();
					}
				});
			}
		})
}

fn project_sections(app: &mut AppView, _window: &mut Window, cx: &mut Context<AppView>) -> impl IntoElement {
	let view = cx.entity();
	let theme = cx.theme().clone();
	let pinned: Vec<_> = app
		.data
		.projects
		.iter()
		.filter(|p| p.pinned_at.is_some())
		.cloned()
		.collect();
	let ungrouped: Vec<_> = app
		.data
		.projects
		.iter()
		.filter(|p| p.pinned_at.is_none() && p.group_id.is_none())
		.cloned()
		.collect();
	let groups = app.data.groups.clone();

	v_flex()
		.w_full()
		.gap_2()
		.when(!pinned.is_empty() || app.data.overlay.sort_mode, |el| {
			el.child(section_label(&app.t("pinnedProjects")))
				.child(
					v_flex()
						.gap_1()
						.children(pinned.into_iter().map(|p| project_row(app, &p, cx))),
				)
				.when(app.data.overlay.sort_mode, |el| {
					el.child(drop_zone(
						"sidebar-drop-pin",
						app.t("dropHereToPin"),
						theme.border,
						theme.muted_foreground,
						{
							let view = view.clone();
							move |drag: &SidebarDrag, cx| {
								view.update(cx, |app, cx| {
									app.set_project_pinned(&drag.id, true);
									cx.notify();
								});
							}
						},
					))
				})
		})
		.child(
			h_flex()
				.w_full()
				.justify_between()
				.px_1()
				.child(section_label(&app.t("sidebarProjectsSection")))
				.child(
					h_flex()
						.gap_1()
						.child(
							Button::new("sort-mode")
								.ghost()
								.xsmall()
								.icon(if app.data.overlay.sort_mode {
									IconName::Check
								} else {
									IconName::Replace
								})
								.tooltip(if app.data.overlay.sort_mode {
									app.t("doneEditingProjectOrder")
								} else {
									app.t("editProjectOrder")
								})
								.on_click({
									let view = view.clone();
									move |_, _, cx| {
										view.update(cx, |app, cx| {
											app.data.overlay.sort_mode = !app.data.overlay.sort_mode;
											cx.notify();
										});
									}
								}),
						)
						.child(
							Button::new("add-project-button")
								.ghost()
								.xsmall()
								.icon(IconName::Plus)
								.tooltip(app.t("newProject"))
								.on_click({
									let view = view.clone();
									move |_, _, cx| {
										view.update(cx, |app, cx| {
											app.data.overlay.dialog = Some(DialogKind::CreateProject);
											app.data.overlay.dialog_folder = None;
											app.data.overlay.dialog_error = None;
											app.data.overlay.onboarding = false;
											cx.notify();
										});
									}
								}),
						),
				),
		)
		.child(
			v_flex()
				.gap_1()
				.children(groups.into_iter().map(|group| {
					let collapsed = app.data.prefs.collapsed_groups.contains(&group.id);
					let members: Vec<_> = app
						.data
						.projects
						.iter()
						.filter(|p| p.group_id.as_deref() == Some(group.id.as_str()) && p.pinned_at.is_none())
						.cloned()
						.collect();
					let count = members.len();
					let gid = group.id.clone();
					v_flex()
						.id(crate::ui::eid(format!("group-{}", group.id)))
						.child(
							h_flex()
								.id(crate::ui::eid(format!("group-h-{}", group.id)))
								.px_2()
								.py_1()
								.rounded_md()
								.gap_2()
								.hover(|el| el.bg(theme.sidebar_accent))
								.on_click({
									let view = view.clone();
									let gid = gid.clone();
									move |_, _, cx| {
										view.update(cx, |app, cx| {
											if app.data.overlay.sort_mode {
												return;
											}
											if let Some(ix) =
												app.data.prefs.collapsed_groups.iter().position(|x| x == &gid)
											{
												app.data.prefs.collapsed_groups.remove(ix);
											} else {
												app.data.prefs.collapsed_groups.push(gid.clone());
											}
											app.persist_prefs();
											cx.notify();
										});
									}
								})
								.when(app.data.overlay.sort_mode, |el| {
									el.on_drop({
										let view = view.clone();
										let gid = gid.clone();
										move |drag: &SidebarDrag, _, cx| {
											view.update(cx, |app, cx| {
												app.assign_project_to_group(&drag.id, Some(gid.clone()));
												cx.notify();
											});
										}
									})
								})
								.when(app.data.overlay.sort_mode, |el| {
									el.child(div().text_xs().text_color(theme.muted_foreground).child("⠿"))
								})
								.child(
									Icon::new(if collapsed {
										IconName::ChevronRight
									} else {
										IconName::ChevronDown
									})
									.w(px(12.)),
								)
								.child(
									Button::new(crate::ui::eid(format!("group-toggle-{}", group.id)))
										.ghost()
										.small()
										.label(group.name.clone())
										.tooltip(crate::i18n::tf(
											app.data.locale,
											"toggleProjectGroup",
											&[("name", &group.name)],
										))
										.on_click({
											let view = view.clone();
											let gid = gid.clone();
											move |_, _, cx| {
												view.update(cx, |app, cx| {
													if app.data.overlay.sort_mode {
														return;
													}
													if let Some(ix) =
														app.data.prefs.collapsed_groups.iter().position(|x| x == &gid)
													{
														app.data.prefs.collapsed_groups.remove(ix);
													} else {
														app.data.prefs.collapsed_groups.push(gid.clone());
													}
													app.persist_prefs();
													cx.notify();
												});
											}
										}),
								)
								.child(
									div()
										.text_xs()
										.text_color(theme.muted_foreground)
										.child(count.to_string()),
								),
						)
						.when(app.data.overlay.sort_mode, |el| {
							el.child(drop_zone(
								crate::ui::eid(format!("sidebar-drop-group-{}", group.id)),
								app.t("dropProjectIntoFolder"),
								theme.border,
								theme.muted_foreground,
								{
									let view = view.clone();
									let gid = gid.clone();
									move |drag: &SidebarDrag, cx| {
										view.update(cx, |app, cx| {
											app.assign_project_to_group(&drag.id, Some(gid.clone()));
											cx.notify();
										});
									}
								},
							))
						})
						.when(!collapsed, |el| {
							el.child(
								v_flex()
									.pl_3()
									.children(members.into_iter().map(|p| project_row(app, &p, cx))),
							)
						})
				}))
				.children(ungrouped.into_iter().map(|p| project_row(app, &p, cx))),
		)
		.when(app.data.overlay.sort_mode, |el| {
			el.child(drop_zone(
				"sidebar-drop-unpin",
				app.t("dropHereToUnpinOrMoveOut"),
				theme.border,
				theme.muted_foreground,
				{
					let view = view.clone();
					move |drag: &SidebarDrag, cx| {
						view.update(cx, |app, cx| {
							app.drop_sidebar_project(&drag.id, None, true);
							cx.notify();
						});
					}
				},
			))
		})
}

fn onboarding_popover(app: &AppView, sidebar_width: f32, cx: &mut Context<AppView>) -> impl IntoElement {
	if !app.data.overlay.onboarding || has_any_projects(app) {
		return div().id("onboarding-hidden").into_any_element();
	}
	let theme = cx.theme().clone();
	let view = cx.entity();
	v_flex()
		.id("onboarding-tour")
		.absolute()
		.top(px(148.))
		.left(px(sidebar_width + 8.))
		.w(px(260.))
		.p_3()
		.gap_1()
		.rounded_lg()
		.border_1()
		.border_color(theme.border)
		.bg(theme.background)
		.shadow_lg()
		.child(
			h_flex()
				.justify_between()
				.child(div().font_semibold().text_sm().child(app.t("onboardingTourTitle")))
				.child(
					Button::new("onboarding-close")
						.ghost()
						.xsmall()
						.icon(IconName::Close)
						.on_click({
							let view = view.clone();
							move |_, _, cx| {
								view.update(cx, |app, cx| {
									app.data.overlay.onboarding = false;
									cx.notify();
								});
							}
						}),
				),
		)
		.child(
			div()
				.text_xs()
				.text_color(theme.muted_foreground)
				.child(app.t("onboardingTourDesc")),
		)
		.into_any_element()
}

fn has_any_projects(app: &AppView) -> bool {
	!app.data.projects.is_empty()
}

fn section_label(text: &str) -> impl IntoElement {
	div().px_2().pt_2().text_xs().font_medium().child(text.to_string())
}

fn project_row(
	app: &AppView,
	project: &model::project::ProjectWithProfiles,
	cx: &mut Context<AppView>,
) -> impl IntoElement {
	let theme = cx.theme().clone();
	let view = cx.entity();
	let selected = app.data.current_project.as_deref() == Some(project.id.as_str());
	let nav_focus = app.data.overlay.sidebar_nav.as_ref() == Some(&SidebarNavItem::Project(project.id.clone()));
	let extras: Vec<_> = project.profiles.iter().filter(|p| !p.is_default).cloned().collect();
	let expanded = app.data.overlay.expanded_projects.contains(&project.id) || extras.is_empty() || selected;
	let agent = app.agent_for_project(&project.id);
	let letter = project
		.name
		.chars()
		.next()
		.map(|c| c.to_ascii_uppercase())
		.unwrap_or('?');
	let id = project.id.clone();
	let default_profile = project.profiles.iter().find(|p| p.is_default).map(|p| p.id.clone());

	v_flex()
		.id(crate::ui::eid(format!("proj-{}", project.id)))
		.child(
			h_flex()
				.id(crate::ui::eid(format!("proj-row-{}", project.id)))
				.w_full()
				.px_2()
				.py_1()
				.rounded_md()
				.gap_2()
				.when(selected, |el| el.bg(theme.sidebar_accent))
				.when(nav_focus && !selected, |el| el.border_1().border_color(theme.border))
				.hover(|el| el.bg(theme.sidebar_accent))
				.on_click({
					let view = view.clone();
					let id = id.clone();
					let default_profile = default_profile.clone();
					move |_, _, cx| {
						view.update(cx, |app, cx| {
							if app.data.overlay.sort_mode {
								return;
							}
							app.data.overlay.sidebar_nav = Some(SidebarNavItem::Project(id.clone()));
							if let Some(pid) = default_profile.clone() {
								app.open_profile(&id, &pid);
							}
							cx.notify();
						});
					}
				})
				.on_mouse_down(MouseButton::Left, {
					let view = view.clone();
					let id = id.clone();
					move |_, _, cx| {
						view.update(cx, |app, _| {
							if app.data.overlay.sort_mode {
								app.data.overlay.drag_project = Some(id.clone());
							}
						});
					}
				})
				.on_mouse_up(MouseButton::Left, {
					let view = view.clone();
					let id = id.clone();
					move |_, _, cx| {
						view.update(cx, |app, cx| {
							if let Some(dragged) = app.data.overlay.drag_project.take() {
								if dragged != id {
									app.drop_sidebar_project(&dragged, Some(&id), false);
									cx.notify();
								}
							}
						});
					}
				})
				.on_mouse_down(MouseButton::Right, {
					let view = view.clone();
					let id = id.clone();
					move |ev, window, cx| {
						view.update(cx, |app, cx| {
							app.open_project_menu(id.clone(), ev.position.x.into(), ev.position.y.into(), window, cx);
							cx.notify();
						});
					}
				})
				.when(app.data.overlay.sort_mode, |el| {
					el.cursor(gpui::CursorStyle::OpenHand)
						.opacity(0.95)
						.child(div().text_xs().text_color(theme.muted_foreground).child("⠿"))
						.on_drag(
							SidebarDrag {
								id: id.clone(),
								name: project.name.clone(),
							},
							|info, _, _, cx| {
								cx.new(|_| crate::ui::DragGhost {
									label: info.name.clone(),
								})
							},
						)
						.on_drop({
							let view = view.clone();
							let target = id.clone();
							move |drag: &SidebarDrag, _, cx| {
								view.update(cx, |app, cx| {
									if drag.id != target {
										app.drop_sidebar_project(&drag.id, Some(&target), false);
										cx.notify();
									}
								});
							}
						})
				})
				.when(app.data.prefs.show_avatars, |el| {
					el.child(
						div()
							.size(px(16.))
							.rounded_md()
							.bg(theme.sidebar_accent)
							.flex()
							.items_center()
							.justify_center()
							.overflow_hidden()
							.text_xs()
							.child(if let Some(url) = app.data.avatars.get(&project.id).cloned() {
								img(url).size(px(16.)).into_any_element()
							} else {
								div().child(letter.to_string()).into_any_element()
							}),
					)
				})
				.child(
					div()
						.flex_1()
						.min_w_0()
						.text_sm()
						.font_medium()
						.whitespace_nowrap()
						.overflow_hidden()
						.child(project.name.clone()),
				)
				.when(app.data.overlay.sort_mode, |el| {
					let pinned = project.pinned_at.is_some();
					el.child(
						Button::new(crate::ui::eid(format!("up-{}", project.id)))
							.ghost()
							.xsmall()
							.icon(IconName::ChevronUp)
							.on_click({
								let view = view.clone();
								let id = id.clone();
								move |_, _, cx| {
									view.update(cx, |app, cx| {
										app.move_sidebar_project(&id, -1);
										cx.notify();
									});
								}
							}),
					)
					.child(
						Button::new(crate::ui::eid(format!("down-{}", project.id)))
							.ghost()
							.xsmall()
							.icon(IconName::ChevronDown)
							.on_click({
								let view = view.clone();
								let id = id.clone();
								move |_, _, cx| {
									view.update(cx, |app, cx| {
										app.move_sidebar_project(&id, 1);
										cx.notify();
									});
								}
							}),
					)
					.child(
						Button::new(crate::ui::eid(format!("pin-{}", project.id)))
							.ghost()
							.xsmall()
							.icon(if pinned { IconName::Star } else { IconName::StarOff })
							.tooltip(if pinned {
								app.t("unpinProject")
							} else {
								app.t("pinProject")
							})
							.on_click({
								let view = view.clone();
								let id = id.clone();
								move |_, _, cx| {
									view.update(cx, |app, cx| {
										app.set_project_pinned(&id, !pinned);
										cx.notify();
									});
								}
							}),
					)
				})
				.when(!app.data.overlay.sort_mode && extras.is_empty(), |el| {
					el.child(agent_dot(agent)).child(
						Button::new(crate::ui::eid(format!("add-prof-{}", project.id)))
							.ghost()
							.xsmall()
							.icon(IconName::Plus)
							.on_click({
								let view = view.clone();
								let id = id.clone();
								move |_, _, cx| {
									view.update(cx, |app, cx| {
										app.data.overlay.dialog = Some(DialogKind::CreateProfile);
										app.data.overlay.dialog_project = Some(id.clone());
										cx.notify();
									});
								}
							}),
					)
				})
				.when(!extras.is_empty(), |el| {
					el.child(
						Icon::new(if expanded {
							IconName::ChevronDown
						} else {
							IconName::ChevronRight
						})
						.w(px(12.)),
					)
				}),
		)
		.when(expanded, |el| {
			el.child(
				v_flex()
					.pl_6()
					.gap_0()
					.children(project.profiles.iter().map(|profile| {
						let pid = profile.id.clone();
						let proj = project.id.clone();
						let selected = app.data.current_profile.as_deref() == Some(profile.id.as_str());
						let nav_focus = app.data.overlay.sidebar_nav.as_ref()
							== Some(&SidebarNavItem::Profile {
								project_id: project.id.clone(),
								profile_id: profile.id.clone(),
							});
						let label = if profile.is_default {
							app.t("defaultProfile")
						} else {
							profile.branch_name.clone()
						};
						h_flex()
							.id(crate::ui::eid(format!("prof-{}", profile.id)))
							.px_2()
							.py_1()
							.rounded_md()
							.gap_2()
							.when(selected, |el| el.bg(theme.sidebar_accent))
							.when(nav_focus && !selected, |el| el.border_1().border_color(theme.border))
							.hover(|el| el.bg(theme.sidebar_accent))
							.on_click({
								let view = view.clone();
								let pid = pid.clone();
								let proj = proj.clone();
								move |_, _, cx| {
									view.update(cx, |app, cx| {
										app.data.overlay.sidebar_nav = Some(SidebarNavItem::Profile {
											project_id: proj.clone(),
											profile_id: pid.clone(),
										});
										app.open_profile(&proj, &pid);
										cx.notify();
									});
								}
							})
							.on_mouse_down(MouseButton::Right, {
								let view = view.clone();
								let pid = pid.clone();
								let proj = proj.clone();
								let is_default = profile.is_default;
								move |ev, _, cx| {
									if is_default {
										return;
									}
									view.update(cx, |app, cx| {
										app.data.overlay.context_menu = Some((
											ContextMenu::Profile {
												id: pid.clone(),
												project_id: proj.clone(),
											},
											ev.position.x.into(),
											ev.position.y.into(),
										));
										cx.notify();
									});
								}
							})
							.child(
								Icon::new(if profile.is_default {
									IconName::SquareTerminal
								} else {
									IconName::GitHub
								})
								.w(px(14.)),
							)
							.child(div().flex_1().text_sm().child(label))
							.child(agent_dot(app.agent_for_profile(&profile.id)))
					}))
					.child(
						h_flex()
							.id(crate::ui::eid(format!("new-prof-{}", project.id)))
							.px_2()
							.py_1()
							.rounded_md()
							.gap_2()
							.hover(|el| el.bg(theme.sidebar_accent))
							.on_click({
								let view = view.clone();
								let id = id.clone();
								move |_, _, cx| {
									view.update(cx, |app, cx| {
										app.data.overlay.dialog = Some(DialogKind::CreateProfile);
										app.data.overlay.dialog_project = Some(id.clone());
										cx.notify();
									});
								}
							})
							.child(Icon::new(IconName::Plus).w(px(12.)))
							.child(div().text_sm().child(app.t("createProfile"))),
					),
			)
		})
}

fn nav_row(
	id: &'static str,
	icon: IconName,
	label: String,
	selected: bool,
	on_click: impl Fn(&mut gpui::App) + 'static,
) -> impl IntoElement {
	div()
		.id(id)
		.px_2()
		.py_1()
		.rounded_md()
		.when(selected, |el| el.bg(gpui::hsla(0., 0., 0.5, 0.08)))
		.on_click(move |_, _, cx| on_click(cx))
		.child(
			h_flex()
				.gap_2()
				.child(Icon::new(icon).w(px(14.)))
				.child(div().text_sm().child(label)),
		)
}

pub fn agent_dot(status: AgentStatus) -> impl IntoElement {
	if status == AgentStatus::Idle {
		return div().id("agent-dot-idle").into_any_element();
	}
	let (color, pulse) = match status {
		AgentStatus::Waiting => (gpui::rgb(0xfacc15), false),
		AgentStatus::Running => (gpui::rgb(0x34d399), true),
		AgentStatus::Completed => (gpui::rgb(0x22c55e), false),
		AgentStatus::Idle => (gpui::rgb(0x000000), false),
	};
	div()
		.size(px(8.))
		.rounded_full()
		.bg(color)
		.when(pulse, |el| el.opacity(0.85))
		.into_any_element()
}

#[allow(dead_code)]
fn _file_name(path: &str) -> String {
	backend::file_name(path)
}
