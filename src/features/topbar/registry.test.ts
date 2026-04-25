import { describe, expect, it } from "vitest";
import { staticControlIds } from "./types";
import {
	allControlIds,
	controlRegistry,
	getSupportedControlIds,
} from "./registry";

describe("topbar registry", () => {
	it("registers every declared static control exactly once", () => {
		expect(allControlIds).toEqual([...staticControlIds]);
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

	it("returns all static controls as supported", () => {
		expect(getSupportedControlIds()).toEqual([
			"open-with",
			"reveal-in-finder",
		]);
	});
});
