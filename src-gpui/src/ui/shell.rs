use gpui::{div, prelude::*, px, rgb, Context, KeyDownEvent, MouseButton, Window};
use gpui_component::button::{Button, ButtonVariants};
use gpui_component::{ActiveTheme, Sizable, StyledExt};

use crate::app::AppView;
use crate::state::{Route, ToastAction};
use crate::ui::{debug, dialogs, palette, settings, sidebar, workspace};

pub fn render(app: &mut AppView, window: &mut Window, cx: &mut Context<AppView>) -> impl IntoElement {
	let theme = cx.theme().clone();
	let view = cx.entity();
	div()
		.flex()
		.size_full()
		.bg(theme.background)
		.text_color(theme.foreground)
		.on_mouse_move({
			let view = view.clone();
			move |ev, _, cx| {
				view.update(cx, |app, cx| {
					let x = f32::from(ev.position.x);
					let mut changed = false;
					if let Some((start_x, start_w)) = app.data.overlay.sidebar_drag {
						app.data.prefs.sidebar_width = (start_w + x - start_x).clamp(220.0, 420.0);
						changed = true;
					}
					if let Some((start_x, start_w)) = app.data.overlay.profile_sidebar_drag {
						app.data.prefs.profile_sidebar_width = (start_w + x - start_x).clamp(180.0, 560.0);
						changed = true;
					}
					if changed {
						cx.notify();
					}
				});
			}
		})
		.on_key_down({
			let view = view.clone();
			move |ev: &KeyDownEvent, window, cx| {
				view.update(cx, |app, cx| {
					if let Some(profile) = app.data.overlay.sidebar_resize_focus {
						if app.nudge_sidebar(profile, ev.keystroke.key.as_str()) {
							cx.notify();
							return;
						}
					}
					if app.handle_overlay_key(ev.keystroke.key.as_str(), ev.keystroke.modifiers.shift, window, cx) {
						cx.notify();
					}
				});
			}
		})
		.on_mouse_up(MouseButton::Left, {
			let view = view.clone();
			move |_, _, cx| {
				view.update(cx, |app, cx| {
					if app.data.overlay.sidebar_drag.take().is_some()
						|| app.data.overlay.profile_sidebar_drag.take().is_some()
					{
						app.persist_prefs();
						cx.notify();
					}
				});
			}
		})
		.child(sidebar::render(app, window, cx))
		.child(
			div()
				.id("main-column")
				.flex()
				.flex_col()
				.flex_1()
				.min_w_0()
				.min_h_0()
				.bg(theme.background)
				.child(match app.data.route {
					Route::Home => home_or_empty(app, window, cx),
					Route::Workspace => workspace::render(app, window, cx).into_any_element(),
				})
				.when(cfg!(target_os = "windows"), |el| el.child(window_controls(window))),
		)
		.child(dialogs::render(app, window, cx))
		.child(palette::render(app, window, cx))
		.child(crate::ui::git::render_diff_dialog(app, window, cx))
		.child(debug::render_fab(app, window, cx))
		.child(debug::render_panel(app, window, cx))
		.child(toasts(app, cx))
}

fn home_or_empty(app: &mut AppView, window: &mut Window, cx: &mut Context<AppView>) -> gpui::AnyElement {
	crate::ui::home::render(app, window, cx).into_any_element()
}

fn toasts(app: &AppView, cx: &mut Context<AppView>) -> impl IntoElement {
	let theme = cx.theme().clone();
	let view = cx.entity();
	div()
		.id("toasts")
		.absolute()
		.bottom_4()
		.right_4()
		.flex()
		.flex_col()
		.gap_2()
		.children(app.data.toasts.iter().rev().take(4).map(|toast| {
			let bg = theme.background;
			let action = toast.action;
			div()
				.id(crate::ui::eid(format!("toast-{}", toast.id)))
				.w(px(320.))
				.px_3()
				.py_2()
				.rounded_lg()
				.border_1()
				.border_color(theme.border)
				.bg(bg)
				.shadow_md()
				.child(div().text_sm().font_semibold().child(toast.title.clone()))
				.when(!toast.body.is_empty(), |el| {
					el.child(
						div()
							.text_xs()
							.text_color(theme.muted_foreground)
							.child(toast.body.clone()),
					)
				})
				.when(action == Some(ToastAction::OpenAbout), |el| {
					el.child(
						Button::new(crate::ui::eid(format!("toast-act-{}", toast.id)))
							.xsmall()
							.label(app.t("openUpdatePage"))
							.on_click({
								let view = view.clone();
								move |_, window, cx| {
									view.update(cx, |app, cx| {
										settings::open_update_page(app, window, cx);
									});
								}
							}),
					)
				})
		}))
}

fn window_controls(window: &Window) -> impl IntoElement {
	let maximized = window.is_maximized();
	div()
		.id("win-controls")
		.absolute()
		.top_0()
		.right_0()
		.h(px(28.))
		.flex()
		.child(win_btn("min", "–", "Minimize", false, |window| {
			window.minimize_window()
		}))
		.child(win_btn(
			"max",
			if maximized { "❐" } else { "□" },
			if maximized { "Restore" } else { "Maximize" },
			false,
			|window| window.zoom_window(),
		))
		.child(win_btn("close", "×", "Close", true, |window| window.remove_window()))
}

fn win_btn(
	id: &'static str,
	label: &'static str,
	tip: &'static str,
	close: bool,
	on: impl Fn(&mut Window) + 'static,
) -> impl IntoElement {
	div()
		.id(id)
		.h(px(28.))
		.w(px(36.))
		.flex()
		.items_center()
		.justify_center()
		.text_xs()
		.hover(|el| {
			if close {
				el.bg(rgb(0xc42b1c)).text_color(gpui::white())
			} else {
				el.bg(gpui::hsla(0., 0., 0.5, 0.12))
			}
		})
		.child(
			Button::new(crate::ui::eid(format!("{id}-btn")))
				.ghost()
				.xsmall()
				.label(label)
				.tooltip(tip.to_string())
				.on_click(move |_, window, _| on(window)),
		)
}
