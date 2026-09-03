use gpui::{
	Context, InteractiveElement, IntoElement, ParentElement, StatefulInteractiveElement,
	Styled, Window, div, prelude::FluentBuilder, px, relative,
};
use gpui_component::{
	ActiveTheme, Icon, IconName, Sizable, StyledExt,
	button::{Button, ButtonVariants},
	h_flex,
	input::{Editor, Input},
	text::TextView,
	v_flex,
};

use crate::app::{AppRoot, GitPane, WorkspacePane};
use crate::files::{self, DiffKind};

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
			self.t("no git", "无 Git").to_string()
		} else {
			self.git_branch.clone()
		};
		let pane = self.workspace_pane;
		let stats = self.git_stats_label.clone();

		let pr_label = self
			.pr_status
			.as_ref()
			.map(|status| {
				format!(
					"#{} {}",
					status.number,
					if status.is_draft {
						"draft"
					} else {
						status.state.as_str()
					}
				)
			})
			.unwrap_or_else(|| self.t("No PR", "无 PR").to_string());

		v_flex()
			.flex_1()
			.min_h_0()
			.w_full()
			.child(
				h_flex()
					.flex_none()
					.h(px(40.))
					.min_h(px(40.))
					.px_3()
					.gap_2()
					.items_center()
					.border_b_1()
					.border_color(cx.theme().border)
					.child(div().text_sm().font_semibold().child(project_name))
					.child(
						Button::new("switch-branch")
							.ghost()
							.xsmall()
							.icon(IconName::Folder)
							.label(branch)
							.on_click(cx.listener(|this, _, window, cx| {
								this.open_branch_dialog(window, cx);
							})),
					)
					.child(
						div()
							.text_xs()
							.text_color(cx.theme().muted_foreground)
							.child(stats),
					)
					.child(
						div()
							.text_xs()
							.text_color(cx.theme().muted_foreground)
							.child(pr_label),
					)
					.child(div().flex_1())
					.child(
						Button::new("topbar-editor")
							.ghost()
							.xsmall()
							.icon(IconName::File)
							.label(self.t("Editor", "编辑器"))
							.on_click(cx.listener(|this, _, _, cx| {
								let app = this.settings.editor_app.clone();
								this.launch_topbar_app(&app, cx);
							})),
					)
					.child(
						Button::new("topbar-ext-term")
							.ghost()
							.xsmall()
							.icon(IconName::SquareTerminal)
							.label(self.t("App Term", "外部终端"))
							.on_click(cx.listener(|this, _, _, cx| {
								let app = this.settings.terminal_app.clone();
								this.launch_topbar_app(&app, cx);
							})),
					)
					.child(
						Button::new("topbar-github")
							.ghost()
							.xsmall()
							.label("GitHub")
							.on_click(cx.listener(|this, _, _, cx| {
								this.launch_topbar_app("github-desktop", cx);
							})),
					)
					.child(
						Button::new("new-profile")
							.ghost()
							.xsmall()
							.icon(IconName::Plus)
							.on_click(cx.listener(|this, _, window, cx| {
								this.open_create_profile_dialog(window, cx);
							})),
					)
					.child(
						Button::new("delete-profile")
							.ghost()
							.xsmall()
							.icon(IconName::Delete)
							.on_click(cx.listener(|this, _, window, cx| {
								this.open_delete_profile_dialog(window, cx);
							})),
					)
					.child(
						Button::new("delete-project")
							.ghost()
							.xsmall()
							.label(self.t("Project", "项目"))
							.on_click(cx.listener(|this, _, window, cx| {
								this.open_delete_project_dialog(window, cx);
							})),
					),
			)
			.child(
				h_flex()
					.flex_none()
					.h(px(36.))
					.min_h(px(36.))
					.px_2()
					.gap_1()
					.items_center()
					.bg(cx.theme().muted)
					.border_b_1()
					.border_color(cx.theme().border)
					.child(self.pane_button("pane-files", self.t("Files", "文件"), pane == WorkspacePane::Files, WorkspacePane::Files, cx))
					.child(self.pane_button("pane-git", "Git", pane == WorkspacePane::Git, WorkspacePane::Git, cx))
					.child(self.pane_button(
						"pane-terminal",
						self.t("Terminal", "终端"),
						pane == WorkspacePane::Terminal,
						WorkspacePane::Terminal,
						cx,
					)),
			)
			.child(match pane {
				WorkspacePane::Files => self.render_files_pane(cx).into_any_element(),
				WorkspacePane::Git => self.render_git_pane(cx).into_any_element(),
				WorkspacePane::Terminal => self.render_terminal_pane(cx).into_any_element(),
			})
	}

	fn pane_button(
		&self,
		id: &'static str,
		label: &str,
		selected: bool,
		pane: WorkspacePane,
		cx: &mut Context<Self>,
	) -> impl IntoElement {
		let button = Button::new(id).label(label.to_string()).on_click(
			cx.listener(move |this, _, _, cx| {
				this.set_workspace_pane(pane, cx);
			}),
		);
		if selected {
			button.primary()
		} else {
			button.ghost()
		}
	}

	fn render_diff_view(
		&self,
		id: &'static str,
		diff: String,
		cx: &mut Context<Self>,
	) -> impl IntoElement {
		let lines = files::color_diff(&diff);
		div()
			.id(id)
			.flex_1()
			.p_3()
			.font_family("monospace")
			.text_xs()
			.overflow_y_scroll()
			.child(
				v_flex().gap_0().children(lines.into_iter().map(|line| {
					let color: gpui::Hsla = match line.kind {
						DiffKind::Add => gpui::rgb(0x0d_bc_79).into(),
						DiffKind::Del => gpui::rgb(0xcd_31_31).into(),
						DiffKind::Hunk => gpui::rgb(0x24_72_c8).into(),
						DiffKind::Meta => cx.theme().muted_foreground,
						DiffKind::Context => cx.theme().foreground,
					};
					div().text_color(color).child(line.text)
				})),
			)
	}

	fn render_files_pane(&mut self, cx: &mut Context<Self>) -> impl IntoElement {
		let rows = self.visible_files();
		let preview = self.file_preview.clone();
		let selected = self.selected_file.clone();
		let is_markdown = self.file_is_markdown;
		let show_preview = self.file_show_preview;
		let editor = self.file_editor.clone();
		let badges: Vec<(String, String)> = self
			.changed_files
			.iter()
			.map(|entry| (entry.path.clone(), entry.status.clone()))
			.collect();
		h_flex()
			.flex_1()
			.min_h_0()
			.child(
				v_flex()
					.w(px(260.))
					.h_full()
					.border_r_1()
					.border_color(cx.theme().border)
					.child(
						h_flex()
							.px_3()
							.py_2()
							.justify_between()
							.child(
								div()
									.text_xs()
									.text_color(cx.theme().muted_foreground)
									.child(self.t("Files", "文件")),
							)
							.child(
								h_flex()
									.gap_1()
									.child(
										Button::new("files-new")
											.ghost()
											.xsmall()
											.icon(IconName::Plus)
											.on_click(cx.listener(|this, _, window, cx| {
												this.open_create_file_dialog(window, cx);
											})),
									)
									.child(
										Button::new("files-save")
											.ghost()
											.xsmall()
											.label(self.t("Save", "保存"))
											.on_click(cx.listener(|this, _, _, cx| {
												this.save_selected_file(cx);
											})),
									)
									.child(
										Button::new("files-reveal")
											.ghost()
											.xsmall()
											.label(self.t("Reveal", "打开"))
											.on_click(cx.listener(|this, _, _, cx| {
												this.reveal_selected_path(cx);
											})),
									)
									.child(
										Button::new("files-delete")
											.ghost()
											.xsmall()
											.icon(IconName::Delete)
											.on_click(cx.listener(|this, _, _, cx| {
												this.delete_selected_file(cx);
											})),
									),
							),
					)
					.child(
						v_flex()
							.flex_1()
							.px_2()
							.gap_0()
							.id("file-list")
							.overflow_y_scroll()
							.children(rows.into_iter().map(|row| {
								let active = selected.as_deref() == Some(row.path.as_str());
								let row_id = format!("file-{}", row.path);
								let open_path = row.path.clone();
								let badge = files::git_badge_for(&row.path, &badges);
								let pad = 8.0 + (row.depth as f32 * 12.0);
								h_flex()
									.id(row_id)
									.h(px(26.))
									.px_2()
									.pl(px(pad))
									.gap_2()
									.rounded(px(6.))
									.when(active, |this| this.bg(cx.theme().muted))
									.hover(|this| this.bg(cx.theme().muted))
									.cursor_pointer()
									.on_click(cx.listener(move |this, _, window, cx| {
										this.open_path(&open_path, window, cx);
									}))
									.child(
										Icon::new(if row.is_dir {
											IconName::Folder
										} else {
											IconName::File
										})
										.size_3(),
									)
									.child(div().text_xs().flex_1().child(row.name))
									.when_some(badge, |this, status| {
										this.child(
											div()
												.text_xs()
												.text_color(cx.theme().muted_foreground)
												.child(status),
										)
									})
							})),
					),
			)
			.child(
				v_flex()
					.flex_1()
					.min_w_0()
					.h_full()
					.when(selected.is_some(), |this| {
						this.child(
							h_flex()
								.flex_none()
								.h(px(28.))
								.px_3()
								.gap_2()
								.items_center()
								.border_b_1()
								.border_color(cx.theme().border)
								.child(
									div()
										.text_xs()
										.text_color(cx.theme().muted_foreground)
										.child(
											selected
												.as_deref()
												.map(files::language_for_path)
												.unwrap_or("plaintext"),
										),
								)
								.when(is_markdown, |this| {
									this.child({
										let button = Button::new("file-edit")
											.xsmall()
											.label(self.t("Edit", "编辑"))
											.on_click(cx.listener(|this, _, _, cx| {
												this.file_show_preview = false;
												cx.notify();
											}));
										if show_preview {
											button.ghost()
										} else {
											button.primary()
										}
									})
									.child({
										let button = Button::new("file-preview-md")
											.xsmall()
											.label(self.t("Preview", "预览"))
											.on_click(cx.listener(|this, _, _, cx| {
												this.file_show_preview = true;
												cx.notify();
											}));
										if show_preview {
											button.primary()
										} else {
											button.ghost()
										}
									})
								}),
						)
					})
					.child(if selected.is_none() {
						v_flex()
							.size_full()
							.items_center()
							.justify_center()
							.child(
								div()
									.text_sm()
									.text_color(cx.theme().muted_foreground)
									.child(self.t(
										"Select a file to edit it.",
										"选择一个文件进行编辑。",
									)),
							)
							.into_any_element()
					} else if is_markdown && show_preview {
						div()
							.id("file-preview")
							.size_full()
							.p_4()
							.overflow_y_scroll()
							.child(TextView::markdown("file-md", preview))
							.into_any_element()
					} else {
						div()
							.id("file-editor")
							.size_full()
							.child(
								Editor::new(&editor)
									.bordered(false)
									.appearance(true)
									.h(relative(1.)),
							)
							.into_any_element()
					}),
			)
	}

	fn render_git_pane(&mut self, cx: &mut Context<Self>) -> impl IntoElement {
		let git_pane = self.git_pane;
		let diff = self.git_diff.clone();
		let commits = self.commits.clone();
		let selected = self.selected_commit.clone();
		let commit_diff = self.commit_diff.clone();
		v_flex()
			.flex_1()
			.min_h_0()
			.child(
				h_flex()
					.flex_none()
					.h(px(32.))
					.px_2()
					.gap_1()
					.bg(cx.theme().muted)
					.child({
						let button = Button::new("git-changes")
							.label(self.t("Changes", "变更"))
							.on_click(cx.listener(|this, _, _, cx| {
								this.git_pane = GitPane::Changes;
								cx.notify();
							}));
						if git_pane == GitPane::Changes {
							button.primary()
						} else {
							button.ghost()
						}
					})
					.child({
						let button = Button::new("git-history")
							.label(self.t("History", "历史"))
							.on_click(cx.listener(|this, _, _, cx| {
								this.git_pane = GitPane::History;
								cx.notify();
							}));
						if git_pane == GitPane::History {
							button.primary()
						} else {
							button.ghost()
						}
					}),
			)
			.child(match git_pane {
				GitPane::Changes => self.render_git_changes(cx, diff).into_any_element(),
				GitPane::History => h_flex()
					.flex_1()
					.min_h_0()
					.child(
						v_flex()
							.w(px(280.))
							.h_full()
							.border_r_1()
							.border_color(cx.theme().border)
							.id("commit-list")
							.overflow_y_scroll()
							.children(commits.into_iter().map(|commit| {
								let hash = commit.hash.clone();
								let active = selected.as_deref() == Some(hash.as_str());
								let row_id = format!("commit-{hash}");
								v_flex()
									.id(row_id)
									.p_3()
									.gap_1()
									.when(active, |this| this.bg(cx.theme().muted))
									.hover(|this| this.bg(cx.theme().muted))
									.cursor_pointer()
									.on_click(cx.listener(move |this, _, _, cx| {
										this.select_commit(&hash, cx);
									}))
									.child(div().text_xs().font_medium().child(commit.message))
									.child(
										div()
											.text_xs()
											.text_color(cx.theme().muted_foreground)
											.child(format!(
												"{} · {}",
												commit.author.name, commit.hash
											)),
									)
							})),
					)
					.child(self.render_diff_view(
						"commit-diff",
						if commit_diff.is_empty() {
							self.t(
								"Select a commit to see its diff.",
								"选择一个提交查看 diff。",
							)
							.to_string()
						} else {
							commit_diff
						},
						cx,
					))
					.into_any_element(),
			})
	}

	fn render_git_changes(
		&mut self,
		cx: &mut Context<Self>,
		diff: String,
	) -> impl IntoElement {
		let changed = self.changed_files.clone();
		let selected = self.selected_change.clone();
		let ahead = self.git_ahead;
		let commit = self.commit_message.clone();
		h_flex()
			.flex_1()
			.min_h_0()
			.child(
				v_flex()
					.w(px(260.))
					.h_full()
					.border_r_1()
					.border_color(cx.theme().border)
					.child(
						div()
							.px_3()
							.py_2()
							.text_xs()
							.text_color(cx.theme().muted_foreground)
							.child(format!(
								"{} · {} ahead",
								self.t("Changed files", "变更文件"),
								ahead
							)),
					)
					.child(
						v_flex()
							.flex_1()
							.id("changed-files")
							.overflow_y_scroll()
							.children(changed.into_iter().map(|entry| {
								let path = entry.path.clone();
								let active = selected.as_deref() == Some(path.as_str());
								let row_id = format!("change-{path}");
								h_flex()
									.id(row_id)
									.h(px(28.))
									.px_3()
									.gap_2()
									.when(active, |this| this.bg(cx.theme().muted))
									.hover(|this| this.bg(cx.theme().muted))
									.cursor_pointer()
									.on_click(cx.listener(move |this, _, _, cx| {
										this.select_change(&path, cx);
									}))
									.child(
										div()
											.text_xs()
											.text_color(cx.theme().muted_foreground)
											.child(entry.status),
									)
									.child(div().text_xs().child(entry.path))
							})),
					)
					.child(
						v_flex()
							.p_2()
							.gap_2()
							.border_t_1()
							.border_color(cx.theme().border)
							.child(Input::new(&commit).cleanable(true))
							.child(
								h_flex()
									.gap_1()
									.child(
										Button::new("git-commit")
											.primary()
											.xsmall()
											.label(self.t("Commit", "提交"))
											.on_click(cx.listener(|this, _, window, cx| {
												this.commit_selected_changes(window, cx);
											})),
									)
									.child(
										Button::new("git-discard")
											.ghost()
											.xsmall()
											.label(self.t("Discard", "丢弃"))
											.on_click(cx.listener(|this, _, _, cx| {
												this.discard_selected_changes(cx);
											})),
									)
									.child(
										Button::new("git-push")
											.ghost()
											.xsmall()
											.label(self.t("Push", "推送"))
											.on_click(cx.listener(|this, _, _, cx| {
												this.push_current_branch(cx);
											})),
									),
							),
					),
			)
			.child(self.render_diff_view(
				"git-diff",
				if diff.is_empty() {
					self.t("Working tree is clean.", "工作区是干净的。")
						.to_string()
				} else {
					files::filter_unified_diff(&diff, self.selected_change.as_deref())
				},
				cx,
			))
	}

	fn render_terminal_pane(&mut self, cx: &mut Context<Self>) -> impl IntoElement {
		let terminals = self.profile_terminals();
		let has_terminal = self.active_session.is_some();
		let output = self.terminal_output.clone();
		let input = self.terminal_input.clone();
		let selected = terminals
			.iter()
			.position(|tab| Some(&tab.id) == self.active_session.as_ref())
			.unwrap_or(0);

		v_flex().flex_1().min_h_0().map(|this| {
			if !has_terminal {
				this.items_center()
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
							.child(Icon::new(IconName::SquareTerminal).size_4()),
					)
					.child(
						div()
							.text_sm()
							.font_medium()
							.child(self.t("No terminals open", "还没有终端")),
					)
					.child(
						div()
							.text_sm()
							.text_color(cx.theme().muted_foreground)
							.child(self.t(
								"Open a terminal to start working in this project.",
								"打开一个终端，开始在这个项目中工作。",
							)),
					)
					.child(
						Button::new("new-terminal")
							.primary()
							.icon(IconName::Plus)
							.label(self.t("New Terminal", "新建终端"))
							.on_click(cx.listener(|this, _, _, cx| {
								this.new_terminal(cx);
							})),
					)
			} else {
				this.child(
					h_flex()
						.flex_none()
						.h(px(32.))
						.px_2()
						.gap_1()
						.items_center()
						.justify_between()
						.child(
							h_flex().gap_1().children(terminals.into_iter().enumerate().map(|(index, tab)| {
								let label = match tab.status {
									Some(crate::detector::AgentStatus::Running) => {
										format!("● {}", tab.title)
									}
									Some(crate::detector::AgentStatus::Waiting) => {
										format!("◐ {}", tab.title)
									}
									_ => tab.title,
								};
								let session_id = tab.id;
								let button = Button::new(format!("term-tab-{index}"))
									.label(label)
									.on_click(cx.listener(move |this, _, _, cx| {
										this.activate_terminal(&session_id, cx);
									}));
								if selected == index {
									button.primary()
								} else {
									button.ghost()
								}
							})),
						)
						.child(
							h_flex()
								.gap_1()
								.pr_2()
								.child(
									Button::new("add-terminal")
										.ghost()
										.xsmall()
										.icon(IconName::Plus)
										.on_click(cx.listener(|this, _, _, cx| {
											this.new_terminal(cx);
										})),
								)
								.child(
									Button::new("close-terminal")
										.ghost()
										.xsmall()
										.label(self.t("Close", "关闭"))
										.on_click(cx.listener(|this, _, _, cx| {
											this.close_terminal(cx);
										})),
								),
						),
				)
				.child({
					let spans = self.terminal_spans.clone();
					let font_size = self.settings.terminal_font_size;
					div()
						.id("terminal-output")
						.flex_1()
						.p_3()
						.font_family(self.settings.terminal_font.clone())
						.text_size(px(font_size))
						.overflow_y_scroll()
						.child(if spans.is_empty() && output.is_empty() {
							div()
								.text_color(cx.theme().muted_foreground)
								.child(
									self.t("Waiting for shell output…", "等待终端输出…")
										.to_string(),
								)
								.into_any_element()
						} else if spans.is_empty() {
							div().child(output).into_any_element()
						} else {
							v_flex()
								.gap_0()
								.children(spans.into_iter().map(|line| {
									h_flex().children(line.into_iter().map(|span| {
										div()
											.bg(gpui::rgb(span.bg))
											.text_color(gpui::rgb(span.fg))
											.child(span.text)
									}))
								}))
								.into_any_element()
						})
				})
				.child(
					h_flex()
						.p_2()
						.gap_2()
						.border_t_1()
						.border_color(cx.theme().border)
						.child(Input::new(&input).cleanable(true))
						.child(
							Button::new("send-terminal")
								.primary()
								.label(self.t("Send", "发送"))
								.on_click(cx.listener(|this, _, window, cx| {
									this.send_terminal_input(window, cx);
								})),
						),
				)
			}
		})
	}
}
