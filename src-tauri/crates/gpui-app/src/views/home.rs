use gpui::{
	Context, IntoElement, ParentElement, Styled, div, prelude::FluentBuilder, px,
};
use gpui_component::{
	ActiveTheme, Icon, IconName, StyledExt,
	button::{Button, ButtonVariants},
	v_flex,
};

use crate::app::AppRoot;
use crate::theme::TwoCodePalette;

impl AppRoot {
	pub(crate) fn render_home(
		&mut self,
		cx: &mut Context<Self>,
	) -> impl IntoElement {
		v_flex()
			.size_full()
			.child(
				div()
					.h(px(TwoCodePalette::HEADER_HEIGHT))
					.px_5()
					.flex()
					.items_center()
					.gap_2()
					.border_b_1()
					.border_color(cx.theme().border)
					.child(Icon::new(IconName::Folder).size_4().text_color(cx.theme().muted_foreground))
					.child(div().text_sm().font_semibold().child("Home")),
			)
			.child(
				v_flex()
					.flex_1()
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
							.child(Icon::new(IconName::Folder).size_4()),
					)
					.child(div().text_sm().font_medium().child("No projects yet"))
					.child(
						div()
							.text_sm()
							.text_color(cx.theme().muted_foreground)
							.child(
								"Create a project from a local folder to start working in 2code.",
							),
					)
					.child(
						Button::new("home-new-project")
							.primary()
							.icon(IconName::Plus)
							.label("New Project")
							.on_click(cx.listener(|this, _, _, cx| {
								this.show_create_project = true;
								cx.notify();
							})),
					)
					.when(!self.projects.is_empty(), |this| {
						this.child(
							div()
								.text_xs()
								.text_color(cx.theme().muted_foreground)
								.child(format!(
									"{} project(s) available in the sidebar.",
									self.projects.len()
								)),
						)
					}),
			)
	}
}
