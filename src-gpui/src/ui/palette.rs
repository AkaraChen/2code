use gpui::{div, prelude::*, px, Context, KeyDownEvent, Window};
use gpui_component::input::Input;
use gpui_component::{h_flex, v_flex, ActiveTheme, Icon, StyledExt};

use crate::app::AppView;

pub fn parent_label(relative_path: &str, root_label: &str) -> String {
	match relative_path.rfind('/') {
		Some(ix) if ix > 0 => relative_path[..ix].to_string(),
		_ => root_label.to_string(),
	}
}

pub fn render(app: &mut AppView, _window: &mut Window, cx: &mut Context<AppView>) -> impl IntoElement {
	if !app.data.overlay.palette_open {
		return div().id("palette-closed").into_any_element();
	}
	let theme = cx.theme().clone();
	let view = cx.entity();
	let q = app.inputs.palette.read(cx).value().to_string();
	let results = app.data.overlay.palette_results.clone();
	let selected = app.data.overlay.palette_index;

	div()
		.id("palette-mask")
		.absolute()
		.inset_0()
		.bg(gpui::hsla(0., 0., 0., 0.4))
		.on_click({
			let view = view.clone();
			move |_, _, cx| {
				view.update(cx, |app, cx| {
					app.data.overlay.palette_open = false;
					cx.notify();
				});
			}
		})
		.child(
			v_flex()
				.id("command-palette")
				.absolute()
				.top(px(72.))
				.left_0()
				.right_0()
				.mx_auto()
				.w(px(640.))
				.max_h(px(520.))
				.rounded_lg()
				.bg(theme.background)
				.border_1()
				.border_color(theme.border)
				.shadow_lg()
				.on_click(|_, _, _| {})
				.on_key_down({
					let view = view.clone();
					move |ev: &KeyDownEvent, window, cx| {
						view.update(cx, |app, cx| {
							if app.handle_overlay_key(
								ev.keystroke.key.as_str(),
								ev.keystroke.modifiers.shift,
								window,
								cx,
							) {
								cx.notify();
							}
						});
					}
				})
				.child(
					v_flex()
						.px_4()
						.py_3()
						.gap_1()
						.border_b_1()
						.border_color(theme.border)
						.child(div().text_xs().font_semibold().child(app.t("commandPaletteTitle")))
						.child(Input::new(&app.inputs.palette)),
				)
				.child(if q.is_empty() {
					v_flex()
						.p_4()
						.gap_1()
						.child(
							div()
								.text_sm()
								.text_color(theme.muted_foreground)
								.child(app.t("commandPaletteEmpty")),
						)
						.child(
							div()
								.text_xs()
								.text_color(theme.muted_foreground)
								.child(app.t("commandPaletteHint")),
						)
						.child(
							div()
								.text_xs()
								.text_color(theme.muted_foreground)
								.child(app.t("commandPaletteOpenHint")),
						)
						.into_any_element()
				} else if results.is_empty() {
					v_flex()
						.p_4()
						.gap_1()
						.child(div().child(app.t("commandPaletteNoResults")))
						.child(
							div()
								.text_xs()
								.text_color(theme.muted_foreground)
								.child(app.t("commandPaletteNoResultsHint")),
						)
						.into_any_element()
				} else {
					v_flex()
						.max_h(px(360.))
						.children(results.iter().enumerate().map(|(ix, r)| {
							h_flex()
								.id(crate::ui::eid(format!("pal-{ix}")))
								.px_3()
								.py_2()
								.gap_2()
								.when(ix == selected, |el| el.bg(theme.muted))
								.on_click({
									let view = view.clone();
									move |_, window, cx| {
										view.update(cx, |app, cx| {
											app.data.overlay.palette_index = ix;
											app.open_palette_selection(window, cx);
											cx.notify();
										});
									}
								})
								.child(
									Icon::new(crate::ui::file_icons::file_icon(&r.path, false, false))
										.w(px(16.))
										.text_color(gpui::rgb(crate::ui::file_icons::file_icon_color(&r.path, false))),
								)
								.child(div().text_sm().child(r.name.clone()))
								.child(
									div()
										.text_xs()
										.text_color(theme.muted_foreground)
										.child(parent_label(&r.relative_path, &app.t("commandPaletteRoot"))),
								)
						}))
						.into_any_element()
				})
				.child(
					h_flex()
						.px_3()
						.py_2()
						.border_t_1()
						.border_color(theme.border)
						.justify_between()
						.child(
							div()
								.text_xs()
								.text_color(theme.muted_foreground)
								.child(crate::i18n::tf(
									app.data.locale,
									"commandPaletteResultCount",
									&[("count", &results.len().to_string())],
								)),
						)
						.child(
							div()
								.text_xs()
								.text_color(theme.muted_foreground)
								.child(app.t("commandPaletteFooterHint")),
						),
				),
		)
		.into_any_element()
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn parent_label_uses_directory_or_root() {
		assert_eq!(parent_label("src/app.rs", "Project root"), "src");
		assert_eq!(parent_label("README.md", "Project root"), "Project root");
		assert_eq!(parent_label("src/ui/palette.rs", "根目录"), "src/ui");
	}
}
