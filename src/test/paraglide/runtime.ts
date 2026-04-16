export type Locale = "en" | "zh";

export const baseLocale: Locale = "en";
export const localStorageKey = "PARAGLIDE_LOCALE";

let currentLocale: Locale = baseLocale;
let getLocaleImpl = () => currentLocale;
let setLocaleImpl = (locale: Locale) => {
	currentLocale = locale;
};

export function isLocale(locale: string | null | undefined): locale is Locale {
	return locale === "en" || locale === "zh";
}

export function getLocale() {
	return getLocaleImpl();
}

export function setLocale(locale: Locale) {
	setLocaleImpl(locale);
}

export function overwriteGetLocale(fn: typeof getLocaleImpl) {
	getLocaleImpl = fn;
}

export function overwriteSetLocale(fn: typeof setLocaleImpl) {
	setLocaleImpl = fn;
}
