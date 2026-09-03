use gpui::{
	Context, InteractiveElement, IntoElement, ParentElement, StatefulInteractiveElement,
	Styled, Window, div, px,
};
use gpui_component::{
	ActiveTheme, Icon, IconName, StyledExt,
	button::{Button, ButtonVariants},
	h_flex, v_flex,
};

use crate::app::AppRoot;
use crate::theme::TwoCodePalette;

impl AppRoot {
	pub(crate) fn render_home(
		&mut self,
		_window: &mut Window,
		cx: &mut Context<Self>,
	) -> impl IntoElement {
		let empty = self.projects.is_empty();
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
					.child(
						Icon::new(IconName::Folder)
							.size_4()
							.text_color(cx.theme().muted_foreground),
					)
					.child(div().text_sm().font_semibold().child(self.t("Home", "主页"))),
			)
			.child(if empty {
				self.render_home_empty(cx).into_any_element()
			} else {
				self.render_home_projects(cx).into_any_element()
			})
	}

	fn render_home_empty(&mut self, cx: &mut Context<Self>) -> impl IntoElement {
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
			.child(
				div()
					.text_sm()
					.font_medium()
					.child(self.t("No projects yet", "还没有项目")),
			)
			.child(
				div()
					.text_sm()
					.text_color(cx.theme().muted_foreground)
					.child(self.t(
						"Create a project from a local folder to start working in 2code.",
						"从本地文件夹创建一个项目，开始在 2code 中工作。",
					)),
			)
			.child(
				Button::new("home-new-project")
					.primary()
					.icon(IconName::Plus)
					.label(self.t("New Project", "新建项目"))
					.on_click(cx.listener(|this, _, window, cx| {
						this.open_create_project_dialog(window, cx);
					})),
			)
	}

	fn render_home_projects(&mut self, cx: &mut Context<Self>) -> impl IntoElement {
		let projects = self.projects.clone();
		v_flex()
			.flex_1()
			.p_6()
			.gap_4()
			.child(
				h_flex()
					.justify_between()
					.items_center()
					.child(
						div()
							.text_sm()
							.font_semibold()
							.child(self.t("Projects", "项目")),
					)
					.child(
						Button::new("home-new-project-filled")
							.primary()
							.icon(IconName::Plus)
							.label(self.t("New Project", "新建项目"))
							.on_click(cx.listener(|this, _, window, cx| {
								this.open_create_project_dialog(window, cx);
							})),
					),
			)
			.child(
				v_flex().gap_2().children(projects.into_iter().map(|project| {
					let project_id = project.id.clone();
					let card_id = format!("project-card-{project_id}");
					let profile_id = project
						.default_profile()
						.map(|profile| profile.id.clone())
						.unwrap_or_default();
					let name = project.name.clone();
					let folder = project.folder.clone();
					let lanes = project.profiles.len();
					div()
						.id(card_id)
						.p_4()
						.rounded(px(10.))
						.border_1()
						.border_color(cx.theme().border)
						.hover(|this| this.bg(cx.theme().muted))
						.cursor_pointer()
						.on_click(cx.listener(move |this, _, _, cx| {
							if !profile_id.is_empty() {
								this.open_workspace(&project_id, &profile_id, cx);
							}
						}))
						.child(
							v_flex()
								.gap_1()
								.child(div().text_sm().font_medium().child(name))
								.child(
									div()
										.text_xs()
										.text_color(cx.theme().muted_foreground)
										.child(folder),
								)
								.child(
									div()
										.text_xs()
										.text_color(cx.theme().muted_foreground)
										.child(format!("{lanes} profile(s)")),
								),
						)
				})),
			)
	}
}
