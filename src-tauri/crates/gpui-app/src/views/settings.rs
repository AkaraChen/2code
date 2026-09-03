use gpui::{
	Context, IntoElement, ParentElement, Styled, Window, div, prelude::FluentBuilder,
	px,
};
use gpui_component::{
	ActiveTheme, IconName,
	button::{Button, ButtonVariants},
	h_flex,
	switch::Switch,
	tab::{Tab, TabBar},
	v_flex,
};

use crate::app::{AppRoot, SettingsTab};

impl AppRoot {
	pub(crate) fn render_settings(
		&mut self,
		window: &mut Window,
		cx: &mut Context<Self>,
	) -> impl IntoElement {
		let tab = self.settings_tab;
		v_flex()
			.size_full()
			.p_5()
			.gap_6()
			.child(
				TabBar::new("settings-tabs")
					.selected_index(match tab {
						SettingsTab::General => 0,
						SettingsTab::Terminal => 1,
						SettingsTab::About => 2,
					})
					.on_click(cx.listener(|this, index: &usize, _, cx| {
						this.settings_tab = match index {
							0 => SettingsTab::General,
							1 => SettingsTab::Terminal,
							_ => SettingsTab::About,
						};
						cx.notify();
					}))
					.child(Tab::new().icon(IconName::Settings).label("General"))
					.child(Tab::new().icon(IconName::Terminal).label("Terminal"))
					.child(Tab::new().icon(IconName::Info).label("About")),
			)
			.child(match tab {
				SettingsTab::General => self
					.render_general_settings(window, cx)
					.into_any_element(),
				SettingsTab::Terminal => self
					.render_terminal_settings(cx)
					.into_any_element(),
				SettingsTab::About => self.render_about().into_any_element(),
			})
	}

	fn render_general_settings(
		&mut self,
		_window: &mut Window,
		cx: &mut Context<Self>,
	) -> impl IntoElement {
		let locale = self.settings.locale.clone();
		let theme = self.settings.theme.clone();
		v_flex()
			.max_w(px(448.))
			.gap_6()
			.child(self.setting_field(
				"Language",
				h_flex()
					.gap_2()
					.child(self.choice_button(
						"locale-en",
						"English",
						locale == "en",
						cx.listener(|this, _, _, cx| this.set_locale("en", cx)),
					))
					.child(self.choice_button(
						"locale-zh",
						"中文",
						locale == "zh",
						cx.listener(|this, _, _, cx| this.set_locale("zh", cx)),
					)),
			))
			.child(self.setting_field(
				"Theme",
				h_flex()
					.gap_2()
					.child(self.choice_button(
						"theme-system",
						"System",
						theme == "system",
						cx.listener(|this, _, window, cx| {
							this.set_theme_mode("system", window, cx)
						}),
					))
					.child(self.choice_button(
						"theme-light",
						"Light",
						theme == "light",
						cx.listener(|this, _, window, cx| {
							this.set_theme_mode("light", window, cx)
						}),
					))
					.child(self.choice_button(
						"theme-dark",
						"Dark",
						theme == "dark",
						cx.listener(|this, _, window, cx| {
							this.set_theme_mode("dark", window, cx)
						}),
					)),
			))
			.child(
				h_flex()
					.justify_between()
					.items_center()
					.child(
						v_flex()
							.child(div().text_sm().font_medium().child("Debug mode"))
							.child(
								div()
									.text_sm()
									.text_color(cx.theme().muted_foreground)
									.child("Show extra diagnostics in the native shell."),
							),
					)
					.child(
						Switch::new("debug-mode")
							.checked(self.settings.debug_mode)
							.on_click(cx.listener(|this, checked, _, cx| {
								this.settings.debug_mode = *checked;
								this.persist_settings();
								cx.notify();
							})),
					),
			)
			.child(
				h_flex()
					.justify_between()
					.items_center()
					.child(
						v_flex()
							.child(
								div().text_sm().font_medium().child("Performance profile"),
							)
							.child(
								div()
									.text_sm()
									.text_color(cx.theme().muted_foreground)
									.child("Record render timings for the current session."),
							),
					)
					.child(
						Switch::new("perf-profile")
							.checked(self.settings.performance_profile)
							.on_click(cx.listener(|this, checked, _, cx| {
								this.settings.performance_profile = *checked;
								this.persist_settings();
								cx.notify();
							})),
					),
			)
			.child(
				div()
					.text_xs()
					.text_color(cx.theme().muted_foreground)
					.child(format!(
						"Active appearance: {}",
						if self.settings.is_dark(false) {
							"dark"
						} else {
							"light"
						}
					)),
			)
	}

	fn render_terminal_settings(
		&mut self,
		cx: &mut Context<Self>,
	) -> impl IntoElement {
		v_flex()
			.max_w(px(448.))
			.gap_4()
			.child(self.setting_field(
				"Font",
				div().text_sm().child(self.settings.terminal_font.clone()),
			))
			.child(self.setting_field(
				"Font size",
				h_flex()
					.gap_2()
					.child(
						Button::new("font-smaller")
							.ghost()
							.label("-")
							.on_click(cx.listener(|this, _, _, cx| {
								this.settings.terminal_font_size =
									(this.settings.terminal_font_size - 1.0).max(10.0);
								this.persist_settings();
								cx.notify();
							})),
					)
					.child(
						div()
							.text_sm()
							.child(format!("{:.0}px", self.settings.terminal_font_size)),
					)
					.child(
						Button::new("font-larger")
							.ghost()
							.label("+")
							.on_click(cx.listener(|this, _, _, cx| {
								this.settings.terminal_font_size =
									(this.settings.terminal_font_size + 1.0).min(22.0);
								this.persist_settings();
								cx.notify();
							})),
					),
			))
			.child(
				div()
					.p_4()
					.rounded(px(8.))
					.bg(cx.theme().muted)
					.font_family("monospace")
					.text_sm()
					.child("$ 2code — native GPUI terminal preview"),
			)
	}

	fn render_about(&self) -> impl IntoElement {
		v_flex()
			.max_w(px(448.))
			.gap_2()
			.child(div().text_lg().font_semibold().child("2code"))
			.child(
				div()
					.text_sm()
					.text_color(gpui::rgb(0x737373))
					.child("A native GPUI workstation for terminals, Git, and worktrees."),
			)
			.child(
				div()
					.text_sm()
					.child("This build replaces the Tauri/React shell with Zed GPUI and gpui-component."),
			)
	}

	fn setting_field(
		&self,
		label: &'static str,
		control: impl IntoElement,
	) -> impl IntoElement {
		v_flex()
			.gap_2()
			.child(div().text_sm().font_medium().child(label))
			.child(control)
	}

	fn choice_button(
		&self,
		id: &'static str,
		label: &'static str,
		selected: bool,
		on_click: impl Fn(&gpui::ClickEvent, &mut Window, &mut Context<Self>) + 'static,
	) -> impl IntoElement {
		let button = Button::new(id).label(label).on_click(on_click);
		if selected {
			button.primary()
		} else {
			button.ghost()
		}
	}
}
