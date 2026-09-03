use gpui::{div, prelude::*, px, rgb, Context, KeyDownEvent, MouseButton, Window};
use gpui_component::button::{Button, ButtonVariants};
use gpui_component::{h_flex, v_flex, ActiveTheme, Icon, IconName, Sizable, StyledExt};

use crate::app::AppView;
use crate::state::{Route, ToastAction, ToastKind};
use crate::ui::{debug, dialogs, palette, settings, sidebar, workspace};

pub fn leftover_toast_icon(kind: ToastKind) -> IconName {
	match kind {
		ToastKind::Success => IconName::CircleCheck,
		ToastKind::Info => IconName::Info,
		ToastKind::Warning => IconName::TriangleAlert,
		ToastKind::Error => IconName::CircleX,
	}
}

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
			let action = toast.action;
			let icon = leftover_toast_icon(toast.kind);
			h_flex()
				.id(crate::ui::eid(format!("toast-{}", toast.id)))
				.w(px(356.))
				.gap_2()
				.items_start()
				.px_3()
				.py_2()
				.rounded_lg()
				.border_1()
				.border_color(theme.border)
				.bg(theme.popover)
				.shadow_md()
				.on_click({
					let view = view.clone();
					let id = toast.id;
					move |_, _, cx| {
						view.update(cx, |app, cx| {
							app.data.toasts.retain(|t| t.id != id);
							cx.notify();
						});
					}
				})
				.child(Icon::new(icon).w(px(16.)).h(px(16.)))
				.child(
					v_flex()
						.flex_1()
						.min_w_0()
						.gap_1()
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
						}),
				)
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
		.text_color(gpui::hsla(0., 0., 0.45, 1.))
		.tooltip(crate::ui::tip(tip))
		.on_click(move |_, window, _| on(window))
		.hover(|el| {
			if close {
				el.bg(rgb(0xc42b1c)).text_color(gpui::white())
			} else {
				el.bg(gpui::hsla(0., 0., 0.97, 1.))
			}
		})
		.active(|el| {
			if close {
				el.bg(rgb(0xb32717)).text_color(gpui::white())
			} else {
				el.bg(gpui::hsla(0., 0., 0.97, 1.))
			}
		})
		.child(label)
}

#[cfg(test)]
mod tests {
	use super::leftover_toast_icon;
	use crate::state::ToastKind;
	use gpui_component::IconName;

	fn icon_path(name: IconName) -> String {
		gpui_component::IconNamed::path(name).to_string()
	}

	#[test]
	fn leftover_toast_icons_follow_sonner() {
		assert_eq!(
			icon_path(leftover_toast_icon(ToastKind::Success)),
			icon_path(IconName::CircleCheck)
		);
		assert_eq!(
			icon_path(leftover_toast_icon(ToastKind::Info)),
			icon_path(IconName::Info)
		);
		assert_eq!(
			icon_path(leftover_toast_icon(ToastKind::Warning)),
			icon_path(IconName::TriangleAlert)
		);
		assert_eq!(
			icon_path(leftover_toast_icon(ToastKind::Error)),
			icon_path(IconName::CircleX)
		);
	}
}
