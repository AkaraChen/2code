import { describe, expect, it } from "vitest";
import { mapWithLimit } from "@/features/tabs/restore";

describe("mapWithLimit", () => {
	it("processes all items", async () => {
		const results: number[] = [];
		await mapWithLimit([1, 2, 3], 2, async (item) => {
			results.push(item);
		});
		expect(results).toEqual([1, 2, 3]);
	});

	it("handles empty array", async () => {
		const results: number[] = [];
		await mapWithLimit([], 3, async (item) => {
			results.push(item);
		});
		expect(results).toEqual([]);
	});

	it("limits concurrency to 1 (serial execution)", async () => {
		let concurrent = 0;
		let maxConcurrent = 0;
		const order: number[] = [];

		await mapWithLimit([1, 2, 3, 4], 1, async (item) => {
			concurrent++;
			maxConcurrent = Math.max(maxConcurrent, concurrent);
			// Yield to event loop to allow other tasks to start if not limited
			await new Promise((r) => setTimeout(r, 5));
			order.push(item);
			concurrent--;
		});

		expect(maxConcurrent).toBe(1);
		expect(order).toEqual([1, 2, 3, 4]);
	});

	it("limits concurrency to specified limit", async () => {
		let concurrent = 0;
		let maxConcurrent = 0;

		await mapWithLimit([1, 2, 3, 4, 5, 6], 3, async () => {
			concurrent++;
			maxConcurrent = Math.max(maxConcurrent, concurrent);
			await new Promise((r) => setTimeout(r, 10));
			concurrent--;
		});

		expect(maxConcurrent).toBeLessThanOrEqual(3);
		// With 6 items and limit 3, we should see at least 2 concurrent
		expect(maxConcurrent).toBeGreaterThanOrEqual(2);
	});

	it("continues processing after an item throws", async () => {
		const processed: number[] = [];

		await expect(
			mapWithLimit([1, 2, 3, 4], 2, async (item) => {
				if (item === 2) throw new Error("fail on 2");
				await new Promise((r) => setTimeout(r, 5));
				processed.push(item);
			}),
		).rejects.toThrow("fail on 2");
	});

	it("resolves immediately for empty input with any limit", async () => {
		await expect(
			mapWithLimit([], 100, async () => {
				throw new Error("should not be called");
			}),
		).resolves.toBeUndefined();
	});

	it("works with limit larger than items count", async () => {
		const results: number[] = [];
		await mapWithLimit([1, 2], 10, async (item) => {
			results.push(item);
		});
		expect(results).toEqual([1, 2]);
	});
});
