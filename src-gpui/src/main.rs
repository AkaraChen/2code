mod app;
mod backend;
mod detector;
mod diff;
mod i18n;
mod platform;
mod prefs;
mod review;
mod state;
mod timefmt;
mod ui;
mod updater;

use gpui::{point, prelude::*, px, size, Application, Bounds, TitlebarOptions, WindowBounds, WindowOptions};
use gpui_component::Root;
use tracing_subscriber::prelude::*;

use crate::app::AppView;
use crate::backend::Backend;

fn main() {
	let (log_layer, log_handle) = infra::logger::ChannelLayer::new();
	let filter = tracing_subscriber::EnvFilter::try_from_default_env()
		.unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info"));
	tracing_subscriber::registry()
		.with(filter)
		.with(tracing_subscriber::fmt::layer())
		.with(log_layer)
		.init();

	let backend = match Backend::init(log_handle) {
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
