import { useSyncExternalStore } from "react";
import {
	baseLocale,
	getLocale as getRuntimeLocale,
	isLocale,
	localStorageKey,
	overwriteGetLocale,
	overwriteSetLocale,
} from "@/paraglide/runtime.js";
import type { Locale } from "@/paraglide/runtime.js";

const originalGetLocale = getRuntimeLocale;
const listeners = new Set<() => void>();

function notifyLocaleChange() {
	for (const listener of listeners) listener();
}

function readStoredLocale(): Locale | undefined {
	if (typeof window === "undefined") return undefined;
	const locale = window.localStorage.getItem(localStorageKey);
	return isLocale(locale) ? locale : undefined;
}

function writeStoredLocale(locale: Locale) {
	if (typeof window === "undefined") return;
	window.localStorage.setItem(localStorageKey, locale);
}

function resolveInitialLocale(): Locale {
	const storedLocale = readStoredLocale();
	if (storedLocale) return storedLocale;

	try {
		return originalGetLocale();
	} catch {
		return baseLocale;
	}
}

let currentLocale = resolveInitialLocale();

function applyLocale(locale: Locale) {
	writeStoredLocale(locale);

	if (locale === currentLocale) return;

	currentLocale = locale;
	notifyLocaleChange();
}

overwriteGetLocale(() => currentLocale);
overwriteSetLocale((newLocale) => {
	// Desktop locale changes should update in place instead of reloading.
	applyLocale(newLocale);
});

applyLocale(currentLocale);

function subscribe(listener: () => void) {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

function getSnapshot() {
	return currentLocale;
}

export function useLocale() {
	return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function setAppLocale(locale: Locale) {
	applyLocale(locale);
}

export function getAppLocale() {
	return currentLocale;
}
