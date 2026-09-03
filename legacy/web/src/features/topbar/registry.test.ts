import { describe, expect, it } from "vitest";
import { appControlIds, staticControlIds } from "./types";
import {
	allControlIds,
	controlRegistry,
	getSupportedControlIds,
} from "./registry";

describe("topbar registry", () => {
	it("registers every declared control id exactly once", () => {
		expect(allControlIds).toEqual([...appControlIds, ...staticControlIds]);
		expect(new Set(allControlIds).size).toBe(allControlIds.length);
		expect(controlRegistry.size).toBe(allControlIds.length);
	});

	it("stores definitions with labels and renderable components for every id", () => {
		for (const id of allControlIds) {
			const definition = controlRegistry.get(id);
			expect(definition?.id).toBe(id);
			expect(definition?.label()).toBeTruthy();
			expect(definition?.component).toBeTypeOf("function");
			expect(definition?.icon).toBeTruthy();
		}
	});

	it("maps installed apps to generic controls while keeping static controls", () => {
		expect(getSupportedControlIds(["cursor", "warp"])).toEqual([
			"editor",
			"terminal",
			"pr-status",
		]);
		expect(getSupportedControlIds(["github-desktop"])).toEqual([
			"github-desktop",
			"pr-status",
		]);
		expect(getSupportedControlIds([])).toEqual(["pr-status"]);
	});
});
