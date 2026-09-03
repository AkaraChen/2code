//! 2code visual tokens extracted from `src/app.css`.
//!
//! These match the current shadcn/OKLCH theme so the GPUI shell can stay
//! visually aligned with the screenshots of the existing app.

use gpui::{Hsla, Rgba, rgb};

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct TwoCodePalette {
	pub background: Rgba,
	pub foreground: Rgba,
	pub card: Rgba,
	pub primary: Rgba,
	pub primary_foreground: Rgba,
	pub muted: Rgba,
	pub muted_foreground: Rgba,
	pub border: Rgba,
	pub sidebar: Rgba,
	pub sidebar_foreground: Rgba,
	pub sidebar_accent: Rgba,
}

impl TwoCodePalette {
	pub const SIDEBAR_WIDTH: f32 = 250.0;
	pub const HEADER_HEIGHT: f32 = 52.0;
	pub const RADIUS: f32 = 10.0;

	pub fn light() -> Self {
		Self {
			background: rgb(0xffffff),
			foreground: rgb(0x252525),
			card: rgb(0xffffff),
			primary: rgb(0x343434),
			primary_foreground: rgb(0xfafafa),
			muted: rgb(0xf5f5f5),
			muted_foreground: rgb(0x737373),
			border: rgb(0xe8e8e8),
			sidebar: rgb(0xfafafa),
			sidebar_foreground: rgb(0x252525),
			sidebar_accent: rgb(0xf5f5f5),
		}
	}

	pub fn dark() -> Self {
		Self {
			background: rgb(0x252525),
			foreground: rgb(0xfafafa),
			card: rgb(0x343434),
			primary: rgb(0xe8e8e8),
			primary_foreground: rgb(0x343434),
			muted: rgb(0x444444),
			muted_foreground: rgb(0xb0b0b0),
			border: Rgba {
				r: 1.0,
				g: 1.0,
				b: 1.0,
				a: 0.10,
			},
			sidebar: rgb(0x343434),
			sidebar_foreground: rgb(0xfafafa),
			sidebar_accent: rgb(0x444444),
		}
	}

	pub fn for_mode(dark: bool) -> Self {
		if dark {
			Self::dark()
		} else {
			Self::light()
		}
	}

	pub fn background_hsla(&self) -> Hsla {
		self.background.into()
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn light_palette_uses_white_canvas() {
		let palette = TwoCodePalette::light();
		assert_eq!(palette.background, rgb(0xffffff));
		assert_eq!(TwoCodePalette::SIDEBAR_WIDTH, 250.0);
		assert_eq!(TwoCodePalette::HEADER_HEIGHT, 52.0);
	}

	#[test]
	fn dark_palette_uses_near_black_canvas() {
		let palette = TwoCodePalette::dark();
		assert_eq!(palette.background, rgb(0x252525));
		assert_eq!(palette.foreground, rgb(0xfafafa));
	}

	#[test]
	fn for_mode_selects_the_matching_palette() {
		assert_eq!(TwoCodePalette::for_mode(false), TwoCodePalette::light());
		assert_eq!(TwoCodePalette::for_mode(true), TwoCodePalette::dark());
	}
}
