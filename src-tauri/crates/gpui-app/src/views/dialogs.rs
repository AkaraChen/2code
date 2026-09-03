use gpui::{
	Context, IntoElement, ParentElement, Styled, Window, div, prelude::FluentBuilder,
	px,
};
use gpui_component::{
	ActiveTheme,
	button::{Button, ButtonVariants},
	h_flex, input::Input, v_flex,
};

use crate::app::AppRoot;

impl AppRoot {
	pub(crate) fn render_dialogs(
		&mut self,
		_window: &mut Window,
		cx: &mut Context<Self>,
	) -> impl IntoElement {
		let show_create = self.show_create_project;
		let show_profile = self.show_create_profile;
		let show_delete = self.show_delete_project.clone();
		let name = self.create_name.clone();
		let folder = self.create_folder.clone();
		let branch = self.profile_branch.clone();

		div().absolute().inset_0().when(
			show_create || show_profile || show_delete.is_some(),
			|this| {
				this.flex()
					.items_center()
					.justify_center()
					.bg(gpui::rgba(0x00000066))
					.child(if show_create {
						self.dialog_card(
							"Create Project",
							"Choose a folder first. 2code will use that folder as the project root.",
							v_flex()
								.gap_3()
								.child(Input::new(&name).placeholder("Optional project name").cleanable(true))
								.child(Input::new(&folder).placeholder("Project folder").cleanable(true))
								.child(
									h_flex()
										.gap_2()
										.child(
											Button::new("pick-folder")
												.ghost()
												.label("Choose Folder")
												.on_click(cx.listener(|this, _, window, cx| {
													this.pick_folder(window, cx);
												})),
										)
										.child(
											Button::new("cancel-create")
												.ghost()
												.label("Cancel")
												.on_click(cx.listener(|this, _, _, cx| {
													this.show_create_project = false;
													cx.notify();
												})),
										)
										.child(
											Button::new("confirm-create")
												.primary()
												.label("Create")
												.on_click(cx.listener(|this, _, window, cx| {
													this.submit_create_project(window, cx);
												})),
										),
								),
							cx,
						)
						.into_any_element()
					} else if show_profile {
						self.dialog_card(
							"New Profile",
							"Leave the branch empty to auto-generate a worktree lane.",
							v_flex()
								.gap_3()
								.child(
									Input::new(&branch)
										.placeholder("feature/my-lane")
										.cleanable(true),
								)
								.child(
									h_flex()
										.gap_2()
										.child(
											Button::new("cancel-profile")
												.ghost()
												.label("Cancel")
												.on_click(cx.listener(|this, _, _, cx| {
													this.show_create_profile = false;
													cx.notify();
												})),
										)
										.child(
											Button::new("confirm-profile")
												.primary()
												.label("Create")
												.on_click(cx.listener(|this, _, window, cx| {
													this.submit_create_profile(window, cx);
												})),
										),
								),
							cx,
						)
						.into_any_element()
					} else {
						self.dialog_card(
							"Delete Project",
							"Are you sure you want to delete this project? This action cannot be undone.",
							h_flex()
								.gap_2()
								.child(
									Button::new("cancel-delete")
										.ghost()
										.label("Cancel")
										.on_click(cx.listener(|this, _, _, cx| {
											this.show_delete_project = None;
											cx.notify();
										})),
								)
								.child(
									Button::new("confirm-delete")
										.danger()
										.label("Delete")
										.on_click(cx.listener(|this, _, _, cx| {
											this.confirm_delete_project(cx);
										})),
								),
							cx,
						)
						.into_any_element()
					})
			},
		)
	}

	fn dialog_card(
		&self,
		title: &'static str,
		description: &'static str,
		body: impl IntoElement,
		cx: &mut Context<Self>,
	) -> impl IntoElement {
		v_flex()
			.w(px(420.))
			.p_5()
			.gap_3()
			.rounded(px(10.))
			.border_1()
			.border_color(cx.theme().border)
			.bg(cx.theme().background)
			.child(div().text_sm().font_semibold().child(title))
			.child(
				div()
					.text_sm()
					.text_color(cx.theme().muted_foreground)
					.child(description),
			)
			.child(body)
	}
}
