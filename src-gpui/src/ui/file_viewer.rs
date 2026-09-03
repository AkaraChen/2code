use std::path::PathBuf;

use gpui::{div, img, prelude::*, px, rgb, Context, Window};
use gpui_component::button::{Button, ButtonVariants};
use gpui_component::input::Input;
use gpui_component::text::TextView;
use gpui_component::{h_flex, v_flex, ActiveTheme, Sizable, StyledExt};

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

	if file.preview {
		return preview_pane(app, &file, cx).into_any_element();
	}

	if backend::is_markdown(&file.path) {
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
					.child(md_btn("md-h1", "H1", "# ", "", &view))
					.child(md_btn("md-h2", "H2", "## ", "", &view))
					.child(md_btn("md-h3", "H3", "### ", "", &view))
					.child(md_btn("md-b", "B", "**", "**", &view))
					.child(md_btn("md-i", "I", "*", "*", &view))
					.child(md_btn("md-s", "S", "~~", "~~", &view))
					.child(md_btn("md-code", "`", "`", "`", &view))
					.child(md_btn("md-pre", "</>", "```\n", "\n```", &view))
					.child(md_btn("md-ul", "•", "- ", "", &view))
					.child(md_btn("md-ol", "1.", "1. ", "", &view))
					.child(md_btn("md-q", ">", "> ", "", &view))
					.child(md_btn("md-link", "[]", "[", "](url)", &view))
					.child(md_btn("md-img", "img", "![", "](src)", &view))
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
	let hits = if q.is_empty() {
		0
	} else {
		file.draft.matches(&q).count()
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
				.child(div().flex_1().child(Input::new(&app.inputs.file_search)))
				.child(
					div()
						.text_xs()
						.text_color(theme.muted_foreground)
						.child(if q.is_empty() { String::new() } else { format!("{hits}") }),
				)
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
		.child(div().flex_1().min_h_0().child(Input::new(&app.inputs.file_editor)))
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
						.child(div().text_xs().child(if file.preview_kind == "office" {
							"Office Preview".to_string()
						} else {
							"Preview".to_string()
						}))
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
			.flex()
			.items_center()
			.justify_center()
			.bg(rgb(0x1b1f23))
			.child(
				img(PathBuf::from(src))
					.id("image-preview-img")
					.max_w_full()
					.max_h_full(),
			)
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
				h_flex()
					.gap_2()
					.child(div().text_xs().text_color(theme.muted_foreground).child(kind.clone()))
					.child(div().text_sm().child(path.clone()))
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

fn md_btn(
	id: &'static str,
	label: &'static str,
	prefix: &'static str,
	suffix: &'static str,
	view: &gpui::Entity<AppView>,
) -> impl IntoElement {
	let view = view.clone();
	Button::new(id)
		.ghost()
		.xsmall()
		.label(label)
		.on_click(move |_, window, cx| {
			view.update(cx, |app, cx| {
				let mut text = app.inputs.file_editor.read(cx).value().to_string();
				if !text.is_empty() && !text.ends_with('\n') && (prefix.ends_with(' ') || prefix.ends_with('\n')) {
					text.push('\n');
				}
				text.push_str(prefix);
				text.push_str(suffix);
				app.inputs.file_editor.update(cx, |s, cx| {
					s.set_value(text, window, cx);
				});
			});
		})
}
