use std::path::PathBuf;

use gpui::{div, img, prelude::*, px, rgb, Context, Window};
use gpui_component::button::{Button, ButtonVariants};
use gpui_component::input::Input;
use gpui_component::text::TextView;
use gpui_component::{h_flex, v_flex, ActiveTheme, Icon, IconName, Sizable, StyledExt};

use crate::app::AppView;
use crate::backend;
use crate::state::UnifiedTab;

pub fn render(app: &mut AppView, window: &mut Window, cx: &mut Context<AppView>) -> impl IntoElement {
	let theme = cx.theme().clone();
	let view = cx.entity();
	let Some(ws) = app.data.current_ws() else {
		return div().id("file-viewer-none").into_any_element();
	};
	let Some(UnifiedTab::File { index }) = ws.active else {
		return div().id("file-viewer-hidden").into_any_element();
	};
	let Some(file) = ws.files.get(index).cloned() else {
		return div().id("file-viewer-missing").into_any_element();
	};

	if let Some(err) = file.load_error.clone() {
		return v_flex()
			.id("file-viewer-error")
			.size_full()
			.items_center()
			.justify_center()
			.h(px(128.))
			.gap_2()
			.child(
				div()
					.text_color(theme.muted_foreground)
					.child(app.t("somethingWentWrong")),
			)
			.child(div().text_xs().text_color(theme.muted_foreground).child(err))
			.into_any_element();
	}

	if file.preview {
		return preview_pane(app, &file, cx).into_any_element();
	}

	if backend::is_markdown(&file.path) {
		let slash = file.draft.lines().last().unwrap_or("").to_string();
		return v_flex()
			.id("markdown-viewer")
			.size_full()
			.child(
				h_flex()
					.w_full()
					.px_2()
					.py_1()
					.gap_1()
					.border_b_1()
					.border_color(theme.border)
					.child(md_btn("md-h1", "H1", "# ", "", &view, &app.t("notesFormatHeading1")))
					.child(md_btn("md-h2", "H2", "## ", "", &view, &app.t("notesFormatHeading2")))
					.child(md_btn("md-h3", "H3", "### ", "", &view, &app.t("notesFormatHeading3")))
					.child(md_btn("md-p", "P", "", "\n\n", &view, &app.t("notesFormatParagraph")))
					.child(md_btn("md-b", "B", "**", "**", &view, &app.t("notesFormatBold")))
					.child(md_btn("md-i", "I", "*", "*", &view, &app.t("notesFormatItalic")))
					.child(md_btn("md-s", "S", "~~", "~~", &view, &app.t("notesFormatStrike")))
					.child(md_btn("md-code", "`", "`", "`", &view, &app.t("notesFormatCode")))
					.child(md_btn(
						"md-pre",
						"</>",
						"```\n",
						"\n```",
						&view,
						&app.t("notesFormatCodeBlock"),
					))
					.child(md_btn("md-ul", "•", "- ", "", &view, &app.t("notesFormatBulletList")))
					.child(md_btn(
						"md-ol",
						"1.",
						"1. ",
						"",
						&view,
						&app.t("notesFormatOrderedList"),
					))
					.child(md_btn("md-q", ">", "> ", "", &view, &app.t("notesFormatQuote")))
					.child(md_btn("md-link", "[]", "[", "](url)", &view, &app.t("notesFormatLink")))
					.child(md_btn(
						"md-img",
						"img",
						"![",
						"](src)",
						&view,
						&app.t("notesFormatLink"),
					))
					.child(md_btn(
						"md-table",
						"tbl",
						"| A | B |\n| --- | --- |\n|   |   |\n",
						"",
						&view,
						&app.t("notesInsertTable"),
					))
					.child(md_btn("md-hr", "—", "---\n", "", &view, &app.t("notesInsertDivider")))
					.child(
						div()
							.text_xs()
							.text_color(theme.muted_foreground)
							.child(if file.dirty() {
								app.t("notesSaving")
							} else {
								app.t("notesSaved")
							}),
					)
					.child(
						Button::new("md-save")
							.xsmall()
							.primary()
							.label(app.t("save"))
							.on_click({
								let view = view.clone();
								move |_, window, cx| {
									view.update(cx, |app, cx| {
										app.save_active_file(window, cx);
										cx.notify();
									});
								}
							}),
					),
			)
			.when(slash.starts_with('/'), |el| {
				el.child(slash_menu(&slash, &view, app.data.locale))
			})
			.child(
				h_flex()
					.flex_1()
					.min_h_0()
					.child(div().flex_1().h_full().child(Input::new(&app.inputs.file_editor)))
					.child(
						div()
							.flex_1()
							.h_full()
							.p_3()
							.border_l_1()
							.border_color(theme.border)
							.child(TextView::markdown("md-preview", file.draft.clone(), window, cx)),
					),
			)
			.into_any_element();
	}

	let q = app.inputs.file_search.read(cx).value().to_string();
	let hits = crate::app::search_match_offsets(&file.draft, &q);
	let hit_count = hits.len();
	let hit_ix = if hit_count == 0 {
		0
	} else {
		app.data.overlay.file_search_ix % hit_count + 1
	};
	v_flex()
		.id("text-viewer")
		.size_full()
		.font_family(app.data.prefs.font_family.clone())
		.text_size(px(app.data.prefs.font_size))
		.child(
			h_flex()
				.w_full()
				.px_2()
				.py_1()
				.gap_2()
				.border_b_1()
				.border_color(theme.border)
				.when(app.data.overlay.file_search_open, |el| {
					el.child(div().flex_1().child(Input::new(&app.inputs.file_search)))
						.child(
							div()
								.text_xs()
								.text_color(theme.muted_foreground)
								.child(if q.is_empty() {
									app.t("fileViewerFindInFile")
								} else if hit_count == 0 {
									app.t("terminalSearchNoResults")
								} else {
									format!("{hit_ix}/{hit_count}")
								}),
						)
						.child(
							Button::new("file-find-prev")
								.ghost()
								.xsmall()
								.icon(IconName::ChevronUp)
								.tooltip(app.t("fileViewerPreviousMatch"))
								.on_click({
									let view = view.clone();
									move |_, window, cx| {
										view.update(cx, |app, cx| {
											app.cycle_file_search(window, cx, false);
											cx.notify();
										});
									}
								}),
						)
						.child(
							Button::new("file-find-next")
								.ghost()
								.xsmall()
								.icon(IconName::ChevronDown)
								.tooltip(app.t("fileViewerNextMatch"))
								.on_click({
									let view = view.clone();
									move |_, window, cx| {
										view.update(cx, |app, cx| {
											app.cycle_file_search(window, cx, true);
											cx.notify();
										});
									}
								}),
						)
						.child(
							Button::new("file-find-close")
								.ghost()
								.xsmall()
								.icon(IconName::Close)
								.tooltip(app.t("fileViewerCloseFileSearch"))
								.on_click({
									let view = view.clone();
									move |_, _, cx| {
										view.update(cx, |app, cx| {
											app.data.overlay.file_search_open = false;
											cx.notify();
										});
									}
								}),
						)
				})
				.child(
					Button::new("file-save")
						.xsmall()
						.primary()
						.label(app.t("save"))
						.on_click({
							let view = view.clone();
							move |_, window, cx| {
								view.update(cx, |app, cx| {
									app.save_active_file(window, cx);
									cx.notify();
								});
							}
						}),
				),
		)
		.child(
			div()
				.id("text-editor")
				.flex_1()
				.min_h_0()
				.py(px(12.))
				.child(Input::new(&app.inputs.file_editor)),
		)
		.into_any_element()
}

fn preview_pane(_app: &AppView, file: &crate::state::OpenFileTab, cx: &mut Context<AppView>) -> impl IntoElement {
	let theme = cx.theme().clone();
	let view = cx.entity();
	let path = file.path.clone();
	v_flex()
		.id("binary-preview")
		.size_full()
		.child(
			h_flex()
				.w_full()
				.min_h(px(36.))
				.px_3()
				.bg(theme.muted)
				.justify_between()
				.child(div().text_sm().child(file.title.clone()))
				.child(
					h_flex()
						.gap_2()
						.child(div().text_xs().child(
							if backend::is_document_preview(&file.preview_kind, &file.path)
								&& !backend::is_pdf(&file.path)
								&& file.preview_kind != "pdf"
							{
								"Office Preview".to_string()
							} else {
								"Preview".to_string()
							},
						))
						.child(Button::new("open-external").xsmall().label("Open").on_click({
							let view = view.clone();
							let path = path.clone();
							move |_, _, cx| {
								view.update(cx, |app, _| app.open_external(&path));
							}
						})),
				),
		)
		.child(preview_body(file, cx))
}

fn preview_body(file: &crate::state::OpenFileTab, cx: &mut Context<AppView>) -> impl IntoElement {
	let theme = cx.theme().clone();
	if file.preview_kind == "image" || backend::is_image(&file.path) {
		let src = if file.preview_path.is_empty() {
			file.path.clone()
		} else {
			file.preview_path.clone()
		};
		return div()
			.id("image-preview")
			.size_full()
			.relative()
			.child(checkerboard())
			.child(
				div().absolute().inset_0().flex().items_center().justify_center().child(
					img(PathBuf::from(src))
						.id("image-preview-img")
						.max_w_full()
						.max_h_full(),
				),
			)
			.into_any_element();
	}
	if backend::is_document_preview(&file.preview_kind, &file.path) {
		let path = if file.preview_path.is_empty() {
			file.path.clone()
		} else {
			file.preview_path.clone()
		};
		if let Some(png) = backend::rasterize_pdf_preview(&path) {
			return div()
				.id("document-preview")
				.size_full()
				.bg(rgb(0xffffff))
				.flex()
				.items_center()
				.justify_center()
				.child(img(png).id("pdf-preview-img").max_w_full().max_h_full())
				.into_any_element();
		}
		let open_path = path.clone();
		return v_flex()
			.id("document-preview")
			.size_full()
			.bg(rgb(0xffffff))
			.items_center()
			.justify_center()
			.gap_2()
			.child(div().text_sm().text_color(rgb(0x1f2328)).child(file.title.clone()))
			.child(div().text_xs().text_color(rgb(0x656d76)).child(
				if file.preview_kind == "office-pdf" || backend::is_office(&file.path) {
					"Office Preview".to_string()
				} else {
					"Preview".to_string()
				},
			))
			.child(Button::new("doc-open").small().label("Open").on_click(move |_, _, _| {
				let _ = open::that(&open_path);
			}))
			.into_any_element();
	}
	if file.preview_kind == "archive" && !file.archive_entries.is_empty() {
		let files = file.archive_entries.iter().filter(|(_, k)| k != "dir").count();
		let folders = file.archive_entries.iter().filter(|(_, k)| k == "dir").count();
		return v_flex()
			.id("archive-preview")
			.size_full()
			.p_3()
			.gap_1()
			.child(
				div()
					.text_xs()
					.text_color(theme.muted_foreground)
					.child(format!("{files} files / {folders} folders")),
			)
			.children(file.archive_entries.iter().map(|(path, kind)| {
				let is_dir = kind == "dir";
				let depth = path.matches('/').count();
				h_flex()
					.gap_1()
					.pl(px(4. + 12. * depth as f32))
					.child(
						Icon::new(crate::ui::file_icons::file_icon(path, is_dir, false))
							.w(px(13.))
							.text_color(gpui::rgb(crate::ui::file_icons::file_icon_color(path, is_dir))),
					)
					.child(div().text_size(px(13.)).child(path.clone()))
			}))
			.into_any_element();
	}
	v_flex()
		.flex_1()
		.items_center()
		.justify_center()
		.gap_2()
		.child(
			div()
				.text_color(theme.muted_foreground)
				.child(file.preview_kind.clone()),
		)
		.child(
			div()
				.text_xs()
				.text_color(theme.muted_foreground)
				.child(if file.binary_note.is_empty() {
					"Preview unavailable".to_string()
				} else {
					file.binary_note.clone()
				}),
		)
		.into_any_element()
}

pub fn line_number_count(text: &str) -> usize {
	if text.is_empty() {
		1
	} else {
		text.lines().count().max(1)
	}
}

fn checkerboard() -> impl IntoElement {
	let light = rgb(0x2a2e33);
	let dark = rgb(0x1b1f23);
	let cell = px(16.);
	v_flex()
		.id("image-checkerboard")
		.absolute()
		.inset_0()
		.overflow_hidden()
		.children((0..24).map(move |row| {
			h_flex().children((0..40).map(move |col| {
				div()
					.w(cell)
					.h(cell)
					.bg(if (row + col) % 2 == 0 { light } else { dark })
			}))
		}))
}

fn slash_menu(query: &str, view: &gpui::Entity<AppView>, locale: crate::i18n::Locale) -> impl IntoElement {
	let q = query.trim_start_matches('/').to_ascii_lowercase();
	let items: [(&str, &str, &str); 9] = [
		("h1", "# ", ""),
		("h2", "## ", ""),
		("h3", "### ", ""),
		("ul", "- ", ""),
		("quote", "> ", ""),
		("code", "```\n", "\n```"),
		("link", "[", "](url)"),
		("table", "| A | B |\n| --- | --- |\n|   |   |\n", ""),
		("hr", "---\n", ""),
	];
	v_flex()
		.id("md-slash")
		.px_2()
		.py_1()
		.gap_1()
		.w(px(180.))
		.max_h(px(280.))
		.child(
			div()
				.text_xs()
				.text_color(gpui::hsla(0., 0., 0.5, 1.))
				.child(crate::i18n::t(locale, "notesCommandMenu")),
		)
		.child(
			h_flex().gap_1().flex_wrap().children(
				items
					.into_iter()
					.filter(|(name, _, _)| q.is_empty() || name.contains(&q))
					.map(|(name, prefix, suffix)| {
						let view = view.clone();
						Button::new(crate::ui::eid(format!("slash-{name}")))
							.ghost()
							.xsmall()
							.label(format!("/{name}"))
							.on_click(move |_, window, cx| {
								view.update(cx, |app, cx| {
									let text = app.inputs.file_editor.read(cx).value().to_string();
									let next = crate::app::apply_slash_command(&text, prefix, suffix);
									app.inputs.file_editor.update(cx, |s, cx| {
										s.set_value(next, window, cx);
									});
								});
							})
					}),
			),
		)
}

fn md_btn(
	id: &'static str,
	label: &'static str,
	prefix: &'static str,
	suffix: &'static str,
	view: &gpui::Entity<AppView>,
	tooltip: &str,
) -> impl IntoElement {
	let view = view.clone();
	Button::new(id)
		.ghost()
		.xsmall()
		.label(label)
		.tooltip(tooltip.to_string())
		.on_click(move |_, window, cx| {
			view.update(cx, |app, cx| {
				crate::app::wrap_markup(&app.inputs.file_editor, prefix, suffix, window, cx);
			});
		})
}

#[cfg(test)]
mod tests {
	use super::line_number_count;

	#[test]
	fn line_number_count_empty_is_one() {
		assert_eq!(line_number_count(""), 1);
	}

	#[test]
	fn line_number_count_counts_lines() {
		assert_eq!(line_number_count("a"), 1);
		assert_eq!(line_number_count("a\nb"), 2);
		assert_eq!(line_number_count("a\nb\nc"), 3);
	}
}
