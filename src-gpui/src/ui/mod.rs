use gpui::SharedString;

pub fn eid(s: impl Into<String>) -> SharedString {
	SharedString::from(s.into())
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
