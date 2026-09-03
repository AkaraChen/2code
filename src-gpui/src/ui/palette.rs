use gpui::{div, prelude::*, px, Context, KeyDownEvent, Window};
use gpui_component::input::Input;
use gpui_component::{h_flex, v_flex, ActiveTheme, StyledExt};

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
					div()
						.px_4()
						.py_3()
						.border_b_1()
						.border_color(theme.border)
						.child(Input::new(&app.inputs.palette)),
				)
				.child(if results.is_empty() {
					div()
						.flex()
						.justify_center()
						.px_4()
						.py_8()
						.child(
							div()
								.text_sm()
								.text_color(theme.muted_foreground)
								.child(if q.trim().is_empty() {
									app.t("commandPaletteEmpty")
								} else {
									app.t("commandPaletteNoResults")
								}),
						)
						.into_any_element()
				} else {
					v_flex()
						.max_h(px(420.))
						.p_1()
						.children(results.iter().enumerate().map(|(ix, r)| {
							h_flex()
								.id(crate::ui::eid(format!("pal-{ix}")))
								.min_w_0()
								.px_3()
								.py_2()
								.gap_2()
								.rounded_md()
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
								.child(crate::ui::file_icons::file_glyph(&r.name, false, false, 16.))
								.child(
									v_flex()
										.min_w_0()
										.flex_1()
										.child(div().text_sm().overflow_hidden().child(r.name.clone()))
										.child(
											div()
												.text_xs()
												.overflow_hidden()
												.text_color(theme.muted_foreground)
												.child(parent_label(&r.relative_path, &app.t("commandPaletteRoot"))),
										),
								)
						}))
						.into_any_element()
				}),
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
