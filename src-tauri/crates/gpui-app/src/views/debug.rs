use gpui::{
	Context, IntoElement, ParentElement, Styled, div, prelude::FluentBuilder, px,
};
use gpui_component::{
	ActiveTheme, StyledExt,
	button::{Button, ButtonVariants},
	v_flex,
};

use crate::app::{AppRoot, Route};

impl AppRoot {
	pub(crate) fn render_debug_overlay(
		&mut self,
		cx: &mut Context<Self>,
	) -> impl IntoElement {
		div().when(self.settings.debug_mode && self.debug_open, |this| {
			let route = match &self.route {
				Route::Home => "home".to_string(),
				Route::Settings => "settings".to_string(),
				Route::Workspace {
					project_id,
					profile_id,
				} => format!("workspace {project_id}/{profile_id}"),
			};
			let session = self
				.active_session
				.clone()
				.unwrap_or_else(|| "none".into());
			let status = self
				.terminals
				.iter()
				.find(|tab| Some(&tab.id) == self.active_session.as_ref())
				.and_then(|tab| tab.status)
				.map(|status| format!("{status:?}"))
				.unwrap_or_else(|| "idle".into());
			this.absolute().right_4().bottom_4().child(
				v_flex()
					.w(px(320.))
					.p_3()
					.gap_1()
					.rounded(px(10.))
					.border_1()
					.border_color(cx.theme().border)
					.bg(cx.theme().popover)
					.child(
						div()
							.text_xs()
							.font_semibold()
							.child(self.t("Debug", "调试")),
					)
					.child(div().text_xs().child(format!("route: {route}")))
					.child(div().text_xs().child(format!("session: {session}")))
					.child(div().text_xs().child(format!("agent: {status}")))
					.child(
						div()
							.text_xs()
							.child(format!("git: {}", self.git_stats_label)),
					)
					.child(
						div()
							.text_xs()
							.child(format!(
								"changes: {} · ahead {}",
								self.changed_files.len(),
								self.git_ahead
							)),
					)
					.child(
						div()
							.text_xs()
							.child(format!(
								"pty: {}×{}",
								self.settings.terminal_cols, self.settings.terminal_rows
							)),
					)
					.when_some(self.error.clone(), |this, error| {
						this.child(
							div()
								.text_xs()
								.text_color(cx.theme().danger_foreground)
								.child(error),
						)
					})
					.child(
						Button::new("close-debug")
							.ghost()
							.label(self.t("Close", "关闭"))
							.on_click(cx.listener(|this, _, _, cx| {
								this.debug_open = false;
								cx.notify();
							})),
					),
			)
		})
	}
}
