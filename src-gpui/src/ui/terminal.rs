use gpui::{
	div, img, prelude::*, px, relative, rgb, Context, CursorStyle, Image, ImageFormat, KeyDownEvent, MouseButton,
	Window,
};
use gpui_component::button::{Button, ButtonVariants};
use gpui_component::input::Input;
use gpui_component::{h_flex, v_flex, ActiveTheme, IconName, Sizable, StyledExt};

use crate::app::AppView;
use crate::prefs::TermTheme;

pub fn render(
	app: &mut AppView,
	profile_id: &str,
	index: usize,
	interactive: bool,
	_window: &mut Window,
	cx: &mut Context<AppView>,
) -> impl IntoElement {
	let theme = app.current_term_theme();
	let view = cx.entity();
	let Some(term) = app.data.workspaces.get(profile_id).and_then(|w| w.terminals.get(index)) else {
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
	let link_hits = crate::detector::clickable_hits(&term.screen_text());
	let osc_bar = crate::detector::parse_osc_progress(&term.osc_progress());
	let images = term.images.clone();
	let font_size = app.data.prefs.font_size;
	let grid = render_grid(term, theme, &search_query, hit_ix, interactive, &view, &link_hits);

	div()
		.id(crate::ui::eid(format!("pty-{id}")))
		.size_full()
		.relative()
		.bg(rgb(theme.bg))
		.text_color(rgb(theme.fg))
		.font(crate::ui::markdown::editor_font(app.data.prefs.font_family.clone()))
		.text_size(px(app.data.prefs.font_size))
		.when(!interactive, |el| el.invisible().absolute().inset_0())
		.when(interactive, |el| {
			el.on_mouse_up(MouseButton::Left, {
				let view = view.clone();
				move |ev, window, cx| {
					let skip = ev.modifiers.platform || ev.modifiers.control;
					view.update(cx, |app, cx| {
						if app.data.overlay.drag_file.is_some() {
							app.drop_file_on_terminal();
						}
						let copied = app
							.data
							.current_ws_mut()
							.and_then(|w| w.active_terminal_mut())
							.is_some_and(|term| term.finish_selection());
						if copied {
							app.copy_term_selection(cx);
						} else if let Some((row, col)) = app
							.data
							.current_ws()
							.and_then(|w| w.active_terminal())
							.and_then(|t| t.click_cell)
						{
							let screen = app
								.data
								.current_ws()
								.and_then(|w| w.active_terminal())
								.map(|t| t.screen_text())
								.unwrap_or_default();
							if let Some(hit) = crate::detector::clickable_hits(&screen)
								.into_iter()
								.find(|h| h.contains(row, col))
							{
								app.open_clickable(&hit.token, skip, window, cx);
							}
						}
						if let Some(term) = app.data.current_ws_mut().and_then(|w| w.active_terminal_mut()) {
							term.click_cell = None;
						}
						cx.notify();
					});
				}
			})
		})
		.child({
			let body = div()
				.id(crate::ui::eid(format!("pty-body-{id}")))
				.size_full()
				.p_2()
				.font(crate::ui::markdown::editor_font(app.data.prefs.font_family.clone()))
				.overflow_hidden()
				.relative()
				.child(grid)
				.children(images.into_iter().enumerate().filter_map(|(i, image)| {
					let kind = crate::detector::image_format(&image.bytes)?;
					let format = match kind {
						"jpeg" => ImageFormat::Jpeg,
						"gif" => ImageFormat::Gif,
						"webp" => ImageFormat::Webp,
						_ => ImageFormat::Png,
					};
					let top = 8.0 + image.row as f32 * font_size * 1.2;
					let left = 8.0 + image.col as f32 * font_size * 0.62;
					Some(
						div()
							.id(crate::ui::eid(format!("pty-img-{id}-{i}")))
							.absolute()
							.top(px(top))
							.left(px(left))
							.child(
								img(std::sync::Arc::new(Image::from_bytes(format, image.bytes)))
									.id(crate::ui::eid(format!("pty-img-src-{id}-{i}")))
									.max_w(px(480.))
									.max_h(px(280.)),
							),
					)
				}));
			if interactive {
				body.on_key_down({
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
						if ev.keystroke.key == "c"
							&& !ev.keystroke.modifiers.alt
							&& !ev.keystroke.modifiers.shift
							&& (ev.keystroke.modifiers.platform || ev.keystroke.modifiers.control)
						{
							view.update(cx, |app, cx| {
								if ev.keystroke.modifiers.platform {
									app.copy_term_selection(cx);
								} else {
									app.copy_term_or_interrupt(cx);
								}
							});
							return;
						}
						if ev.keystroke.key == "l"
							&& ev.keystroke.modifiers.control
							&& !ev.keystroke.modifiers.platform
							&& !ev.keystroke.modifiers.alt
							&& !ev.keystroke.modifiers.shift
						{
							view.update(cx, |app, cx| {
								app.clear_active_terminal();
								cx.notify();
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
				.into_any_element()
			} else {
				body.into_any_element()
			}
		})
		.when_some(osc_bar.filter(|(state, _)| *state != 0), |el, (state, value)| {
			el.child(
				div()
					.id("pty-osc-progress")
					.absolute()
					.top_0()
					.left_0()
					.right_0()
					.h(px(3.))
					.bg(rgb(0x21262d))
					.child(
						div()
							.h_full()
							.bg(rgb(match state {
								2 => 0xda3633,
								3 => 0x8b949e,
								_ => 0x1f6feb,
							}))
							.w(relative(if state == 3 {
								1.0
							} else {
								(value as f32 / 100.0).clamp(0.02, 1.0)
							})),
					),
			)
		})
		.when(search_open && interactive, |el| {
			el.child(
				h_flex()
					.id("term-search")
					.absolute()
					.top(px(12.))
					.right(px(12.))
					.h(px(28.))
					.px_2()
					.gap_1()
					.rounded_md()
					.bg(cx.theme().background)
					.border_1()
					.border_color(cx.theme().border)
					.shadow_md()
					.child(div().w(px(224.)).child(Input::new(&app.inputs.term_search)))
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
		.when(interactive && !clickables.is_empty(), |el| {
			el.child(
				h_flex()
					.id(crate::ui::eid(format!("pty-links-{id}")))
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
							.label(label.clone())
							.tooltip(match &token {
								crate::detector::Clickable::Path(_) => app.t("terminalFilePathTooltip"),
								crate::detector::Clickable::Url(_) => app.t("terminalOpenLink"),
							})
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

fn render_grid(
	term: &crate::state::TermSession,
	theme: &TermTheme,
	query: &str,
	hit_ix: usize,
	interactive: bool,
	view: &gpui::Entity<AppView>,
	link_hits: &[crate::detector::ClickHit],
) -> impl IntoElement {
	let screen = term.parser.screen();
	let (rows, cols) = screen.size();
	let hits = term.search_hits(query);
	let active = hits.get(hit_ix).copied();
	let query_len = query.len();

	v_flex().id("pty-grid").children((0..rows).map(|row| {
		let mut spans: Vec<(String, u32, u32, bool, bool, bool, usize)> = Vec::new();
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
			let selected = term.cell_selected(row, col as usize);
			let linked = link_hits.iter().any(|h| h.contains(row, col as usize));
			if highlight {
				bg = if active == Some((row, col as usize, query_len))
					|| active.is_some_and(|(r, c, len)| r == row && (col as usize) >= c && (col as usize) < c + len)
				{
					0x1f6feb
				} else {
					0x5f4b16
				};
				fg = 0xffffff;
			} else if selected {
				bg = 0x264f78;
				fg = 0xffffff;
			}
			if let Some((text, last_fg, last_bg, last_hi, last_sel, last_link, _)) = spans.last_mut() {
				if *last_fg == fg
					&& *last_bg == bg
					&& *last_hi == highlight
					&& *last_sel == selected
					&& *last_link == linked
				{
					text.push_str(&ch);
					continue;
				}
			}
			spans.push((ch, fg, bg, highlight, selected, linked, col as usize));
		}
		h_flex().children(spans.into_iter().map(|(text, fg, bg, _, _, linked, start_col)| {
			let end_col = start_col + text.chars().count();
			let view = view.clone();
			let span = div()
				.bg(rgb(bg))
				.text_color(rgb(fg))
				.whitespace_nowrap()
				.when(linked, |el| el.underline().cursor(CursorStyle::PointingHand))
				.child(text);
			if !interactive {
				return span.into_any_element();
			}
			span.on_mouse_down(MouseButton::Left, {
				let view = view.clone();
				move |ev, _, cx| {
					let extend = ev.modifiers.shift;
					view.update(cx, |app, cx| {
						if let Some(term) = app.data.current_ws_mut().and_then(|w| w.active_terminal_mut()) {
							term.begin_selection(row, start_col, extend);
							term.click_cell = Some((row, start_col));
						}
						cx.notify();
					});
				}
			})
			.on_mouse_move({
				let view = view.clone();
				move |_, _, cx| {
					view.update(cx, |app, cx| {
						if let Some(term) = app.data.current_ws_mut().and_then(|w| w.active_terminal_mut()) {
							if term.selecting {
								term.extend_selection(row, end_col);
								cx.notify();
							}
						}
					});
				}
			})
			.into_any_element()
		}))
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
