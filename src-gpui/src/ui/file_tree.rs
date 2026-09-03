use gpui::{div, prelude::*, px, Context, MouseButton, Window};
use gpui_component::{h_flex, v_flex, ActiveTheme, Icon, IconName, StyledExt};

use crate::app::AppView;
use crate::state::ContextMenu;

pub fn render(app: &mut AppView, window: &mut Window, cx: &mut Context<AppView>) -> impl IntoElement {
	let theme = cx.theme().clone();
	let view = cx.entity();
	let Some(ws) = app.data.current_ws() else {
		return div().id("file-tree-empty").into_any_element();
	};
	let profile = ws.profile_id.clone();
	let root = ws.tree.get("").cloned();
	let err = ws.tree_error.clone();

	v_flex()
		.id("file-tree")
		.size_full()
		.px_1()
		.py_1()
		.text_sm()
		.on_mouse_down(MouseButton::Right, {
			let view = view.clone();
			move |ev, _, cx| {
				view.update(cx, |app, cx| {
					app.data.overlay.context_menu = Some((
						ContextMenu::TreeBlank,
						f32::from(ev.position.x),
						f32::from(ev.position.y),
					));
					cx.notify();
				});
			}
		})
		.when_some(err, |el, err| {
			el.child(
				div()
					.text_xs()
					.text_color(theme.danger)
					.opacity(0.8)
					.child(err),
			)
		})
		.child(match root {
			None => div()
				.p_3()
				.text_color(theme.muted_foreground)
				.child(app.t("fileTreeLoading"))
				.into_any_element(),
			Some(root) if root.children.is_empty() => div()
				.p_3()
				.text_color(theme.muted_foreground)
				.child(app.t("fileTreeEmptyDirectory"))
				.into_any_element(),
			Some(root) => v_flex()
				.children(root.children.iter().map(|path| {
					node_view(app, path, 0, &profile, window, cx)
				}))
				.into_any_element(),
		})
		.into_any_element()
}

fn node_view(
	app: &AppView,
	path: &str,
	depth: usize,
	profile: &str,
	window: &mut Window,
	cx: &mut Context<AppView>,
) -> impl IntoElement {
	let theme = cx.theme().clone();
	let view = cx.entity();
	let Some(node) = app.data.current_ws().and_then(|w| w.tree.get(path)).cloned() else {
		return div().into_any_element();
	};
	let status = app
		.data
		.current_ws()
		.and_then(|w| w.git_files.iter().find(|(p, _)| p == path || p.ends_with(path)))
		.map(|(_, s)| s.clone());
	let indent = px(12. * depth as f32 + 4.);
	let path_owned = path.to_string();
	let profile_owned = profile.to_string();

	v_flex()
		.child(
			h_flex()
				.id(crate::ui::eid(format!("tree-{path}")))
				.w_full()
				.pl(indent)
				.pr_1()
				.py_0p5()
				.rounded_md()
				.gap_1()
				.hover(|el| el.bg(theme.muted))
				.on_click({
					let view = view.clone();
					let path = path_owned.clone();
					let profile = profile_owned.clone();
					let is_dir = node.is_dir;
					move |_, window, cx| {
						view.update(cx, |app, cx| {
							if is_dir {
								app.toggle_dir(&profile, &path);
							} else {
								app.open_file(&profile, &path, window, cx);
							}
							cx.notify();
						});
					}
				})
				.on_mouse_down(MouseButton::Right, {
					let view = view.clone();
					let path = path_owned.clone();
					move |ev, _, cx| {
						view.update(cx, |app, cx| {
							app.data.overlay.context_menu = Some((
								ContextMenu::File { path: path.clone() },
								f32::from(ev.position.x),
								f32::from(ev.position.y),
							));
							cx.notify();
						});
					}
				})
				.child(Icon::new(if node.is_dir {
					if node.expanded {
						IconName::FolderOpen
					} else {
						IconName::Folder
					}
				} else {
					IconName::File
				}).w(px(13.)))
				.child(div().flex_1().child(node.name.clone()))
				.when_some(status, |el, st| {
					el.child(
						div()
							.text_xs()
							.text_color(if st.contains('D') {
								theme.danger
							} else {
								theme.success
							})
							.child(crate::app::file_status_badge(&st)),
					)
				}),
		)
		.when(node.is_dir && node.expanded, |el| {
			el.children(node.children.iter().map(|child| {
				node_view(app, child, depth + 1, profile, window, cx)
			}))
		})
		.into_any_element()
}
