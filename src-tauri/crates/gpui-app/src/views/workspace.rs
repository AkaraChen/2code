use gpui::{
	Context, InteractiveElement, IntoElement, ParentElement, StatefulInteractiveElement,
	Styled, Window, div, prelude::FluentBuilder, px,
};
use gpui_component::{
	ActiveTheme, Icon, IconName, Sizable, StyledExt,
	button::{Button, ButtonVariants},
	h_flex, input::Input,
	tab::{Tab, TabBar},
	text::TextView,
	v_flex,
};

use crate::app::{AppRoot, GitPane, WorkspacePane};
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
			self.t("no git", "无 Git").to_string()
		} else {
			self.git_branch.clone()
		};
		let pane = self.workspace_pane;
		let stats = self.git_stats_label.clone();

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
									.label(self.t("New Profile", "新建配置"))
									.on_click(cx.listener(|this, _, window, cx| {
										this.open_create_profile_dialog(window, cx);
									})),
							)
							.child(
								Button::new("delete-project")
									.ghost()
									.icon(IconName::Delete)
									.label(self.t("Delete", "删除"))
									.on_click(cx.listener(|this, _, window, cx| {
										this.open_delete_project_dialog(window, cx);
									})),
							),
					),
			)
			.child(
				TabBar::new("workspace-panes")
					.selected_index(match pane {
						WorkspacePane::Files => 0,
						WorkspacePane::Git => 1,
						WorkspacePane::Terminal => 2,
					})
					.on_click(cx.listener(|this, index: &usize, _, cx| {
						this.workspace_pane = match index {
							0 => WorkspacePane::Files,
							1 => WorkspacePane::Git,
							_ => WorkspacePane::Terminal,
						};
						cx.notify();
					}))
					.child(Tab::new().icon(IconName::File).label(self.t("Files", "文件")))
					.child(Tab::new().icon(IconName::Folder).label("Git"))
					.child(
						Tab::new()
							.icon(IconName::SquareTerminal)
							.label(self.t("Terminal", "终端")),
					),
			)
			.child(match pane {
				WorkspacePane::Files => self.render_files_pane(cx).into_any_element(),
				WorkspacePane::Git => self.render_git_pane(cx).into_any_element(),
				WorkspacePane::Terminal => self.render_terminal_pane(cx).into_any_element(),
			})
	}

	fn render_files_pane(&mut self, cx: &mut Context<Self>) -> impl IntoElement {
		let files = self.files.clone();
		let preview = self.file_preview.clone();
		let selected = self.selected_file.clone();
		let parent = self.file_parent.clone();
		let is_markdown = self.file_is_markdown;
		h_flex()
			.flex_1()
			.min_h_0()
			.child(
				v_flex()
					.w(px(240.))
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
									.child(parent.clone().unwrap_or_else(|| ".".into())),
							)
							.when(parent.is_some(), |this| {
								this.child(
									Button::new("files-up")
										.ghost()
										.xsmall()
										.label("Up")
										.on_click(cx.listener(|this, _, _, cx| {
											this.open_parent_dir(cx);
										})),
								)
							}),
					)
					.child(
						v_flex()
							.flex_1()
							.px_2()
							.gap_1()
							.id("file-list")
							.overflow_y_scroll()
							.children(files.into_iter().map(|path| {
								let active = selected.as_deref() == Some(path.as_str());
								let row_id = format!("file-{path}");
								let open_path = path.clone();
								h_flex()
									.id(row_id)
									.h(px(28.))
									.px_2()
									.gap_2()
									.rounded(px(6.))
									.when(active, |this| this.bg(cx.theme().muted))
									.hover(|this| this.bg(cx.theme().muted))
									.cursor_pointer()
									.on_click(cx.listener(move |this, _, _, cx| {
										this.open_path(&open_path, cx);
									}))
									.child(Icon::new(IconName::File).size_3())
									.child(div().text_xs().child(path))
							})),
					),
			)
			.child(
				v_flex()
					.flex_1()
					.min_w_0()
					.h_full()
					.child(if preview.is_empty() {
						v_flex()
							.size_full()
							.items_center()
							.justify_center()
							.child(
								div()
									.text_sm()
									.text_color(cx.theme().muted_foreground)
									.child(self.t(
										"Select a file to preview it.",
										"选择一个文件进行预览。",
									)),
							)
							.into_any_element()
					} else if is_markdown {
						div()
							.id("file-preview")
							.size_full()
							.p_4()
							.overflow_y_scroll()
							.child(TextView::markdown("file-md", preview))
							.into_any_element()
					} else {
						div()
							.id("file-preview")
							.size_full()
							.p_4()
							.overflow_y_scroll()
							.font_family("monospace")
							.text_xs()
							.child(preview)
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
				TabBar::new("git-panes")
					.selected_index(match git_pane {
						GitPane::Changes => 0,
						GitPane::History => 1,
					})
					.on_click(cx.listener(|this, index: &usize, _, cx| {
						this.git_pane = if *index == 0 {
							GitPane::Changes
						} else {
							GitPane::History
						};
						cx.notify();
					}))
					.child(Tab::new().label(self.t("Changes", "变更")))
					.child(Tab::new().label(self.t("History", "历史"))),
			)
			.child(match git_pane {
				GitPane::Changes => div()
					.id("git-diff")
					.flex_1()
					.p_3()
					.font_family("monospace")
					.text_xs()
					.overflow_y_scroll()
					.child(if diff.is_empty() {
						self.t("Working tree is clean.", "工作区是干净的。")
							.to_string()
					} else {
						diff
					})
					.into_any_element(),
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
					.child(
						div()
							.id("commit-diff")
							.flex_1()
							.p_3()
							.font_family("monospace")
							.text_xs()
							.overflow_y_scroll()
							.child(if commit_diff.is_empty() {
								self.t("Select a commit to see its diff.", "选择一个提交查看 diff。")
									.to_string()
							} else {
								commit_diff
							}),
					)
					.into_any_element(),
			})
	}

	fn render_terminal_pane(&mut self, cx: &mut Context<Self>) -> impl IntoElement {
		let terminals = self.terminals.clone();
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
						.justify_between()
						.child(
							TabBar::new("terminal-tabs")
								.selected_index(selected)
								.on_click(cx.listener(|this, index: &usize, _, cx| {
									if let Some(tab) = this.terminals.get(*index).cloned() {
										this.activate_terminal(&tab.id, cx);
									}
								}))
								.children(terminals.into_iter().map(|tab| {
									let label = match tab.status {
										Some(crate::detector::AgentStatus::Running) => {
											format!("● {}", tab.title)
										}
										Some(crate::detector::AgentStatus::Waiting) => {
											format!("◐ {}", tab.title)
										}
										_ => tab.title,
									};
									Tab::new().label(label)
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
					div()
						.id("terminal-output")
						.flex_1()
						.p_3()
						.font_family("monospace")
						.text_sm()
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
