import { beforeEach, describe, expect, it, vi } from "vitest";

describe("locale", () => {
	beforeEach(() => {
		vi.resetModules();
		localStorage.clear();
	});

	it("initializes locale from localStorage", async () => {
		localStorage.setItem("PARAGLIDE_LOCALE", "zh");

		const { getAppLocale } = await import("./locale");

		expect(getAppLocale()).toBe("zh");
	});

	it("persists locale changes synchronously", async () => {
		const locale = await import("./locale");
		const runtime = await import("@/paraglide/runtime.js");

		locale.setAppLocale("zh");

		expect(locale.getAppLocale()).toBe("zh");
		expect(runtime.getLocale()).toBe("zh");
		expect(localStorage.getItem(runtime.localStorageKey)).toBe("zh");
	});

	it("overrides runtime setLocale without reloading", async () => {
		const locale = await import("./locale");
		const runtime = await import("@/paraglide/runtime.js");

		runtime.setLocale("zh");

		expect(locale.getAppLocale()).toBe("zh");
		expect(runtime.getLocale()).toBe("zh");
	});
});
