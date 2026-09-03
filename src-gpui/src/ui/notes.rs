use gpui::{div, prelude::*, Context, Window};
use gpui_component::input::Input;
use gpui_component::{h_flex, v_flex, ActiveTheme, StyledExt};

use crate::app::AppView;
use crate::ui::markdown::{self, MarkupTarget};

pub fn render(app: &mut AppView, window: &mut Window, cx: &mut Context<AppView>) -> impl IntoElement {
	let theme = cx.theme().clone();
	v_flex()
		.id("notes-panel")
		.size_full()
		.child(
			h_flex()
				.w_full()
				.px_2()
				.py_1()
				.justify_between()
				.border_b_1()
				.border_color(theme.border)
				.child(div().text_xs().font_semibold().child(app.t("notes"))),
		)
		.child(markdown::toolbar(app, MarkupTarget::Notes, window, cx))
		.child(
			div()
				.id("notes-editor")
				.flex_1()
				.min_h_0()
				.p_2()
				.child(Input::new(&app.inputs.notes)),
		)
}
