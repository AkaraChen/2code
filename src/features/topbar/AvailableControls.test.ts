import { describe, expect, it } from "vitest";
import { getAvailableControlIds } from "./AvailableControls";
import type { ControlId } from "./types";

describe("getAvailableControlIds", () => {
	it("returns supported controls that are not active", () => {
		expect(
			getAvailableControlIds(
				["github-desktop", "git-diff"] as ControlId[],
				["pr-status", "git-diff", "reveal-in-finder"] as ControlId[],
			),
		).toEqual(["pr-status", "reveal-in-finder"]);
	});

	it("preserves supported control order", () => {
		expect(
			getAvailableControlIds(
				["git-diff"] as ControlId[],
				["pr-status", "git-diff", "reveal-in-finder"] as ControlId[],
			),
		).toEqual(["pr-status", "reveal-in-finder"]);
	});
});
