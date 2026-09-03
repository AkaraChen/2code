use gpui::{
	Context, IntoElement, ParentElement, Styled, div, px,
};
use gpui_component::{
	Icon, IconName, Selectable, StyledExt,
	button::{Button, ButtonVariants},
	sidebar::{
		Sidebar, SidebarCollapsible, SidebarGroup, SidebarHeader, SidebarMenu,
		SidebarMenuItem, SidebarToggleButton,
	},
	v_flex,
};

use crate::app::{AppRoot, Route};
use crate::theme::TwoCodePalette;

impl AppRoot {
	pub(crate) fn render_sidebar(
		&mut self,
		cx: &mut Context<Self>,
	) -> impl IntoElement {
		let collapsed = self.sidebar_collapsed;
		let route = self.route.clone();
		let projects = self.projects.clone();

		Sidebar::new("app-sidebar")
			.w(px(TwoCodePalette::SIDEBAR_WIDTH))
			.collapsible(SidebarCollapsible::Icon)
			.collapsed(collapsed)
			.header(
				SidebarHeader::new().child(
					div()
						.flex()
						.items_center()
						.justify_between()
						.w_full()
						.child(
							div()
								.font_semibold()
								.text_sm()
								.child("2Code"),
						)
						.child(
							SidebarToggleButton::new()
								.collapsed(collapsed)
								.on_click(cx.listener(|this, _, _, cx| {
									this.sidebar_collapsed = !this.sidebar_collapsed;
									cx.notify();
								})),
						),
				),
			)
			.child(
				SidebarGroup::new("Projects").child(
					SidebarMenu::new()
						.child(
							SidebarMenuItem::new("Home")
								.icon(Icon::new(IconName::LayoutDashboard).size_4())
								.active(matches!(route, Route::Home))
								.on_click(cx.listener(|this, _, _, cx| {
									this.open_home(cx);
								})),
						)
						.children(projects.iter().map(|project| {
							let project_id = project.id.clone();
							let profile_id = project
								.default_profile()
								.map(|profile| profile.id.clone())
								.unwrap_or_default();
							let active = matches!(
								&route,
								Route::Workspace { project_id: current, .. }
									if current == &project_id
							);
							SidebarMenuItem::new(project.name.clone())
								.icon(Icon::new(IconName::Folder).size_4())
								.active(active)
								.default_open(active)
								.click_to_toggle(true)
								.children(project.profiles.iter().map(|profile| {
									let project_id = project_id.clone();
									let profile_id = profile.id.clone();
									let selected = matches!(
										&route,
										Route::Workspace { profile_id: current, .. }
											if current == &profile_id
									);
									SidebarMenuItem::new(profile.branch_name.clone())
										.icon(Icon::new(IconName::Folder).size_4())
										.active(selected)
										.on_click(cx.listener(move |this, _, _, cx| {
											this.open_workspace(
												&project_id,
												&profile_id,
												cx,
											);
										}))
								}))
								.on_click(cx.listener(move |this, _, _, cx| {
									if !profile_id.is_empty() {
										this.open_workspace(&project_id, &profile_id, cx);
									}
								}))
						})),
				),
			)
			.footer(
				v_flex()
					.w_full()
					.gap_1()
					.child(
						Button::new("new-project")
							.ghost()
							.icon(IconName::Plus)
							.label("New Project")
							.on_click(cx.listener(|this, _, window, cx| {
								this.open_create_project_dialog(window, cx);
							})),
					)
					.child(
						Button::new("open-settings")
							.ghost()
							.icon(IconName::Settings)
							.label("Settings")
							.selected(matches!(route, Route::Settings))
							.on_click(cx.listener(|this, _, _, cx| {
								this.open_settings(cx);
							})),
					)
					.child(
						Button::new("open-commands")
							.ghost()
							.icon(IconName::Info)
							.label("Commands")
							.on_click(cx.listener(|this, _, window, cx| {
								this.open_command_palette(window, cx);
							})),
					),
			)
	}
}
