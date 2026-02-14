import { describe, expect, it, vi } from "vitest";
import { createCachedPromise } from "./cachedPromise";

describe("createCachedPromise", () => {
	it("returns the same promise on subsequent calls", () => {
		const getter = createCachedPromise(() => Promise.resolve(42));
		const p1 = getter();
		const p2 = getter();
		expect(p1).toBe(p2);
	});

	it("calls the factory function only once", () => {
		const factory = vi.fn(() => Promise.resolve("data"));
		const getter = createCachedPromise(factory);
		getter();
		getter();
		getter();
		expect(factory).toHaveBeenCalledTimes(1);
	});

	it("resolves with the factory return value", async () => {
		const getter = createCachedPromise(() => Promise.resolve(42));
		await expect(getter()).resolves.toBe(42);
	});

	it("caches a rejected promise (does not retry)", async () => {
		const error = new Error("fail");
		const getter = createCachedPromise(() => Promise.reject(error));
		const p1 = getter();
		const p2 = getter();
		expect(p1).toBe(p2);
		await expect(p1).rejects.toThrow("fail");
	});

	it("works with async factory functions", async () => {
		const getter = createCachedPromise(async () => {
			await new Promise((r) => setTimeout(r, 10));
			return "async-data";
		});
		const [r1, r2] = await Promise.all([getter(), getter()]);
		expect(r1).toBe("async-data");
		expect(r2).toBe("async-data");
	});
});
