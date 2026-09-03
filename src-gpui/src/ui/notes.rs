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
	let slash = draft.lines().last().unwrap_or("").to_string();

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
				.child(note_md("n-h1", "H1", "# ", "", &view, &app.t("notesFormatHeading1")))
				.child(note_md("n-h2", "H2", "## ", "", &view, &app.t("notesFormatHeading2")))
				.child(note_md("n-h3", "H3", "### ", "", &view, &app.t("notesFormatHeading3")))
				.child(note_md("n-b", "B", "**", "**", &view, &app.t("notesFormatBold")))
				.child(note_md("n-i", "I", "*", "*", &view, &app.t("notesFormatItalic")))
				.child(note_md("n-s", "S", "~~", "~~", &view, &app.t("notesFormatStrike")))
				.child(note_md("n-code", "`", "`", "`", &view, &app.t("notesFormatCode")))
				.child(note_md(
					"n-pre",
					"</>",
					"```\n",
					"\n```",
					&view,
					&app.t("notesFormatCodeBlock"),
				))
				.child(note_md("n-ul", "•", "- ", "", &view, &app.t("notesFormatBulletList")))
				.child(note_md(
					"n-ol",
					"1.",
					"1. ",
					"",
					&view,
					&app.t("notesFormatOrderedList"),
				))
				.child(note_md("n-q", ">", "> ", "", &view, &app.t("notesFormatQuote")))
				.child(note_md("n-link", "[]", "[", "](url)", &view, &app.t("notesFormatLink")))
				.child(note_md(
					"n-table",
					"tbl",
					"| A | B |\n| --- | --- |\n|   |   |\n",
					"",
					&view,
					&app.t("notesInsertTable"),
				))
				.child(note_md("n-hr", "—", "---\n", "", &view, &app.t("notesInsertDivider"))),
		)
		.when(slash.starts_with('/'), |el| {
			el.child(notes_slash_menu(&slash, &view, app.data.locale))
		})
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

fn notes_slash_menu(query: &str, view: &gpui::Entity<AppView>, locale: crate::i18n::Locale) -> impl IntoElement {
	let q = query.trim_start_matches('/').to_ascii_lowercase();
	let items: [(&str, &str, &str); 9] = [
		("h1", "# ", ""),
		("h2", "## ", ""),
		("h3", "### ", ""),
		("ul", "- ", ""),
		("quote", "> ", ""),
		("code", "```\n", "\n```"),
		("link", "[", "](url)"),
		("table", "| A | B |\n| --- | --- |\n|   |   |\n", ""),
		("hr", "---\n", ""),
	];
	v_flex()
		.id("notes-slash")
		.px_2()
		.py_1()
		.gap_1()
		.w(px(180.))
		.max_h(px(280.))
		.child(
			div()
				.text_xs()
				.text_color(gpui::hsla(0., 0., 0.5, 1.))
				.child(crate::i18n::t(locale, "notesCommandMenu")),
		)
		.child(
			h_flex().gap_1().flex_wrap().children(
				items
					.into_iter()
					.filter(|(name, _, _)| q.is_empty() || name.contains(&q))
					.map(|(name, prefix, suffix)| {
						let view = view.clone();
						Button::new(crate::ui::eid(format!("notes-slash-{name}")))
							.ghost()
							.xsmall()
							.label(format!("/{name}"))
							.on_click(move |_, window, cx| {
								view.update(cx, |app, cx| {
									let text = app.inputs.notes.read(cx).value().to_string();
									let next = crate::app::apply_slash_command(&text, prefix, suffix);
									app.inputs.notes.update(cx, |s, cx| {
										s.set_value(next, window, cx);
									});
								});
							})
					}),
			),
		)
}

fn note_md(
	id: &'static str,
	label: &'static str,
	prefix: &'static str,
	suffix: &'static str,
	view: &gpui::Entity<AppView>,
	tooltip: &str,
) -> impl IntoElement {
	let view = view.clone();
	Button::new(id)
		.ghost()
		.xsmall()
		.label(label)
		.tooltip(tooltip.to_string())
		.on_click(move |_, window, cx| {
			view.update(cx, |app, cx| {
				crate::app::wrap_markup(&app.inputs.notes, prefix, suffix, window, cx);
			});
		})
}
