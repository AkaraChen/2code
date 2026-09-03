use gpui::{div, prelude::*, px, AnyView, App, Context, SharedString, Window};
use gpui_component::{Icon, IconName};

pub fn eid(s: impl Into<String>) -> SharedString {
	SharedString::from(s.into())
}

pub fn leftover_branch_glyph(color: gpui::Hsla) -> gpui::Div {
	div().text_color(color).child("⎇")
}

pub fn leftover_pencil_glyph(color: gpui::Hsla) -> gpui::Div {
	div().text_color(color).child("✎")
}

pub fn leftover_house_glyph(color: gpui::Hsla) -> gpui::Div {
	div().text_color(color).child("⌂")
}

pub fn leftover_folder_plus_mark(folder: f32, plus: f32) -> gpui::Div {
	div()
		.relative()
		.size(px(folder))
		.flex()
		.items_center()
		.justify_center()
		.flex_shrink_0()
		.child(Icon::new(IconName::Folder).w(px(folder)))
		.child(
			div()
				.absolute()
				.bottom(px(-2.))
				.right(px(-3.))
				.size(px(plus))
				.rounded_full()
				.flex()
				.items_center()
				.justify_center()
				.child(Icon::new(IconName::Plus).w(px((plus * 0.75).max(8.)))),
		)
}

pub fn tip(text: impl Into<String>) -> impl Fn(&mut Window, &mut App) -> AnyView + 'static {
	let text = text.into();
	move |window, cx| gpui_component::tooltip::Tooltip::new(text.clone()).build(window, cx)
}

pub struct DragGhost {
	pub label: String,
}

#[derive(Clone)]
pub struct TreeDrag {
	pub path: String,
}

#[derive(Clone)]
pub struct TopbarDrag {
	pub id: String,
}

impl gpui::Render for DragGhost {
	fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
		div().px_2().py_1().rounded_md().opacity(0.45).child(self.label.clone())
	}
}

pub mod debug;
pub mod dialogs;
pub mod file_icons;
pub mod file_tree;
pub mod file_viewer;
pub mod git;
pub mod home;
pub mod markdown;
pub mod notes;
pub mod palette;
pub mod settings;
pub mod shell;
pub mod sidebar;
pub mod terminal;
pub mod workspace;
