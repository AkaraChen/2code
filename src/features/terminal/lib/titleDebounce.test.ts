import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TitleDebouncer } from "./titleDebounce";

describe("title debouncer", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("updates value immediately but defers notification by 75ms", () => {
		const debouncer = new TitleDebouncer();
		const flushes: Array<string | null> = [];
		debouncer.subscribe(() => flushes.push(debouncer.value));

		debouncer.set("a");
		expect(debouncer.value).toBe("a");
		expect(flushes).toEqual([]);

		vi.advanceTimersByTime(75);

		expect(flushes).toEqual(["a"]);
		debouncer.dispose();
	});

	it("ignores identical titles", () => {
		const debouncer = new TitleDebouncer();
		const listener = vi.fn();
		debouncer.subscribe(listener);

		debouncer.set("a");
		vi.advanceTimersByTime(75);
		debouncer.set("a");
		vi.advanceTimersByTime(200);

		expect(listener).toHaveBeenCalledTimes(1);
		debouncer.dispose();
	});

	it("flushes on a fixed cadence under sustained distinct title churn", () => {
		const debouncer = new TitleDebouncer();
		const flushes: Array<string | null> = [];
		debouncer.subscribe(() => flushes.push(debouncer.value));

		for (let i = 0; i < 20; i++) {
			debouncer.set(`title-${i}`);
			vi.advanceTimersByTime(50);
		}

		expect(flushes).toHaveLength(10);
		expect(flushes[0]).toBe("title-1");
		expect(flushes[flushes.length - 1]).toBe("title-19");
		debouncer.dispose();
	});

	it("dispose cancels a pending flush", () => {
		const debouncer = new TitleDebouncer();
		const listener = vi.fn();
		debouncer.subscribe(listener);

		debouncer.set("a");
		debouncer.dispose();
		vi.advanceTimersByTime(200);

		expect(listener).not.toHaveBeenCalled();
	});
});
