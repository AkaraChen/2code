use gpui::{
	div, point, prelude::*, px, size, App, Bounds, Context, SharedString, Window, WindowBounds,
	WindowOptions,
};
use gpui_component::button::{Button, ButtonVariants};
use gpui_component::{Disableable, Selectable};
use gpui_component::input::Input;
use gpui_component::switch::Switch;
use gpui_component::{
	h_flex, v_flex, ActiveTheme, IconName, Root, Sizable, StyledExt, ThemeMode,
};
use gpui_component::tab::Tab;

use crate::app::AppView;
use crate::i18n::Locale;
use crate::prefs::{term_theme_by_name, RadiusPref, TERM_THEMES, ThemePref};
use crate::state::SettingsTab;

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
	latest_url: String,
	fonts: Vec<String>,
	sounds: Vec<String>,
	editing_template_id: Option<String>,
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
		let custom_shell = inp(window, cx, "", &prefs.custom_shell, false);
		let worktree = inp(window, cx, "", &prefs.worktree_dir, false);
		custom_shell.update(cx, |s, cx| {
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
			template_name: inp(window, cx, "", "", false),
			template_shell: inp(window, cx, "", "", false),
			template_cwd: inp(window, cx, "", "", false),
			template_cmds: inp(window, cx, "", "", true),
			update_status: crate::i18n::t(locale, "updateIdleDescription"),
			latest_version: None,
			latest_url: crate::updater::releases_page().to_string(),
			fonts: crate::platform::list_mono_fonts(),
			sounds: crate::platform::list_system_sounds(),
			editing_template_id: None,
		}
	}

	fn t(&self, key: &str) -> String {
		crate::i18n::t(self.locale, key)
	}

	fn persist(&mut self, cx: &mut Context<Self>) {
		self.prefs.custom_shell = self.custom_shell.read(cx).value().to_string();
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
					.child(match self.tab {
						SettingsTab::General => self.general(window, cx).into_any_element(),
						SettingsTab::Terminal => self.terminal(window, cx).into_any_element(),
						SettingsTab::Templates => self.templates(window, cx).into_any_element(),
						SettingsTab::Notification => self.notification(cx).into_any_element(),
						SettingsTab::TopBar => self.topbar(cx).into_any_element(),
						SettingsTab::About => self.about(cx).into_any_element(),
					}),
			)
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
			.child(
				h_flex()
					.gap_2()
					.child(choice("lang-en", "English", self.locale == Locale::En, {
						let view = view.clone();
						move |cx| {
							view.update(cx, |this, cx| {
								this.locale = Locale::En;
								this.persist(cx);
								cx.notify();
							});
						}
					}))
					.child(choice("lang-zh", "中文", self.locale == Locale::Zh, {
						let view = view.clone();
						move |cx| {
							view.update(cx, |this, cx| {
								this.locale = Locale::Zh;
								this.persist(cx);
								cx.notify();
							});
						}
					})),
			)
			.child(field_label(&self.t("theme")))
			.child(
				h_flex()
					.gap_2()
					.children(
						[
							(ThemePref::System, self.t("themeSystem")),
							(ThemePref::Light, self.t("themeLight")),
							(ThemePref::Dark, self.t("themeDark")),
						]
						.into_iter()
						.map(|(pref, label)| {
							let selected = self.prefs.theme == pref;
							choice(format!("theme-{label}"), &label, selected, {
								let view = view.clone();
								move |cx| {
									view.update(cx, |this, cx| {
										this.prefs.theme = pref;
										let mode = match pref {
											ThemePref::Dark => ThemeMode::Dark,
											ThemePref::Light => ThemeMode::Light,
											ThemePref::System => cx.window_appearance().into(),
										};
										gpui_component::Theme::change(mode, None, cx);
										this.persist(cx);
										cx.notify();
									});
								}
							})
						}),
					),
			)
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
			.child(Input::new(&self.worktree))
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

	fn terminal(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
		let view = cx.entity();
		let theme = term_theme_by_name(&self.prefs.terminal_theme_dark);
		h_flex()
			.id("settings-terminal")
			.size_full()
			.gap_8()
			.child(
				v_flex()
					.max_w(px(448.))
					.gap_4()
					.child(field_label(&self.t("terminalTheme")))
					.child(
						v_flex().gap_1().children(TERM_THEMES.iter().map(|t| {
							let selected = self.prefs.terminal_theme_dark == t.name;
							choice(t.name, t.name, selected, {
								let view = view.clone();
								let name = t.name.to_string();
								move |cx| {
									view.update(cx, |this, cx| {
										this.prefs.terminal_theme_dark = name.clone();
										if this.prefs.sync_terminal_theme {
											this.prefs.terminal_theme_light = name.clone();
										}
										this.persist(cx);
										cx.notify();
									});
								}
							})
						})),
					)
					.child(switch_row(
						"sync-term",
						self.t("syncTerminalTheme"),
						String::new(),
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
					.when(!self.prefs.sync_terminal_theme, |el| {
						el.child(field_label(&self.t("terminalTheme")))
							.child(
								v_flex().gap_1().children(TERM_THEMES.iter().map(|t| {
									let selected = self.prefs.terminal_theme_light == t.name;
									choice(format!("light-{name}", name = t.name), t.name, selected, {
										let view = view.clone();
										let name = t.name.to_string();
										move |cx| {
											view.update(cx, |this, cx| {
												this.prefs.terminal_theme_light = name.clone();
												this.persist(cx);
												cx.notify();
											});
										}
									})
								})),
							)
					})
					.child(field_label(&self.t("defaultShell")))
					.child(
						h_flex().gap_1().flex_wrap().children(crate::platform::list_shells().into_iter().map(|shell| {
							let selected = self.prefs.custom_shell == shell;
							choice(format!("shell-{shell}"), &shell, selected, {
								let view = view.clone();
								let shell = shell.clone();
								move |cx| {
									view.update(cx, |this, cx| {
										this.prefs.custom_shell = shell.clone();
										this.persist(cx);
										cx.notify();
									});
								}
							})
						})),
					)
					.child(Input::new(&self.custom_shell))
					.child(field_label(&self.t("terminalFont")))
					.child(div().text_sm().child(self.prefs.font_family.clone()))
					.child(switch_row(
						"show-all-fonts",
						self.t("showAllFonts"),
						String::new(),
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
					.child(
						div()
							.max_h(px(180.))
							.overflow_y_hidden()
							.child({
								let fonts = if self.prefs.show_all_fonts {
									crate::platform::visible_font_families(true)
								} else {
									self.fonts.clone()
								};
								h_flex().gap_1().flex_wrap().children(fonts.into_iter().map(|family| {
									let selected = self.prefs.font_family == family;
									choice(format!("font-{family}"), &family, selected, {
										let view = view.clone();
										let family = family.clone();
										move |cx| {
											view.update(cx, |this, cx| {
												this.prefs.font_family = family.clone();
												this.persist(cx);
												cx.notify();
											});
										}
									})
								}))
							}),
					)
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
												this.prefs.font_size = (this.prefs.font_size + 1.0).min(22.0);
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
					.flex_1()
					.h(px(220.))
					.rounded_lg()
					.p_3()
					.bg(gpui::rgb(theme.bg))
					.text_color(gpui::rgb(theme.fg))
					.font_family("monospace")
					.child("$ echo 2code")
					.child("2code")
					.child(format!("theme: {}", theme.name)),
			)
	}

	fn templates(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
		let _ = window;
		let view = cx.entity();
		v_flex()
			.id("settings-templates")
			.max_w(px(672.))
			.gap_3()
			.child(div().font_semibold().child(self.t("globalTerminalTemplates")))
			.child(div().text_xs().text_color(cx.theme().muted_foreground).child(self.t("globalTerminalTemplatesDescription")))
			.child(if self.prefs.templates.is_empty() {
				div().p_4().child(self.t("noTerminalTemplates")).into_any_element()
			} else {
				v_flex()
					.gap_2()
					.children(self.prefs.templates.iter().cloned().map(|t| {
						let selected = self.editing_template_id.as_deref() == Some(t.id.as_str());
						h_flex()
							.id(crate::ui::eid(format!("tpl-{}", t.id)))
							.justify_between()
							.p_2()
							.rounded_md()
							.border_1()
							.border_color(if selected {
								cx.theme().accent
							} else {
								cx.theme().border
							})
							.child(
								v_flex()
									.id(crate::ui::eid(format!("tpl-edit-{}", t.id)))
									.cursor(gpui::CursorStyle::PointingHand)
									.child(div().font_medium().child(t.name.clone()))
									.child(div().text_xs().child(format!("{} · {}", t.shell, t.cwd)))
									.on_click({
										let view = view.clone();
										let t = t.clone();
										move |_, window, cx| {
											view.update(cx, |this, cx| {
												this.editing_template_id = Some(t.id.clone());
												this.template_name.update(cx, |s, cx| {
													s.set_value(t.name.clone(), window, cx);
												});
												this.template_shell.update(cx, |s, cx| {
													s.set_value(t.shell.clone(), window, cx);
												});
												this.template_cwd.update(cx, |s, cx| {
													s.set_value(t.cwd.clone(), window, cx);
												});
												this.template_cmds.update(cx, |s, cx| {
													s.set_value(t.commands.join("\n"), window, cx);
												});
												cx.notify();
											});
										}
									}),
							)
							.child(
								Button::new(crate::ui::eid(format!("del-{}", t.id)))
									.danger()
									.xsmall()
									.label(self.t("delete"))
									.on_click({
										let view = view.clone();
										let id = t.id.clone();
										move |_, _, cx| {
											view.update(cx, |this, cx| {
												this.prefs.templates.retain(|x| x.id != id);
												if this.editing_template_id.as_deref() == Some(id.as_str()) {
													this.editing_template_id = None;
												}
												this.persist(cx);
												cx.notify();
											});
										}
									}),
							)
					}))
					.into_any_element()
			})
			.child(field_label(&self.t("terminalTemplateName")))
			.child(Input::new(&self.template_name))
			.child(field_label(&self.t("terminalTemplateShell")))
			.child(Input::new(&self.template_shell))
			.child(field_label(&self.t("terminalTemplateCwd")))
			.child(Input::new(&self.template_cwd))
			.child(field_label(&self.t("terminalTemplateCommands")))
			.child(Input::new(&self.template_cmds))
			.child(
				Button::new("add-tpl")
					.primary()
					.label(if self.editing_template_id.is_some() {
						self.t("save")
					} else {
						self.t("addTerminalTemplate")
					})
					.on_click({
						let view = view.clone();
						move |_, window, cx| {
							view.update(cx, |this, cx| {
								let name = this.template_name.read(cx).value().to_string();
								if name.trim().is_empty() {
									return;
								}
								crate::prefs::upsert_template(
									&mut this.prefs.templates,
									this.editing_template_id.as_deref(),
									name,
									this.template_shell.read(cx).value().to_string(),
									this.template_cwd.read(cx).value().to_string(),
									this
										.template_cmds
										.read(cx)
										.value()
										.lines()
										.map(|l| l.to_string())
										.filter(|l| !l.is_empty())
										.collect(),
								);
								this.editing_template_id = None;
								this.template_name.update(cx, |s, cx| s.set_value("", window, cx));
								this.template_shell.update(cx, |s, cx| s.set_value("", window, cx));
								this.template_cwd.update(cx, |s, cx| s.set_value("", window, cx));
								this.template_cmds.update(cx, |s, cx| s.set_value("", window, cx));
								this.persist(cx);
								cx.notify();
							});
						}
					}),
			)
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
			.child(field_label(&self.t("notificationSound")))
			.child(div().text_sm().child(if self.prefs.notification_sound.is_empty() {
				self.t("notificationSoundNone")
			} else {
				self.prefs.notification_sound.clone()
			}))
			.child(if self.sounds.is_empty() {
				v_flex()
					.gap_1()
					.p_3()
					.rounded_md()
					.border_1()
					.border_color(cx.theme().border)
					.child(div().text_sm().child(self.t("soundPickerUnavailable")))
					.child(
						div()
							.text_xs()
							.text_color(cx.theme().muted_foreground)
							.child(self.t("soundPickerUnavailableDescription")),
					)
					.into_any_element()
			} else {
				h_flex()
					.gap_1()
					.flex_wrap()
					.children(std::iter::once(String::new()).chain(self.sounds.iter().cloned()).map(|name| {
						let selected = self.prefs.notification_sound == name;
						let label = if name.is_empty() {
							self.t("notificationSoundNone")
						} else {
							name.clone()
						};
						choice(format!("snd-{name}"), &label, selected, {
							let view = view.clone();
							let name = name.clone();
							move |cx| {
								view.update(cx, |this, cx| {
									this.prefs.notification_sound = name.clone();
									let _ = crate::platform::play_system_sound(&name);
									this.persist(cx);
									cx.notify();
								});
							}
						})
					}))
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
				v_flex().gap_1().children(self.prefs.topbar_controls.iter().cloned().enumerate().map(|(ix, id)| {
					let view = view.clone();
					h_flex()
						.id(crate::ui::eid(format!("tb-order-{id}")))
						.gap_2()
						.px_2()
						.py_1()
						.rounded_md()
						.border_1()
						.border_color(cx.theme().border)
						.child(div().flex_1().child(id.clone()))
						.child(
							Button::new(crate::ui::eid(format!("tb-up-{id}")))
								.ghost()
								.xsmall()
								.icon(IconName::ChevronUp)
								.on_click({
									let view = view.clone();
									move |_, _, cx| {
										view.update(cx, |this, cx| {
											if ix > 0 {
												this.prefs.topbar_controls.swap(ix, ix - 1);
												this.persist(cx);
												cx.notify();
											}
										});
									}
								}),
						)
						.child(
							Button::new(crate::ui::eid(format!("tb-dn-{id}")))
								.ghost()
								.xsmall()
								.icon(IconName::ChevronDown)
								.on_click({
									let view = view.clone();
									move |_, _, cx| {
										view.update(cx, |this, cx| {
											if ix + 1 < this.prefs.topbar_controls.len() {
												this.prefs.topbar_controls.swap(ix, ix + 1);
												this.persist(cx);
												cx.notify();
											}
										});
									}
								}),
						)
				})),
			)
			.child(div().text_xs().text_color(cx.theme().muted_foreground).child(self.t("topbarDragHint")))
			.child(div().font_semibold().child(self.t("topbarAvailable")))
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
				h_flex()
					.gap_1()
					.flex_wrap()
					.children(crate::platform::installed_editors().into_iter().map(|app| {
						let selected = self.prefs.editor_app == app.id || self.prefs.editor_app == app.command;
						let label = match app.id {
							"vscode" => self.t("topbarVscode"),
							"cursor" => self.t("topbarCursor"),
							"windsurf" => self.t("topbarWindsurf"),
							"zed" => self.t("topbarZed"),
							_ => self.t("topbarSublimeText"),
						};
						choice(format!("ed-{id}", id = app.id), &label, selected, {
							let view = view.clone();
							let id = app.id.to_string();
							move |cx| {
								view.update(cx, |this, cx| {
									this.prefs.editor_app = id.clone();
									this.persist(cx);
									cx.notify();
								});
							}
						})
					}))
					.into_any_element()
			})
			.child(field_label(&self.t("topbarTerminalApp")))
			.child(if crate::platform::installed_terminals().is_empty() {
				div().text_xs().text_color(cx.theme().muted_foreground).child(self.t("topbarDetectingApps")).into_any_element()
			} else {
				h_flex()
					.gap_1()
					.flex_wrap()
					.children(crate::platform::installed_terminals().into_iter().map(|app| {
						let selected = self.prefs.terminal_app == app.id;
						let label = match app.id {
							"ghostty" => self.t("topbarGhostty"),
							"iterm2" => self.t("topbarIterm2"),
							"kitty" => self.t("topbarKitty"),
							_ => self.t("topbarWarp"),
						};
						choice(format!("termapp-{id}", id = app.id), &label, selected, {
							let view = view.clone();
							let id = app.id.to_string();
							move |cx| {
								view.update(cx, |this, cx| {
									this.prefs.terminal_app = id.clone();
									this.persist(cx);
									cx.notify();
								});
							}
						})
					}))
					.into_any_element()
			})
			.child(
				Button::new("reset-topbar")
					.label(self.t("topbarResetDefaults"))
					.on_click({
						let view = view.clone();
						move |_, _, cx| {
							view.update(cx, |this, cx| {
								this.prefs.topbar_controls = vec![
									"github-desktop".into(),
									"editor".into(),
									"terminal".into(),
									"pr-status".into(),
								];
								this.persist(cx);
								cx.notify();
							});
						}
					}),
			)
	}

	fn about(&mut self, cx: &mut Context<Self>) -> impl IntoElement {
		let view = cx.entity();
		v_flex()
			.gap_3()
			.max_w(px(480.))
			.child(div().text_xl().font_semibold().child("2Code"))
			.child(div().text_sm().child(self.t("aboutAppDescription")))
			.child(
				Button::new("ver")
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
			)
			.child(div().font_semibold().child(self.t("contributors")))
			.child(div().text_sm().child("AkaraChen"))
			.child(div().text_xs().text_color(cx.theme().muted_foreground).child(self.t("primaryContributorDescription")))
			.child(
				h_flex()
					.gap_2()
					.child(link_btn("repo", self.t("repository"), "https://github.com/AkaraChen/2code"))
					.child(link_btn("rel", self.t("releases"), "https://github.com/AkaraChen/2code/releases"))
					.child(link_btn("web", self.t("website"), "https://github.com/AkaraChen/2code")),
			)
			.child(div().text_sm().child(self.update_status.clone()))
			.child(
				h_flex()
					.gap_2()
					.child(
						Button::new("check-upd")
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
												this.latest_url = info.html_url.clone();
												this.update_status = crate::i18n::tf(
													this.locale,
													"updateAvailableTitle",
													&[("version", &info.latest_version)],
												);
											}
											Ok(_) => {
												this.latest_version = None;
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
					.child(
						Button::new("open-upd")
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
								let has_update = self.latest_version.is_some();
								move |_, _, cx| {
									if has_update {
										view.update(cx, |this, cx| {
											this.update_status = this.t("checkForUpdates");
											match crate::updater::download_and_install(this.prefs.accept_beta) {
												Ok(path) => {
													this.update_status = path;
													cx.quit();
												}
												Err(err) => {
													this.update_status = err;
													let _ = open::that(&url);
												}
											}
											cx.notify();
										});
									} else {
										let _ = open::that(&url);
									}
								}
							}),
					),
			)
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
				cx.notify();
			});
		})
}

fn field_label(text: &str) -> impl IntoElement {
	div().font_medium().text_sm().child(text.to_string())
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

fn link_btn(id: &'static str, label: String, url: &'static str) -> impl IntoElement {
	Button::new(id).small().label(label).on_click(move |_, _, _| {
		let _ = open::that(url);
	})
}
