use std::collections::HashMap;
use std::sync::OnceLock;

use serde::Deserialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Locale {
	#[default]
	En,
	Zh,
}

impl Locale {
	pub fn as_code(self) -> &'static str {
		match self {
			Self::En => "en",
			Self::Zh => "zh",
		}
	}

	pub fn from_code(code: &str) -> Self {
		if code.starts_with("zh") {
			Self::Zh
		} else {
			Self::En
		}
	}
}

fn table(locale: Locale) -> &'static HashMap<String, String> {
	fn parse(raw: &str) -> HashMap<String, String> {
		#[derive(Deserialize)]
		struct Loose(HashMap<String, serde_json::Value>);
		let Loose(map) = serde_json::from_str(raw).unwrap_or_else(|_| Loose(HashMap::new()));
		map.into_iter()
			.filter_map(|(k, v)| v.as_str().map(|s| (k, s.to_string())))
			.collect()
	}

	match locale {
		Locale::En => {
			static EN: OnceLock<HashMap<String, String>> = OnceLock::new();
			EN.get_or_init(|| parse(include_str!("../../messages/en.json")))
		}
		Locale::Zh => {
			static ZH: OnceLock<HashMap<String, String>> = OnceLock::new();
			ZH.get_or_init(|| parse(include_str!("../../messages/zh.json")))
		}
	}
}

pub fn t(locale: Locale, key: &str) -> String {
	table(locale)
		.get(key)
		.cloned()
		.or_else(|| table(Locale::En).get(key).cloned())
		.unwrap_or_else(|| key.to_string())
}

pub fn tf(locale: Locale, key: &str, pairs: &[(&str, &str)]) -> String {
	let mut s = t(locale, key);
	for (k, v) in pairs {
		s = s.replace(&format!("{{{k}}}"), v);
	}
	s
}
