mod app;
mod backend;
mod i18n;
mod prefs;
mod state;
mod ui;
mod updater;

use gpui::{
	point, prelude::*, px, size, Application, Bounds, TitlebarOptions, WindowBounds, WindowOptions,
};
use gpui_component::Root;

use crate::app::AppView;
use crate::backend::Backend;

fn main() {
	tracing_subscriber::fmt()
		.with_env_filter(
			tracing_subscriber::EnvFilter::try_from_default_env()
				.unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
		)
		.init();

	let backend = match Backend::init() {
		Ok(b) => b,
		Err(err) => {
			eprintln!("failed to init 2code backend: {err}");
			std::process::exit(1);
		}
	};

	let app = Application::new();
	app.run(move |cx| {
		gpui_component::init(cx);
		AppView::bind_keys(cx);

		let bounds = Bounds::centered(None, size(px(1440.), px(900.)), cx);
		let backend = backend.clone();
		cx.spawn(async move |cx| {
			cx.open_window(
				WindowOptions {
					window_bounds: Some(WindowBounds::Windowed(bounds)),
					window_min_size: Some(size(px(960.), px(600.))),
					titlebar: Some(TitlebarOptions {
						title: Some("2code".into()),
						appears_transparent: true,
						traffic_light_position: Some(point(px(16.), px(24.))),
					}),
					..Default::default()
				},
				move |window, cx| {
					let view = cx.new(|cx| AppView::new(backend.clone(), window, cx));
					cx.new(|cx| Root::new(view, window, cx))
				},
			)?;
			Ok::<_, anyhow::Error>(())
		})
		.detach();
		cx.activate(true);
	});
}
