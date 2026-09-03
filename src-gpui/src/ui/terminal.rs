use gpui::{div, prelude::*, px, rgb, Context, KeyDownEvent, Window};
use gpui_component::button::{Button, ButtonVariants};
use gpui_component::input::Input;
use gpui_component::{h_flex, v_flex, ActiveTheme, IconName, Sizable, StyledExt};

use crate::app::AppView;
use crate::prefs::TermTheme;

pub fn render(app: &mut AppView, index: usize, _window: &mut Window, cx: &mut Context<AppView>) -> impl IntoElement {
	let theme = app.current_term_theme();
	let view = cx.entity();
	let Some(term) = app.data.current_ws().and_then(|w| w.terminals.get(index)) else {
		return div().id("term-missing").into_any_element();
	};
	let search_open = term.search_open;
	let search_query = if search_open {
		app.inputs.term_search.read(cx).value().to_string()
	} else {
		String::new()
	};
	let hits = term.search_hits(&search_query);
	let hit_ix = term.search_ix;
	let id = term.id.clone();
	let clickables = crate::detector::clickable_tokens(&term.screen_text());
	let grid = render_grid(term, theme, &search_query, hit_ix);

	div()
		.id(crate::ui::eid(format!("pty-{id}")))
		.size_full()
		.relative()
		.bg(rgb(theme.bg))
		.text_color(rgb(theme.fg))
		.font_family(app.data.prefs.font_family.clone())
		.text_size(px(app.data.prefs.font_size))
		.on_mouse_up(gpui::MouseButton::Left, {
			let view = view.clone();
			move |_, _, cx| {
				view.update(cx, |app, cx| {
					if app.data.overlay.drag_file.is_some() {
						app.drop_file_on_terminal();
						cx.notify();
					}
				});
			}
		})
		.child(
			div()
				.id(crate::ui::eid(format!("pty-body-{id}")))
				.size_full()
				.p_2()
				.font_family(app.data.prefs.font_family.clone())
				.overflow_hidden()
				.on_key_down({
					let view = view.clone();
					move |ev: &KeyDownEvent, window, cx| {
						if ev.keystroke.modifiers.control && ev.keystroke.key == "f"
							|| ev.keystroke.modifiers.platform && ev.keystroke.key == "f"
						{
							view.update(cx, |app, cx| {
								app.open_find(window, cx);
								cx.notify();
							});
							return;
						}
						if (ev.keystroke.modifiers.platform || ev.keystroke.modifiers.control)
							&& ev.keystroke.key == "v"
							&& !ev.keystroke.modifiers.alt
						{
							view.update(cx, |app, cx| {
								app.paste_to_pty(cx);
							});
							return;
						}
						let handled = view.update(cx, |app, cx| {
							let handled = app.handle_overlay_key(
								ev.keystroke.key.as_str(),
								ev.keystroke.modifiers.shift,
								window,
								cx,
							);
							if handled {
								cx.notify();
							}
							handled
						});
						if handled {
							return;
						}
						if let Some(bytes) = key_to_bytes(ev) {
							view.update(cx, |app, _| {
								app.write_to_active_pty(&bytes);
							});
						}
					}
				})
				.child(grid),
		)
		.when(search_open, |el| {
			el.child(
				h_flex()
					.id("term-search")
					.absolute()
					.top(px(12.))
					.right(px(12.))
					.w(px(320.))
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
						div()
							.text_xs()
							.text_color(cx.theme().muted_foreground)
							.child(if search_query.is_empty() {
								String::new()
							} else if hits.is_empty() {
								app.t("terminalSearchNoResults")
							} else {
								format!("{}/{}", hit_ix + 1, hits.len())
							}),
					)
					.child(
						Button::new("term-search-prev")
							.ghost()
							.xsmall()
							.icon(IconName::ChevronUp)
							.tooltip(app.t("terminalSearchPrevious"))
							.on_click({
								let view = view.clone();
								move |_, _, cx| {
									view.update(cx, |app, cx| {
										app.cycle_term_search(cx, false);
										cx.notify();
									});
								}
							}),
					)
					.child(
						Button::new("term-search-next")
							.ghost()
							.xsmall()
							.icon(IconName::ChevronDown)
							.tooltip(app.t("terminalSearchNext"))
							.on_click({
								let view = view.clone();
								move |_, _, cx| {
									view.update(cx, |app, cx| {
										app.cycle_term_search(cx, true);
										cx.notify();
									});
								}
							}),
					)
					.child(
						Button::new("term-search-close")
							.ghost()
							.xsmall()
							.icon(IconName::Close)
							.tooltip(app.t("terminalSearchClose"))
							.on_click({
								let view = view.clone();
								move |_, _, cx| {
									view.update(cx, |app, cx| {
										if let Some(term) =
											app.data.current_ws_mut().and_then(|w| w.active_terminal_mut())
										{
											term.search_open = false;
										}
										cx.notify();
									});
								}
							}),
					),
			)
		})
		.when(!clickables.is_empty(), |el| {
			el.child(
				h_flex()
					.id("pty-links")
					.absolute()
					.bottom(px(8.))
					.left(px(8.))
					.right(px(8.))
					.gap_1()
					.flex_wrap()
					.children(clickables.into_iter().map(|token| {
						let label = match &token {
							crate::detector::Clickable::Url(u) => u.clone(),
							crate::detector::Clickable::Path(p) => p.clone(),
						};
						let view = view.clone();
						Button::new(crate::ui::eid(format!("pty-link-{label}")))
							.xsmall()
							.label(label)
							.on_click(move |ev, window, cx| {
								let token = token.clone();
								let skip = ev.modifiers().platform || ev.modifiers().control;
								view.update(cx, |app, cx| {
									app.open_clickable(&token, skip, window, cx);
									cx.notify();
								});
							})
					})),
			)
		})
		.into_any_element()
}

fn render_grid(term: &crate::state::TermSession, theme: &TermTheme, query: &str, hit_ix: usize) -> impl IntoElement {
	let screen = term.parser.screen();
	let (rows, cols) = screen.size();
	let hits = term.search_hits(query);
	let active = hits.get(hit_ix).copied();
	let query_len = query.len();

	v_flex().id("pty-grid").children((0..rows).map(|row| {
		let mut spans: Vec<(String, u32, u32, bool)> = Vec::new();
		for col in 0..cols {
			let cell = screen.cell(row, col);
			let ch = cell
				.map(|c| {
					let text = c.contents();
					if text.is_empty() {
						" ".to_string()
					} else {
						text.to_string()
					}
				})
				.unwrap_or_else(|| " ".into());
			let (mut fg, mut bg) = cell
				.map(|c| (map_color(c.fgcolor(), theme.fg), map_color(c.bgcolor(), theme.bg)))
				.unwrap_or((theme.fg, theme.bg));
			if cell.map(|c| c.inverse()).unwrap_or(false) {
				std::mem::swap(&mut fg, &mut bg);
			}
			if cell.map(|c| c.bold()).unwrap_or(false) {
				fg = brighten(fg);
			}
			let highlight = hits
				.iter()
				.any(|&(r, c, len)| r == row && (col as usize) >= c && (col as usize) < c + len);
			if highlight {
				bg = if active == Some((row, col as usize, query_len))
					|| active.is_some_and(|(r, c, len)| r == row && (col as usize) >= c && (col as usize) < c + len)
				{
					0xe3b341
				} else {
					0x3b6ea8
				};
				fg = 0x0d1117;
			}
			if let Some((text, last_fg, last_bg, last_hi)) = spans.last_mut() {
				if *last_fg == fg && *last_bg == bg && *last_hi == highlight {
					text.push_str(&ch);
					continue;
				}
			}
			spans.push((ch, fg, bg, highlight));
		}
		h_flex().children(
			spans
				.into_iter()
				.map(|(text, fg, bg, _)| div().bg(rgb(bg)).text_color(rgb(fg)).whitespace_nowrap().child(text)),
		)
	}))
}

fn map_color(color: vt100::Color, fallback: u32) -> u32 {
	match color {
		vt100::Color::Default => fallback,
		vt100::Color::Idx(idx) => ansi_color(idx),
		vt100::Color::Rgb(r, g, b) => ((r as u32) << 16) | ((g as u32) << 8) | b as u32,
	}
}

fn ansi_color(idx: u8) -> u32 {
	const BASIC: [u32; 16] = [
		0x0d1117, 0xff7b72, 0x3fb950, 0xd29922, 0x58a6ff, 0xbc8cff, 0x39c5cf, 0xc9d1d9, 0x6e7681, 0xffa198, 0x56d364,
		0xe3b341, 0x79c0ff, 0xd2a8ff, 0x56d4dd, 0xffffff,
	];
	if (idx as usize) < 16 {
		return BASIC[idx as usize];
	}
	if idx >= 232 {
		let v = 8 + (idx as u32 - 232) * 10;
		return (v << 16) | (v << 8) | v;
	}
	let n = idx - 16;
	let r = n / 36;
	let g = (n / 6) % 6;
	let b = n % 6;
	let step = |c: u8| if c == 0 { 0 } else { 55 + 40 * c as u32 };
	(step(r) << 16) | (step(g) << 8) | step(b)
}

fn brighten(color: u32) -> u32 {
	let r = ((color >> 16) & 0xff).saturating_add(28).min(255);
	let g = ((color >> 8) & 0xff).saturating_add(28).min(255);
	let b = (color & 0xff).saturating_add(28).min(255);
	(r << 16) | (g << 8) | b
}

fn key_to_bytes(ev: &KeyDownEvent) -> Option<Vec<u8>> {
	let key = ev.keystroke.key.as_str();
	let mods = &ev.keystroke.modifiers;
	if mods.shift && !mods.control && !mods.platform && !mods.alt && key == "enter" {
		return Some(b"\n".to_vec());
	}
	if mods.platform && !mods.control && !mods.alt && !mods.shift {
		match key {
			"left" => return Some(b"\x1b[H".to_vec()),
			"right" => return Some(b"\x1b[F".to_vec()),
			_ => {}
		}
	}
	if mods.alt && !mods.control && !mods.platform && !mods.shift {
		match key {
			"left" => return Some(b"\x1bb".to_vec()),
			"right" => return Some(b"\x1bf".to_vec()),
			_ => {}
		}
	}
	if ev.keystroke.modifiers.control {
		return match key {
			"c" => Some(vec![0x03]),
			"d" => Some(vec![0x04]),
			"l" => Some(vec![0x0c]),
			"u" => Some(vec![0x15]),
			"k" => Some(vec![0x0b]),
			"a" => Some(vec![0x01]),
			"e" => Some(vec![0x05]),
			"w" => Some(vec![0x17]),
			_ => None,
		};
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
		"home" => Some(b"\x1b[H".to_vec()),
		"end" => Some(b"\x1b[F".to_vec()),
		"pageup" => Some(b"\x1b[5~".to_vec()),
		"pagedown" => Some(b"\x1b[6~".to_vec()),
		"delete" => Some(b"\x1b[3~".to_vec()),
		other if other.len() == 1 => Some(other.as_bytes().to_vec()),
		_ => None,
	}
}
