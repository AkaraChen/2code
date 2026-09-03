use gpui::{div, prelude::*, Context, SharedString, Window};

pub fn eid(s: impl Into<String>) -> SharedString {
	SharedString::from(s.into())
}

pub struct DragGhost {
	pub label: String,
}

impl gpui::Render for DragGhost {
	fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
		div().px_2().py_1().rounded_md().opacity(0.45).child(self.label.clone())
	}
}

pub mod debug;
pub mod dialogs;
pub mod file_tree;
pub mod file_viewer;
pub mod git;
pub mod home;
pub mod notes;
pub mod palette;
pub mod settings;
pub mod shell;
pub mod sidebar;
pub mod terminal;
pub mod workspace;
