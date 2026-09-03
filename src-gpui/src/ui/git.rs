use gpui::{div, prelude::*, px, rgb, Context, Window};
use gpui_component::button::{Button, ButtonVariants};
use gpui_component::checkbox::Checkbox;
use gpui_component::input::Input;
use gpui_component::{h_flex, v_flex, ActiveTheme, Icon, IconName, Sizable, StyledExt};
use gpui_component::{Disableable, Selectable};

use crate::app::{extract_file_hunk, file_status_badge, AppView};
use crate::backend;
use crate::diff::{self, DiffLineKind};
use crate::state::{DialogKind, DiffPreviewMode, GitDiffTab};

pub fn render_panel(app: &mut AppView, _window: &mut Window, cx: &mut Context<AppView>) -> impl IntoElement {
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
						.w_full()
						.px_2()
						.py_1()
						.gap_2()
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
						.children(
							files
								.iter()
								.map(|(path, status)| file_row(app, path, status, included.contains(path), true, cx)),
						)
						.into_any_element()
				}),
		)
		.child(commit_composer(app, included.len(), files.len(), ahead, cx))
		.into_any_element()
}

fn file_row(
	app: &AppView,
	path: &str,
	status: &str,
	checked: bool,
	compact: bool,
	cx: &mut Context<AppView>,
) -> impl IntoElement {
	let view = cx.entity();
	let theme = cx.theme().clone();
	let badge = file_status_badge(status);
	let name = crate::backend::file_name(path);
	let path_owned = path.to_string();
	h_flex()
		.id(crate::ui::eid(format!("git-file-{path}")))
		.w_full()
		.px_2()
		.py_1()
		.gap_2()
		.hover(|el| el.bg(theme.muted))
		.on_click({
			let view = view.clone();
			let path = path_owned.clone();
			move |_, _, cx| {
				view.update(cx, |app, cx| {
					app.select_diff_file(&path);
					app.data.overlay.git_diff_open = true;
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
		.child(Icon::new(IconName::File).w(px(13.)))
		.child(div().flex_1().text_sm().child(name))
		.child(
			div()
				.text_xs()
				.text_color(match badge {
					"A" => theme.success,
					"D" => theme.danger,
					_ => theme.muted_foreground,
				})
				.child(badge),
		)
		.when(compact, |el| {
			el.child(
				Button::new(crate::ui::eid(format!("discard-{path}")))
					.ghost()
					.xsmall()
					.icon(IconName::Undo)
					.tooltip(app.t("gitDiscardFileAction"))
					.on_click({
						let view = view.clone();
						let path = path_owned.clone();
						move |_, _, cx| {
							view.update(cx, |app, cx| {
								app.discard_file(&path);
								cx.notify();
							});
						}
					}),
			)
		})
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
		.child(Input::new(&app.inputs.commit_summary))
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

pub fn render_diff_dialog(app: &mut AppView, _window: &mut Window, cx: &mut Context<AppView>) -> impl IntoElement {
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
								let worktree = app.data.current_ws().map(|w| w.worktree.clone()).unwrap_or_default();
								let path =
									std::path::PathBuf::from(worktree).join(selected.as_deref().unwrap_or_default());
								gpui::img(path).w_full().max_h(px(480.)).into_any_element()
							} else {
								v_flex()
									.gap_2()
									.child(diff_stats(&diff))
									.child(diff_view(
										&diff,
										mode,
										theme.muted_foreground,
										selected.clone().unwrap_or_default(),
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
								.label(format!(
									"{} ({})",
									app.t("reviewQueue"),
									app.data.overlay.review_comments.len()
								))
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
				app.data.overlay.git_diff_tab = tab;
				cx.notify();
			});
		})
}

fn history_pane(app: &AppView, cx: &mut Context<AppView>) -> impl IntoElement {
	let view = cx.entity();
	let theme = cx.theme().clone();
	if let Some(hash) = app.data.overlay.git_selected_commit.clone() {
		return v_flex()
			.child(
				Button::new("back-commits")
					.ghost()
					.small()
					.label(app.t("backToCommitList"))
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
			.child(if app.data.overlay.git_commit_files.is_empty() {
				div().p_3().child(app.t("noFileChanges")).into_any_element()
			} else {
				v_flex()
					.children(app.data.overlay.git_commit_files.iter().map(|p| {
						let path = p.clone();
						div()
							.id(crate::ui::eid(format!("cfile-{p}")))
							.px_2()
							.py_1()
							.hover(|el| el.bg(theme.muted))
							.on_click({
								let view = view.clone();
								move |_, _, cx| {
									view.update(cx, |app, cx| {
										app.data.overlay.git_diff_file = Some(path.clone());
										cx.notify();
									});
								}
							})
							.child(p.clone())
					}))
					.into_any_element()
			})
			.into_any_element();
	}
	if app.data.overlay.git_commits.is_empty() {
		return div().p_4().child(app.t("noCommitsFound")).into_any_element();
	}
	v_flex()
		.children(app.data.overlay.git_commits.iter().map(|c| {
			let hash = c.hash.clone();
			v_flex()
				.id(crate::ui::eid(format!("commit-{hash}")))
				.px_3()
				.py_2()
				.gap_1()
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
				.child(div().font_medium().text_sm().child(c.message.clone()))
				.child(div().text_xs().text_color(theme.muted_foreground).child(format!(
					"{} · {}",
					c.author.name,
					&hash[..hash.len().min(7)]
				)))
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
	let selected = app
		.data
		.overlay
		.review_line
		.as_ref()
		.map(|(_, line)| line.clone())
		.unwrap_or_default();
	v_flex()
		.gap_1()
		.pt_2()
		.border_t_1()
		.border_color(cx.theme().border)
		.when(!selected.is_empty(), |el| {
			el.child(div().text_xs().font_family("monospace").child(selected))
		})
		.child(Input::new(&app.inputs.review_comment))
		.child(
			Button::new("add-review")
				.small()
				.primary()
				.label(app.t("reviewQueue"))
				.disabled(app.data.overlay.review_line.is_none())
				.on_click({
					let view = view.clone();
					move |_, window, cx| {
						view.update(cx, |app, cx| {
							app.add_review_comment(window, cx);
							cx.notify();
						});
					}
				}),
		)
}

fn diff_view(
	diff: &str,
	mode: DiffPreviewMode,
	muted: gpui::Hsla,
	file: String,
	view: &gpui::Entity<AppView>,
) -> impl IntoElement {
	if diff.trim().is_empty() {
		return div().text_color(muted).child("").into_any_element();
	}
	if mode == DiffPreviewMode::Split {
		return split_diff_view(diff, muted, file, view).into_any_element();
	}
	v_flex()
		.id("diff-lines")
		.gap_0()
		.font_family("monospace")
		.text_sm()
		.children(
			diff.lines()
				.enumerate()
				.map(|(ix, line)| unified_line(line, muted, file.clone(), ix, view)),
		)
		.into_any_element()
}

fn unified_line(
	line: &str,
	muted: gpui::Hsla,
	file: String,
	ix: usize,
	view: &gpui::Entity<AppView>,
) -> impl IntoElement {
	let (bg, color) = line_colors(line, muted);
	let text = line.to_string();
	let view = view.clone();
	div()
		.id(crate::ui::eid(format!("udiff-{ix}")))
		.px_2()
		.bg(bg)
		.text_color(color)
		.on_click(move |_, _, cx| {
			view.update(cx, |app, cx| {
				app.data.overlay.review_line = Some((file.clone(), text.clone()));
				cx.notify();
			});
		})
		.child(line.to_string())
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

fn split_diff_view(diff: &str, muted: gpui::Hsla, file: String, view: &gpui::Entity<AppView>) -> impl IntoElement {
	v_flex()
		.id("diff-split")
		.gap_0()
		.font_family("monospace")
		.text_sm()
		.children(diff::split_rows(diff).into_iter().enumerate().map(|(ix, row)| {
			h_flex()
				.id(crate::ui::eid(format!("split-row-{ix}")))
				.w_full()
				.child(split_cell(row.left, muted, ix, "l", file.clone(), view))
				.child(div().w(px(1.)).h_full().bg(gpui::hsla(0., 0., 0.5, 0.2)))
				.child(split_cell(row.right, muted, ix, "r", file.clone(), view))
		}))
}

fn split_cell(
	cell: Option<(DiffLineKind, String)>,
	muted: gpui::Hsla,
	ix: usize,
	side: &'static str,
	file: String,
	view: &gpui::Entity<AppView>,
) -> impl IntoElement {
	let (kind, text) = match cell {
		Some((kind, text)) => (Some(kind), text),
		None => (None, String::new()),
	};
	let (bg, color) = kind
		.map(|k| kind_colors(k, muted))
		.unwrap_or((gpui::hsla(0., 0., 0., 0.), muted));
	let view = view.clone();
	let shown = if text.is_empty() { " ".to_string() } else { text.clone() };
	div()
		.id(crate::ui::eid(format!("split-{side}-{ix}")))
		.flex_1()
		.min_w_0()
		.px_2()
		.bg(bg)
		.text_color(color)
		.on_click(move |_, _, cx| {
			if !text.is_empty() {
				view.update(cx, |app, cx| {
					app.data.overlay.review_line = Some((file.clone(), text.clone()));
					cx.notify();
				});
			}
		})
		.child(shown)
}
