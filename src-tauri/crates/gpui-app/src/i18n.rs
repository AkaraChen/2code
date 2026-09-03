//! Tiny locale table for the native shell. Source strings stay aligned with
//! `messages/en.json` / `messages/zh.json` for the surfaces that already exist.

pub fn is_zh(locale: &str) -> bool {
	locale.eq_ignore_ascii_case("zh") || locale.starts_with("zh-")
}

pub fn t<'a>(locale: &str, en: &'a str, zh: &'a str) -> &'a str {
	if is_zh(locale) { zh } else { en }
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn chinese_locales_select_zh_copy() {
		assert!(is_zh("zh"));
		assert!(is_zh("zh-CN"));
		assert!(!is_zh("en"));
		assert_eq!(t("zh", "Home", "主页"), "主页");
		assert_eq!(t("en", "Home", "主页"), "Home");
	}
}
