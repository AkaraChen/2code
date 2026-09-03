mod app;
mod backend;
mod settings;
mod theme;
mod views;

use gpui::{
	App, Application, Bounds, WindowBounds, WindowOptions, prelude::*, px, size,
};
use gpui_component::{Root, TitleBar};

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
			let bounds = Bounds::centered(None, size(px(1280.), px(800.)), &cx);
			cx.open_window(
				WindowOptions {
					window_bounds: Some(WindowBounds::Windowed(bounds)),
					titlebar: Some(TitleBar::title_bar_options()),
					..Default::default()
				},
				|window, cx| {
					let view = cx.new(|cx| AppRoot::new(window, cx));
					cx.new(|cx| Root::new(view.into(), window, cx).bg(cx.theme().background))
				},
			)
			.expect("failed to open 2code window");
		})
		.detach();
	});
}
