import type { Mock } from "vitest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setPerformanceProfileEnabled } from "@/generated";
import { usePerformanceProfileStore } from "./performanceProfileStore";

const setPerformanceProfileEnabledMock =
	setPerformanceProfileEnabled as unknown as Mock;

async function resetStore() {
	usePerformanceProfileStore.setState({ enabled: false });
	await new Promise((resolve) => setTimeout(resolve, 0));
	setPerformanceProfileEnabledMock.mockClear();
}

describe("usePerformanceProfileStore", () => {
	beforeEach(resetStore);

	it("starts backend profiling when enabled", async () => {
		usePerformanceProfileStore.getState().setEnabled(true);

		await vi.waitFor(() => {
			expect(setPerformanceProfileEnabled).toHaveBeenCalledWith({
				enabled: true,
			});
		});
	});

	it("does not persist profiling across app restarts", async () => {
		usePerformanceProfileStore.getState().setEnabled(true);
		await resetStore();

		expect(usePerformanceProfileStore.getState().enabled).toBe(false);
		expect(setPerformanceProfileEnabled).not.toHaveBeenCalled();
	});

	it("serializes backend profiling changes", async () => {
		usePerformanceProfileStore.getState().setEnabled(true);
		usePerformanceProfileStore.getState().setEnabled(false);

		await vi.waitFor(() => {
			expect(setPerformanceProfileEnabled).toHaveBeenCalledTimes(2);
		});
		expect(setPerformanceProfileEnabled).toHaveBeenCalledWith({
			enabled: true,
		});
		expect(setPerformanceProfileEnabled).toHaveBeenLastCalledWith({
			enabled: false,
		});
	});
});
