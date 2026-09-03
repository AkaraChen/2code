use gpui::{div, prelude::*, px, Context, Window};
use gpui_component::button::{Button, ButtonRounded, ButtonVariants};
use gpui_component::input::Input;
use gpui_component::{h_flex, v_flex, ActiveTheme, IconName};

use crate::app::AppView;
use crate::backend;

pub fn leftover_debug_count(filtered: usize, total: usize) -> String {
	format!("{filtered} / {total}")
}

pub fn leftover_debug_level_variant(level: &str) -> &'static str {
	match level {
		"ERROR" => "destructive",
		"WARN" => "secondary",
		"INFO" => "default",
		_ => "secondary",
	}
}

fn leftover_level_colors(level: &str, theme: &gpui_component::Theme) -> (gpui::Hsla, gpui::Hsla) {
	match leftover_debug_level_variant(level) {
		"destructive" => (theme.danger, theme.danger_foreground),
		"default" => (theme.primary, theme.primary_foreground),
		_ => (theme.secondary, theme.secondary_foreground),
	}
}

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
				.primary()
				.icon(IconName::Inspector)
				.rounded(ButtonRounded::Size(px(16.)))
				.tooltip(app.t("debugLog"))
				.on_click(move |_, window, cx| {
					view.update(cx, |app, cx| {
						app.open_debug_log(window, cx);
						cx.notify();
					});
				}),
		)
		.into_any_element()
}

pub fn render_dialog_body(app: &mut AppView, cx: &mut Context<AppView>) -> impl IntoElement {
	let view = cx.entity();
	let theme = cx.theme().clone();
	let q = app.inputs.debug_search.read(cx).value().to_string();
	let total = app.data.overlay.debug_logs.len();
	let logs: Vec<_> = app
		.data
		.overlay
		.debug_logs
		.iter()
		.filter(|l| backend::leftover_debug_log_matches(l, &q))
		.cloned()
		.collect();
	let filtered = logs.len();
	v_flex()
		.id("debug-log-body")
		.w_full()
		.min_h(px(280.))
		.max_h(px(520.))
		.gap_2()
		.child(
			h_flex()
				.w_full()
				.gap_2()
				.px_1()
				.child(div().flex_1().child(Input::new(&app.inputs.debug_search)))
				.child(
					Button::new("debug-clear")
						.ghost()
						.icon(IconName::Delete)
						.tooltip(app.t("debugClear"))
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
			div()
				.flex_1()
				.w_full()
				.py_8()
				.flex()
				.items_center()
				.justify_center()
				.child(
					div()
						.text_sm()
						.text_color(theme.muted_foreground)
						.child(app.t("debugNoLogs")),
				)
				.into_any_element()
		} else {
			v_flex()
				.id("debug-log-list")
				.flex_1()
				.w_full()
				.min_h(px(160.))
				.overflow_y_scroll()
				.children(logs.into_iter().map(|l| {
					let (badge_bg, badge_fg) = leftover_level_colors(&l.level, &theme);
					h_flex()
						.id(crate::ui::eid(format!("dbg-{}-{}", l.timestamp, l.source)))
						.w_full()
						.items_start()
						.gap_2()
						.px_3()
						.py(px(2.))
						.hover(|el| el.bg(theme.muted))
						.child(
							div()
								.flex_shrink_0()
								.text_xs()
								.font_family("monospace")
								.text_color(theme.muted_foreground)
								.child(backend::format_debug_time(l.timestamp)),
						)
						.child(
							div()
								.flex_shrink_0()
								.h(px(16.))
								.px(px(6.))
								.rounded_md()
								.bg(badge_bg)
								.text_color(badge_fg)
								.text_xs()
								.font_family("monospace")
								.child(l.level.clone()),
						)
						.child(
							div()
								.flex_shrink_0()
								.text_xs()
								.font_family("monospace")
								.text_color(theme.muted_foreground)
								.child(l.source.clone()),
						)
						.child(
							div()
								.flex_1()
								.text_xs()
								.font_family("monospace")
								.child(l.message.clone()),
						)
				}))
				.into_any_element()
		})
		.child(
			h_flex().w_full().justify_end().px_1().py_1().child(
				div()
					.text_xs()
					.text_color(theme.muted_foreground)
					.child(leftover_debug_count(filtered, total)),
			),
		)
}

#[cfg(test)]
mod tests {
	use super::{leftover_debug_count, leftover_debug_level_variant};

	#[test]
	fn leftover_debug_footer_matches_inventory() {
		assert_eq!(leftover_debug_count(3, 10), "3 / 10");
		assert_eq!(leftover_debug_count(0, 0), "0 / 0");
	}

	#[test]
	fn leftover_debug_level_badges() {
		assert_eq!(leftover_debug_level_variant("ERROR"), "destructive");
		assert_eq!(leftover_debug_level_variant("WARN"), "secondary");
		assert_eq!(leftover_debug_level_variant("INFO"), "default");
		assert_eq!(leftover_debug_level_variant("TRACE"), "secondary");
	}
}
