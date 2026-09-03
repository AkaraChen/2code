use gpui::{div, prelude::*, Context, Window};
use gpui_component::input::Input;
use gpui_component::{h_flex, v_flex, ActiveTheme, StyledExt};

use crate::app::AppView;
use crate::state::NotesStatus;

pub fn render(app: &mut AppView, _window: &mut Window, cx: &mut Context<AppView>) -> impl IntoElement {
	let theme = cx.theme().clone();
	let view = cx.entity();
	let status = app
		.data
		.current_ws()
		.map(|w| w.notes_status)
		.unwrap_or_default();
	let badge = match status {
		NotesStatus::Saving => app.t("notesSaving"),
		NotesStatus::Failed => app.t("notesSaveFailedShort"),
		NotesStatus::Saved => app.t("notesSaved"),
	};

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
				.child(div().text_xs().font_semibold().child(app.t("notes")))
				.child(
					div()
						.text_xs()
						.text_color(theme.muted_foreground)
						.child(badge),
				),
		)
		.child(
			div()
				.id("notes-editor")
				.flex_1()
				.min_h_0()
				.p_2()
				.on_mouse_up(gpui::MouseButton::Left, {
					let view = view.clone();
					move |_, _, cx| {
						view.update(cx, |app, cx| {
							app.save_notes(cx);
						});
					}
				})
				.child(Input::new(&app.inputs.notes)),
		)
}
