use gpui::{div, img, prelude::*, px, Context, MouseButton, Window};
use gpui_component::button::{Button, ButtonVariants};
use gpui_component::checkbox::Checkbox;
use gpui_component::input::Input;
use gpui_component::{h_flex, v_flex, ActiveTheme, Icon, IconName, Sizable, StyledExt};
use gpui_component::{Disableable, Selectable};

use crate::app::{extract_file_hunk, file_status_badge, AppView};
use crate::backend;
use crate::diff::{self, DiffLineKind};
use crate::state::{ContextMenu, DialogKind, DiffPreviewMode, GitDiffTab};
use crate::timefmt;

pub fn render_panel(app: &mut AppView, window: &mut Window, cx: &mut Context<AppView>) -> impl IntoElement {
	let theme = cx.theme().clone();
	let view = cx.entity();
	let Some(ws) = app.data.current_ws() else {
		return div().id("git-panel-empty").into_any_element();
	};
	let files = ws.git_files.clone();
	let included = ws.git_included.clone();
	let ahead = ws.git_ahead;

	v_flex()
		.id("git-panel")
		.size_full()
		.child(
			v_flex()
				.flex_1()
				.min_h_0()
				.child(
					h_flex()
						.id("git-changes-header")
						.w_full()
						.px_2()
						.py_1()
						.gap_2()
						.bg(theme.background)
						.border_b_1()
						.border_color(theme.border)
						.child(
							Checkbox::new("git-all")
								.checked(!files.is_empty() && included.len() == files.len())
								.on_click({
									let view = view.clone();
									let files = files.clone();
									move |checked, _, cx| {
										view.update(cx, |app, cx| {
											if let Some(ws) = app.data.current_ws_mut() {
												ws.git_included.clear();
												if *checked {
													ws.git_included.extend(files.iter().map(|(p, _)| p.clone()));
												}
											}
											cx.notify();
										});
									}
								}),
						)
						.child(div().flex_1().text_xs().child(crate::i18n::tf(
							app.data.locale,
							"changedFiles",
							&[("count", &files.len().to_string())],
						)))
						.child(
							Button::new("open-diff")
								.ghost()
								.xsmall()
								.icon(IconName::Maximize)
								.tooltip(app.t("gitOpenDiffView"))
								.on_click({
									let view = view.clone();
									move |_, _, cx| {
										view.update(cx, |app, cx| {
											app.open_git_diff();
											cx.notify();
										});
									}
								}),
						),
				)
				.child(if files.is_empty() {
					div()
						.p_4()
						.text_sm()
						.text_color(theme.muted_foreground)
						.child(app.t("noChangesDetected"))
						.into_any_element()
				} else {
					v_flex()
						.children(files.iter().map(|(path, status)| {
							file_row(app, path, status, included.contains(path), true, window, cx)
						}))
						.into_any_element()
				}),
		)
		.child(commit_composer(app, included.len(), files.len(), ahead, cx))
		.into_any_element()
}

pub fn file_display_parts(file_name: &str) -> (String, Option<String>) {
	match file_name.rfind('/') {
		Some(idx) => (file_name[idx + 1..].to_string(), Some(file_name[..idx].to_string())),
		None => (file_name.to_string(), None),
	}
}

pub fn leftover_step_index(current: usize, delta: i32, count: usize) -> usize {
	if count == 0 {
		return current;
	}
	let next = current as i32 + delta;
	next.clamp(0, count as i32 - 1) as usize
}

pub fn leftover_step_commit_index(current: Option<usize>, delta: i32, count: usize) -> Option<usize> {
	if count == 0 {
		return current;
	}
	Some(match current {
		None => 0,
		Some(index) => leftover_step_index(index, delta, count),
	})
}

pub fn leftover_change_badge(status: &str) -> (&'static str, &'static str) {
	match file_status_badge(status) {
		"A" => ("A", "green"),
		"D" => ("D", "red"),
		"R" => ("R", "amber"),
		"M" => ("M", "blue"),
		other => (other, "muted"),
	}
}

fn leftover_badge_color(kind: &str) -> gpui::Hsla {
	match kind {
		"green" => gpui::hsla(142. / 360., 0.70, 0.45, 1.),
		"red" => gpui::hsla(0., 0.84, 0.60, 1.),
		"blue" => gpui::hsla(217. / 360., 0.91, 0.60, 1.),
		"amber" => gpui::hsla(38. / 360., 0.92, 0.50, 1.),
		_ => gpui::hsla(0., 0., 0.55, 1.),
	}
}

fn leftover_status_badge(status: &str) -> impl IntoElement {
	let (letter, kind) = leftover_change_badge(status);
	let color = leftover_badge_color(kind);
	h_flex()
		.flex_none()
		.w(px(16.))
		.h(px(16.))
		.rounded(px(2.))
		.border_1()
		.border_color(color.opacity(0.3))
		.bg(color.opacity(0.1))
		.justify_center()
		.child(div().font_family("monospace").text_xs().text_color(color).child(letter))
}

fn leftover_path_cell(path: &str, active: bool, muted: gpui::Hsla) -> impl IntoElement {
	let (basename, parent) = file_display_parts(path);
	h_flex()
		.min_w_0()
		.flex_1()
		.gap_2()
		.overflow_hidden()
		.child(
			div()
				.min_w_0()
				.flex_1()
				.text_sm()
				.overflow_hidden()
				.when(active, |el| el.font_medium())
				.child(basename),
		)
		.when_some(parent, |el, dir| {
			el.child(
				div()
					.min_w(px(16.))
					.overflow_hidden()
					.text_xs()
					.text_color(muted)
					.child(dir),
			)
		})
}

fn file_row(
	app: &AppView,
	path: &str,
	status: &str,
	checked: bool,
	compact: bool,
	_window: &mut Window,
	cx: &mut Context<AppView>,
) -> impl IntoElement {
	let view = cx.entity();
	let theme = cx.theme().clone();
	let path_owned = path.to_string();
	let status_owned = status.to_string();
	let active = app.data.overlay.git_diff_file.as_deref() == Some(path);
	h_flex()
		.id(crate::ui::eid(format!("git-file-{path}")))
		.w_full()
		.min_w_0()
		.items_start()
		.px_3()
		.py_2()
		.gap_2()
		.overflow_hidden()
		.when(active, |el| el.bg(theme.muted))
		.when(!checked, |el| el.opacity(0.7))
		.hover(|el| el.bg(theme.muted))
		.on_click({
			let view = view.clone();
			let path = path_owned.clone();
			let status = status_owned.clone();
			move |ev, window, cx| {
				view.update(cx, |app, cx| {
					app.select_diff_file(&path);
					if ev.click_count() >= 2 {
						if compact {
							app.open_git_diff();
						} else if let Some(pid) = app.data.current_profile.clone() {
							if crate::app::git_status_kind(&status) != crate::app::GitStatusKind::Deleted {
								app.open_file(&pid, &path, window, cx);
							}
							app.data.overlay.git_diff_open = false;
						}
					}
					cx.notify();
				});
			}
		})
		.on_mouse_down(MouseButton::Right, {
			let view = view.clone();
			let path = path_owned.clone();
			move |ev, _, cx| {
				view.update(cx, |app, cx| {
					app.select_diff_file(&path);
					app.data.overlay.context_menu = Some((
						ContextMenu::GitFile { path: path.clone() },
						f32::from(ev.position.x),
						f32::from(ev.position.y),
					));
					cx.notify();
				});
			}
		})
		.child(
			Checkbox::new(crate::ui::eid(format!("chk-{path}")))
				.checked(checked)
				.on_click({
					let view = view.clone();
					let path = path_owned.clone();
					move |val, _, cx| {
						view.update(cx, |app, cx| {
							if let Some(ws) = app.data.current_ws_mut() {
								if *val {
									ws.git_included.insert(path.clone());
								} else {
									ws.git_included.remove(&path);
								}
							}
							cx.notify();
						});
					}
				}),
		)
		.child(leftover_path_cell(path, active, theme.muted_foreground))
		.child(leftover_status_badge(status))
}

fn commit_composer(
	app: &AppView,
	included: usize,
	total: usize,
	ahead: u32,
	cx: &mut Context<AppView>,
) -> impl IntoElement {
	let view = cx.entity();
	let theme = cx.theme().clone();
	let summary_empty = app.inputs.commit_summary.read(cx).value().trim().is_empty();
	v_flex()
		.id("commit-composer")
		.w_full()
		.border_t_1()
		.border_color(theme.border)
		.px_2()
		.py_2()
		.gap_2()
		.child(
			div()
				.text_xs()
				.font_semibold()
				.child(app.t("gitCommitSectionTitle").to_ascii_uppercase()),
		)
		.child(div().text_xs().child(app.t("gitCommitSummary")))
		.child(Input::new(&app.inputs.commit_summary))
		.child(div().text_xs().child(app.t("gitCommitBody")))
		.child(Input::new(&app.inputs.commit_body))
		.child(
			h_flex()
				.justify_between()
				.child(
					div()
						.text_xs()
						.text_color(theme.muted_foreground)
						.child(crate::i18n::tf(
							app.data.locale,
							"gitCommitIncludedCount",
							&[
								("includedCount", &included.to_string()),
								("totalCount", &total.to_string()),
							],
						)),
				)
				.child(
					h_flex()
						.gap_1()
						.child(
							Button::new("inc-all")
								.ghost()
								.xsmall()
								.label(app.t("gitCommitIncludeAll"))
								.on_click({
									let view = view.clone();
									move |_, _, cx| {
										view.update(cx, |app, cx| {
											if let Some(ws) = app.data.current_ws_mut() {
												ws.git_included = ws.git_files.iter().map(|(p, _)| p.clone()).collect();
											}
											cx.notify();
										});
									}
								}),
						)
						.child(
							Button::new("inc-none")
								.ghost()
								.xsmall()
								.label(app.t("gitCommitIncludeNone"))
								.on_click({
									let view = view.clone();
									move |_, _, cx| {
										view.update(cx, |app, cx| {
											if let Some(ws) = app.data.current_ws_mut() {
												ws.git_included.clear();
											}
											cx.notify();
										});
									}
								}),
						),
				),
		)
		.child(
			h_flex()
				.gap_2()
				.child(
					Button::new("commit")
						.primary()
						.small()
						.label(app.t("gitCommitButton"))
						.disabled(included == 0 || summary_empty)
						.on_click({
							let view = view.clone();
							move |_, _, cx| {
								view.update(cx, |app, cx| {
									app.commit_selected(cx);
									cx.notify();
								});
							}
						}),
				)
				.when(ahead > 0, |el| {
					el.child(
						Button::new("push")
							.small()
							.icon(IconName::ArrowUp)
							.label(app.t("gitPushButton"))
							.on_click({
								let view = view.clone();
								move |_, _, cx| {
									view.update(cx, |app, cx| {
										app.push_current();
										cx.notify();
									});
								}
							}),
					)
				}),
		)
		.child(
			div()
				.text_xs()
				.text_color(theme.muted_foreground)
				.child(app.t("gitCommitShortcutHint")),
		)
}

pub fn render_diff_dialog(app: &mut AppView, window: &mut Window, cx: &mut Context<AppView>) -> impl IntoElement {
	if !app.data.overlay.git_diff_open {
		return div().id("git-diff-closed").into_any_element();
	}
	let theme = cx.theme().clone();
	let view = cx.entity();
	let branch = app
		.data
		.current_ws()
		.map(|w| {
			if w.branch.is_empty() {
				"main".into()
			} else {
				w.branch.clone()
			}
		})
		.unwrap_or_else(|| "main".into());
	let tab = app.data.overlay.git_diff_tab;
	let mode = app.data.overlay.git_diff_mode;
	let files = app.data.current_ws().map(|w| w.git_files.clone()).unwrap_or_default();
	let selected = app.data.overlay.git_diff_file.clone();
	let diff = selected
		.as_ref()
		.map(|p| extract_file_hunk(&app.data.overlay.git_diff_text, p))
		.unwrap_or_else(|| app.data.overlay.git_diff_text.clone());
	let large = diff.lines().count() >= 400
		&& selected
			.as_ref()
			.map(|p| !app.data.overlay.git_large_revealed.contains(p))
			.unwrap_or(false);

	div()
		.id("git-diff-overlay")
		.absolute()
		.inset_0()
		.flex()
		.items_center()
		.justify_center()
		.bg(gpui::hsla(0., 0., 0., 0.35))
		.on_click({
			let view = view.clone();
			move |_, _, cx| {
				view.update(cx, |app, cx| {
					app.data.overlay.git_diff_open = false;
					cx.notify();
				});
			}
		})
		.child(
			v_flex()
				.id("git-diff-dialog")
				.w(px(1100.))
				.h(px(720.))
				.bg(theme.background)
				.rounded_xl()
				.border_1()
				.border_color(theme.border)
				.shadow_lg()
				.on_click(|_, _, _| {})
				.child(
					h_flex()
						.w_full()
						.px_4()
						.py_2()
						.border_b_1()
						.border_color(theme.border)
						.justify_between()
						.child(
							h_flex()
								.gap_2()
								.child(Icon::new(IconName::GitHub).w(px(16.)))
								.child(div().font_semibold().child(branch)),
						)
						.child(
							h_flex()
								.gap_2()
								.child(
									div()
										.text_xs()
										.text_color(theme.muted_foreground)
										.child(app.t("gitDiffPreviewMode")),
								)
								.child(
									Button::new("unified")
										.xsmall()
										.selected(mode == DiffPreviewMode::Unified)
										.label(app.t("gitDiffPreviewModeUnified"))
										.on_click({
											let view = view.clone();
											move |_, _, cx| {
												view.update(cx, |app, cx| {
													app.data.overlay.git_diff_mode = DiffPreviewMode::Unified;
													cx.notify();
												});
											}
										}),
								)
								.child(
									Button::new("split")
										.xsmall()
										.selected(mode == DiffPreviewMode::Split)
										.label(app.t("gitDiffPreviewModeSplit"))
										.on_click({
											let view = view.clone();
											move |_, _, cx| {
												view.update(cx, |app, cx| {
													app.data.overlay.git_diff_mode = DiffPreviewMode::Split;
													cx.notify();
												});
											}
										}),
								)
								.child(
									Button::new("close-diff")
										.ghost()
										.xsmall()
										.icon(IconName::Close)
										.on_click({
											let view = view.clone();
											move |_, _, cx| {
												view.update(cx, |app, cx| {
													app.data.overlay.git_diff_open = false;
													cx.notify();
												});
											}
										}),
								),
						),
				)
				.child(
					h_flex()
						.flex_1()
						.min_h_0()
						.child(
							v_flex()
								.w(px(360.))
								.h_full()
								.border_r_1()
								.border_color(theme.border)
								.child(
									h_flex()
										.w_full()
										.px_2()
										.py_1()
										.gap_2()
										.child(tab_btn(
											"changes",
											app.t("changes"),
											tab == GitDiffTab::Changes,
											GitDiffTab::Changes,
											&view,
										))
										.child(tab_btn(
											"history",
											app.t("history"),
											tab == GitDiffTab::History,
											GitDiffTab::History,
											&view,
										)),
								)
								.child(if tab == GitDiffTab::Changes {
									v_flex()
										.flex_1()
										.min_h_0()
										.child(if files.is_empty() {
											div().p_4().child(app.t("noChangesDetected")).into_any_element()
										} else {
											v_flex()
												.flex_1()
												.children(files.iter().map(|(p, s)| {
													file_row(
														app,
														p,
														s,
														app.data
															.current_ws()
															.map(|w| w.git_included.contains(p))
															.unwrap_or(false),
														false,
														window,
														cx,
													)
												}))
												.into_any_element()
										})
										.child(commit_composer(
											app,
											app.data.current_ws().map(|w| w.git_included.len()).unwrap_or(0),
											files.len(),
											app.data.current_ws().map(|w| w.git_ahead).unwrap_or(0),
											cx,
										))
										.into_any_element()
								} else {
									history_pane(app, cx).into_any_element()
								}),
						)
						.child(v_flex().flex_1().min_w_0().h_full().p_3().child(
							if selected.is_none() && tab == GitDiffTab::Changes {
								div()
									.text_color(theme.muted_foreground)
									.child(app.t("selectFileToView"))
									.into_any_element()
							} else if large {
								v_flex()
									.gap_2()
									.child(div().font_semibold().child(app.t("gitDiffLargeGuardrailTitle")))
									.child(div().text_sm().child(app.t("gitDiffLargeGuardrailDescription")))
									.child(
										Button::new("reveal-large")
											.label(app.t("gitDiffLargeGuardrailReveal"))
											.on_click({
												let view = view.clone();
												let path = selected.clone().unwrap_or_default();
												move |_, _, cx| {
													view.update(cx, |app, cx| {
														app.data.overlay.git_large_revealed.insert(path.clone());
														cx.notify();
													});
												}
											}),
									)
									.into_any_element()
							} else if selected.as_ref().is_some_and(|p| backend::is_image(p)) {
								image_preview(app, selected.as_deref().unwrap_or_default(), &diff).into_any_element()
							} else {
								v_flex()
									.gap_2()
									.children(diff::rename_paths(&diff).map(|(old, new)| {
										v_flex()
											.gap_1()
											.child(div().text_xs().text_color(theme.muted_foreground).child(format!(
												"{label}: {old}",
												label = app.t("gitDiffRenamePreviousPath")
											)))
											.child(div().text_xs().text_color(theme.muted_foreground).child(format!(
												"{label}: {new}",
												label = app.t("gitDiffRenameCurrentPath")
											)))
									}))
									.child(diff_stats(&diff))
									.child(diff_view(
										&diff,
										mode,
										theme.muted_foreground,
										selected.clone().unwrap_or_default(),
										app.data.overlay.review_selection.clone(),
										&view,
									))
									.child(review_composer(app, cx))
									.into_any_element()
							},
						)),
				)
				.when(!app.data.overlay.review_comments.is_empty(), |el| {
					el.child(
						div().id("review-fab").absolute().bottom_4().right_4().child(
							Button::new("open-review")
								.primary()
								.small()
								.label(format!("Review Queue ({})", app.data.overlay.review_comments.len()))
								.on_click({
									let view = view.clone();
									move |_, _, cx| {
										view.update(cx, |app, cx| {
											app.data.overlay.dialog = Some(DialogKind::ReviewQueue);
											cx.notify();
										});
									}
								}),
						),
					)
				}),
		)
		.into_any_element()
}

fn tab_btn(
	id: &'static str,
	label: String,
	selected: bool,
	tab: GitDiffTab,
	view: &gpui::Entity<AppView>,
) -> impl IntoElement {
	let view = view.clone();
	Button::new(id)
		.ghost()
		.small()
		.selected(selected)
		.label(label)
		.on_click(move |_, _, cx| {
			view.update(cx, |app, cx| {
				app.switch_git_tab(tab);
				cx.notify();
			});
		})
}

fn history_pane(app: &AppView, cx: &mut Context<AppView>) -> impl IntoElement {
	let view = cx.entity();
	let theme = cx.theme().clone();
	if let Some(hash) = app.data.overlay.git_selected_commit.clone() {
		let commit = app
			.data
			.overlay
			.git_commits
			.iter()
			.find(|c| c.hash == hash || c.full_hash == hash)
			.cloned();
		let selected_file = app.data.overlay.git_diff_file.clone();
		return v_flex()
			.id("commit-drill-in")
			.child(
				h_flex()
					.px_2()
					.py_1()
					.gap_1()
					.child(
						Button::new("back-commits")
							.ghost()
							.xsmall()
							.icon(IconName::ArrowLeft)
							.tooltip(app.t("backToCommitList"))
							.on_click({
								let view = view.clone();
								move |_, _, cx| {
									view.update(cx, |app, cx| {
										app.data.overlay.git_selected_commit = None;
										cx.notify();
									});
								}
							}),
					)
					.child(
						v_flex()
							.min_w_0()
							.flex_1()
							.child(
								div()
									.text_sm()
									.font_medium()
									.child(commit.as_ref().map(|c| c.message.clone()).unwrap_or_default()),
							)
							.child(
								div()
									.text_xs()
									.font_family("monospace")
									.text_color(theme.muted_foreground)
									.child(commit.as_ref().map(|c| c.hash.clone()).unwrap_or(hash.clone())),
							),
					),
			)
			.child(if app.data.overlay.git_commit_files.is_empty() {
				div()
					.p_8()
					.text_sm()
					.text_color(theme.muted_foreground)
					.child(app.t("noFileChanges"))
					.into_any_element()
			} else {
				v_flex()
					.child(
						div()
							.px_3()
							.py_1()
							.text_xs()
							.text_color(theme.muted_foreground)
							.child(crate::i18n::tf(
								app.data.locale,
								"changedFiles",
								&[("count", &app.data.overlay.git_commit_files.len().to_string())],
							)),
					)
					.children(app.data.overlay.git_commit_files.iter().enumerate().map(|(ix, p)| {
						let path = p.clone();
						let active = app.data.overlay.git_commit_file_index == ix
							|| selected_file.as_deref() == Some(p.as_str());
						h_flex()
							.id(crate::ui::eid(format!("cfile-{p}")))
							.w_full()
							.min_w_0()
							.items_start()
							.px_3()
							.py_2()
							.gap_2()
							.overflow_hidden()
							.when(active, |el| el.bg(theme.muted))
							.hover(|el| el.bg(theme.muted))
							.on_click({
								let view = view.clone();
								move |_, _, cx| {
									view.update(cx, |app, cx| {
										app.data.overlay.git_commit_file_index = ix;
										app.data.overlay.git_diff_file = Some(path.clone());
										cx.notify();
									});
								}
							})
							.child(leftover_path_cell(p, active, theme.muted_foreground))
							.child(leftover_status_badge("M"))
					}))
					.into_any_element()
			})
			.into_any_element();
	}
	if app.data.overlay.git_commits.is_empty() {
		return div()
			.p_8()
			.text_sm()
			.text_color(theme.muted_foreground)
			.child(app.t("noCommitsFound"))
			.into_any_element();
	}
	let now = timefmt::unix_now_secs();
	let selected_ix = app.data.overlay.git_commit_index;
	v_flex()
		.id("commit-list")
		.children(app.data.overlay.git_commits.iter().enumerate().map(|(ix, c)| {
			let hash = c.hash.clone();
			let active = selected_ix == Some(ix);
			v_flex()
				.id(crate::ui::eid(format!("commit-{hash}")))
				.px_3()
				.py(px(6.))
				.gap(px(2.))
				.when(active, |el| el.bg(theme.muted))
				.hover(|el| el.bg(theme.muted))
				.on_click({
					let view = view.clone();
					let hash = hash.clone();
					move |_, _, cx| {
						view.update(cx, |app, cx| {
							app.select_commit(&hash);
							cx.notify();
						});
					}
				})
				.child(div().text_sm().child(c.message.clone()))
				.child(
					h_flex()
						.gap_2()
						.text_xs()
						.text_color(theme.muted_foreground)
						.child(div().font_family("monospace").child(hash.clone()))
						.child(div().min_w_0().flex_1().child(c.author.name.clone()))
						.child(div().child(timefmt::format_relative_time(&c.date, now))),
				)
				.child(
					h_flex()
						.gap_2()
						.text_xs()
						.when(c.files_changed > 0, |el| {
							el.child(div().text_color(theme.muted_foreground).child(format!(
								"{} {}",
								c.files_changed,
								if c.files_changed == 1 { "file" } else { "files" }
							)))
						})
						.when(c.insertions > 0, |el| {
							el.child(
								div()
									.text_color(gpui::hsla(0.38, 0.7, 0.45, 1.))
									.child(format!("+{}", c.insertions)),
							)
						})
						.when(c.deletions > 0, |el| {
							el.child(
								div()
									.text_color(gpui::hsla(0.02, 0.75, 0.5, 1.))
									.child(format!("-{}", c.deletions)),
							)
						}),
				)
		}))
		.into_any_element()
}

fn diff_stats(diff: &str) -> impl IntoElement {
	let adds = diff
		.lines()
		.filter(|l| l.starts_with('+') && !l.starts_with("+++"))
		.count();
	let dels = diff
		.lines()
		.filter(|l| l.starts_with('-') && !l.starts_with("---"))
		.count();
	h_flex()
		.gap_2()
		.text_xs()
		.font_family("monospace")
		.child(
			div()
				.text_color(gpui::hsla(0.38, 0.7, 0.45, 1.))
				.child(format!("+{adds}")),
		)
		.child(
			div()
				.text_color(gpui::hsla(0.02, 0.75, 0.5, 1.))
				.child(format!("-{dels}")),
		)
}

fn review_composer(app: &AppView, cx: &mut Context<AppView>) -> impl IntoElement {
	let view = cx.entity();
	let Some(sel) = app.data.overlay.review_selection.clone() else {
		return div().id("review-composer-idle").into_any_element();
	};
	let theme = cx.theme().clone();
	v_flex()
		.id("review-composer")
		.w(px(448.))
		.mt_2()
		.rounded_lg()
		.border_1()
		.border_color(theme.border)
		.bg(theme.popover)
		.shadow_lg()
		.child(
			h_flex()
				.px_3()
				.py_2()
				.justify_between()
				.border_b_1()
				.border_color(theme.border)
				.child(
					div()
						.text_xs()
						.font_semibold()
						.text_color(theme.muted_foreground)
						.child(format!("Comment on {}", crate::review::format_review_range(sel.range))),
				)
				.child(
					Button::new("cancel-review")
						.ghost()
						.xsmall()
						.icon(IconName::Close)
						.tooltip("Cancel review comment".to_string())
						.on_click({
							let view = view.clone();
							move |_, window, cx| {
								view.update(cx, |app, cx| {
									app.cancel_review_comment(window, cx);
									cx.notify();
								});
							}
						}),
				),
		)
		.child(div().px_1().child(Input::new(&app.inputs.review_comment)))
		.child(
			h_flex()
				.justify_end()
				.px_3()
				.py_2()
				.border_t_1()
				.border_color(theme.border)
				.child(
					Button::new("add-review")
						.small()
						.primary()
						.label("Add to queue".to_string())
						.disabled(app.inputs.review_comment.read(cx).value().trim().is_empty())
						.on_click({
							let view = view.clone();
							move |_, window, cx| {
								view.update(cx, |app, cx| {
									app.add_review_comment(window, cx);
									cx.notify();
								});
							}
						}),
				),
		)
		.into_any_element()
}

fn diff_view(
	diff: &str,
	mode: DiffPreviewMode,
	muted: gpui::Hsla,
	file: String,
	selection: Option<crate::review::ReviewSelection>,
	view: &gpui::Entity<AppView>,
) -> impl IntoElement {
	if diff.trim().is_empty() {
		return div().text_color(muted).child("").into_any_element();
	}
	if mode == DiffPreviewMode::Split {
		return split_diff_view(diff, muted, file, selection, view).into_any_element();
	}
	let annotated = diff::annotate_unified(diff);
	v_flex()
		.id("diff-lines")
		.gap_0()
		.font_family("monospace")
		.text_sm()
		.children(
			annotated
				.into_iter()
				.enumerate()
				.map(|(ix, line)| unified_line(line, muted, file.clone(), selection.as_ref(), ix, view)),
		)
		.into_any_element()
}

fn unified_line(
	line: diff::AnnotatedLine,
	muted: gpui::Hsla,
	file: String,
	selection: Option<&crate::review::ReviewSelection>,
	ix: usize,
	view: &gpui::Entity<AppView>,
) -> impl IntoElement {
	let (mut bg, color) = line_colors(&line.raw, muted);
	let target = match line.kind {
		DiffLineKind::Add => line.new_no.map(|no| (crate::review::ReviewSide::Additions, no)),
		DiffLineKind::Del => line.old_no.map(|no| (crate::review::ReviewSide::Deletions, no)),
		_ => None,
	};
	if let Some((side, no)) = target {
		if selection.is_some_and(|s| s.file == file && crate::review::line_in_range(s.range, side, no)) {
			bg = gpui::hsla(0.58, 0.55, 0.45, 0.22);
		}
	}
	let view = view.clone();
	let text = line.raw;
	div()
		.id(crate::ui::eid(format!("udiff-{ix}")))
		.px_2()
		.bg(bg)
		.text_color(color)
		.when_some(target, |el, (side, no)| {
			el.on_click(move |ev, _, cx| {
				let extend = ev.modifiers().shift;
				view.update(cx, |app, cx| {
					app.select_review_line(&file, side, no, extend);
					cx.notify();
				});
			})
		})
		.child(text)
}

fn line_colors(line: &str, muted: gpui::Hsla) -> (gpui::Hsla, gpui::Hsla) {
	if line.starts_with('+') && !line.starts_with("+++") {
		(gpui::hsla(0.38, 0.6, 0.4, 0.15), gpui::hsla(0.38, 0.7, 0.45, 1.))
	} else if line.starts_with('-') && !line.starts_with("---") {
		(gpui::hsla(0.02, 0.7, 0.5, 0.15), gpui::hsla(0.02, 0.75, 0.5, 1.))
	} else {
		(gpui::hsla(0., 0., 0., 0.), muted)
	}
}

fn kind_colors(kind: DiffLineKind, muted: gpui::Hsla) -> (gpui::Hsla, gpui::Hsla) {
	match kind {
		DiffLineKind::Add => (gpui::hsla(0.38, 0.6, 0.4, 0.15), gpui::hsla(0.38, 0.7, 0.45, 1.)),
		DiffLineKind::Del => (gpui::hsla(0.02, 0.7, 0.5, 0.15), gpui::hsla(0.02, 0.75, 0.5, 1.)),
		DiffLineKind::Header => (gpui::hsla(0., 0., 0., 0.04), muted),
		DiffLineKind::Context => (gpui::hsla(0., 0., 0., 0.), muted),
	}
}

fn split_diff_view(
	diff: &str,
	muted: gpui::Hsla,
	file: String,
	selection: Option<crate::review::ReviewSelection>,
	view: &gpui::Entity<AppView>,
) -> impl IntoElement {
	let annotated = diff::annotate_unified(diff);
	v_flex()
		.id("diff-split")
		.gap_0()
		.font_family("monospace")
		.text_sm()
		.children(diff::split_rows(diff).into_iter().enumerate().map(|(ix, row)| {
			h_flex()
				.id(crate::ui::eid(format!("split-row-{ix}")))
				.w_full()
				.child(split_cell(
					row.left,
					muted,
					ix,
					"l",
					file.clone(),
					selection.as_ref(),
					&annotated,
					view,
				))
				.child(div().w(px(1.)).h_full().bg(gpui::hsla(0., 0., 0.5, 0.2)))
				.child(split_cell(
					row.right,
					muted,
					ix,
					"r",
					file.clone(),
					selection.as_ref(),
					&annotated,
					view,
				))
		}))
}

fn split_target(
	kind: DiffLineKind,
	text: &str,
	annotated: &[diff::AnnotatedLine],
) -> Option<(crate::review::ReviewSide, u32)> {
	let line = annotated.iter().find(|l| l.kind == kind && l.raw == text)?;
	match kind {
		DiffLineKind::Add => Some((crate::review::ReviewSide::Additions, line.new_no?)),
		DiffLineKind::Del => Some((crate::review::ReviewSide::Deletions, line.old_no?)),
		_ => None,
	}
}

fn split_cell(
	cell: Option<(DiffLineKind, String)>,
	muted: gpui::Hsla,
	ix: usize,
	side: &'static str,
	file: String,
	selection: Option<&crate::review::ReviewSelection>,
	annotated: &[diff::AnnotatedLine],
	view: &gpui::Entity<AppView>,
) -> impl IntoElement {
	let (kind, text) = match cell {
		Some((kind, text)) => (Some(kind), text),
		None => (None, String::new()),
	};
	let (mut bg, color) = kind
		.map(|k| kind_colors(k, muted))
		.unwrap_or((gpui::hsla(0., 0., 0., 0.), muted));
	let target = kind.and_then(|k| split_target(k, &text, annotated));
	if let Some((review_side, no)) = target {
		if selection.is_some_and(|s| s.file == file && crate::review::line_in_range(s.range, review_side, no)) {
			bg = gpui::hsla(0.58, 0.55, 0.45, 0.22);
		}
	}
	let view = view.clone();
	let shown = if text.is_empty() { " ".to_string() } else { text };
	div()
		.id(crate::ui::eid(format!("split-{side}-{ix}")))
		.flex_1()
		.min_w_0()
		.px_2()
		.bg(bg)
		.text_color(color)
		.when_some(target, |el, (review_side, no)| {
			el.on_click(move |ev, _, cx| {
				let extend = ev.modifiers().shift;
				view.update(cx, |app, cx| {
					app.select_review_line(&file, review_side, no, extend);
					cx.notify();
				});
			})
		})
		.child(shown)
}

fn image_preview(app: &AppView, path: &str, diff: &str) -> impl IntoElement {
	let worktree = app.data.current_ws().map(|w| w.worktree.clone()).unwrap_or_default();
	let after = std::path::PathBuf::from(&worktree).join(path);
	let before_rel = diff::rename_paths(diff)
		.map(|(old, _)| old)
		.unwrap_or_else(|| path.to_string());
	let before = app.backend.cached_head_blob(&worktree, &before_rel);
	h_flex()
		.id("git-image-preview")
		.w_full()
		.gap_4()
		.child(
			v_flex()
				.flex_1()
				.gap_1()
				.child(
					div()
						.text_xs()
						.font_semibold()
						.child(app.t("gitDiffImagePreviewBefore")),
				)
				.child(if let Some(before) = before {
					img(before).w_full().max_h(px(480.)).into_any_element()
				} else {
					div()
						.text_sm()
						.text_color(gpui::hsla(0., 0., 0.5, 1.))
						.child(app.t("gitDiffImagePreviewUnavailable"))
						.into_any_element()
				}),
		)
		.child(
			v_flex()
				.flex_1()
				.gap_1()
				.child(div().text_xs().font_semibold().child(app.t("gitDiffImagePreviewAfter")))
				.child(if after.exists() {
					img(after).w_full().max_h(px(480.)).into_any_element()
				} else {
					div()
						.text_sm()
						.child(app.t("gitDiffImagePreviewUnavailable"))
						.into_any_element()
				}),
		)
}

#[cfg(test)]
mod tests {
	use super::{file_display_parts, leftover_change_badge, leftover_step_commit_index, leftover_step_index};

	#[test]
	fn leftover_file_display_parts_split_git_paths() {
		assert_eq!(
			file_display_parts("src/features/git/FileListItem.tsx"),
			("FileListItem.tsx".into(), Some("src/features/git".into()))
		);
		assert_eq!(file_display_parts("README.md"), ("README.md".into(), None));
	}

	#[test]
	fn leftover_step_index_clamps_like_git_diff_reducer() {
		assert_eq!(leftover_step_index(2, 1, 10), 3);
		assert_eq!(leftover_step_index(3, -1, 10), 2);
		assert_eq!(leftover_step_index(0, -1, 5), 0);
		assert_eq!(leftover_step_index(4, 1, 5), 4);
		assert_eq!(leftover_step_index(0, 1, 1), 0);
		assert_eq!(leftover_step_index(0, 1, 0), 0);
		assert_eq!(leftover_step_index(2, 100, 5), 4);
	}

	#[test]
	fn leftover_step_commit_index_starts_at_first() {
		assert_eq!(leftover_step_commit_index(None, 1, 5), Some(0));
		assert_eq!(leftover_step_commit_index(None, -1, 5), Some(0));
		assert_eq!(leftover_step_commit_index(None, 1, 0), None);
		assert_eq!(leftover_step_commit_index(Some(1), 1, 5), Some(2));
		assert_eq!(leftover_step_commit_index(Some(4), 1, 5), Some(4));
	}

	#[test]
	fn leftover_change_badge_matches_file_list_item() {
		assert_eq!(leftover_change_badge("added"), ("A", "green"));
		assert_eq!(leftover_change_badge("deleted"), ("D", "red"));
		assert_eq!(leftover_change_badge("change"), ("M", "blue"));
		assert_eq!(leftover_change_badge("renamed"), ("R", "amber"));
		assert_eq!(leftover_change_badge("A"), ("A", "green"));
		assert_eq!(leftover_change_badge("M"), ("M", "blue"));
	}
}
