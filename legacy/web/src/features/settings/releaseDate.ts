type RelativeTimeUnit =
	| "second"
	| "minute"
	| "hour"
	| "day"
	| "month"
	| "year";

interface ReleaseDateFormatters {
	absoluteDate: Intl.DateTimeFormat;
	relativeTime: Intl.RelativeTimeFormat;
}

const formatterCache = new Map<string, ReleaseDateFormatters>();

function getReleaseDateFormatters(locale: string) {
	const cached = formatterCache.get(locale);
	if (cached) return cached;

	const formatters = {
		absoluteDate: new Intl.DateTimeFormat(locale, {
			dateStyle: "medium",
		}),
		relativeTime: new Intl.RelativeTimeFormat(locale, {
			numeric: "auto",
			style: "long",
		}),
	};
	formatterCache.set(locale, formatters);
	return formatters;
}

export function getRelativeTimeValue(
	date: Date,
	now = Date.now(),
): { value: number; unit: RelativeTimeUnit } {
	const diffSeconds = Math.round((date.getTime() - now) / 1000);
	const absSeconds = Math.abs(diffSeconds);

	if (absSeconds < 60) {
		return { value: diffSeconds, unit: "second" };
	}
	if (absSeconds < 60 * 60) {
		return { value: Math.round(diffSeconds / 60), unit: "minute" };
	}
	if (absSeconds < 60 * 60 * 24) {
		return { value: Math.round(diffSeconds / (60 * 60)), unit: "hour" };
	}
	if (absSeconds < 60 * 60 * 24 * 30) {
		return {
			value: Math.round(diffSeconds / (60 * 60 * 24)),
			unit: "day",
		};
	}
	if (absSeconds < 60 * 60 * 24 * 365) {
		return {
			value: Math.round(diffSeconds / (60 * 60 * 24 * 30)),
			unit: "month",
		};
	}
	return {
		value: Math.round(diffSeconds / (60 * 60 * 24 * 365)),
		unit: "year",
	};
}

export function formatReleaseDate(
	date: string | null | undefined,
	locale: string,
) {
	if (!date) {
		return null;
	}

	const parsed = new Date(date);
	if (Number.isNaN(parsed.getTime())) {
		return date;
	}

	const { absoluteDate, relativeTime } = getReleaseDateFormatters(locale);
	const absoluteDateText = absoluteDate.format(parsed);
	const relativeTimeValue = getRelativeTimeValue(parsed);
	const relativeTimeText = relativeTime.format(
		relativeTimeValue.value,
		relativeTimeValue.unit,
	);

	return `${absoluteDateText} (${relativeTimeText})`;
}
