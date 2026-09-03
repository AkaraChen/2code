use gpui::{div, prelude::*, px, Context, Window};
use gpui_component::button::{Button, ButtonVariants};
use gpui_component::input::Input;
use gpui_component::text::TextView;
use gpui_component::{h_flex, v_flex, ActiveTheme, Sizable, StyledExt};

use crate::app::AppView;
use crate::state::NotesStatus;

pub fn render(app: &mut AppView, window: &mut Window, cx: &mut Context<AppView>) -> impl IntoElement {
	let theme = cx.theme().clone();
	let view = cx.entity();
	let status = app.data.current_ws().map(|w| w.notes_status).unwrap_or_default();
	let badge = match status {
		NotesStatus::Saving => app.t("notesSaving"),
		NotesStatus::Failed => app.t("notesSaveFailedShort"),
		NotesStatus::Saved => app.t("notesSaved"),
	};
	let draft = app.inputs.notes.read(cx).value().to_string();

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
				.child(div().text_xs().text_color(theme.muted_foreground).child(badge)),
		)
		.child(
			h_flex()
				.w_full()
				.px_2()
				.py_1()
				.gap_1()
				.border_b_1()
				.border_color(theme.border)
				.child(note_md("n-h1", "H1", "# ", "", &view))
				.child(note_md("n-b", "B", "**", "**", &view))
				.child(note_md("n-i", "I", "*", "*", &view))
				.child(note_md("n-code", "`", "`", "`", &view))
				.child(note_md("n-ul", "•", "- ", "", &view))
				.child(note_md("n-q", ">", "> ", "", &view))
				.child(note_md("n-link", "[]", "[", "](url)", &view)),
		)
		.child(
			v_flex()
				.id("notes-editor")
				.flex_1()
				.min_h_0()
				.child(
					div()
						.flex_1()
						.min_h(px(120.))
						.p_2()
						.child(Input::new(&app.inputs.notes)),
				)
				.child(
					div()
						.flex_1()
						.min_h(px(80.))
						.p_2()
						.border_t_1()
						.border_color(theme.border)
						.child(TextView::markdown("notes-preview", draft, window, cx)),
				),
		)
}

fn note_md(
	id: &'static str,
	label: &'static str,
	prefix: &'static str,
	suffix: &'static str,
	view: &gpui::Entity<AppView>,
) -> impl IntoElement {
	let view = view.clone();
	Button::new(id)
		.ghost()
		.xsmall()
		.label(label)
		.on_click(move |_, window, cx| {
			view.update(cx, |app, cx| {
				let mut text = app.inputs.notes.read(cx).value().to_string();
				if !text.is_empty() && !text.ends_with('\n') && prefix.ends_with(' ') {
					text.push('\n');
				}
				text.push_str(prefix);
				text.push_str(suffix);
				app.inputs.notes.update(cx, |s, cx| {
					s.set_value(text, window, cx);
				});
			});
		})
}
