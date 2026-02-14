use pinyin::ToPinyin;
use slug::slugify;

/// Convert a string (possibly containing CJK characters) into a URL-safe slug.
/// CJK characters are first converted to pinyin syllables, then the result is slugified.
pub fn slugify_cjk(input: &str) -> String {
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
}
