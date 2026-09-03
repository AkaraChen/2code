use gpui::{div, prelude::*, Context, Window};
use gpui_component::input::Input;
use gpui_component::v_flex;

use crate::app::AppView;
use crate::ui::markdown::{self, MarkupTarget};

pub fn render(app: &mut AppView, window: &mut Window, cx: &mut Context<AppView>) -> impl IntoElement {
	v_flex()
		.id("notes-panel")
		.size_full()
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
