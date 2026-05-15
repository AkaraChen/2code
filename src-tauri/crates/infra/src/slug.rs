use pinyin::ToPinyin;
use slug::slugify;

/// Convert a string (possibly containing CJK characters) into a URL-safe slug.
/// CJK characters are first converted to pinyin syllables, then the result is slugified.
pub fn slugify_cjk(input: &str) -> String {
	let mut converted = String::with_capacity(input.len());
	for c in input.chars() {
		if let Some(py) = c.to_pinyin() {
			if !converted.is_empty() && !converted.ends_with(' ') {
				converted.push(' ');
			}
			converted.push_str(py.plain());
			converted.push(' ');
		} else {
			converted.push(c);
		}
	}
	slugify(converted)
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn slugify_empty_string() {
		assert_eq!(slugify_cjk(""), "");
	}

	#[test]
	fn slugify_emoji_only() {
		let result = slugify_cjk("🚀🔥");
		assert!(result.is_empty() || result.chars().all(|c| c.is_ascii()));
	}

	#[test]
	fn slugify_ascii_only() {
		assert_eq!(slugify_cjk("hello world"), "hello-world");
	}

	#[test]
	fn slugify_mixed_cjk_and_ascii() {
		let result = slugify_cjk("你好world");
		assert!(result.contains("ni"));
		assert!(result.contains("hao"));
		assert!(result.contains("world"));
	}

	fn slugify_cjk_with_parts(input: &str) -> String {
		let mut parts: Vec<String> = Vec::new();
		let mut buf = String::new();
		for c in input.chars() {
			if let Some(py) = c.to_pinyin() {
				if !buf.is_empty() {
					parts.push(buf.clone());
					buf.clear();
				}
				parts.push(py.plain().to_string());
			} else {
				buf.push(c);
			}
		}
		if !buf.is_empty() {
			parts.push(buf);
		}
		slugify(parts.join(" "))
	}

	#[test]
	fn slugify_matches_part_join_for_boundaries() {
		for input in [
			"hello world",
			"你好world",
			"hello你好",
			"hello你好world",
			"🚀你好🔥world",
			"测试/branch name",
		] {
			assert_eq!(slugify_cjk(input), slugify_cjk_with_parts(input));
		}
	}

	#[test]
	#[ignore]
	fn bench_slugify_cjk_single_buffer() {
		let inputs = [
			"hello world project branch name",
			"你好world项目分支",
			"feature/修复终端通知性能问题",
			"🚀发布 beta 版本 2026-05-15",
		];
		let iterations = 25_000;

		let start = std::time::Instant::now();
		let mut original_len = 0;
		for _ in 0..iterations {
			for input in inputs {
				original_len += slugify_cjk_with_parts(input).len();
			}
		}
		let original_elapsed = start.elapsed();

		let start = std::time::Instant::now();
		let mut single_buffer_len = 0;
		for _ in 0..iterations {
			for input in inputs {
				single_buffer_len += slugify_cjk(input).len();
			}
		}
		let single_buffer_elapsed = start.elapsed();

		assert_eq!(original_len, single_buffer_len);
		println!(
			"parts_join={:?} single_buffer={:?} speedup={:.2}x",
			original_elapsed,
			single_buffer_elapsed,
			original_elapsed.as_secs_f64()
				/ single_buffer_elapsed.as_secs_f64()
		);
	}
}
