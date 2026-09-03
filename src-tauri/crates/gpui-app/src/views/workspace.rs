use gpui::{
	Context, InteractiveElement, IntoElement, ParentElement, StatefulInteractiveElement,
	Styled, Window, div,
	prelude::FluentBuilder, px,
};
use gpui_component::{
	ActiveTheme, Icon, IconName, Sizable, StyledExt,
	button::{Button, ButtonVariants},
	h_flex, input::Input, v_flex,
};

use crate::app::AppRoot;
use crate::theme::TwoCodePalette;

impl AppRoot {
	pub(crate) fn render_workspace(
		&mut self,
		_window: &mut Window,
		cx: &mut Context<Self>,
	) -> impl IntoElement {
		let project_name = self
			.current_project()
			.map(|project| project.name.clone())
			.unwrap_or_else(|| "Project".into());
		let branch = if self.git_branch.is_empty() {
			"no git".into()
		} else {
			self.git_branch.clone()
		};
		let has_terminal = self.active_session.is_some();
		let output = self.terminal_output.clone();
		let files = self.files.clone();
		let diff = self.git_diff.clone();
		let stats = self.git_stats_label.clone();
		let input = self.terminal_input.clone();

		v_flex()
			.size_full()
			.child(
				h_flex()
					.h(px(TwoCodePalette::HEADER_HEIGHT))
					.px_3()
					.gap_2()
					.justify_between()
					.border_b_1()
					.border_color(cx.theme().border)
					.child(
						h_flex()
							.gap_2()
							.items_center()
							.child(div().text_sm().font_semibold().child(project_name))
							.child(
								h_flex()
									.h(px(24.))
									.px_2()
									.rounded(px(6.))
									.bg(cx.theme().muted)
									.gap_1()
									.child(Icon::new(IconName::Folder).size_3())
									.child(
										div()
											.text_xs()
											.text_color(cx.theme().muted_foreground)
											.child(branch),
									),
							),
					)
					.child(
						h_flex()
							.gap_2()
							.child(
								div()
									.h(px(24.))
									.px_2()
									.rounded(px(6.))
									.bg(cx.theme().muted)
									.text_xs()
									.text_color(cx.theme().muted_foreground)
									.child(stats),
							)
							.child(
								Button::new("new-profile")
									.ghost()
									.icon(IconName::Plus)
									.label("New Profile")
									.on_click(cx.listener(|this, _, _, cx| {
										this.show_create_profile = true;
										cx.notify();
									})),
							)
							.child(
								Button::new("delete-project")
									.ghost()
									.icon(IconName::Delete)
									.label("Delete")
									.on_click(cx.listener(|this, _, _, cx| {
										this.show_delete_project = this
											.current_project()
											.map(|project| project.id.clone());
										cx.notify();
									})),
							),
					),
			)
			.child(
				h_flex()
					.flex_1()
					.min_h_0()
					.child(
						v_flex()
							.w(px(220.))
							.h_full()
							.border_r_1()
							.border_color(cx.theme().border)
							.child(
								div()
									.px_3()
									.py_2()
									.text_xs()
									.text_color(cx.theme().muted_foreground)
									.child("Files"),
							)
							.child(
								v_flex()
									.flex_1()
									.px_2()
									.gap_1()
									.id("file-list")
									.overflow_y_scroll()
									.children(files.into_iter().map(|path| {
										h_flex()
											.h(px(28.))
											.px_2()
											.gap_2()
											.rounded(px(6.))
											.hover(|this| this.bg(cx.theme().muted))
											.child(Icon::new(IconName::File).size_3())
											.child(div().text_xs().child(path))
									})),
							),
					)
					.child(
						v_flex().flex_1().min_w_0().h_full().map(|this| {
							if has_terminal {
								this.child(
									v_flex()
										.size_full()
										.child(
											h_flex()
												.h(px(36.))
												.px_3()
												.justify_between()
												.border_b_1()
												.border_color(cx.theme().border)
												.child(
													div().text_xs().child("Terminal"),
												)
												.child(
													Button::new("close-terminal")
														.ghost()
														.xsmall()
														.label("Close")
														.on_click(cx.listener(
															|this, _, _, cx| {
																this.close_terminal(cx);
															},
														)),
												),
										)
										.child(
											div()
												.id("terminal-output")
												.flex_1()
												.p_3()
												.font_family("monospace")
												.text_xs()
												.overflow_y_scroll()
												.child(if output.is_empty() {
													"Waiting for shell output…"
														.to_string()
												} else {
													output
												}),
										)
										.child(
											h_flex()
												.p_2()
												.gap_2()
												.border_t_1()
												.border_color(cx.theme().border)
												.child(
													Input::new(&input)
														.cleanable(true)
												)
												.child(
													Button::new("send-terminal")
														.primary()
														.label("Send")
														.on_click(cx.listener(
															|this, _, window, cx| {
																this.send_terminal_input(
																	window, cx,
																);
															},
														)),
												),
										),
								)
							} else {
								this.child(
									v_flex()
										.size_full()
										.items_center()
										.justify_center()
										.gap_2()
										.child(
											div()
												.size_8()
												.rounded(px(8.))
												.bg(cx.theme().muted)
												.flex()
												.items_center()
												.justify_center()
												.child(
													Icon::new(IconName::SquareTerminal)
														.size_4(),
												),
										)
										.child(
											div()
												.text_sm()
												.font_medium()
												.child("No terminals open"),
										)
										.child(
											div()
												.text_sm()
												.text_color(cx.theme().muted_foreground)
												.child(
													"Open a terminal to start working in this project.",
												),
										)
										.child(
											Button::new("new-terminal")
												.primary()
												.icon(IconName::Plus)
												.label("New Terminal")
												.on_click(cx.listener(
													|this, _, _, cx| {
														this.new_terminal(cx);
													},
												)),
										)
										.when(!diff.is_empty(), |this| {
											this.child(
												div()
													.mt_4()
													.max_w(px(640.))
													.max_h(px(180.))
													.p_3()
													.rounded(px(8.))
													.bg(cx.theme().muted)
													.font_family("monospace")
													.text_xs()
													.id("git-diff")
													.overflow_y_scroll()
													.child(diff),
											)
										}),
								)
							}
						}),
					),
			)
	}
}
