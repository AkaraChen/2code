use gpui::{div, prelude::*, px, Context, Window};
use gpui_component::button::{Button, ButtonVariants};
use gpui_component::input::Input;
use gpui_component::{h_flex, v_flex, ActiveTheme, IconName, Sizable, StyledExt};

use crate::app::AppView;

pub fn render_fab(app: &AppView, _window: &mut Window, cx: &mut Context<AppView>) -> impl IntoElement {
	if !app.data.prefs.debug_mode {
		return div().id("debug-fab-off").into_any_element();
	}
	let view = cx.entity();
	div()
		.id("debug-fab")
		.absolute()
		.right(px(64.))
		.bottom(px(16.))
		.child(
			Button::new("debug-toggle")
				.icon(IconName::Inspector)
				.tooltip(app.t("debugLog"))
				.on_click(move |_, _, cx| {
					view.update(cx, |app, cx| {
						app.data.overlay.debug_open = !app.data.overlay.debug_open;
						cx.notify();
					});
				}),
		)
		.into_any_element()
}

pub fn render_panel(app: &mut AppView, _window: &mut Window, cx: &mut Context<AppView>) -> impl IntoElement {
	if !app.data.overlay.debug_open && app.data.overlay.dialog != Some(crate::state::DialogKind::DebugLog) {
		return div().id("debug-panel-off").into_any_element();
	}
	if !app.data.overlay.debug_open {
		return debug_body(app, cx).into_any_element();
	}
	let theme = cx.theme().clone();
	div()
		.id("debug-panel")
		.absolute()
		.right(px(16.))
		.bottom(px(64.))
		.w(px(420.))
		.h(px(280.))
		.rounded_lg()
		.bg(theme.background)
		.border_1()
		.border_color(theme.border)
		.shadow_lg()
		.child(debug_body(app, cx))
		.into_any_element()
}

fn debug_body(app: &mut AppView, cx: &mut Context<AppView>) -> impl IntoElement {
	let view = cx.entity();
	let theme = cx.theme().clone();
	let q = app.inputs.debug_search.read(cx).value().to_string();
	let logs: Vec<_> = app
		.data
		.overlay
		.debug_logs
		.iter()
		.filter(|l| {
			q.is_empty()
				|| crate::backend::format_debug_log(l)
					.to_ascii_lowercase()
					.contains(&q.to_ascii_lowercase())
		})
		.cloned()
		.collect();
	v_flex()
		.size_full()
		.child(
			h_flex()
				.w_full()
				.px_2()
				.py_1()
				.gap_2()
				.child(div().flex_1().child(Input::new(&app.inputs.debug_search)))
				.child(
					Button::new("debug-clear")
						.xsmall()
						.label(app.t("debugClear"))
						.on_click({
							let view = view.clone();
							move |_, _, cx| {
								view.update(cx, |app, cx| {
									app.data.overlay.debug_logs.clear();
									cx.notify();
								});
							}
						}),
				),
		)
		.child(if logs.is_empty() {
			div().flex_1().p_4().child(app.t("debugNoLogs")).into_any_element()
		} else {
			v_flex()
				.flex_1()
				.p_2()
				.children(logs.into_iter().map(|l| {
					let level_color = match l.level.as_str() {
						"ERROR" => gpui::rgb(0xef4444),
						"WARN" => gpui::rgb(0xf59e0b),
						_ => gpui::rgb(0x22c55e),
					};
					h_flex()
						.gap_2()
						.child(
							div()
								.text_xs()
								.font_family("monospace")
								.text_color(theme.muted_foreground)
								.child(crate::backend::format_debug_time(l.timestamp)),
						)
						.child(
							div()
								.text_xs()
								.font_family("monospace")
								.text_color(level_color)
								.child(l.level.clone()),
						)
						.child(
							div()
								.text_xs()
								.font_family("monospace")
								.child(format!("{} {}", l.source, l.message)),
						)
				}))
				.into_any_element()
		})
}
