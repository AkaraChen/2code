use std::time::Duration;

use gpui::{div, prelude::*, px, Animation, AnimationExt, Context, MouseButton, Window};
use gpui_component::input::Input;
use gpui_component::{h_flex, v_flex, ActiveTheme, Icon, IconName, StyledExt};

use crate::app::AppView;
use crate::state::ContextMenu;
use crate::ui::TreeDrag;

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
		.px(px(6.))
		.py_1()
		.text_size(px(13.))
		.tab_index(0)
		.on_key_down({
			let view = view.clone();
			move |ev: &gpui::KeyDownEvent, window, cx| {
				view.update(cx, |app, cx| {
					if app.tree_key(ev.keystroke.key.as_str(), ev.keystroke.modifiers.shift, window, cx) {
						cx.notify();
					}
				});
			}
		})
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
		.on_drop({
			let view = view.clone();
			move |drag: &TreeDrag, _, cx| {
				view.update(cx, |app, cx| {
					app.drop_tree_paths(&[drag.path.clone()], None);
					cx.notify();
				});
			}
		})
		.when_some(err, |el, err| {
			el.child(div().text_xs().text_color(theme.danger).opacity(0.8).child(err))
		})
		.when_some(sticky_folder(app), |el, crumb| {
			el.child(
				h_flex()
					.id("tree-sticky-folder")
					.w_full()
					.px_1()
					.py_0p5()
					.mb_1()
					.gap_1()
					.rounded_md()
					.bg(theme.muted)
					.text_xs()
					.font_semibold()
					.child(
						Icon::new(IconName::FolderOpen)
							.w(px(12.))
							.text_color(gpui::rgb(0xc9a227)),
					)
					.child(crumb),
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
				.children(
					root.children
						.iter()
						.map(|path| node_view(app, path, 0, &profile, window, cx)),
				)
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
	let renaming = app.data.overlay.renaming_path.as_deref() == Some(path);
	let selected = app.data.current_ws().is_some_and(|w| w.tree_selected.contains(path));

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
				.when(selected, |el| el.bg(theme.muted))
				.hover(|el| el.bg(theme.muted))
				.on_click({
					let view = view.clone();
					let path = path_owned.clone();
					let is_dir = node.is_dir;
					move |ev, window, cx| {
						view.update(cx, |app, cx| {
							if app.data.overlay.renaming_path.as_deref() == Some(path.as_str()) {
								return;
							}
							let mods = ev.modifiers();
							app.click_tree_path(&path, is_dir, mods.platform || mods.control, mods.shift, window, cx);
							cx.notify();
						});
					}
				})
				.on_mouse_down(MouseButton::Left, {
					let view = view.clone();
					let path = path_owned.clone();
					let is_dir = node.is_dir;
					move |_, _, cx| {
						if is_dir {
							return;
						}
						view.update(cx, |app, _| {
							app.data.overlay.drag_file = Some(path.clone());
						});
					}
				})
				.on_drag(
					TreeDrag {
						path: path_owned.clone(),
					},
					|info, _, _, cx| {
						cx.new(|_| crate::ui::DragGhost {
							label: info.path.clone(),
						})
					},
				)
				.when(node.is_dir, |el| {
					el.on_drop({
						let view = view.clone();
						let dest = path_owned.clone();
						move |drag: &TreeDrag, _, cx| {
							view.update(cx, |app, cx| {
								if drag.path != dest {
									app.drop_tree_paths(&[drag.path.clone()], Some(&dest));
									cx.notify();
								}
							});
						}
					})
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
				.child(crate::ui::file_icons::file_glyph(path, node.is_dir, node.expanded, 13.))
				.child(if renaming {
					div()
						.flex_1()
						.min_w_0()
						.child(Input::new(&app.inputs.rename))
						.into_any_element()
				} else {
					div()
						.flex_1()
						.when(
							status.as_ref().is_some_and(|st| {
								crate::app::git_status_kind(st) == crate::app::GitStatusKind::Deleted
							}),
							|el| el.line_through().text_color(theme.muted_foreground),
						)
						.child(node.name.clone())
						.into_any_element()
				})
				.when_some(status.filter(|_| !renaming), |el, st| {
					let kind = crate::app::git_status_kind(&st);
					el.child(
						div()
							.text_xs()
							.text_color(match kind {
								crate::app::GitStatusKind::Added | crate::app::GitStatusKind::Untracked => {
									theme.success
								}
								crate::app::GitStatusKind::Deleted => theme.danger,
								crate::app::GitStatusKind::Renamed => theme.warning,
								crate::app::GitStatusKind::Ignored => theme.muted_foreground,
								crate::app::GitStatusKind::Modified => theme.warning,
							})
							.child(crate::app::file_status_badge(&st)),
					)
				}),
		)
		.when(node.is_dir && node.expanded, |el| {
			el.child(
				v_flex()
					.id(crate::ui::eid(format!("tree-children-{path}")))
					.children(
						node.children
							.iter()
							.map(|child| node_view(app, child, depth + 1, profile, window, cx)),
					)
					.with_animation(
						crate::ui::eid(format!("tree-open-{path}")),
						Animation::new(Duration::from_millis(18)),
						|this, delta| this.opacity(delta).ml(px(12.0 * (1.0 - delta))),
					),
			)
		})
		.into_any_element()
}

fn sticky_folder(app: &AppView) -> Option<String> {
	let ws = app.data.current_ws()?;
	let path = if let Some(selected) = ws.tree_selected.iter().next() {
		let parent = selected.rsplit_once('/').map(|(dir, _)| dir).unwrap_or(selected);
		if parent.is_empty() {
			None
		} else {
			Some(parent.to_string())
		}
	} else {
		ws.tree
			.values()
			.filter(|node| node.is_dir && node.expanded && !node.path.is_empty())
			.max_by_key(|node| node.path.matches('/').count())
			.map(|node| node.path.clone())
	}?;
	Some(path)
}
