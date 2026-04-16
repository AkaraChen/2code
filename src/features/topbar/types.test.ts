import { describe, expect, it } from "vitest";
import {
	isLaunchAppControlId,
	launchAppControlIds,
	staticControlIds,
} from "./types";

describe("topbar types", () => {
	it("accepts every launch-app control id", () => {
		for (const id of launchAppControlIds) {
			expect(isLaunchAppControlId(id)).toBe(true);
		}
	});

	it("rejects static controls and unknown ids", () => {
		for (const id of staticControlIds) {
			expect(isLaunchAppControlId(id)).toBe(false);
		}
		expect(isLaunchAppControlId("unknown-app")).toBe(false);
	});
});
