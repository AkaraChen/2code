use crate::i18n::Locale;

const EN_MONTHS: [&str; 12] = [
	"Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

pub fn unix_now_secs() -> i64 {
	std::time::SystemTime::now()
		.duration_since(std::time::UNIX_EPOCH)
		.map(|d| d.as_secs() as i64)
		.unwrap_or(0)
}

pub fn leftover_utc_year(now_secs: i64) -> i32 {
	let mut year = 2026;
	for _ in 0..8 {
		let start = civil_to_unix(year, 1, 1);
		let next = civil_to_unix(year + 1, 1, 1);
		if now_secs >= start && now_secs < next {
			return year;
		}
		if now_secs < start {
			year -= 1;
		} else {
			year += 1;
		}
	}
	year
}

pub fn unix_now_ms() -> i64 {
	std::time::SystemTime::now()
		.duration_since(std::time::UNIX_EPOCH)
		.map(|d| d.as_millis() as i64)
		.unwrap_or(0)
}

pub fn parse_iso8601_secs(raw: &str) -> Option<i64> {
	let s = raw.trim();
	if !s.contains('T') {
		return parse_ymd(s).map(|(y, m, d)| civil_to_unix(y, m, d));
	}
	let (date, time_tz) = s.split_once('T')?;
	let (year, month, day) = parse_ymd(date)?;
	let (time, offset) = if let Some(time) = time_tz.strip_suffix('Z').or_else(|| time_tz.strip_suffix('z')) {
		(time, 0i64)
	} else if let Some(idx) = time_tz.rfind('+') {
		(&time_tz[..idx], parse_tz_offset(&time_tz[idx..])?)
	} else if let Some(rel) = time_tz.find('-').filter(|&i| i >= 8) {
		(&time_tz[..rel], parse_tz_offset(&time_tz[rel..])?)
	} else {
		(time_tz, 0)
	};
	let time = time.split('.').next()?;
	let mut tp = time.split(':');
	let hour: i64 = tp.next()?.parse().ok()?;
	let minute: i64 = tp.next()?.parse().ok()?;
	let second: i64 = tp.next().unwrap_or("0").parse().ok()?;
	Some(civil_to_unix(year, month, day) + hour * 3600 + minute * 60 + second - offset)
}

fn parse_ymd(raw: &str) -> Option<(i32, i32, i32)> {
	let date = raw.get(..10)?;
	if date.as_bytes().get(4) != Some(&b'-') || date.as_bytes().get(7) != Some(&b'-') {
		return None;
	}
	Some((
		date[0..4].parse().ok()?,
		date[5..7].parse().ok()?,
		date[8..10].parse().ok()?,
	))
}

fn parse_tz_offset(raw: &str) -> Option<i64> {
	let (sign, rest) = if let Some(rest) = raw.strip_prefix('+') {
		(1i64, rest)
	} else if let Some(rest) = raw.strip_prefix('-') {
		(-1, rest)
	} else {
		return None;
	};
	let compact = rest.replace(':', "");
	if compact.len() < 2 {
		return None;
	}
	let hours: i64 = compact[..2].parse().ok()?;
	let minutes: i64 = if compact.len() >= 4 {
		compact[2..4].parse().ok()?
	} else {
		0
	};
	Some(sign * (hours * 3600 + minutes * 60))
}

pub fn civil_to_unix(year: i32, month: i32, day: i32) -> i64 {
	let (mut year, mut month) = (year, month);
	if month <= 2 {
		year -= 1;
		month += 9;
	} else {
		month -= 3;
	}
	let era = if year >= 0 { year } else { year - 399 } / 400;
	let yoe = (year - era * 400) as u32;
	let doy = (153 * month as u32 + 2) / 5 + day as u32 - 1;
	let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
	(era as i64 * 146097 + doe as i64 - 719468) * 86400
}

/// Leftover CommitList buckets: `just now`, `Nm ago`, `Nh ago`, `Nd ago`, `Nmo ago`, `Ny ago`.
pub fn format_relative_time(iso: &str, now_secs: i64) -> String {
	let Some(then) = parse_iso8601_secs(iso) else {
		return iso.to_string();
	};
	let diff_sec = now_secs - then;
	if diff_sec < 60 {
		return "just now".into();
	}
	let diff_min = diff_sec / 60;
	if diff_min < 60 {
		return format!("{diff_min}m ago");
	}
	let diff_hr = diff_min / 60;
	if diff_hr < 24 {
		return format!("{diff_hr}h ago");
	}
	let diff_day = diff_hr / 24;
	if diff_day < 30 {
		return format!("{diff_day}d ago");
	}
	let diff_month = diff_day / 30;
	if diff_month < 12 {
		return format!("{diff_month}mo ago");
	}
	format!("{}y ago", diff_month / 12)
}

/// Leftover `getRelativeTimeValue` — signed, future-positive, no week bucket.
fn js_round(value: f64) -> i64 {
	(value + 0.5).floor() as i64
}

pub fn relative_time_value(then_ms: i64, now_ms: i64) -> (i64, &'static str) {
	let diff_seconds = js_round((then_ms - now_ms) as f64 / 1000.0);
	let abs = diff_seconds.unsigned_abs();
	if abs < 60 {
		(diff_seconds, "second")
	} else if abs < 60 * 60 {
		(js_round(diff_seconds as f64 / 60.0), "minute")
	} else if abs < 60 * 60 * 24 {
		(js_round(diff_seconds as f64 / (60.0 * 60.0)), "hour")
	} else if abs < 60 * 60 * 24 * 30 {
		(js_round(diff_seconds as f64 / (60.0 * 60.0 * 24.0)), "day")
	} else if abs < 60 * 60 * 24 * 365 {
		(js_round(diff_seconds as f64 / (60.0 * 60.0 * 24.0 * 30.0)), "month")
	} else {
		(js_round(diff_seconds as f64 / (60.0 * 60.0 * 24.0 * 365.0)), "year")
	}
}

fn format_medium_date(raw: &str, locale: Locale) -> Option<String> {
	let (year, month, day) = parse_ymd(raw)?;
	if !(1..=12).contains(&month) {
		return None;
	}
	Some(match locale {
		Locale::En => format!("{} {}, {year}", EN_MONTHS[(month as usize) - 1], day),
		Locale::Zh => format!("{year}年{month}月{day}日"),
	})
}

fn format_long_relative(value: i64, unit: &str, locale: Locale) -> String {
	if value == 0 {
		return match locale {
			Locale::En => "now".into(),
			Locale::Zh => "现在".into(),
		};
	}
	match (locale, value, unit) {
		(Locale::En, 1, "day") => "tomorrow".into(),
		(Locale::En, -1, "day") => "yesterday".into(),
		(Locale::En, 1, "month") => "next month".into(),
		(Locale::En, -1, "month") => "last month".into(),
		(Locale::En, 1, "year") => "next year".into(),
		(Locale::En, -1, "year") => "last year".into(),
		(Locale::Zh, 1, "day") => "明天".into(),
		(Locale::Zh, -1, "day") => "昨天".into(),
		(Locale::Zh, 1, "month") => "下个月".into(),
		(Locale::Zh, -1, "month") => "上个月".into(),
		(Locale::Zh, 1, "year") => "明年".into(),
		(Locale::Zh, -1, "year") => "去年".into(),
		(Locale::En, n, unit) => {
			let abs = n.unsigned_abs();
			let word = if abs == 1 { unit.to_string() } else { format!("{unit}s") };
			if n > 0 {
				format!("in {abs} {word}")
			} else {
				format!("{abs} {word} ago")
			}
		}
		(Locale::Zh, n, unit) => {
			let abs = n.unsigned_abs();
			let word = match unit {
				"second" => "秒",
				"minute" => "分钟",
				"hour" => "小时",
				"day" => "天",
				"month" => "个月",
				_ => "年",
			};
			if n > 0 {
				format!("{abs}{word}后")
			} else {
				format!("{abs}{word}前")
			}
		}
	}
}

/// Leftover About `formatReleaseDate`: medium date + long relative, e.g. `May 15, 2026 (in 2 months)`.
pub fn format_release_date_display(raw: &str, locale: Locale) -> String {
	format_release_date_at(raw, locale, unix_now_ms())
}

pub fn format_release_date_at(raw: &str, locale: Locale, now_ms: i64) -> String {
	if raw.trim().is_empty() {
		return raw.to_string();
	}
	let Some(then) = parse_iso8601_secs(raw) else {
		return raw.to_string();
	};
	let absolute = format_medium_date(raw, locale).unwrap_or_else(|| raw.to_string());
	let (value, unit) = relative_time_value(then * 1000, now_ms);
	format!("{absolute} ({})", format_long_relative(value, unit, locale))
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn format_relative_time_matches_leftover_commit_list() {
		let then = parse_iso8601_secs("2026-04-09T12:00:00Z").unwrap();
		assert_eq!(format_relative_time("2026-04-09T12:00:00Z", then + 30), "just now");
		assert_eq!(format_relative_time("2026-04-09T12:00:00Z", then + 5 * 60), "5m ago");
		assert_eq!(format_relative_time("2026-04-09T12:00:00Z", then + 3 * 3600), "3h ago");
		assert_eq!(format_relative_time("2026-04-09T12:00:00Z", then + 2 * 86400), "2d ago");
		assert_eq!(
			format_relative_time("2026-04-09T12:00:00Z", then + 30 * 86400),
			"1mo ago"
		);
		assert_eq!(
			format_relative_time("2026-04-09T12:00:00Z", then + 400 * 86400),
			"1y ago"
		);
	}

	#[test]
	fn parse_iso8601_respects_timezone_offset() {
		let utc = parse_iso8601_secs("2026-04-09T12:00:00Z").unwrap();
		let plus8 = parse_iso8601_secs("2026-04-09T20:00:00+08:00").unwrap();
		assert_eq!(utc, plus8);
		assert_eq!(utc, civil_to_unix(2026, 4, 9) + 12 * 3600);
	}

	#[test]
	fn format_relative_time_falls_back_to_raw_date() {
		assert_eq!(format_relative_time("not-a-date", 0), "not-a-date");
	}

	#[test]
	fn leftover_release_date_uses_medium_and_long_relative() {
		let now = parse_iso8601_secs("2026-05-15T00:00:00Z").unwrap() * 1000;
		assert_eq!(
			format_release_date_at("2026-05-15T00:00:00Z", Locale::En, now + 30_000),
			"May 15, 2026 (30 seconds ago)"
		);
		assert_eq!(
			format_release_date_at("2026-05-15T00:00:00Z", Locale::En, now - 90_000),
			"May 15, 2026 (in 2 minutes)"
		);
		assert_eq!(
			format_release_date_at("2026-07-15T00:00:00Z", Locale::En, now),
			"Jul 15, 2026 (in 2 months)"
		);
		assert_eq!(
			format_release_date_at("2026-05-15T00:00:00Z", Locale::Zh, now + 90_000),
			"2026年5月15日 (1分钟前)"
		);
		assert_eq!(format_release_date_at("not-a-date", Locale::En, now), "not-a-date");
	}

	#[test]
	fn leftover_utc_year_matches_inventory() {
		assert_eq!(leftover_utc_year(civil_to_unix(2026, 9, 3)), 2026);
		assert_eq!(leftover_utc_year(civil_to_unix(2027, 1, 1)), 2027);
	}

	#[test]
	fn leftover_relative_time_value_buckets() {
		let now = parse_iso8601_secs("2026-05-15T00:00:00Z").unwrap() * 1000;
		assert_eq!(relative_time_value(now + 30_000, now), (30, "second"));
		assert_eq!(relative_time_value(now - 90_000, now), (-1, "minute"));
	}
}
