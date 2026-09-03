//! vt100 helpers: key encoding and color-span extraction.

use vt100::Color;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TermSpan {
	pub text: String,
	pub fg: u32,
	pub bg: u32,
}

pub fn ansi_color_rgb(color: Color, default: u32) -> u32 {
	match color {
		Color::Default => default,
		Color::Rgb(r, g, b) => u32::from_be_bytes([0, r, g, b]),
		Color::Idx(index) => ANSI_16.get(index as usize).copied().unwrap_or(default),
	}
}

const ANSI_16: [u32; 16] = [
	0x000000, 0xCD3131, 0x0DBC79, 0xE5E510, 0x2472C8, 0xBC3FBC, 0x11A8CD, 0xE5E5E5,
	0x666666, 0xF14C4C, 0x23D18B, 0xF5F543, 0x3B8EEA, 0xD670D6, 0x29B8DB, 0xFFFFFF,
];

const DEFAULT_FG: u32 = 0xE8E8E8;
const DEFAULT_BG: u32 = 0x1E1E1E;

pub fn screen_spans(parser: &vt100::Parser) -> Vec<Vec<TermSpan>> {
	let screen = parser.screen();
	let (rows, cols) = screen.size();
	let mut lines = Vec::with_capacity(rows as usize);
	for row in 0..rows {
		let mut spans: Vec<TermSpan> = Vec::new();
		let mut current_fg = None::<u32>;
		let mut current_bg = None::<u32>;
		let mut current = String::new();
		let mut saw_glyph = false;
		for col in 0..cols {
			let Some(cell) = screen.cell(row, col) else {
				continue;
			};
			let ch = cell.contents();
			let glyph = if ch.is_empty() {
				" ".to_string()
			} else {
				saw_glyph = true;
				ch.to_string()
			};
			let fg = ansi_color_rgb(cell.fgcolor(), DEFAULT_FG);
			let bg = ansi_color_rgb(cell.bgcolor(), DEFAULT_BG);
			if (current_fg != Some(fg) || current_bg != Some(bg)) && !current.is_empty() {
				spans.push(TermSpan {
					text: std::mem::take(&mut current),
					fg: current_fg.unwrap_or(DEFAULT_FG),
					bg: current_bg.unwrap_or(DEFAULT_BG),
				});
			}
			current_fg = Some(fg);
			current_bg = Some(bg);
			current.push_str(&glyph);
		}
		if !current.is_empty() && saw_glyph {
			spans.push(TermSpan {
				text: current,
				fg: current_fg.unwrap_or(DEFAULT_FG),
				bg: current_bg.unwrap_or(DEFAULT_BG),
			});
			lines.push(spans);
		}
	}
	lines
}

pub fn keystroke_to_bytes(key: &str, key_char: Option<&str>, ctrl: bool) -> Option<Vec<u8>> {
	if ctrl {
		return match key {
			"c" => Some(vec![0x03]),
			"d" => Some(vec![0x04]),
			"l" => Some(vec![0x0c]),
			"u" => Some(vec![0x15]),
			"w" => Some(vec![0x17]),
			"z" => Some(vec![0x1a]),
			"k" => None,
			_ => key_char.and_then(|value| {
				value.bytes().next().map(|byte| vec![byte & 0x1f])
			}),
		};
	}
	match key {
		"enter" | "return" => Some(b"\r".to_vec()),
		"backspace" => Some(vec![0x7f]),
		"tab" => Some(b"\t".to_vec()),
		"escape" => Some(vec![0x1b]),
		"up" => Some(b"\x1b[A".to_vec()),
		"down" => Some(b"\x1b[B".to_vec()),
		"right" => Some(b"\x1b[C".to_vec()),
		"left" => Some(b"\x1b[D".to_vec()),
		"home" => Some(b"\x1b[H".to_vec()),
		"end" => Some(b"\x1b[F".to_vec()),
		"pageup" => Some(b"\x1b[5~".to_vec()),
		"pagedown" => Some(b"\x1b[6~".to_vec()),
		_ => key_char.map(|value| value.as_bytes().to_vec()),
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn encodes_control_and_arrows() {
		assert_eq!(keystroke_to_bytes("c", Some("c"), true), Some(vec![0x03]));
		assert_eq!(keystroke_to_bytes("enter", None, false), Some(b"\r".to_vec()));
		assert_eq!(
			keystroke_to_bytes("up", None, false),
			Some(b"\x1b[A".to_vec())
		);
		assert_eq!(keystroke_to_bytes("a", Some("a"), false), Some(b"a".to_vec()));
	}

	#[test]
	fn groups_colored_cells() {
		let mut parser = vt100::Parser::new(4, 20, 10);
		parser.process(b"\x1b[31mred\x1b[0m plain");
		let lines = screen_spans(&parser);
		assert!(!lines.is_empty());
		assert!(lines[0].iter().any(|span| span.text.contains("red")));
		assert_eq!(ansi_color_rgb(Color::Idx(1), DEFAULT_FG), 0xCD3131);
		assert!(lines[0].iter().any(|span| span.fg == 0xCD3131));
	}
}
