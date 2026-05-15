import { describe, expect, it } from "vitest";
import {
	removeTemplateDraft,
	updateTemplateDraft,
} from "./templateDraftList";

const templates = [
	{ id: "a", name: "A" },
	{ id: "b", name: "B" },
	{ id: "c", name: "C" },
];

describe("template draft list updates", () => {
	it("updates a template at an index", () => {
		expect(updateTemplateDraft(templates, 1, { name: "Updated" })).toEqual([
			templates[0],
			{ id: "b", name: "Updated" },
			templates[2],
		]);
	});

	it("returns a copied array for an invalid update index", () => {
		const result = updateTemplateDraft(templates, 99, { name: "Updated" });
		expect(result).toEqual(templates);
		expect(result).not.toBe(templates);
	});

	it("removes a template at an index", () => {
		expect(removeTemplateDraft(templates, 1)).toEqual([
			templates[0],
			templates[2],
		]);
	});

	it("returns a copied array for an invalid remove index", () => {
		const result = removeTemplateDraft(templates, -1);
		expect(result).toEqual(templates);
		expect(result).not.toBe(templates);
	});
});
