import type { Mock } from "vitest";
import { beforeEach, describe, expect, it } from "vitest";
import { setPerformanceProfileEnabled } from "@/generated";
import { usePerformanceProfileStore } from "./performanceProfileStore";

const setPerformanceProfileEnabledMock =
	setPerformanceProfileEnabled as unknown as Mock;

function resetStore() {
	usePerformanceProfileStore.setState({ enabled: false });
	setPerformanceProfileEnabledMock.mockClear();
}

describe("usePerformanceProfileStore", () => {
	beforeEach(resetStore);

	it("starts backend profiling when enabled", () => {
		usePerformanceProfileStore.getState().setEnabled(true);

		expect(setPerformanceProfileEnabled).toHaveBeenCalledWith({
			enabled: true,
		});
	});
});
