use gpui::{div, prelude::*, px, rgb, Context, KeyDownEvent, Window};
use gpui_component::button::{Button, ButtonVariants};
use gpui_component::input::Input;
use gpui_component::{h_flex, v_flex, ActiveTheme, IconName, Sizable, StyledExt};

use crate::app::AppView;

pub fn render(
	app: &mut AppView,
	index: usize,
	_window: &mut Window,
	cx: &mut Context<AppView>,
) -> impl IntoElement {
	let theme = app.current_term_theme();
	let view = cx.entity();
	let Some(term) = app
		.data
		.current_ws()
		.and_then(|w| w.terminals.get(index))
	else {
		return div().id("term-missing").into_any_element();
	};
	let text = term.screen_text();
	let search_open = term.search_open;
	let id = term.id.clone();

	div()
		.id(crate::ui::eid(format!("pty-{id}")))
		.size_full()
		.relative()
		.bg(rgb(theme.bg))
		.text_color(rgb(theme.fg))
		.font_family(app.data.prefs.font_family.clone())
		.text_size(px(app.data.prefs.font_size))
		.child(
			div()
				.id(crate::ui::eid(format!("pty-body-{id}")))
				.size_full()
				.p_2()
				.font_family("monospace")
				.whitespace_nowrap() // may fail
				.on_key_down({
					let view = view.clone();
					move |ev: &KeyDownEvent, _, cx| {
						if let Some(bytes) = key_to_bytes(ev) {
							view.update(cx, |app, _| {
								app.write_to_active_pty(&bytes);
							});
						}
					}
				})
				.child(
					v_flex().children(text.lines().map(|line| {
						div().child(line.to_string())
					})),
				),
		)
		.when(search_open, |el| {
			el.child(
				h_flex()
					.id("term-search")
					.absolute()
					.top(px(12.))
					.right(px(12.))
					.w(px(280.))
					.h(px(28.))
					.px_2()
					.gap_1()
					.rounded_md()
					.bg(cx.theme().background)
					.border_1()
					.border_color(cx.theme().border)
					.shadow_md()
					.child(div().flex_1().child(Input::new(&app.inputs.term_search)))
					.child(
						Button::new("term-search-prev")
							.ghost()
							.xsmall()
							.icon(IconName::ChevronUp)
							.tooltip(app.t("terminalSearchPrevious")),
					)
					.child(
						Button::new("term-search-next")
							.ghost()
							.xsmall()
							.icon(IconName::ChevronDown)
							.tooltip(app.t("terminalSearchNext")),
					)
					.child(
						Button::new("term-search-close")
							.ghost()
							.xsmall()
							.icon(IconName::Close)
							.on_click({
								let view = view.clone();
								move |_, _, cx| {
									view.update(cx, |app, cx| {
										if let Some(term) = app.data.current_ws_mut().and_then(|w| w.active_terminal_mut()) {
											term.search_open = false;
										}
										cx.notify();
									});
								}
							}),
					),
			)
		})
		.into_any_element()
}

fn key_to_bytes(ev: &KeyDownEvent) -> Option<Vec<u8>> {
	let key = ev.keystroke.key.as_str();
	if ev.keystroke.modifiers.control && key == "c" {
		return Some(vec![0x03]);
	}
	if ev.keystroke.modifiers.control && key == "d" {
		return Some(vec![0x04]);
	}
	if ev.keystroke.modifiers.control && key == "l" {
		return Some(vec![0x0c]);
	}
	match key {
		"enter" => Some(b"\r".to_vec()),
		"backspace" => Some(vec![0x7f]),
		"tab" => Some(b"\t".to_vec()),
		"escape" => Some(b"\x1b".to_vec()),
		"up" => Some(b"\x1b[A".to_vec()),
		"down" => Some(b"\x1b[B".to_vec()),
		"right" => Some(b"\x1b[C".to_vec()),
		"left" => Some(b"\x1b[D".to_vec()),
		other if other.len() == 1 => Some(other.as_bytes().to_vec()),
		_ => None,
	}
}
