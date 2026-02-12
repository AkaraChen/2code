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
