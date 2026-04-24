import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { invalidateQueriesMock, watchProjectsMock } = vi.hoisted(() => ({
	invalidateQueriesMock: vi.fn(),
	watchProjectsMock: vi.fn(),
}));

vi.mock("@/generated", () => ({
	watchProjects: watchProjectsMock,
}));

vi.mock("@/shared/lib/queryClient", () => ({
	queryClient: {
		invalidateQueries: invalidateQueriesMock,
	},
}));

async function loadWatcher() {
	await import("./fileWatcher");
	const [{ onEvent }] = watchProjectsMock.mock.calls.map((args) => args[0]);
	return onEvent as { onmessage: (() => void) | null };
}

describe("fileWatcher", () => {
	beforeEach(() => {
		vi.resetModules();
		vi.useFakeTimers();
		invalidateQueriesMock.mockClear();
		watchProjectsMock.mockClear();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("starts watching projects as soon as the module loads", async () => {
		const channel = await loadWatcher();

		expect(watchProjectsMock).toHaveBeenCalledTimes(1);
		expect(channel.onmessage).toBeTypeOf("function");
	});

	it("debounces bursts of file events into a single invalidation batch", async () => {
		const channel = await loadWatcher();

		channel.onmessage?.();
		channel.onmessage?.();
		vi.advanceTimersByTime(999);
		expect(invalidateQueriesMock).not.toHaveBeenCalled();

		vi.advanceTimersByTime(1);
		expect(invalidateQueriesMock.mock.calls).toEqual([
			[
				{
					queryKey: ["git-diff"],
					exact: false,
				},
			],
			[
				{
					queryKey: ["git-diff-stats"],
					exact: false,
				},
			],
			[
				{
					queryKey: ["git-status"],
					exact: false,
				},
			],
			[
				{
					queryKey: ["git-log"],
					exact: false,
				},
			],
			[
				{
					queryKey: ["fs-tree"],
					exact: false,
				},
			],
		]);
	});

	it("resets the debounce timer when another event arrives before the flush", async () => {
		const channel = await loadWatcher();

		channel.onmessage?.();
		vi.advanceTimersByTime(500);
		channel.onmessage?.();
		vi.advanceTimersByTime(999);
		expect(invalidateQueriesMock).not.toHaveBeenCalled();

		vi.advanceTimersByTime(1);
		expect(invalidateQueriesMock).toHaveBeenCalledTimes(5);
	});
});
