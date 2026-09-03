mod app;
mod backend;
mod i18n;
mod settings;
mod theme;
mod views;

use gpui::{
	App, Bounds, WindowBounds, WindowOptions, point, prelude::*, px, size,
};
use gpui_component::{ActiveTheme, Root, TitleBar};

use crate::app::AppRoot;

fn main() {
	tracing_subscriber::fmt()
		.with_env_filter(
			tracing_subscriber::EnvFilter::from_default_env()
				.add_directive("gpui_app=info".parse().unwrap()),
		)
		.init();

	let application = gpui_platform::application()
		.with_assets(gpui_component_assets::Assets);

	application.run(move |cx: &mut App| {
		gpui_component::init(cx);

		cx.spawn(async move |cx| {
			let bounds = Bounds {
				origin: point(px(80.), px(80.)),
				size: size(px(1280.), px(800.)),
			};
			let mut titlebar = TitleBar::title_bar_options();
			titlebar.title = Some("2code".into());
			cx.open_window(
				WindowOptions {
					window_bounds: Some(WindowBounds::Windowed(bounds)),
					titlebar: Some(titlebar),
					..Default::default()
				},
				|window, cx| {
					window.set_window_title("2code");
					let view = cx.new(|cx| AppRoot::new(window, cx));
					cx.new(|cx| Root::new(view, window, cx).bg(cx.theme().background))
				},
			)
			.expect("failed to open 2code window");
		})
		.detach();
	});
}
