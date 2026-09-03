use gpui::{div, prelude::*, px, Context, Entity, Window};
use gpui_component::button::{Button, ButtonVariants};
use gpui_component::input::{Input, InputState};
use gpui_component::{h_flex, v_flex, ActiveTheme, IconName, Selectable, Sizable};

use crate::app::AppView;
use crate::i18n;
use crate::state::{MdMenu, NotesStatus};

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum MarkupTarget {
	Notes,
	File,
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum TableOp {
	Insert,
	AddRowAfter,
	AddColAfter,
	AddRowBefore,
	AddColBefore,
	DeleteRow,
}

#[derive(Clone, Copy)]
pub struct SlashItem {
	pub key: &'static str,
	pub label_key: &'static str,
	pub action: MdAction,
}

#[derive(Clone, Copy)]
pub enum MdAction {
	Wrap(&'static str, &'static str),
	Block(&'static str),
	Slash(&'static str, &'static str),
	Insert(&'static str),
	Table(TableOp),
	ApplyLink,
	RemoveLink,
}

pub const DEFAULT_TABLE: &str = "|  |  |  |\n| --- | --- | --- |\n|  |  |  |\n|  |  |  |\n";

pub fn slash_items() -> &'static [SlashItem] {
	&[
		SlashItem {
			key: "paragraph",
			label_key: "notesFormatParagraph",
			action: MdAction::Slash("", ""),
		},
		SlashItem {
			key: "h1",
			label_key: "notesFormatHeading1",
			action: MdAction::Slash("# ", ""),
		},
		SlashItem {
			key: "h2",
			label_key: "notesFormatHeading2",
			action: MdAction::Slash("## ", ""),
		},
		SlashItem {
			key: "h3",
			label_key: "notesFormatHeading3",
			action: MdAction::Slash("### ", ""),
		},
		SlashItem {
			key: "ul",
			label_key: "notesFormatBulletList",
			action: MdAction::Slash("- ", ""),
		},
		SlashItem {
			key: "ol",
			label_key: "notesFormatOrderedList",
			action: MdAction::Slash("1. ", ""),
		},
		SlashItem {
			key: "quote",
			label_key: "notesFormatQuote",
			action: MdAction::Slash("> ", ""),
		},
		SlashItem {
			key: "code",
			label_key: "notesFormatCodeBlock",
			action: MdAction::Slash("```\n", "\n```"),
		},
		SlashItem {
			key: "table",
			label_key: "notesInsertTable",
			action: MdAction::Slash(DEFAULT_TABLE, ""),
		},
		SlashItem {
			key: "hr",
			label_key: "notesInsertDivider",
			action: MdAction::Slash("---\n", ""),
		},
	]
}

pub fn editor_font(family: impl Into<gpui::SharedString>) -> gpui::Font {
	let mut font = gpui::font(family);
	font.features = gpui::FontFeatures(std::sync::Arc::new(vec![("liga".into(), 1), ("calt".into(), 1)]));
	font
}

pub fn line_range(text: &str, caret: usize) -> (usize, usize) {
	let caret = caret.min(text.len());
	let start = text[..caret].rfind('\n').map(|i| i + 1).unwrap_or(0);
	let end = text[caret..].find('\n').map(|i| caret + i).unwrap_or(text.len());
	(start, end)
}

pub fn slash_query(text: &str, caret: usize) -> Option<String> {
	let (start, end) = line_range(text, caret);
	text[start..end].strip_prefix('/').map(|rest| rest.to_string())
}

pub fn apply_slash_at(text: &str, caret: usize, prefix: &str, suffix: &str) -> (String, usize) {
	let (start, end) = line_range(text, caret);
	if text[start..end].starts_with('/') {
		let mut out = String::with_capacity(text.len() + prefix.len() + suffix.len());
		out.push_str(&text[..start]);
		out.push_str(prefix);
		out.push_str(suffix);
		out.push_str(&text[end..]);
		(out, start + prefix.len())
	} else {
		crate::app::wrap_markup_text(text, caret, caret, prefix, suffix)
	}
}

pub fn strip_block_prefix(line: &str) -> &str {
	let trimmed = line.trim_start();
	if let Some(rest) = trimmed.strip_prefix("### ") {
		rest
	} else if let Some(rest) = trimmed.strip_prefix("## ") {
		rest
	} else if let Some(rest) = trimmed.strip_prefix("# ") {
		rest
	} else if let Some(rest) = trimmed.strip_prefix("> ") {
		rest
	} else if let Some(rest) = trimmed.strip_prefix("- ") {
		rest
	} else if let Some(rest) = trimmed.strip_prefix("* ") {
		rest
	} else if let Some(rest) = trimmed.strip_prefix("+ ") {
		rest
	} else if let Some((num, rest)) = trimmed.split_once(". ") {
		if !num.is_empty() && num.chars().all(|c| c.is_ascii_digit()) {
			rest
		} else {
			trimmed
		}
	} else {
		trimmed
	}
}

pub fn apply_block_prefix(text: &str, caret: usize, prefix: &str) -> (String, usize) {
	let (start, end) = line_range(text, caret);
	let line = &text[start..end];
	let indent: String = line.chars().take_while(|c| c.is_whitespace()).collect();
	let body = strip_block_prefix(line.trim_start());
	let mut out = String::with_capacity(text.len() + prefix.len());
	out.push_str(&text[..start]);
	out.push_str(&indent);
	out.push_str(prefix);
	out.push_str(body);
	out.push_str(&text[end..]);
	(out, start + indent.len() + prefix.len())
}

pub fn insert_snippet(text: &str, caret: usize, snippet: &str) -> (String, usize) {
	let (start, end) = line_range(text, caret);
	let empty = text[start..end].trim().is_empty();
	let at = if empty { start } else { end };
	let mut out = String::new();
	out.push_str(&text[..at]);
	if at > 0 && !text[..at].ends_with('\n') {
		out.push('\n');
	}
	out.push_str(snippet);
	let caret = out.len();
	if empty {
		out.push_str(&text[end..]);
	} else {
		if !snippet.ends_with('\n') && at < text.len() {
			out.push('\n');
		}
		out.push_str(&text[at..]);
	}
	let at = caret.min(out.len());
	(out, at)
}

fn is_table_line(line: &str) -> bool {
	let t = line.trim();
	t.starts_with('|') && t.ends_with('|') && t.len() > 1
}

fn is_separator_row(cells: &[String]) -> bool {
	!cells.is_empty()
		&& cells.iter().all(|c| {
			let t = c.trim();
			!t.is_empty() && t.chars().all(|ch| ch == '-' || ch == ':')
		})
}

fn split_cells(line: &str) -> Vec<String> {
	let t = line.trim();
	let inner = t.strip_prefix('|').and_then(|s| s.strip_suffix('|')).unwrap_or(t);
	inner.split('|').map(|c| c.trim().to_string()).collect()
}

fn join_cells(cells: &[String]) -> String {
	format!("| {} |", cells.join(" | "))
}

#[derive(Debug, Clone)]
struct TableSpan {
	start_line: usize,
	end_line: usize,
	rows: Vec<Vec<String>>,
	row: usize,
	col: usize,
}

fn line_starts(text: &str) -> Vec<usize> {
	let mut starts = vec![0];
	for (i, ch) in text.char_indices() {
		if ch == '\n' {
			starts.push(i + 1);
		}
	}
	starts
}

fn table_at(text: &str, caret: usize) -> Option<TableSpan> {
	let starts = line_starts(text);
	let caret = caret.min(text.len());
	let line_ix = starts.iter().rposition(|&s| s <= caret).unwrap_or(0);
	let lines: Vec<&str> = text.split('\n').collect();
	if line_ix >= lines.len() || !is_table_line(lines[line_ix]) {
		return None;
	}
	let mut start = line_ix;
	while start > 0 && is_table_line(lines[start - 1]) {
		start -= 1;
	}
	let mut end = line_ix;
	while end + 1 < lines.len() && is_table_line(lines[end + 1]) {
		end += 1;
	}
	let rows: Vec<Vec<String>> = lines[start..=end].iter().map(|l| split_cells(l)).collect();
	if rows.len() < 2 || !is_separator_row(&rows[1]) {
		return None;
	}
	let col = {
		let line = lines[line_ix];
		let local = caret.saturating_sub(starts[line_ix]);
		let prefix = &line[..local.min(line.len())];
		prefix.chars().filter(|c| *c == '|').count().saturating_sub(1)
	};
	Some(TableSpan {
		start_line: start,
		end_line: end,
		row: line_ix - start,
		col,
		rows,
	})
}

fn serialize_table(rows: &[Vec<String>]) -> String {
	rows.iter().map(|r| join_cells(r)).collect::<Vec<_>>().join("\n")
}

fn replace_lines(text: &str, start_line: usize, end_line: usize, next: &str) -> (String, usize) {
	let starts = line_starts(text);
	let from = starts.get(start_line).copied().unwrap_or(0);
	let to = if end_line + 1 < starts.len() {
		starts[end_line + 1].saturating_sub(1)
	} else {
		text.len()
	};
	let mut out = String::new();
	out.push_str(&text[..from]);
	out.push_str(next);
	if to < text.len() {
		if !next.ends_with('\n') && text[to..].starts_with('\n') {
			out.push('\n');
			out.push_str(&text[to + 1..]);
		} else {
			out.push_str(&text[to..]);
		}
	} else if !next.ends_with('\n') && text.ends_with('\n') {
		out.push('\n');
	}
	(out, from)
}

pub fn apply_table_op(text: &str, caret: usize, op: TableOp) -> (String, usize) {
	if matches!(op, TableOp::Insert) {
		let (start, end) = line_range(text, caret);
		let empty = text[start..end].trim().is_empty();
		let insert_at = if empty { start } else { end };
		let prefix = if insert_at > 0 && !text[..insert_at].ends_with('\n') {
			"\n"
		} else {
			""
		};
		let mut out = String::new();
		out.push_str(&text[..insert_at]);
		out.push_str(prefix);
		out.push_str(DEFAULT_TABLE);
		if insert_at < text.len() && !DEFAULT_TABLE.ends_with('\n') {
			out.push('\n');
		}
		out.push_str(&text[if empty { end } else { insert_at }..]);
		return (out, insert_at + prefix.len());
	}

	let Some(mut table) = table_at(text, caret) else {
		return (text.to_string(), caret);
	};
	let width = table.rows.first().map(|r| r.len()).unwrap_or(1).max(1);
	for row in &mut table.rows {
		while row.len() < width {
			row.push(String::new());
		}
	}
	let col = table.col.min(width.saturating_sub(1));
	match op {
		TableOp::Insert => {}
		TableOp::AddRowAfter => {
			let ix = if table.row <= 1 {
				2.min(table.rows.len())
			} else {
				table.row + 1
			};
			table.rows.insert(ix.min(table.rows.len()), vec![String::new(); width]);
		}
		TableOp::AddRowBefore => {
			let ix = if table.row <= 1 { 2 } else { table.row };
			table.rows.insert(ix.min(table.rows.len()), vec![String::new(); width]);
		}
		TableOp::AddColAfter => {
			let at = col + 1;
			for (i, row) in table.rows.iter_mut().enumerate() {
				row.insert(at, if i == 1 { "---".into() } else { String::new() });
			}
		}
		TableOp::AddColBefore => {
			for (i, row) in table.rows.iter_mut().enumerate() {
				row.insert(col, if i == 1 { "---".into() } else { String::new() });
			}
		}
		TableOp::DeleteRow => {
			if table.row <= 1 || table.rows.len() <= 3 {
				return replace_lines(text, table.start_line, table.end_line, "");
			}
			table.rows.remove(table.row);
		}
	}
	if table.rows.len() >= 2 {
		table.rows[1] = vec!["---".into(); table.rows[0].len().max(1)];
	}
	replace_lines(text, table.start_line, table.end_line, &serialize_table(&table.rows))
}

fn link_span(text: &str, caret: usize) -> Option<(usize, usize, String, String)> {
	let caret = caret.min(text.len());
	let window_start = caret.saturating_sub(200);
	let window_end = (caret + 200).min(text.len());
	let slice = &text[window_start..window_end];
	let rel = caret - window_start;
	let mut best = None;
	for (i, _) in slice.match_indices('[') {
		let Some(mid) = slice[i..].find("](") else {
			continue;
		};
		let Some(close) = slice[i + mid + 2..].find(')') else {
			continue;
		};
		let start = window_start + i;
		let end = window_start + i + mid + 2 + close + 1;
		if caret >= start && caret <= end {
			let label = slice[i + 1..i + mid].to_string();
			let href = slice[i + mid + 2..i + mid + 2 + close].to_string();
			best = Some((start, end, label, href));
			if rel >= i {
				break;
			}
		}
	}
	best
}

pub fn link_href_at(text: &str, caret: usize) -> Option<String> {
	link_span(text, caret).map(|(_, _, _, href)| href)
}

pub fn apply_link(text: &str, start: usize, end: usize, href: &str) -> (String, usize) {
	let href = href.trim();
	if href.is_empty() {
		return (text.to_string(), end);
	}
	if let Some((ls, le, label, _)) = link_span(text, start) {
		let next = format!("[{label}]({href})");
		let mut out = String::new();
		out.push_str(&text[..ls]);
		out.push_str(&next);
		out.push_str(&text[le..]);
		return (out, ls + next.len());
	}
	let (a, b) = if start <= end { (start, end) } else { (end, start) };
	let label = if a == b { href } else { &text[a..b] };
	let next = format!("[{label}]({href})");
	let mut out = String::new();
	out.push_str(&text[..a]);
	out.push_str(&next);
	out.push_str(&text[b..]);
	(out, a + next.len())
}

pub fn remove_link(text: &str, caret: usize) -> (String, usize) {
	if let Some((start, end, label, _)) = link_span(text, caret) {
		let mut out = String::new();
		out.push_str(&text[..start]);
		out.push_str(&label);
		out.push_str(&text[end..]);
		(out, start + label.len())
	} else {
		(text.to_string(), caret)
	}
}

pub const CODE_BLOCK_LANGS: &[&str] = &[
	"typescript",
	"tsx",
	"javascript",
	"jsx",
	"json",
	"html",
	"css",
	"markdown",
	"rust",
	"python",
	"go",
	"sql",
	"yaml",
	"xml",
	"c",
	"cpp",
	"shell",
];

pub fn fence_at(text: &str, caret: usize) -> Option<(usize, usize, String)> {
	let starts = line_starts(text);
	let caret = caret.min(text.len());
	let line_ix = starts.iter().rposition(|&s| s <= caret).unwrap_or(0);
	let lines: Vec<&str> = text.split('\n').collect();
	let mut open = None;
	for (i, line) in lines.iter().enumerate() {
		if let Some(rest) = line.trim_start().strip_prefix("```") {
			if open.is_none() {
				open = Some((i, rest.trim().to_string()));
			} else if i >= line_ix {
				let (oi, lang) = open?;
				if line_ix >= oi && line_ix <= i {
					return Some((oi, i, lang));
				}
				open = None;
			} else {
				open = None;
			}
		}
	}
	if let Some((oi, lang)) = open {
		if line_ix >= oi {
			return Some((oi, lines.len().saturating_sub(1), lang));
		}
	}
	None
}

pub fn set_fence_language(text: &str, caret: usize, lang: &str) -> (String, usize) {
	let Some((open_ix, _, _)) = fence_at(text, caret) else {
		return (text.to_string(), caret);
	};
	let starts = line_starts(text);
	let from = starts[open_ix];
	let line_end = text[from..].find('\n').map(|i| from + i).unwrap_or(text.len());
	let indent = text[from..line_end]
		.chars()
		.take_while(|c| c.is_whitespace())
		.collect::<String>();
	let mut out = String::new();
	out.push_str(&text[..from]);
	out.push_str(&indent);
	out.push_str("```");
	out.push_str(lang);
	out.push_str(&text[line_end..]);
	(out, from + indent.len() + 3 + lang.len())
}

pub fn fence_body(text: &str, caret: usize) -> Option<String> {
	let (open_ix, close_ix, _) = fence_at(text, caret)?;
	let lines: Vec<&str> = text.split('\n').collect();
	if close_ix <= open_ix + 1 {
		return Some(String::new());
	}
	Some(lines[open_ix + 1..close_ix].join("\n"))
}

pub fn toolbar(
	app: &mut AppView,
	target: MarkupTarget,
	window: &mut Window,
	cx: &mut Context<AppView>,
) -> impl IntoElement {
	let theme = cx.theme().clone();
	let view = cx.entity();
	let menu = app.data.overlay.md_menu;
	let locale = app.data.locale;
	let id_prefix = match target {
		MarkupTarget::Notes => "notes",
		MarkupTarget::File => "md",
	};
	let status = match target {
		MarkupTarget::Notes => app.data.current_ws().map(|w| w.notes_status).unwrap_or_default(),
		MarkupTarget::File => {
			if app
				.data
				.current_ws()
				.and_then(|w| w.active_file())
				.is_some_and(|f| f.dirty())
			{
				NotesStatus::Saving
			} else {
				NotesStatus::Saved
			}
		}
	};
	let badge = match status {
		NotesStatus::Saving => app.t("notesSaving"),
		NotesStatus::Failed => app.t("notesSaveFailedShort"),
		NotesStatus::Saved => app.t("notesSaved"),
	};
	let input = match target {
		MarkupTarget::Notes => &app.inputs.notes,
		MarkupTarget::File => &app.inputs.file_editor,
	};
	let draft = input.read(cx).value().to_string();
	let caret = input.read(cx).cursor();
	let fence = fence_at(&draft, caret);
	let slash = slash_query(&draft, caret);

	v_flex()
		.id(crate::ui::eid(format!("{id_prefix}-md-chrome")))
		.w_full()
		.child(
			h_flex()
				.w_full()
				.px_2()
				.py_1()
				.gap_1()
				.flex_wrap()
				.border_b_1()
				.border_color(theme.border)
				.child(menu_btn(
					&format!("{id_prefix}-cmd"),
					IconName::Menu,
					&app.t("notesCommandMenu"),
					menu == Some(MdMenu::Command),
					MdMenu::Command,
					target,
					&view,
				))
				.child(sep(&theme))
				.child(mark_btn(
					&format!("{id_prefix}-b"),
					"B",
					&format!("{}  ⌘B", app.t("notesFormatBold")),
					MdAction::Wrap("**", "**"),
					target,
					&view,
				))
				.child(mark_btn(
					&format!("{id_prefix}-i"),
					"I",
					&format!("{}  ⌘I", app.t("notesFormatItalic")),
					MdAction::Wrap("*", "*"),
					target,
					&view,
				))
				.child(icon_action(
					&format!("{id_prefix}-code"),
					IconName::Copy,
					&app.t("notesFormatCode"),
					MdAction::Wrap("`", "`"),
					target,
					&view,
				))
				.child(mark_btn(
					&format!("{id_prefix}-s"),
					"S",
					&app.t("notesFormatStrike"),
					MdAction::Wrap("~~", "~~"),
					target,
					&view,
				))
				.child(menu_btn(
					&format!("{id_prefix}-link"),
					IconName::ExternalLink,
					&app.t("notesFormatLink"),
					menu == Some(MdMenu::Link),
					MdMenu::Link,
					target,
					&view,
				))
				.child(sep(&theme))
				.child(mark_btn(
					&format!("{id_prefix}-ul"),
					"•",
					&app.t("notesFormatBulletList"),
					MdAction::Block("- "),
					target,
					&view,
				))
				.child(mark_btn(
					&format!("{id_prefix}-ol"),
					"1.",
					&app.t("notesFormatOrderedList"),
					MdAction::Block("1. "),
					target,
					&view,
				))
				.child(icon_action(
					&format!("{id_prefix}-q"),
					IconName::ChevronRight,
					&app.t("notesFormatQuote"),
					MdAction::Block("> "),
					target,
					&view,
				))
				.child(sep(&theme))
				.child(menu_btn(
					&format!("{id_prefix}-tbl"),
					IconName::Frame,
					&app.t("notesTableMenu"),
					menu == Some(MdMenu::Table),
					MdMenu::Table,
					target,
					&view,
				))
				.when(target == MarkupTarget::File, |el| {
					el.child(
						Button::new(crate::ui::eid(format!("{id_prefix}-preview")))
							.ghost()
							.xsmall()
							.icon(if app.data.overlay.md_preview {
								IconName::EyeOff
							} else {
								IconName::Eye
							})
							.tooltip(if app.data.overlay.md_preview {
								app.t("notesCodeBlockEdit")
							} else {
								app.t("notesCodeBlockHidePreview")
							})
							.selected(app.data.overlay.md_preview)
							.on_click({
								let view = view.clone();
								move |_, _, cx| {
									view.update(cx, |app, cx| {
										app.data.overlay.md_preview = !app.data.overlay.md_preview;
										cx.notify();
									});
								}
							}),
					)
					.child(
						Button::new(crate::ui::eid(format!("{id_prefix}-save")))
							.xsmall()
							.primary()
							.label(app.t("save"))
							.on_click({
								let view = view.clone();
								move |_, window, cx| {
									view.update(cx, |app, cx| {
										app.save_active_file(window, cx);
										cx.notify();
									});
								}
							}),
					)
				})
				.child(div().flex_1().text_xs().text_color(theme.muted_foreground).child(badge)),
		)
		.when(menu == Some(MdMenu::Command), |el| {
			el.child(command_menu(id_prefix, target, locale, &view))
		})
		.when(menu == Some(MdMenu::Table), |el| {
			el.child(table_menu(id_prefix, target, locale, &view))
		})
		.when(menu == Some(MdMenu::Link), |el| {
			el.child(link_editor(app, id_prefix, target, &view))
		})
		.when(slash.is_some(), |el| {
			el.child(slash_menu(id_prefix, target, &slash.unwrap_or_default(), locale, &view))
		})
		.when(fence.is_some(), |el| {
			el.child(fence_bar(app, id_prefix, target, &draft, caret, window, cx))
		})
}

fn sep(theme: &gpui_component::Theme) -> impl IntoElement {
	div().w(px(1.)).h(px(16.)).bg(theme.border)
}

fn menu_btn(
	id: &str,
	icon: IconName,
	tip: &str,
	selected: bool,
	menu: MdMenu,
	target: MarkupTarget,
	view: &gpui::Entity<AppView>,
) -> impl IntoElement {
	let view = view.clone();
	Button::new(crate::ui::eid(id))
		.ghost()
		.xsmall()
		.icon(icon)
		.tooltip(tip.to_string())
		.selected(selected)
		.on_click(move |_, window, cx| {
			view.update(cx, |app, cx| {
				app.toggle_md_menu(menu, target, window, cx);
				cx.notify();
			});
		})
}

fn mark_btn(
	id: &str,
	label: &str,
	tip: &str,
	action: MdAction,
	target: MarkupTarget,
	view: &gpui::Entity<AppView>,
) -> impl IntoElement {
	let view = view.clone();
	Button::new(crate::ui::eid(id))
		.ghost()
		.xsmall()
		.label(label.to_string())
		.tooltip(tip.to_string())
		.on_click(move |_, window, cx| {
			view.update(cx, |app, cx| {
				app.run_md(target, action, window, cx);
				cx.notify();
			});
		})
}

fn icon_action(
	id: &str,
	icon: IconName,
	tip: &str,
	action: MdAction,
	target: MarkupTarget,
	view: &gpui::Entity<AppView>,
) -> impl IntoElement {
	let view = view.clone();
	Button::new(crate::ui::eid(id))
		.ghost()
		.xsmall()
		.icon(icon)
		.tooltip(tip.to_string())
		.on_click(move |_, window, cx| {
			view.update(cx, |app, cx| {
				app.run_md(target, action, window, cx);
				cx.notify();
			});
		})
}

fn command_menu(
	id_prefix: &str,
	target: MarkupTarget,
	locale: crate::i18n::Locale,
	view: &gpui::Entity<AppView>,
) -> impl IntoElement {
	let items: [(&str, &str, MdAction); 8] = [
		("p", "notesFormatParagraph", MdAction::Block("")),
		("h1", "notesFormatHeading1", MdAction::Block("# ")),
		("h2", "notesFormatHeading2", MdAction::Block("## ")),
		("h3", "notesFormatHeading3", MdAction::Block("### ")),
		("q", "notesFormatQuote", MdAction::Block("> ")),
		("code", "notesFormatCodeBlock", MdAction::Wrap("```\n", "\n```")),
		("table", "notesInsertTable", MdAction::Table(TableOp::Insert)),
		("hr", "notesInsertDivider", MdAction::Insert("---\n")),
	];
	vertical_menu(
		&format!("{id_prefix}-command-menu"),
		&items.map(|(id, key, action)| (format!("{id_prefix}-cmd-{id}"), i18n::t(locale, key), action)),
		target,
		view,
	)
}

fn table_menu(
	id_prefix: &str,
	target: MarkupTarget,
	locale: crate::i18n::Locale,
	view: &gpui::Entity<AppView>,
) -> impl IntoElement {
	let items = [
		(
			format!("{id_prefix}-tbl-insert"),
			i18n::t(locale, "notesInsertTable"),
			MdAction::Table(TableOp::Insert),
		),
		(
			format!("{id_prefix}-tbl-row-after"),
			i18n::t(locale, "notesTableAddRow"),
			MdAction::Table(TableOp::AddRowAfter),
		),
		(
			format!("{id_prefix}-tbl-col-after"),
			i18n::t(locale, "notesTableAddColumn"),
			MdAction::Table(TableOp::AddColAfter),
		),
		(
			format!("{id_prefix}-tbl-row-before"),
			i18n::t(locale, "notesTableAddRowBefore"),
			MdAction::Table(TableOp::AddRowBefore),
		),
		(
			format!("{id_prefix}-tbl-col-before"),
			i18n::t(locale, "notesTableAddColumnBefore"),
			MdAction::Table(TableOp::AddColBefore),
		),
		(
			format!("{id_prefix}-tbl-del"),
			i18n::t(locale, "notesTableDeleteCells"),
			MdAction::Table(TableOp::DeleteRow),
		),
	];
	vertical_menu(&format!("{id_prefix}-table-menu"), &items, target, view)
}

fn vertical_menu(
	id: &str,
	items: &[(String, String, MdAction)],
	target: MarkupTarget,
	view: &gpui::Entity<AppView>,
) -> impl IntoElement {
	v_flex()
		.id(crate::ui::eid(id))
		.w(px(180.))
		.max_h(px(280.))
		.px_1()
		.py_1()
		.gap_1()
		.border_b_1()
		.border_color(gpui::hsla(0., 0., 0.5, 0.2))
		.children(items.iter().map(|(id, label, action)| {
			let view = view.clone();
			let action = *action;
			Button::new(crate::ui::eid(id.clone()))
				.ghost()
				.xsmall()
				.label(label.clone())
				.on_click(move |_, window, cx| {
					view.update(cx, |app, cx| {
						app.run_md(target, action, window, cx);
						cx.notify();
					});
				})
		}))
}

fn slash_menu(
	id_prefix: &str,
	target: MarkupTarget,
	query: &str,
	locale: crate::i18n::Locale,
	view: &gpui::Entity<AppView>,
) -> impl IntoElement {
	let q = query.to_ascii_lowercase();
	v_flex()
		.id(crate::ui::eid(format!("{id_prefix}-slash")))
		.w(px(180.))
		.max_h(px(280.))
		.px_1()
		.py_1()
		.gap_1()
		.border_b_1()
		.border_color(gpui::hsla(0., 0., 0.5, 0.2))
		.child(
			div()
				.px_2()
				.text_xs()
				.text_color(gpui::hsla(0., 0., 0.5, 1.))
				.child(i18n::t(locale, "notesCommandMenu")),
		)
		.children(slash_items().iter().filter_map(|item| {
			let label = i18n::t(locale, item.label_key);
			let hay = format!("{} {}", item.key, label.to_ascii_lowercase());
			if !q.is_empty() && !hay.contains(&q) {
				return None;
			}
			let view = view.clone();
			let action = item.action;
			Some(
				Button::new(crate::ui::eid(format!("{id_prefix}-slash-{}", item.key)))
					.ghost()
					.xsmall()
					.label(label)
					.on_click(move |_, window, cx| {
						view.update(cx, |app, cx| {
							app.run_md(target, action, window, cx);
							cx.notify();
						});
					}),
			)
		}))
}

fn link_editor(app: &AppView, id_prefix: &str, target: MarkupTarget, view: &gpui::Entity<AppView>) -> impl IntoElement {
	h_flex()
		.id(crate::ui::eid(format!("{id_prefix}-link-editor")))
		.w_full()
		.px_2()
		.py_1()
		.gap_1()
		.border_b_1()
		.border_color(gpui::hsla(0., 0., 0.5, 0.2))
		.child(div().flex_1().min_w(px(160.)).child(Input::new(&app.inputs.md_link)))
		.child(
			Button::new(crate::ui::eid(format!("{id_prefix}-link-apply")))
				.ghost()
				.xsmall()
				.icon(IconName::Check)
				.tooltip(app.t("notesApplyLink"))
				.on_click({
					let view = view.clone();
					move |_, window, cx| {
						view.update(cx, |app, cx| {
							app.run_md(target, MdAction::ApplyLink, window, cx);
							cx.notify();
						});
					}
				}),
		)
		.child(
			Button::new(crate::ui::eid(format!("{id_prefix}-link-remove")))
				.ghost()
				.xsmall()
				.icon(IconName::Close)
				.tooltip(app.t("notesRemoveLink"))
				.on_click({
					let view = view.clone();
					move |_, window, cx| {
						view.update(cx, |app, cx| {
							app.run_md(target, MdAction::RemoveLink, window, cx);
							cx.notify();
						});
					}
				}),
		)
}

fn fence_bar(
	app: &mut AppView,
	id_prefix: &str,
	target: MarkupTarget,
	draft: &str,
	caret: usize,
	_window: &mut Window,
	cx: &mut Context<AppView>,
) -> impl IntoElement {
	let view = cx.entity();
	let current = fence_at(draft, caret).map(|(_, _, lang)| lang).unwrap_or_default();
	h_flex()
		.id(crate::ui::eid(format!("{id_prefix}-fence")))
		.w_full()
		.px_2()
		.py_1()
		.gap_1()
		.flex_wrap()
		.border_b_1()
		.border_color(gpui::hsla(0., 0., 0.5, 0.2))
		.bg(gpui::rgb(0x282c34))
		.child(
			div()
				.text_xs()
				.text_color(gpui::rgb(0xabb2bf))
				.child(if current.is_empty() {
					app.t("notesCodeBlockSearchLanguage")
				} else {
					current.clone()
				}),
		)
		.children(CODE_BLOCK_LANGS.iter().map(|lang| {
			let view = view.clone();
			let lang = *lang;
			Button::new(crate::ui::eid(format!("{id_prefix}-lang-{lang}")))
				.ghost()
				.xsmall()
				.label(lang.to_string())
				.selected(lang == current)
				.on_click(move |_, window, cx| {
					view.update(cx, |app, cx| {
						app.set_md_fence_language(target, lang, window, cx);
						cx.notify();
					});
				})
		}))
		.child(
			Button::new(crate::ui::eid(format!("{id_prefix}-copy-fence")))
				.ghost()
				.xsmall()
				.icon(IconName::Copy)
				.tooltip(app.t("notesCodeBlockCopy"))
				.on_click({
					let view = view.clone();
					move |_, _, cx| {
						view.update(cx, |app, cx| {
							app.copy_md_fence(target, cx);
							cx.notify();
						});
					}
				}),
		)
}

pub fn md_input(app: &AppView, target: MarkupTarget) -> &Entity<InputState> {
	match target {
		MarkupTarget::Notes => &app.inputs.notes,
		MarkupTarget::File => &app.inputs.file_editor,
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn apply_block_prefix_replaces_heading() {
		assert_eq!(apply_block_prefix("# hello", 3, "## "), ("## hello".into(), 3));
		assert_eq!(apply_block_prefix("- item", 2, ""), ("item".into(), 0));
		assert_eq!(apply_block_prefix("1. item", 3, "> "), ("> item".into(), 2));
	}

	#[test]
	fn slash_query_reads_caret_line() {
		assert_eq!(slash_query("/h1", 3).as_deref(), Some("h1"));
		assert_eq!(slash_query("intro\n/tab", 10).as_deref(), Some("tab"));
		assert!(slash_query("hello", 3).is_none());
	}

	#[test]
	fn apply_slash_at_replaces_slash_line() {
		assert_eq!(apply_slash_at("/h1", 3, "# ", ""), ("# ".into(), 2));
		assert_eq!(
			apply_slash_at("intro\n/code", 10, "```\n", "\n```"),
			("intro\n```\n\n```".into(), 10)
		);
	}

	#[test]
	fn apply_table_op_inserts_and_edits() {
		let (text, _) = apply_table_op("", 0, TableOp::Insert);
		assert!(text.contains("| --- | --- | --- |"));
		assert_eq!(text.lines().count(), 4);

		let src = "| A | B |\n| --- | --- |\n| x | y |";
		let (after, _) = apply_table_op(src, 30, TableOp::AddRowAfter);
		assert_eq!(after.lines().count(), 4);
		assert!(after.lines().last().unwrap().contains('|'));

		let (before, _) = apply_table_op(src, 30, TableOp::AddRowBefore);
		assert_eq!(before.lines().count(), 4);

		let (cols, _) = apply_table_op(src, 3, TableOp::AddColAfter);
		assert!(cols.lines().next().unwrap().matches('|').count() >= 4);

		let (left, _) = apply_table_op(src, 3, TableOp::AddColBefore);
		assert!(left.lines().next().unwrap().starts_with("|  | A"));

		let (gone, _) = apply_table_op(src, 30, TableOp::DeleteRow);
		assert!(!gone.contains('x') || gone.trim().is_empty() || gone.lines().count() < 3);
	}

	#[test]
	fn apply_and_remove_link() {
		let (linked, _) = apply_link("see here", 4, 8, "https://ex.test");
		assert_eq!(linked, "see [here](https://ex.test)");
		let (plain, _) = remove_link(&linked, 8);
		assert_eq!(plain, "see here");
	}

	#[test]
	fn fence_language_roundtrip() {
		let src = "```\nfn main() {}\n```";
		assert_eq!(fence_at(src, 6).map(|(_, _, l)| l), Some(String::new()));
		let (next, _) = set_fence_language(src, 6, "rust");
		assert_eq!(next, "```rust\nfn main() {}\n```");
		assert_eq!(fence_body(&next, 8).as_deref(), Some("fn main() {}"));
	}
}
