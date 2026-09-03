use gpui::{
	Context, ParentElement, Styled, Window, div, px,
};
use gpui_component::{
	ActiveTheme, WindowExt,
	button::{Button, ButtonVariant, ButtonVariants},
	dialog::DialogButtonProps,
	h_flex, input::Input, v_flex,
};

use crate::app::AppRoot;

impl AppRoot {
	pub(crate) fn open_create_project_dialog(
		&mut self,
		window: &mut Window,
		cx: &mut Context<Self>,
	) {
		let name = self.create_name.clone();
		let folder = self.create_folder.clone();
		let view = cx.entity();
		window.open_dialog(cx, move |dialog, _, cx| {
			dialog
				.title("Create Project")
				.width(px(448.))
				.child(
					v_flex()
						.gap_3()
						.child(
							div()
								.text_sm()
								.text_color(cx.theme().muted_foreground)
								.child(
									"Choose a folder first. 2code will use that folder as the project root.",
								),
						)
						.child(Input::new(&name).cleanable(true))
						.child(Input::new(&folder).cleanable(true))
						.child(
							Button::new("pick-folder")
								.ghost()
								.label("Choose Folder")
								.on_click({
									let view = view.clone();
									move |_, window, cx| {
										view.update(cx, |this, cx| {
											this.pick_folder(window, cx);
										});
									}
								}),
						),
				)
				.button_props(
					DialogButtonProps::default()
						.ok_text("Create")
						.cancel_text("Cancel")
						.show_cancel(true),
				)
				.on_ok({
					let view = view.clone();
					move |_, window, cx| {
						view.update(cx, |this, cx| {
							this.submit_create_project(window, cx);
						});
						true
					}
				})
		});
	}

	pub(crate) fn open_create_profile_dialog(
		&mut self,
		window: &mut Window,
		cx: &mut Context<Self>,
	) {
		let branch = self.profile_branch.clone();
		let view = cx.entity();
		window.open_dialog(cx, move |dialog, _, cx| {
			dialog
				.title("New Profile")
				.width(px(420.))
				.child(
					v_flex()
						.gap_3()
						.child(
							div()
								.text_sm()
								.text_color(cx.theme().muted_foreground)
								.child(
									"Leave the branch empty to auto-generate a worktree lane.",
								),
						)
						.child(Input::new(&branch).cleanable(true)),
				)
				.button_props(
					DialogButtonProps::default()
						.ok_text("Create")
						.cancel_text("Cancel")
						.show_cancel(true),
				)
				.on_ok({
					let view = view.clone();
					move |_, window, cx| {
						view.update(cx, |this, cx| {
							this.submit_create_profile(window, cx);
						});
						true
					}
				})
		});
	}

	pub(crate) fn open_delete_project_dialog(
		&mut self,
		window: &mut Window,
		cx: &mut Context<Self>,
	) {
		let Some(project_id) = self
			.current_project()
			.map(|project| project.id.clone())
		else {
			return;
		};
		let view = cx.entity();
		window.open_alert_dialog(cx, move |alert, _, _| {
			alert
				.title("Delete Project")
				.description(
					"Are you sure you want to delete this project? This action cannot be undone.",
				)
				.show_cancel(true)
				.button_props(
					DialogButtonProps::default()
						.ok_text("Delete")
						.ok_variant(ButtonVariant::Danger)
						.cancel_text("Cancel")
						.show_cancel(true),
				)
				.on_ok({
					let view = view.clone();
					let project_id = project_id.clone();
					move |_, _, cx| {
						view.update(cx, |this, cx| {
							this.confirm_delete_project(&project_id, cx);
						});
						true
					}
				})
		});
	}

	pub(crate) fn open_delete_profile_dialog(
		&mut self,
		window: &mut Window,
		cx: &mut Context<Self>,
	) {
		let Some(profile_id) = self
			.current_profile()
			.map(|profile| profile.id.clone())
		else {
			return;
		};
		let view = cx.entity();
		window.open_alert_dialog(cx, move |alert, _, _| {
			alert
				.title("Delete Profile")
				.description(
					"Remove this worktree profile and its terminals. This cannot be undone.",
				)
				.show_cancel(true)
				.button_props(
					DialogButtonProps::default()
						.ok_text("Delete")
						.ok_variant(ButtonVariant::Danger)
						.cancel_text("Cancel")
						.show_cancel(true),
				)
				.on_ok({
					let view = view.clone();
					let profile_id = profile_id.clone();
					move |_, _, cx| {
						view.update(cx, |this, cx| {
							this.confirm_delete_profile(&profile_id, cx);
						});
						true
					}
				})
		});
	}

	pub(crate) fn open_create_file_dialog(
		&mut self,
		window: &mut Window,
		cx: &mut Context<Self>,
	) {
		let name = self.new_file_name.clone();
		let view = cx.entity();
		window.open_dialog(cx, move |dialog, _, _| {
			dialog
				.title("New File")
				.width(px(420.))
				.child(Input::new(&name).cleanable(true))
				.button_props(
					DialogButtonProps::default()
						.ok_text("Create")
						.cancel_text("Cancel")
						.show_cancel(true),
				)
				.on_ok({
					let view = view.clone();
					move |_, window, cx| {
						view.update(cx, |this, cx| {
							this.create_named_file(window, cx);
						});
						true
					}
				})
		});
	}

	pub(crate) fn open_branch_dialog(
		&mut self,
		window: &mut Window,
		cx: &mut Context<Self>,
	) {
		let branches = self.branches.clone();
		let view = cx.entity();
		window.open_dialog(cx, move |dialog, _, _| {
			dialog
				.title("Switch Branch")
				.width(px(420.))
				.child(
					v_flex().gap_1().children(branches.clone().into_iter().map(|branch| {
						let name = branch.name.clone();
						let label = format!(
							"{}{}{}",
							if branch.is_current { "● " } else { "" },
							name,
							if branch.is_used { " (in use)" } else { "" }
						);
						let view = view.clone();
						h_flex().child(
							Button::new(format!("branch-{name}"))
								.ghost()
								.label(label)
								.on_click(move |_, _, cx| {
									view.update(cx, |this, cx| {
										this.checkout_current_folder_branch(&name, cx);
									});
								}),
						)
					})),
				)
				.button_props(DialogButtonProps::default().ok_text("Close"))
		});
	}

	pub(crate) fn open_command_palette(
		&mut self,
		window: &mut Window,
		cx: &mut Context<Self>,
	) {
		let view = cx.entity();
		window.open_dialog(cx, move |dialog, _, _| {
			dialog
				.title("Command Palette")
				.width(px(420.))
				.child(
					v_flex()
						.gap_2()
						.child(palette_action("cmd-home", "Go Home", {
							let view = view.clone();
							move |_, _, cx| {
								view.update(cx, |this, cx| this.open_home(cx));
							}
						}))
						.child(palette_action("cmd-settings", "Open Settings", {
							let view = view.clone();
							move |_, _, cx| {
								view.update(cx, |this, cx| this.open_settings(cx));
							}
						}))
						.child(palette_action("cmd-new-project", "New Project", {
							let view = view.clone();
							move |_, window, cx| {
								view.update(cx, |this, cx| {
									this.open_create_project_dialog(window, cx);
								});
							}
						}))
						.child(palette_action("cmd-new-profile", "New Profile", {
							let view = view.clone();
							move |_, window, cx| {
								view.update(cx, |this, cx| {
									this.open_create_profile_dialog(window, cx);
								});
							}
						}))
						.child(palette_action("cmd-new-terminal", "New Terminal", {
							let view = view.clone();
							move |_, _, cx| {
								view.update(cx, |this, cx| this.new_terminal(cx));
							}
						}))
						.child(palette_action("cmd-commit", "Commit Changes", {
							let view = view.clone();
							move |_, window, cx| {
								view.update(cx, |this, cx| {
									this.commit_selected_changes(window, cx);
								});
							}
						}))
						.child(palette_action("cmd-push", "Push Branch", {
							let view = view.clone();
							move |_, _, cx| {
								view.update(cx, |this, cx| this.push_current_branch(cx));
							}
						}))
						.child(palette_action("cmd-theme", "Toggle Theme", {
							let view = view.clone();
							move |_, window, cx| {
								view.update(cx, |this, cx| {
									let next = if this.settings.is_dark(false) {
										"light"
									} else {
										"dark"
									};
									this.set_theme_mode(next, window, cx);
								});
							}
						})),
				)
				.button_props(DialogButtonProps::default().ok_text("Close"))
		});
	}
}

fn palette_action(
	id: &'static str,
	label: &'static str,
	on_click: impl Fn(&gpui::ClickEvent, &mut Window, &mut gpui::App) + 'static,
) -> impl gpui::IntoElement {
	h_flex().child(
		Button::new(id)
			.ghost()
			.label(label)
			.on_click(on_click),
	)
}
