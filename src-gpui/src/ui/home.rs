use gpui::{div, prelude::*, px, Context, Window};
use gpui_component::{v_flex, ActiveTheme, Icon, IconName, StyledExt};

use crate::app::AppView;

pub fn render(app: &AppView, _window: &mut Window, cx: &mut Context<AppView>) -> impl IntoElement {
	let theme = cx.theme().clone();
	let pad_left = if cfg!(target_os = "macos") && app.data.prefs.sidebar_collapsed {
		px(84.)
	} else {
		px(20.)
	};

	v_flex()
		.id("home-page")
		.size_full()
		.child(
			div()
				.id("home-header")
				.h(px(52.))
				.w_full()
				.px_5()
				.pl(pad_left)
				.flex()
				.items_center()
				.gap_2()
				.border_b_1()
				.border_color(theme.border)
				.child(
					Icon::new(IconName::Folder)
						.text_color(theme.muted_foreground)
						.w(px(16.)),
				)
				.child(div().font_semibold().text_sm().child(app.t("home"))),
		)
		.child(
			v_flex()
				.flex_1()
				.items_center()
				.justify_center()
				.gap_3()
				.child(
					div()
						.size(px(48.))
						.rounded_full()
						.bg(theme.muted)
						.flex()
						.items_center()
						.justify_center()
						.child(crate::ui::leftover_folder_plus_mark(22., 10.)),
				)
				.child(div().font_semibold().child(app.t("emptyProjectsTitle")))
				.child(
					div()
						.text_sm()
						.text_color(theme.muted_foreground)
						.child(app.t("emptyProjectsDesc")),
				),
		)
}
