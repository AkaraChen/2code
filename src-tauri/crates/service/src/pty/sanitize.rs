const VT100_SCROLLBACK: usize = 10000;

/// Process raw terminal history through a virtual terminal emulator
/// to produce clean output (text + colors, no cursor positioning).
pub(crate) fn sanitize_history(raw: &[u8], rows: u16, cols: u16) -> Vec<u8> {
	if raw.is_empty() {
		return Vec::new();
	}
	let mut parser = vt100::Parser::new(rows, cols, VT100_SCROLLBACK);
	parser.process(raw);
	serialize_screen(&mut parser)
}

/// Extract all visible content (scrollback + current screen) from a vt100 parser
/// as formatted bytes with SGR sequences but no cursor positioning.
fn serialize_screen(parser: &mut vt100::Parser) -> Vec<u8> {
	let (rows, cols) = parser.screen().size();
	let screen_rows = rows as usize;

	// Find max scrollback depth
	parser.screen_mut().set_scrollback(usize::MAX);
	let max_scrollback = parser.screen().scrollback();

	let mut all_lines: Vec<Vec<u8>> = Vec::new();

	// Extract scrollback content in full pages (oldest first)
	let mut offset = max_scrollback;
	while offset >= screen_rows {
		parser.screen_mut().set_scrollback(offset);
		for line in parser.screen().rows_formatted(0, cols) {
			all_lines.push(line);
		}
		offset -= screen_rows;
	}

	// Partial page remaining (if max_scrollback is not a multiple of screen_rows)
	if offset > 0 {
		parser.screen_mut().set_scrollback(offset);
		for line in parser.screen().rows_formatted(0, cols).take(offset) {
			all_lines.push(line);
		}
	}

	// Current screen content
	parser.screen_mut().set_scrollback(0);
	for line in parser.screen().rows_formatted(0, cols) {
		all_lines.push(line);
	}

	// Trim trailing visually-empty lines
	while let Some(last) = all_lines.last() {
		if is_visually_empty(last) {
			all_lines.pop();
		} else {
			break;
		}
	}

	if all_lines.is_empty() {
		return Vec::new();
	}

	// Join lines with \r\n and add SGR reset at the end
	let mut output = Vec::new();
	for (i, line) in all_lines.iter().enumerate() {
		if i > 0 {
			output.extend_from_slice(b"\r\n");
		}
		output.extend_from_slice(line);
	}
	output.extend_from_slice(b"\x1b[0m");

	output
}

/// Check if a formatted line is visually empty (contains only SGR sequences and/or spaces).
fn is_visually_empty(line: &[u8]) -> bool {
	let mut i = 0;
	while i < line.len() {
		if line[i] == 0x1b {
			// Skip ESC [ ... m (SGR sequence)
			i += 1;
			if i < line.len() && line[i] == b'[' {
				i += 1;
				while i < line.len() && line[i] != b'm' {
					i += 1;
				}
				if i < line.len() {
					i += 1; // skip 'm'
				}
			}
		} else if line[i] == b' ' {
			i += 1;
		} else {
			return false;
		}
	}
	true
}

#[cfg(test)]
mod tests {
	use super::*;

	// --- is_visually_empty ---

	#[test]
	fn visually_empty_empty_line() {
		assert!(is_visually_empty(b""));
	}

	#[test]
	fn visually_empty_spaces_only() {
		assert!(is_visually_empty(b"     "));
	}

	#[test]
	fn visually_empty_sgr_only() {
		assert!(is_visually_empty(b"\x1b[0m\x1b[32m"));
	}

	#[test]
	fn visually_empty_sgr_and_spaces() {
		assert!(is_visually_empty(b"\x1b[0m   \x1b[32m  "));
	}

	#[test]
	fn visually_nonempty_text() {
		assert!(!is_visually_empty(b"hello"));
	}

	#[test]
	fn visually_nonempty_text_with_sgr() {
		assert!(!is_visually_empty(b"\x1b[32mhello\x1b[0m"));
	}

	// --- sanitize_history ---

	/// Helper to extract plain text from sanitized output (strip ANSI sequences).
	fn strip_ansi(bytes: &[u8]) -> String {
		let s = String::from_utf8_lossy(bytes);
		let mut result = String::new();
		let mut chars = s.chars().peekable();
		while let Some(c) = chars.next() {
			if c == '\x1b' {
				// Skip ESC [ ... (letter)
				if chars.peek() == Some(&'[') {
					chars.next();
					while let Some(&nc) = chars.peek() {
						chars.next();
						if nc.is_ascii_alphabetic() {
							break;
						}
					}
				}
			} else {
				result.push(c);
			}
		}
		result
	}

	#[test]
	fn sanitize_empty_input() {
		assert_eq!(sanitize_history(b"", 24, 80), Vec::<u8>::new());
	}

	#[test]
	fn sanitize_plain_text() {
		let result = sanitize_history(b"hello world", 24, 80);
		let text = strip_ansi(&result);
		assert!(text.contains("hello world"));
	}

	#[test]
	fn sanitize_multiline_text() {
		let input = b"line1\r\nline2\r\nline3";
		let result = sanitize_history(input, 24, 80);
		let text = strip_ansi(&result);
		assert!(text.contains("line1"));
		assert!(text.contains("line2"));
		assert!(text.contains("line3"));
	}

	#[test]
	fn sanitize_preserves_sgr_colors() {
		// Red text: ESC[31m hello ESC[0m
		let input = b"\x1b[31mred text\x1b[0m";
		let result = sanitize_history(input, 24, 80);
		// Output should contain SGR sequences (not be plain text)
		assert!(result
			.windows(4)
			.any(|w| w == b"\x1b[31" || w == b"\x1b[0m"));
		let text = strip_ansi(&result);
		assert!(text.contains("red text"));
	}

	#[test]
	fn sanitize_removes_cursor_movement() {
		// Write "AAAA", move cursor to home, overwrite with "BB"
		// Final visible: "BBAA"
		let input = b"AAAA\x1b[HBB";
		let result = sanitize_history(input, 24, 80);
		let text = strip_ansi(&result);
		assert!(
			text.contains("BBAA"),
			"Expected 'BBAA' in output, got: {:?}",
			text
		);
	}

	#[test]
	fn sanitize_inline_tui_overwrite() {
		// Simulate progress: write "Loading...", then \r to go to start, overwrite with "Done!     "
		let input = b"Loading...\rDone!     ";
		let result = sanitize_history(input, 24, 80);
		let text = strip_ansi(&result);
		assert!(
			text.contains("Done!"),
			"Expected 'Done!' in output, got: {:?}",
			text
		);
		assert!(
			!text.contains("Loading"),
			"Should not contain 'Loading', got: {:?}",
			text
		);
	}

	#[test]
	fn sanitize_erase_line() {
		// Write text, then \r + erase to end of line + new text
		let input = b"old text\r\x1b[Knew text";
		let result = sanitize_history(input, 24, 80);
		let text = strip_ansi(&result);
		assert!(
			text.contains("new text"),
			"Expected 'new text', got: {:?}",
			text
		);
		assert!(
			!text.contains("old text"),
			"Should not contain 'old text', got: {:?}",
			text
		);
	}

	#[test]
	fn sanitize_cjk_wide_chars() {
		let input = "你好世界\r\n测试中文".as_bytes();
		let result = sanitize_history(input, 24, 80);
		let text = strip_ansi(&result);
		assert!(text.contains("你好世界"));
		assert!(text.contains("测试中文"));
	}

	#[test]
	fn sanitize_alt_screen_exited() {
		// Enter alt screen, write content, exit alt screen, write normal content
		let mut input = Vec::new();
		input.extend_from_slice(b"normal before\r\n");
		input.extend_from_slice(b"\x1b[?1049h"); // enter alt screen
		input.extend_from_slice(b"alt screen content");
		input.extend_from_slice(b"\x1b[?1049l"); // exit alt screen
		input.extend_from_slice(b"normal after");

		let result = sanitize_history(&input, 24, 80);
		let text = strip_ansi(&result);
		assert!(
			text.contains("normal before"),
			"Expected 'normal before', got: {:?}",
			text
		);
		assert!(
			text.contains("normal after"),
			"Expected 'normal after', got: {:?}",
			text
		);
		// Alt screen content should not appear in normal buffer
		assert!(
			!text.contains("alt screen content"),
			"Should not contain alt screen content, got: {:?}",
			text
		);
	}

	#[test]
	fn sanitize_scrollback_content() {
		// Generate enough lines to push content into scrollback
		let mut input = Vec::new();
		for i in 0..30 {
			input.extend_from_slice(format!("line {i}\r\n").as_bytes());
		}
		// Use a small terminal (5 rows) so lines go into scrollback
		let result = sanitize_history(&input, 5, 80);
		let text = strip_ansi(&result);
		// Should contain both early and late lines
		assert!(
			text.contains("line 0"),
			"Expected 'line 0' in scrollback, got: {:?}",
			text
		);
		assert!(
			text.contains("line 29"),
			"Expected 'line 29', got: {:?}",
			text
		);
	}

	#[test]
	fn sanitize_trims_trailing_empty_lines() {
		// Single line of text on a 24-row terminal should not produce 24 lines
		let result = sanitize_history(b"hello", 24, 80);
		let text = strip_ansi(&result);
		let lines: Vec<&str> = text.split("\r\n").collect();
		assert!(
			lines.len() < 24,
			"Should trim trailing empty lines, got {} lines",
			lines.len()
		);
	}
}
