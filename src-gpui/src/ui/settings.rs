#![cfg_attr(rustfmt, rustfmt_skip)]

use gpui::{
	div, img, point, prelude::*, px, size, App, Bounds, Context, Image, ImageFormat, SharedString,
	Window, WindowBounds, WindowOptions,
};
use gpui_component::button::{Button, ButtonVariants};
use gpui_component::{Disableable, Selectable};
use gpui_component::input::Input;
use gpui_component::switch::Switch;
use gpui_component::checkbox::Checkbox;
use gpui_component::{
	h_flex, v_flex, ActiveTheme, Icon, IconName, Root, Sizable, StyledExt, ThemeMode,
};
use gpui_component::tab::Tab;

use crate::app::AppView;
use crate::i18n::Locale;
use crate::prefs::{term_theme_by_name, RadiusPref, TERM_THEMES, ThemePref};
use crate::state::{
	leftover_command_preview, leftover_normalize_global_template, leftover_template_draft_can_save,
	leftover_template_draft_width, DialogKind, SettingsTab,
};

pub fn open_update_page(app: &mut AppView, window: &mut Window, cx: &mut Context<AppView>) {
	open_settings_at(app, window, cx, Some(SettingsTab::About));
}

pub fn open_settings_window(app: &mut AppView, window: &mut Window, cx: &mut Context<AppView>) {
	open_settings_at(app, window, cx, None);
}

fn open_settings_at(
	app: &mut AppView,
	window: &mut Window,
	cx: &mut Context<AppView>,
	tab: Option<SettingsTab>,
) {
	if let Some(existing) = app.settings_view.as_ref().and_then(|w| w.upgrade()) {
		if let Some(tab) = tab {
			existing.update(cx, |this, cx| {
				this.tab = tab;
				cx.notify();
			});
		}
		if let Some(handle) = app.settings_window.clone() {
			if handle.update(cx, |_, win, _| win.activate_window()).is_ok() {
				app.data.overlay.settings_open = true;
				app.data.overlay.settings_tab = tab.unwrap_or(app.data.overlay.settings_tab);
				return;
			}
		}
	}
	let backend = app.backend.clone();
	let prefs = app.data.prefs.clone();
	let locale = app.data.locale;
	let main = cx.entity().downgrade();
	let bounds = Bounds::centered(None, size(px(880.), px(640.)), cx);
	if let Ok(handle) = cx.open_window(
		WindowOptions {
			window_bounds: Some(WindowBounds::Windowed(bounds)),
			window_min_size: Some(size(px(600.), px(420.))),
			titlebar: Some(gpui::TitlebarOptions {
				title: Some(SharedString::from("Settings")),
				appears_transparent: false,
				traffic_light_position: Some(point(px(12.), px(12.))),
			}),
			..Default::default()
		},
		move |window, cx| {
			let initial = tab.unwrap_or(SettingsTab::General);
			let view = cx.new(|cx| {
				let mut settings =
					SettingsView::new(backend.clone(), prefs.clone(), locale, main.clone(), window, cx);
				settings.tab = initial;
				if let Some(main) = settings.main.upgrade() {
					let weak = cx.entity().downgrade();
					main.update(cx, |app, _| {
						app.settings_view = Some(weak);
					});
				}
				settings
			});
			cx.new(|cx| Root::new(view, window, cx))
		},
	) {
		app.settings_window = Some(handle);
		app.data.overlay.settings_open = true;
	}
	let _ = window;
}

pub struct SettingsView {
	backend: crate::backend::Backend,
	prefs: crate::prefs::Prefs,
	locale: Locale,
	tab: SettingsTab,
	main: gpui::WeakEntity<AppView>,
	custom_shell: gpui::Entity<gpui_component::input::InputState>,
	worktree: gpui::Entity<gpui_component::input::InputState>,
	template_name: gpui::Entity<gpui_component::input::InputState>,
	template_shell: gpui::Entity<gpui_component::input::InputState>,
	template_cwd: gpui::Entity<gpui_component::input::InputState>,
	template_cmds: gpui::Entity<gpui_component::input::InputState>,
	update_status: String,
	latest_version: Option<String>,
	released_at: Option<String>,
	latest_url: String,
	fonts: Vec<String>,
	sounds: Vec<String>,
	editing_template_id: Option<String>,
	template_dialog_open: bool,
	preview_theme: Option<String>,
	open_select: Option<String>,
}

impl SettingsView {
	fn new(
		backend: crate::backend::Backend,
		prefs: crate::prefs::Prefs,
		locale: Locale,
		main: gpui::WeakEntity<AppView>,
		window: &mut Window,
		cx: &mut Context<Self>,
	) -> Self {
		fn inp(
			window: &mut Window,
			cx: &mut Context<SettingsView>,
			ph: &str,
			val: &str,
			multi: bool,
		) -> gpui::Entity<gpui_component::input::InputState> {
			let ph = ph.to_string();
			let val = val.to_string();
			cx.new(|cx| {
				let mut s = gpui_component::input::InputState::new(window, cx).placeholder(ph);
				if multi {
					s = s.multi_line(true);
				}
				s
			})
		}
		let custom_shell = inp(window, cx, &crate::i18n::t(locale, "customShellPlaceholder"), &prefs.custom_shell, false);
		let worktree = inp(window, cx, &crate::i18n::t(locale, "defaultWorktreeDirPlaceholder"), &prefs.worktree_dir, false);
		custom_shell.update(cx, |s, cx| {
			s.set_placeholder(crate::i18n::t(locale, "customShellPlaceholder"), window, cx);
			s.set_value(prefs.custom_shell.clone(), window, cx);
		});
		worktree.update(cx, |s, cx| {
			s.set_value(prefs.worktree_dir.clone(), window, cx);
		});
		Self {
			backend,
			prefs,
			locale,
			tab: SettingsTab::General,
			main,
			custom_shell,
			worktree,
			template_name: inp(window, cx, &crate::i18n::t(locale, "terminalTemplateNamePlaceholder"), "", false),
			template_shell: inp(window, cx, &crate::i18n::t(locale, "terminalTemplateShellPlaceholder"), "", false),
			template_cwd: inp(window, cx, &crate::i18n::t(locale, "terminalTemplateCwdPlaceholder"), "", false),
			template_cmds: inp(window, cx, &crate::i18n::t(locale, "scriptPlaceholder"), "", true),
			update_status: crate::i18n::t(locale, "updateIdleDescription"),
			latest_version: None,
			released_at: None,
			latest_url: crate::updater::releases_page().to_string(),
			fonts: crate::platform::list_mono_fonts(),
			sounds: crate::platform::list_system_sounds(),
			editing_template_id: None,
			template_dialog_open: false,
			preview_theme: None,
			open_select: None,
		}
	}

	fn t(&self, key: &str) -> String {
		crate::i18n::t(self.locale, key)
	}

	fn persist(&mut self, cx: &mut Context<Self>) {
		let typed = self.custom_shell.read(cx).value().to_string();
		let listed = crate::platform::list_shells();
		if self.prefs.custom_shell.is_empty() || !listed.iter().any(|s| s == &self.prefs.custom_shell) {
			self.prefs.custom_shell = typed;
		}
		self.prefs.worktree_dir = self.worktree.read(cx).value().to_string();
		self.prefs.language = self.locale;
		self.prefs.save(&self.backend.app_data_dir);
		let scale = self.prefs.radius.scale();
		let theme = gpui_component::Theme::global_mut(cx);
		theme.radius = px(6.0 * scale);
		theme.radius_lg = px(8.0 * scale);
		if let Some(main) = self.main.upgrade() {
			let prefs = self.prefs.clone();
			let locale = self.locale;
			main.update(cx, |app, cx| {
				app.data.prefs = prefs;
				app.data.locale = locale;
				if !app.data.prefs.debug_mode {
					if app.data.overlay.dialog == Some(DialogKind::DebugLog) {
						app.data.overlay.dialog = None;
					}
					app.data.overlay.debug_open = false;
				}
				app.persist_prefs();
				cx.notify();
			});
		}
	}
}

impl gpui::Render for SettingsView {
	fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
		let theme = cx.theme().clone();
		let tab = self.tab;
		v_flex()
			.id("settings-window")
			.size_full()
			.relative()
			.bg(theme.background)
			.child(
				h_flex()
					.id("settings-tabs")
					.w_full()
					.px_5()
					.pt_5()
					.gap_2()
					.overflow_x_scroll()
					.child(set_tab("g", IconName::Settings, self.t("general"), tab == SettingsTab::General, SettingsTab::General, cx))
					.child(set_tab("t", IconName::SquareTerminal, self.t("terminal"), tab == SettingsTab::Terminal, SettingsTab::Terminal, cx))
					.child(set_tab("tp", IconName::LayoutDashboard, self.t("templates"), tab == SettingsTab::Templates, SettingsTab::Templates, cx))
					.child(set_tab("n", IconName::Bell, self.t("notification"), tab == SettingsTab::Notification, SettingsTab::Notification, cx))
					.child(set_tab("tb", IconName::PanelBottom, self.t("topbar"), tab == SettingsTab::TopBar, SettingsTab::TopBar, cx))
					.child(set_tab("a", IconName::Info, self.t("about"), tab == SettingsTab::About, SettingsTab::About, cx)),
			)
			.child(
				div()
					.id("settings-body")
					.flex_1()
					.min_h_0()
					.p_5()
					.overflow_y_scroll()
					.child(match self.tab {
						SettingsTab::General => self.general(window, cx).into_any_element(),
						SettingsTab::Terminal => self.terminal(window, cx).into_any_element(),
						SettingsTab::Templates => self.templates(window, cx).into_any_element(),
						SettingsTab::Notification => self.notification(cx).into_any_element(),
						SettingsTab::TopBar => self.topbar(cx).into_any_element(),
						SettingsTab::About => self.about(cx).into_any_element(),
					}),
			)
			.child(self.leftover_template_draft_overlay(window, cx))
	}
}

impl SettingsView {
	fn general(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
		let view = cx.entity();
		v_flex()
			.id("settings-general")
			.max_w(px(448.))
			.gap_6()
			.child(field_label(&self.t("language")))
			.child(leftover_select(
				"language",
				match self.locale {
					Locale::En => "English",
					Locale::Zh => "中文",
				},
				self.open_select.as_deref() == Some("language"),
				false,
				vec![
					("en".into(), "English".into()),
					("zh".into(), "中文".into()),
				],
				view.clone(),
				cx.theme().clone(),
				|this, value, cx| {
					this.locale = if value == "zh" { Locale::Zh } else { Locale::En };
					this.persist(cx);
				},
			))
			.child(field_label(&self.t("theme")))
			.child(leftover_select(
				"theme",
				&match self.prefs.theme {
					ThemePref::System => self.t("themeSystem"),
					ThemePref::Light => self.t("themeLight"),
					ThemePref::Dark => self.t("themeDark"),
				},
				self.open_select.as_deref() == Some("theme"),
				false,
				vec![
					("system".into(), self.t("themeSystem")),
					("light".into(), self.t("themeLight")),
					("dark".into(), self.t("themeDark")),
				],
				view.clone(),
				cx.theme().clone(),
				|this, value, cx| {
					this.prefs.theme = match value.as_str() {
						"light" => ThemePref::Light,
						"dark" => ThemePref::Dark,
						_ => ThemePref::System,
					};
					let mode = match this.prefs.theme {
						ThemePref::Dark => ThemeMode::Dark,
						ThemePref::Light => ThemeMode::Light,
						ThemePref::System => cx.window_appearance().into(),
					};
					gpui_component::Theme::change(mode, None, cx);
					this.persist(cx);
				},
			))
			.child(field_label(&self.t("borderRadius")))
			.child(
				h_flex().gap_2().children(RadiusPref::all().into_iter().map(|r| {
					let selected = self.prefs.radius == r;
					choice(r.label_key(), &self.t(r.label_key()), selected, {
						let view = view.clone();
						move |cx| {
							view.update(cx, |this, cx| {
								this.prefs.radius = r;
								this.persist(cx);
								cx.notify();
							});
						}
					})
				})),
			)
			.child(field_label(&self.t("defaultWorktreeDir")))
			.child(
				div()
					.text_xs()
					.text_color(cx.theme().muted_foreground)
					.child(self.t("defaultWorktreeDirDesc")),
			)
			.child(
				h_flex()
					.gap_2()
					.child(div().flex_1().min_w_0().child(Input::new(&self.worktree)))
					.child(
						Button::new("pick-worktree")
							.small()
							.icon(IconName::Folder)
							.label(self.t("chooseFolder"))
							.on_click({
								let view = view.clone();
								move |_, window, cx| {
									if let Some(folder) = crate::backend::pick_folder() {
										view.update(cx, |this, cx| {
											this.worktree.update(cx, |s, cx| {
												s.set_value(folder, window, cx);
											});
											this.persist(cx);
											cx.notify();
										});
									}
								}
							}),
					)
					.child(
						Button::new("clear-worktree")
							.ghost()
							.small()
							.icon(IconName::Close)
							.tooltip(self.t("clearDefaultWorktreeDir"))
							.disabled(self.worktree.read(cx).value().is_empty())
							.on_click({
								let view = view.clone();
								move |_, window, cx| {
									view.update(cx, |this, cx| {
										this.worktree.update(cx, |s, cx| {
											s.set_value("", window, cx);
										});
										this.persist(cx);
										cx.notify();
									});
								}
							}),
					),
			)
			.child(switch_row(
				"debug-mode",
				self.t("debugMode"),
				self.t("debugModeDescription"),
				self.prefs.debug_mode,
				{
					let view = view.clone();
					move |val, cx| {
						view.update(cx, |this, cx| {
							this.prefs.debug_mode = val;
							this.persist(cx);
							cx.notify();
						});
					}
				},
			))
			.child(switch_row(
				"perf",
				self.t("performanceProfile"),
				self.t("performanceProfileDescription"),
				self.prefs.performance_profile,
				{
					let view = view.clone();
					move |val, cx| {
						view.update(cx, |this, cx| {
							this.prefs.performance_profile = val;
							this.persist(cx);
							cx.notify();
						});
					}
				},
			))
			.child(switch_row(
				"avatars",
				self.t("showProjectAvatars"),
				self.t("showProjectAvatarsDescription"),
				self.prefs.show_avatars,
				{
					let view = view.clone();
					move |val, cx| {
						view.update(cx, |this, cx| {
							this.prefs.show_avatars = val;
							this.persist(cx);
							cx.notify();
						});
					}
				},
			))
	}

	fn preview_theme_name(&self, cx: &Context<Self>) -> String {
		if let Some(name) = &self.preview_theme {
			return name.clone();
		}
		if !self.prefs.sync_terminal_theme && cx.theme().mode == ThemeMode::Light {
			self.prefs.terminal_theme_light.clone()
		} else {
			self.prefs.terminal_theme_dark.clone()
		}
	}

	fn terminal(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
		let view = cx.entity();
		let theme = term_theme_by_name(&self.preview_theme_name(cx));
		let shells = crate::platform::list_shells();
		let default_shell = crate::backend::default_shell();
		let custom_selected = self.prefs.custom_shell.is_empty() || !shells.iter().any(|s| s == &self.prefs.custom_shell);
		let fonts = if self.prefs.show_all_fonts {
			crate::platform::visible_font_families(true)
		} else {
			self.fonts.clone()
		};
		let dark_label = if self.prefs.sync_terminal_theme {
			self.t("terminalTheme")
		} else {
			self.t("terminalThemeDark")
		};
		h_flex()
			.id("settings-terminal")
			.size_full()
			.gap_8()
			.child(
				v_flex()
					.max_w(px(448.))
					.gap_4()
					.child(theme_label_row(&dark_label, "preview-dark", self.t("preview"), {
						let view = view.clone();
						let name = self.prefs.terminal_theme_dark.clone();
						move |cx| {
							view.update(cx, |this, cx| {
								this.preview_theme = Some(name.clone());
								cx.notify();
							});
						}
					}))
					.child(leftover_select(
						"term-theme-dark",
						&self.prefs.terminal_theme_dark,
						self.open_select.as_deref() == Some("term-theme-dark"),
						false,
						TERM_THEMES.iter().map(|t| (t.name.to_string(), t.name.to_string())).collect(),
						view.clone(),
						cx.theme().clone(),
						|this, value, cx| {
							this.prefs.terminal_theme_dark = value.clone();
							if this.prefs.sync_terminal_theme {
								this.prefs.terminal_theme_light = value;
							}
							this.preview_theme = None;
							this.persist(cx);
						},
					))
					.when(!self.prefs.sync_terminal_theme, |el| {
						el.child(theme_label_row(&self.t("terminalThemeLight"), "preview-light", self.t("preview"), {
							let view = view.clone();
							let name = self.prefs.terminal_theme_light.clone();
							move |cx| {
								view.update(cx, |this, cx| {
									this.preview_theme = Some(name.clone());
									cx.notify();
								});
							}
						}))
							.child(leftover_select(
								"term-theme-light",
								&self.prefs.terminal_theme_light,
								self.open_select.as_deref() == Some("term-theme-light"),
								false,
								TERM_THEMES.iter().map(|t| (t.name.to_string(), t.name.to_string())).collect(),
								view.clone(),
								cx.theme().clone(),
								|this, value, cx| {
									this.prefs.terminal_theme_light = value;
									this.preview_theme = None;
									this.persist(cx);
								},
							))
					})
					.child(leftover_check_row(
						"sync-term",
						self.t("syncTerminalTheme"),
						self.prefs.sync_terminal_theme,
						{
							let view = view.clone();
							move |val, cx| {
								view.update(cx, |this, cx| {
									this.prefs.sync_terminal_theme = val;
									this.persist(cx);
									cx.notify();
								});
							}
						},
					))
					.child(field_label(&self.t("defaultShell")))
					.child(leftover_select(
						"shell",
						&if custom_selected {
							self.t("customShell")
						} else if self.prefs.custom_shell == default_shell {
							format!("{} ({})", self.prefs.custom_shell, self.t("defaultOption"))
						} else {
							self.prefs.custom_shell.clone()
						},
						self.open_select.as_deref() == Some("shell"),
						false,
						{
							let mut options: Vec<(String, String)> = shells
								.into_iter()
								.map(|shell| {
									let label = if shell == default_shell {
										format!("{shell} ({})", self.t("defaultOption"))
									} else {
										shell.clone()
									};
									(shell, label)
								})
								.collect();
							options.push(("__custom__".into(), self.t("customShell")));
							options
						},
						view.clone(),
						cx.theme().clone(),
						|this, value, cx| {
							if value == "__custom__" {
								if crate::platform::list_shells().iter().any(|s| s == &this.prefs.custom_shell) {
									this.prefs.custom_shell.clear();
								}
							} else {
								this.prefs.custom_shell = value;
							}
							this.persist(cx);
						},
					))
					.child(
						div()
							.text_xs()
							.text_color(cx.theme().muted_foreground)
							.child(self.t("defaultShellDescription")),
					)
					.when(custom_selected, |el| el.child(Input::new(&self.custom_shell)))
					.child(field_label(&self.t("terminalFont")))
					.when(fonts.is_empty(), |el| {
						el.child(leftover_select(
							"font",
							&self.t("fontPickerUnavailable"),
							false,
							true,
							vec![("".into(), self.t("fontPickerUnavailable"))],
							view.clone(),
							cx.theme().clone(),
							|_, _, _| {},
						))
						.child(
							div()
								.text_xs()
								.text_color(cx.theme().muted_foreground)
								.child(self.t("fontPickerUnavailableDescription")),
						)
					})
					.when(!fonts.is_empty(), |el| {
						el.child(leftover_select(
							"font",
							&self.prefs.font_family,
							self.open_select.as_deref() == Some("font"),
							false,
							fonts.into_iter().map(|family| (family.clone(), family)).collect(),
							view.clone(),
							cx.theme().clone(),
							|this, value, cx| {
								this.prefs.font_family = value;
								this.persist(cx);
							},
						))
					})
					.child(leftover_check_row(
						"show-all-fonts",
						self.t("showAllFonts"),
						self.prefs.show_all_fonts,
						{
							let view = view.clone();
							move |val, cx| {
								view.update(cx, |this, cx| {
									this.prefs.show_all_fonts = val;
									this.persist(cx);
									cx.notify();
								});
							}
						},
					))
					.child(field_label(&self.t("fontSize")))
					.child(
						h_flex()
							.gap_2()
							.child(
								Button::new("fs-")
									.xsmall()
									.label("-")
									.on_click({
										let view = view.clone();
										move |_, _, cx| {
											view.update(cx, |this, cx| {
												this.prefs.font_size = (this.prefs.font_size - 1.0).max(10.0);
												this.persist(cx);
												cx.notify();
											});
										}
									}),
							)
							.child(div().child(format!("{}", self.prefs.font_size as i32)))
							.child(
								Button::new("fs+")
									.xsmall()
									.label("+")
									.on_click({
										let view = view.clone();
										move |_, _, cx| {
											view.update(cx, |this, cx| {
												this.prefs.font_size = (this.prefs.font_size + 1.0).min(20.0);
												this.persist(cx);
												cx.notify();
											});
										}
									}),
							),
					),
			)
			.child(
				v_flex()
					.id("terminal-preview")
					.flex_1()
					.h(px(220.))
					.rounded_lg()
					.px(px(16.))
					.py(px(12.))
					.gap_0()
					.bg(gpui::rgb(theme.bg))
					.text_color(gpui::rgb(theme.fg))
					.font_family(self.prefs.font_family.clone())
					.text_size(px(self.prefs.font_size))
					.border_1()
					.border_color(cx.theme().border)
					.child(preview_line(0x3fb950, "$", theme.fg, "whoami"))
					.child(div().child("2code"))
					.child(preview_line(0x3fb950, "$", theme.fg, "ls"))
					.child(div().child("src-gpui  docs  messages"))
					.child(preview_line(0x3fb950, "$", theme.fg, "echo \"Hello, 2code!\""))
					.child(div().child("Hello, 2code!"))
					.child(
						h_flex()
							.gap_1()
							.child(div().text_color(gpui::rgb(0x3fb950)).child("$"))
							.child(
								div()
									.w(px(8.))
									.h(px(self.prefs.font_size))
									.bg(gpui::rgb(theme.cursor)),
							),
					),
			)
	}

	fn templates(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
		let _ = window;
		let view = cx.entity();
		let theme = cx.theme().clone();
		v_flex()
			.id("settings-templates")
			.max_w(px(672.))
			.gap_4()
			.child(
				h_flex()
					.items_start()
					.justify_between()
					.gap_4()
					.child(
						v_flex()
							.gap_1()
							.child(div().font_semibold().child(self.t("globalTerminalTemplates")))
							.child(
								div()
									.text_sm()
									.text_color(theme.muted_foreground)
									.child(self.t("globalTerminalTemplatesDescription")),
							),
					)
					.child(
						Button::new("add-tpl")
							.outline()
							.small()
							.label(self.t("addTerminalTemplate"))
							.on_click({
								let view = view.clone();
								move |_, window, cx| {
									view.update(cx, |this, cx| {
										this.open_template_draft(None, window, cx);
									});
								}
							}),
					),
			)
			.child(if self.prefs.templates.is_empty() {
				div()
					.rounded_lg()
					.border_1()
					.border_color(theme.border)
					.px_4()
					.py_3()
					.child(
						div()
							.text_sm()
							.text_color(theme.muted_foreground)
							.child(self.t("noTerminalTemplates")),
					)
					.into_any_element()
			} else {
				v_flex()
					.gap_2()
					.children(self.prefs.templates.iter().cloned().map(|t| {
						let preview = leftover_command_preview(&t.commands.join("\n"));
						h_flex()
							.id(crate::ui::eid(format!("tpl-{}", t.id)))
							.items_center()
							.justify_between()
							.gap_4()
							.rounded_lg()
							.border_1()
							.border_color(theme.border)
							.px_4()
							.py_3()
							.child(
								v_flex()
									.min_w_0()
									.gap_1()
									.child(div().font_medium().child(t.name.clone()))
									.when(!preview.is_empty(), |el| {
										el.child(
											div()
												.font_family("monospace")
												.text_sm()
												.text_color(theme.muted_foreground)
												.child(preview),
										)
									}),
							)
							.child(
								h_flex()
									.flex_shrink_0()
									.gap_1()
									.child(
										Button::new(crate::ui::eid(format!("tpl-edit-{}", t.id)))
											.ghost()
											.xsmall()
											.tooltip(self.t("editTerminalTemplate"))
											.child(crate::ui::leftover_pencil_glyph(theme.muted_foreground))
											.on_click({
												let view = view.clone();
												let t = t.clone();
												move |_, window, cx| {
													view.update(cx, |this, cx| {
														this.open_template_draft(Some(&t), window, cx);
													});
												}
											}),
									)
									.child(
										Button::new(crate::ui::eid(format!("del-{}", t.id)))
											.ghost()
											.xsmall()
											.tooltip(self.t("deleteTerminalTemplate"))
											.child(Icon::new(IconName::Delete).w(px(14.)).text_color(theme.danger))
											.on_click({
												let view = view.clone();
												let id = t.id.clone();
												move |_, _, cx| {
													view.update(cx, |this, cx| {
														this.prefs.templates.retain(|x| x.id != id);
														if this.editing_template_id.as_deref() == Some(id.as_str()) {
															this.close_template_draft();
														}
														this.persist(cx);
														cx.notify();
													});
												}
											}),
									),
							)
					}))
					.into_any_element()
			})
	}

	fn leftover_template_draft_overlay(
		&mut self,
		_window: &mut Window,
		cx: &mut Context<Self>,
	) -> impl IntoElement {
		if !self.template_dialog_open {
			return div().id("no-tpl-draft").into_any_element();
		}
		let view = cx.entity();
		let theme = cx.theme().clone();
		let editing = self.editing_template_id.is_some();
		let name = self.template_name.read(cx).value().to_string();
		let can_save = leftover_template_draft_can_save(&name);
		div()
			.id("tpl-draft-mask")
			.absolute()
			.inset_0()
			.flex()
			.items_center()
			.justify_center()
			.bg(gpui::hsla(0., 0., 0., 0.12))
			.on_click({
				let view = view.clone();
				move |_, _, cx| {
					view.update(cx, |this, cx| {
						this.close_template_draft();
						cx.notify();
					});
				}
			})
			.child(
				v_flex()
					.id("tpl-draft-panel")
					.w(px(leftover_template_draft_width()))
					.p_4()
					.gap_4()
					.rounded_xl()
					.bg(theme.popover)
					.border_1()
					.border_color(theme.border)
					.shadow_lg()
					.on_click(|_, _, _| {})
					.child(
						h_flex()
							.gap_2()
							.items_center()
							.child(Icon::new(IconName::SquareTerminal).w(px(16.)))
							.child(
								div().font_semibold().child(if editing {
									self.t("editTerminalTemplate")
								} else {
									self.t("addTerminalTemplate")
								}),
							),
					)
					.child(
						v_flex()
							.gap_4()
							.child(
								v_flex()
									.gap_1()
									.child(field_label(&self.t("terminalTemplateName")))
									.child(Input::new(&self.template_name)),
							)
							.child(
								v_flex()
									.gap_1()
									.child(field_label(&self.t("terminalTemplateCommands")))
									.child(
										div()
											.text_xs()
											.text_color(theme.muted_foreground)
											.child(self.t("terminalTemplateCommandsDescription")),
									)
									.child(Input::new(&self.template_cmds)),
							),
					)
					.child(
						h_flex()
							.justify_between()
							.child(
								h_flex()
									.gap_2()
									.child(
										Button::new("tpl-cancel")
											.outline()
											.small()
											.label(self.t("cancel"))
											.on_click({
												let view = view.clone();
												move |_, _, cx| {
													view.update(cx, |this, cx| {
														this.close_template_draft();
														cx.notify();
													});
												}
											}),
									)
									.when(editing, |el| {
										el.child(
											Button::new("tpl-delete")
												.danger()
												.small()
												.label(self.t("delete"))
												.on_click({
													let view = view.clone();
													move |_, _, cx| {
														view.update(cx, |this, cx| {
															if let Some(id) = this.editing_template_id.clone() {
																this.prefs.templates.retain(|x| x.id != id);
																this.persist(cx);
															}
															this.close_template_draft();
															cx.notify();
														});
													}
												}),
										)
									}),
							)
							.child(
								Button::new("tpl-save")
									.primary()
									.small()
									.label(self.t("save"))
									.disabled(!can_save)
									.on_click({
										let view = view.clone();
										move |_, _, cx| {
											view.update(cx, |this, cx| {
												this.save_template_draft(cx);
											});
										}
									}),
							),
					),
			)
			.into_any_element()
	}

	fn open_template_draft(
		&mut self,
		template: Option<&crate::prefs::TerminalTemplatePref>,
		window: &mut Window,
		cx: &mut Context<Self>,
	) {
		if let Some(t) = template {
			self.editing_template_id = Some(t.id.clone());
			self.template_name.update(cx, |s, cx| {
				s.set_value(t.name.clone(), window, cx);
			});
			self.template_cmds.update(cx, |s, cx| {
				s.set_value(t.commands.join("\n"), window, cx);
			});
		} else {
			self.editing_template_id = None;
			self.template_name.update(cx, |s, cx| s.set_value("", window, cx));
			self.template_cmds.update(cx, |s, cx| s.set_value("", window, cx));
		}
		self.template_dialog_open = true;
		cx.notify();
	}

	fn close_template_draft(&mut self) {
		self.template_dialog_open = false;
		self.editing_template_id = None;
	}

	fn save_template_draft(&mut self, cx: &mut Context<Self>) {
		let name = self.template_name.read(cx).value().to_string();
		let commands_text = self.template_cmds.read(cx).value().to_string();
		let Some((name, commands)) = leftover_normalize_global_template(&name, &commands_text) else {
			return;
		};
		crate::prefs::upsert_template(
			&mut self.prefs.templates,
			self.editing_template_id.as_deref(),
			name,
			String::new(),
			String::new(),
			commands,
		);
		self.close_template_draft();
		self.persist(cx);
		cx.notify();
	}

	fn notification(&mut self, cx: &mut Context<Self>) -> impl IntoElement {
		let view = cx.entity();
		v_flex()
			.gap_4()
			.max_w(px(448.))
			.child(switch_row(
				"notif",
				self.t("notificationEnabled"),
				self.t("notificationEnabledDescription"),
				self.prefs.notifications,
				{
					let view = view.clone();
					move |val, cx| {
						view.update(cx, |this, cx| {
							this.prefs.notifications = val;
							this.persist(cx);
							cx.notify();
						});
					}
				},
			))
			.child(
				h_flex()
					.w_full()
					.items_center()
					.gap_2()
					.child(div().flex_1().child(field_label(&self.t("notificationSound"))))
					.child(
						Button::new("preview-sound")
							.ghost()
							.xsmall()
							.icon(IconName::Bell)
							.disabled(!self.prefs.notifications || self.prefs.notification_sound.is_empty() || self.sounds.is_empty())
							.on_click({
								let sound = self.prefs.notification_sound.clone();
								move |_, _, _| {
									let _ = crate::platform::play_system_sound(&sound);
								}
							}),
					),
			)
			.child(if self.sounds.is_empty() {
				v_flex()
					.gap_1()
					.child(leftover_select(
						"sound",
						&self.t("soundPickerUnavailable"),
						false,
						true,
						vec![("".into(), self.t("soundPickerUnavailable"))],
						view.clone(),
						cx.theme().clone(),
						|_, _, _| {},
					))
					.child(
						div()
							.text_xs()
							.text_color(cx.theme().muted_foreground)
							.child(self.t("soundPickerUnavailableDescription")),
					)
					.into_any_element()
			} else {
				leftover_select(
					"sound",
					if self.prefs.notification_sound.is_empty() {
						self.t("notificationSoundNone")
					} else {
						self.prefs.notification_sound.clone()
					},
					self.open_select.as_deref() == Some("sound"),
					!self.prefs.notifications,
					std::iter::once(("".into(), self.t("notificationSoundNone")))
						.chain(self.sounds.iter().cloned().map(|name| (name.clone(), name)))
						.collect(),
					view.clone(),
					cx.theme().clone(),
					|this, value, cx| {
						this.prefs.notification_sound = value;
						this.persist(cx);
					},
				)
				.into_any_element()
			})
	}

	fn topbar(&mut self, cx: &mut Context<Self>) -> impl IntoElement {
		let view = cx.entity();
		let all = ["github-desktop", "editor", "terminal", "pr-status"];
		v_flex()
			.gap_4()
			.child(div().font_semibold().child(self.t("topbarPreview")))
			.child(
				v_flex().gap_1().children(self.prefs.topbar_controls.iter().cloned().map(|id| {
					let view = view.clone();
					h_flex()
						.id(crate::ui::eid(format!("tb-order-{id}")))
						.gap_2()
						.px_2()
						.py_1()
						.rounded_md()
						.border_1()
						.border_color(cx.theme().border)
						.child(
							div()
								.text_xs()
								.text_color(cx.theme().muted_foreground)
								.child("⠿"),
						)
						.on_drag(
							crate::ui::TopbarDrag { id: id.clone() },
							|info, _, _, cx| {
								cx.new(|_| crate::ui::DragGhost {
									label: info.id.clone(),
								})
							},
						)
						.on_drop({
							let view = view.clone();
							let target = id.clone();
							move |drag: &crate::ui::TopbarDrag, _, cx| {
								view.update(cx, |this, cx| {
									if let Some(to) = this.prefs.topbar_controls.iter().position(|x| x == &target) {
										crate::prefs::move_topbar_control(&mut this.prefs.topbar_controls, &drag.id, to);
										this.persist(cx);
										cx.notify();
									}
								});
							}
						})
						.child(div().flex_1().child(match id.as_str() {
							"github-desktop" => self.t("topbarGithubDesktop"),
							"editor" => self.t("topbarEditor"),
							"terminal" => self.t("topbarTerminal"),
							"pr-status" => self.t("topbarPrStatus"),
							_ => id.clone(),
						}))
				})),
			)
			.when(self.prefs.topbar_controls.is_empty(), |el| {
				el.child(
					div()
						.text_xs()
						.text_color(cx.theme().muted_foreground)
						.child(self.t("topbarNoControls")),
				)
			})
			.child(div().text_xs().text_color(cx.theme().muted_foreground).child(self.t("topbarDragHint")))
			.child(
				v_flex()
					.id("tb-available-drop")
					.gap_2()
					.w_full()
					.min_h(px(40.))
					.rounded_md()
					.on_drop({
						let view = view.clone();
						move |drag: &crate::ui::TopbarDrag, _, cx| {
							view.update(cx, |this, cx| {
								this.prefs.topbar_controls.retain(|x| x != &drag.id);
								this.persist(cx);
								cx.notify();
							});
						}
					})
					.child(div().font_semibold().child(self.t("topbarAvailable"))),
			)
			.when(all.iter().all(|id| self.prefs.topbar_controls.iter().any(|x| x == *id)), |el| {
				el.child(
					div()
						.text_xs()
						.text_color(cx.theme().muted_foreground)
						.child(self.t("topbarAllControlsActive")),
				)
			})
			.children(all.into_iter().map(|id| {
				let on = self.prefs.topbar_controls.iter().any(|x| x == id);
				switch_row(
					id,
					match id {
						"github-desktop" => self.t("topbarGithubDesktop"),
						"editor" => self.t("topbarEditor"),
						"terminal" => self.t("topbarTerminal"),
						_ => self.t("topbarPrStatus"),
					},
					String::new(),
					on,
					{
						let view = view.clone();
						let id = id.to_string();
						move |val, cx| {
							view.update(cx, |this, cx| {
								if val {
									if !this.prefs.topbar_controls.contains(&id) {
										this.prefs.topbar_controls.push(id.clone());
									}
								} else {
									this.prefs.topbar_controls.retain(|x| x != &id);
								}
								this.persist(cx);
								cx.notify();
							});
						}
					},
				)
			}))
			.child(field_label(&self.t("topbarEditorApp")))
			.child(if crate::platform::installed_editors().is_empty() {
				div().text_xs().text_color(cx.theme().muted_foreground).child(self.t("topbarDetectingApps")).into_any_element()
			} else {
				let editors = crate::platform::installed_editors();
				let current = crate::state::leftover_configured_app(
					&self.prefs.editor_app,
					crate::state::LEFTOVER_EDITOR_APP_IDS,
					&editors.iter().map(|app| app.id).collect::<Vec<_>>(),
				)
				.unwrap_or(editors[0].id);
				leftover_select(
					"editor-app",
					&self.t(crate::state::leftover_launch_app_i18n(current)),
					self.open_select.as_deref() == Some("editor-app"),
					false,
					editors
						.iter()
						.map(|app| (app.id.to_string(), self.t(crate::state::leftover_launch_app_i18n(app.id))))
						.collect(),
					view.clone(),
					cx.theme().clone(),
					|this, value, cx| {
						this.prefs.editor_app = value;
						this.persist(cx);
					},
				)
				.into_any_element()
			})
			.child(field_label(&self.t("topbarTerminalApp")))
			.child(if crate::platform::installed_terminals().is_empty() {
				div().text_xs().text_color(cx.theme().muted_foreground).child(self.t("topbarDetectingApps")).into_any_element()
			} else {
				let terminals = crate::platform::installed_terminals();
				let current = crate::state::leftover_configured_app(
					&self.prefs.terminal_app,
					crate::state::LEFTOVER_TERMINAL_APP_IDS,
					&terminals.iter().map(|app| app.id).collect::<Vec<_>>(),
				)
				.unwrap_or(terminals[0].id);
				leftover_select(
					"terminal-app",
					&self.t(crate::state::leftover_launch_app_i18n(current)),
					self.open_select.as_deref() == Some("terminal-app"),
					false,
					terminals
						.iter()
						.map(|app| (app.id.to_string(), self.t(crate::state::leftover_launch_app_i18n(app.id))))
						.collect(),
					view.clone(),
					cx.theme().clone(),
					|this, value, cx| {
						this.prefs.terminal_app = value;
						this.persist(cx);
					},
				)
				.into_any_element()
			})
			.child(
				Button::new("reset-topbar")
					.label(self.t("topbarResetDefaults"))
					.on_click({
						let view = view.clone();
						move |_, _, cx| {
							view.update(cx, |this, cx| {
								this.prefs.topbar_controls = crate::prefs::default_topbar_controls();
								this.persist(cx);
								cx.notify();
							});
						}
					}),
			)
	}

	fn about(&mut self, cx: &mut Context<Self>) -> impl IntoElement {
		let view = cx.entity();
		let theme = cx.theme().clone();
		let badge = crate::state::leftover_update_badge(
			self.latest_version.is_some(),
			self.update_status == self.t("updateNotAvailableDescription"),
		);
		v_flex()
			.gap_8()
			.max_w(px(crate::state::leftover_about_max_width()))
			.child(
				h_flex()
					.gap_5()
					.items_center()
					.child(
						img(std::sync::Arc::new(Image::from_bytes(
							ImageFormat::Png,
							include_bytes!("../../assets/app-icon.png").to_vec(),
						)))
						.id("about-app-icon")
						.size(px(80.))
						.rounded_lg(),
					)
					.child(
						v_flex()
							.gap(px(6.))
							.min_w_0()
							.child(
								h_flex()
									.gap(px(10.))
									.items_center()
									.child(div().text_xl().font_semibold().child("2code"))
									.child(
										Button::new("ver")
											.xsmall()
											.label(crate::i18n::tf(
												self.locale,
												"currentVersion",
												&[("version", env!("CARGO_PKG_VERSION"))],
											))
											.on_click({
												let view = view.clone();
												move |_, _, cx| {
													cx.write_to_clipboard(gpui::ClipboardItem::new_string(
														env!("CARGO_PKG_VERSION").into(),
													));
													view.update(cx, |this, cx| {
														if let Some(main) = this.main.upgrade() {
															main.update(cx, |app, cx| {
																app.data.push_toast(
																	crate::state::ToastKind::Success,
																	app.t("aboutVersionCopied"),
																	"",
																);
																cx.notify();
															});
														}
													});
												}
											}),
									),
							)
							.child(
								div()
									.text_sm()
									.text_color(theme.muted_foreground)
									.child(self.t("aboutAppDescription")),
							),
					),
			)
			.child(
				h_flex()
					.gap_2()
					.flex_wrap()
					.child(
						Button::new("repo")
							.outline()
							.small()
							.label(self.t("repository"))
							.on_click(|_, _, _| {
								let _ = open::that("https://github.com/AkaraChen/2code");
							}),
					)
					.child(
						Button::new("rel")
							.outline()
							.small()
							.label(self.t("releases"))
							.on_click(|_, _, _| {
								let _ = open::that("https://github.com/AkaraChen/2code/releases");
							}),
					),
			)
			.child(
				v_flex()
					.id("about-update-card")
					.w_full()
					.overflow_hidden()
					.rounded_xl()
					.border_1()
					.border_color(theme.border)
					.child(
						h_flex()
							.min_h(px(44.))
							.w_full()
							.px_4()
							.py_2()
							.gap_2()
							.justify_between()
							.border_b_1()
							.border_color(theme.border)
							.bg(theme.muted.opacity(0.4))
							.child(div().text_sm().font_medium().child(self.t("update")))
							.when(badge != crate::state::LeftoverUpdateBadge::Hidden, |el| {
								el.child(
									div()
										.px_2()
										.py(px(2.))
										.rounded_full()
										.when(badge == crate::state::LeftoverUpdateBadge::Available, |el| {
											el.bg(theme.primary).text_color(theme.primary_foreground)
										})
										.when(badge == crate::state::LeftoverUpdateBadge::NotAvailable, |el| {
											el.border_1().border_color(theme.border).text_color(theme.muted_foreground)
										})
										.child(div().text_xs().child(if badge == crate::state::LeftoverUpdateBadge::Available {
											if let Some(ver) = &self.latest_version {
												crate::i18n::tf(
													self.locale,
													"updateAvailableTitle",
													&[("version", ver)],
												)
											} else {
												self.t("updateAvailableTitle")
											}
										} else {
											self.t("updateNotAvailableTitle")
										})),
								)
							}),
					)
					.child(
						v_flex()
							.gap_4()
							.p_4()
							.child(switch_row(
								"beta",
								self.t("acceptBetaUpdates"),
								self.t("acceptBetaUpdatesDescription"),
								self.prefs.accept_beta,
								{
									let view = view.clone();
									move |val, cx| {
										view.update(cx, |this, cx| {
											this.prefs.accept_beta = val;
											this.persist(cx);
											cx.notify();
										});
									}
								},
							))
							.child(
								v_flex()
									.gap_1()
									.child(
										div()
											.text_sm()
											.when(self.latest_version.is_none(), |el| {
												el.text_color(theme.muted_foreground)
											})
											.child(self.update_status.clone()),
									)
									.when_some(self.released_at.clone(), |el, date| {
										el.child(
											div()
												.text_sm()
												.text_color(theme.muted_foreground)
												.child(crate::i18n::tf(
													self.locale,
													"updateReleasedAt",
													&[("date", &crate::updater::format_release_date_display(&date, self.locale))],
												)),
										)
									}),
							)
							.child(
								h_flex()
									.gap_2()
									.flex_wrap()
									.child(
										Button::new("check-upd")
											.outline()
											.small()
											.label(self.t("checkForUpdates"))
											.on_click({
												let view = view.clone();
												move |_, _, cx| {
													view.update(cx, |this, cx| {
														this.update_status = this.t("checkForUpdates");
														let result =
															crate::updater::check_for_update(this.prefs.accept_beta);
														match &result {
															Ok(info) if info.available => {
																this.latest_version = Some(info.latest_version.clone());
																this.released_at = info.released_at.clone();
																this.latest_url = info.html_url.clone();
																this.update_status = crate::i18n::tf(
																	this.locale,
																	"updateAvailableDescription",
																	&[
																		("currentVersion", env!("CARGO_PKG_VERSION")),
																		("version", &info.latest_version),
																	],
																);
															}
															Ok(_) => {
																this.latest_version = None;
																this.released_at = None;
																this.update_status =
																	this.t("updateNotAvailableDescription");
															}
															Err(err) => {
																this.update_status = format!(
																	"{}: {err}",
																	this.t("updateCheckFailedTitle")
																);
															}
														}
														if let Some(main) = this.main.upgrade() {
															main.update(cx, |app, cx| {
																app.apply_update_result(result, false);
																cx.notify();
															});
														}
														cx.notify();
													});
												}
											}),
									)
									.when(self.latest_version.is_some(), |el| {
										el.child(
											Button::new("open-upd")
												.small()
												.label(if let Some(ver) = &self.latest_version {
													crate::i18n::tf(
														self.locale,
														"installUpdate",
														&[("version", ver)],
													)
												} else {
													self.t("openUpdatePage")
												})
												.on_click({
													let view = view.clone();
													let url = self.latest_url.clone();
													move |_, _, cx| {
														view.update(cx, |this, cx| {
															this.update_status = this.t("checkForUpdates");
															match crate::updater::download_and_install(this.prefs.accept_beta) {
																Ok(path) => {
																	this.update_status = path;
																	cx.quit();
																}
																Err(err) => {
																	this.update_status = format!(
																		"{}: {err}",
																		this.t("updateInstallFailedTitle")
																	);
																	let _ = open::that(&url);
																}
															}
															cx.notify();
														});
													}
												}),
										)
									}),
							),
					),
			)
			.child(div().text_sm().font_medium().child(self.t("contributors")))
			.child(
				h_flex()
					.gap_3()
					.items_center()
					.px_3()
					.py_2()
					.rounded_lg()
					.border_1()
					.border_color(theme.border)
					.child(
						img("https://github.com/AkaraChen.png?size=96")
							.id("about-maintainer-avatar")
							.size(px(36.))
							.rounded_full(),
					)
					.child(
						v_flex()
							.child(div().text_sm().font_medium().child("AkaraChen"))
							.child(
								div()
									.text_xs()
									.text_color(theme.muted_foreground)
									.child(self.t("primaryContributorDescription")),
							),
					),
			)
			.child(
				div()
					.text_xs()
					.text_color(theme.muted_foreground)
					.child(crate::state::leftover_about_copyright(
						crate::timefmt::leftover_utc_year(crate::timefmt::unix_now_secs()),
					)),
			)
	}
}

fn set_tab(
	_id: &'static str,
	icon: IconName,
	label: String,
	selected: bool,
	tab: SettingsTab,
	cx: &mut Context<SettingsView>,
) -> impl IntoElement {
	let view = cx.entity();
	Tab::new()
		.icon(icon)
		.label(label)
		.selected(selected)
		.on_click(move |_, _, cx| {
			view.update(cx, |this, cx| {
				this.tab = tab;
				this.open_select = None;
				this.template_dialog_open = false;
				cx.notify();
			});
		})
}

fn field_label(text: &str) -> impl IntoElement {
	div().font_medium().text_sm().child(text.to_string())
}

fn theme_label_row(
	label: &str,
	preview_id: &'static str,
	preview_label: String,
	on_preview: impl Fn(&mut App) + 'static,
) -> impl IntoElement {
	h_flex()
		.w_full()
		.justify_between()
		.child(field_label(label))
		.child(
			Button::new(preview_id)
				.ghost()
				.xsmall()
				.icon(IconName::Eye)
				.tooltip(preview_label)
				.on_click(move |_, _, cx| on_preview(cx)),
		)
}

fn leftover_select(
	id: &str,
	current: impl Into<String>,
	open: bool,
	disabled: bool,
	options: Vec<(String, String)>,
	view: gpui::Entity<SettingsView>,
	theme: gpui_component::Theme,
	on_pick: impl Fn(&mut SettingsView, String, &mut Context<SettingsView>) + Clone + 'static,
) -> impl IntoElement {
	let current = current.into();
	let selected_label = current.clone();
	let height = crate::state::leftover_native_select_height();
	div()
		.id(crate::ui::eid(format!("sel-{id}")))
		.relative()
		.w_full()
		.child(
			h_flex()
				.id(crate::ui::eid(format!("sel-btn-{id}")))
				.h(px(height))
				.w_full()
				.px_3()
				.gap_2()
				.items_center()
				.rounded_md()
				.border_1()
				.border_color(theme.border)
				.bg(theme.background)
				.when(disabled, |el| el.opacity(0.5))
				.on_click({
					let view = view.clone();
					let id = id.to_string();
					move |_, _, cx| {
						if disabled {
							return;
						}
						view.update(cx, |this, cx| {
							this.open_select = if this.open_select.as_deref() == Some(id.as_str()) {
								None
							} else {
								Some(id.clone())
							};
							cx.notify();
						});
					}
				})
				.child(div().flex_1().min_w_0().text_sm().child(current))
				.child(Icon::new(IconName::ChevronDown).w(px(14.))),
		)
		.when(open && !disabled, |el| {
			el.child(
				div()
					.id(crate::ui::eid(format!("sel-menu-{id}")))
					.absolute()
					.top(px(height + 4.))
					.left_0()
					.right_0()
					.max_h(px(240.))
					.overflow_y_scroll()
					.p_1()
					.rounded_lg()
					.border_1()
					.border_color(theme.border)
					.bg(theme.popover)
					.shadow_md()
					.children(options.into_iter().map(|(value, label)| {
						let selected = label == selected_label;
						div()
							.id(crate::ui::eid(format!("sel-{id}-{value}")))
							.w_full()
							.px_2()
							.py(px(6.))
							.rounded_md()
							.text_sm()
							.when(selected, |row| row.bg(theme.muted))
							.hover(|row| row.bg(theme.muted))
							.on_click({
								let view = view.clone();
								let on_pick = on_pick.clone();
								move |_, _, cx| {
									view.update(cx, |this, cx| {
										on_pick(this, value.clone(), cx);
										this.open_select = None;
										cx.notify();
									});
								}
							})
							.child(label)
					})),
			)
		})
}

fn leftover_check_row(
	id: &'static str,
	label: String,
	checked: bool,
	on: impl Fn(bool, &mut App) + 'static,
) -> impl IntoElement {
	h_flex()
		.gap_2()
		.items_center()
		.child(Checkbox::new(id).checked(checked).on_click(move |val, _, cx| on(*val, cx)))
		.child(div().text_sm().child(label))
}

fn choice(
	id: impl Into<gpui::SharedString>,
	label: &str,
	selected: bool,
	on: impl Fn(&mut App) + 'static,
) -> impl IntoElement {
	Button::new(id.into())
		.small()
		.selected(selected)
		.label(label.to_string())
		.on_click(move |_, _, cx| on(cx))
}

fn switch_row(
	id: &'static str,
	title: String,
	desc: String,
	checked: bool,
	on: impl Fn(bool, &mut App) + 'static,
) -> impl IntoElement {
	h_flex()
		.w_full()
		.justify_between()
		.gap_4()
		.child(
			v_flex()
				.child(div().font_medium().text_sm().child(title))
				.when(!desc.is_empty(), |el| {
					el.child(div().text_xs().child(desc))
				}),
		)
		.child(Switch::new(id).checked(checked).on_click(move |val, _, cx| on(*val, cx)))
}

fn preview_line(prompt_color: u32, prompt: &str, fg: u32, cmd: &str) -> impl IntoElement {
	h_flex()
		.gap_1()
		.child(div().text_color(gpui::rgb(prompt_color)).child(prompt.to_string()))
		.child(div().text_color(gpui::rgb(fg)).child(cmd.to_string()))
}
