use pinyin::ToPinyin;
use slug::slugify;

/// Convert a string (possibly containing CJK characters) into a URL-safe slug.
/// CJK characters are first converted to pinyin syllables, then the result is slugified.
pub fn slugify_cjk(input: &str) -> String {
	let mut expanded = String::new();
	let mut buf = String::new();
	for c in input.chars() {
		if let Some(py) = c.to_pinyin() {
			if !buf.is_empty() {
				push_slug_part(&mut expanded, &buf);
				buf.clear();
			}
			push_slug_part(&mut expanded, py.plain());
		} else {
			buf.push(c);
		}
	}
	if !buf.is_empty() {
		push_slug_part(&mut expanded, &buf);
	}
	slugify(expanded)
}

fn push_slug_part(output: &mut String, part: &str) {
	if !output.is_empty() {
		output.push(' ');
	}
	output.push_str(part);
}

#[cfg(test)]
mod tests {
	use super::*;
	use std::time::Instant;

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

	#[test]
	#[ignore]
	fn bench_slugify_cjk_without_parts_vec() {
		let names: Vec<String> = (0..2_000)
			.map(|index| format!("功能开发-{index}-你好-world"))
			.collect();
		let iterations = 100;

		let started = Instant::now();
		let mut parts_vec_len = 0;
		for _ in 0..iterations {
			for name in &names {
				parts_vec_len += slugify_cjk_with_parts(
					std::hint::black_box(name),
				)
				.len();
			}
		}
		let parts_vec = started.elapsed();

		let started = Instant::now();
		let mut direct_string_len = 0;
		for _ in 0..iterations {
			for name in &names {
				direct_string_len += slugify_cjk(std::hint::black_box(name)).len();
			}
		}
		let direct_string = started.elapsed();

		assert_eq!(parts_vec_len, direct_string_len);
		println!(
			"parts_vec={parts_vec:?} direct_string={direct_string:?} speedup={:.2}x",
			parts_vec.as_secs_f64() / direct_string.as_secs_f64()
		);
	}
}
