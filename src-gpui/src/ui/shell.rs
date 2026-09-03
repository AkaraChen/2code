use gpui::{div, prelude::*, px, rgb, Context, Window};
use gpui_component::{ActiveTheme, StyledExt};

use crate::app::AppView;
use crate::state::Route;
use crate::ui::{debug, dialogs, palette, sidebar, workspace};

pub fn render(app: &mut AppView, window: &mut Window, cx: &mut Context<AppView>) -> impl IntoElement {
	let theme = cx.theme().clone();
	div()
		.flex()
		.size_full()
		.bg(theme.background)
		.text_color(theme.foreground)
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
				.when(cfg!(target_os = "windows"), |el| el.child(window_controls())),
		)
		.child(dialogs::render(app, window, cx))
		.child(palette::render(app, window, cx))
		.child(crate::ui::git::render_diff_dialog(app, window, cx))
		.child(debug::render_fab(app, window, cx))
		.child(debug::render_panel(app, window, cx))
		.child(toasts(app, cx))
}

fn home_or_empty(
	app: &mut AppView,
	window: &mut Window,
	cx: &mut Context<AppView>,
) -> gpui::AnyElement {
	crate::ui::home::render(app, window, cx).into_any_element()
}

fn toasts(app: &AppView, cx: &mut Context<AppView>) -> impl IntoElement {
	let theme = cx.theme().clone();
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
				.child(
					div()
						.text_sm()
						.font_semibold()
						.child(toast.title.clone()),
				)
				.when(!toast.body.is_empty(), |el| {
					el.child(
						div()
							.text_xs()
							.text_color(theme.muted_foreground)
							.child(toast.body.clone()),
					)
				})
		}))
}

fn window_controls() -> impl IntoElement {
	div()
		.id("win-controls")
		.absolute()
		.top_0()
		.right_0()
		.h(px(28.))
		.flex()
		.child(win_btn("min", "–", false))
		.child(win_btn("max", "□", false))
		.child(win_btn("close", "×", true))
}

fn win_btn(id: &'static str, label: &'static str, close: bool) -> impl IntoElement {
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
		.child(label)
}
