import { describe, expect, it } from "vitest";
import type { GlobalTerminalTemplate } from "@/features/terminal/templates";
import {
	removeGlobalTerminalTemplate,
	replaceGlobalTerminalTemplate,
} from "./globalTerminalTemplateList";

const templates: GlobalTerminalTemplate[] = [
	{ id: "a", name: "A", commands: ["a"] },
	{ id: "b", name: "B", commands: ["b"] },
	{ id: "c", name: "C", commands: ["c"] },
];

describe("global terminal template list updates", () => {
	it("replaces a template by id", () => {
		const replacement = { id: "b", name: "Updated", commands: ["dev"] };
		expect(
			replaceGlobalTerminalTemplate(templates, "b", replacement),
		).toEqual([templates[0], replacement, templates[2]]);
	});

	it("returns a copied array when replacement id is missing", () => {
		const result = replaceGlobalTerminalTemplate(templates, "x", {
			id: "x",
			name: "X",
			commands: [],
		});
		expect(result).toEqual(templates);
		expect(result).not.toBe(templates);
	});

	it("removes a template by id", () => {
		expect(removeGlobalTerminalTemplate(templates, "b")).toEqual([
			templates[0],
			templates[2],
		]);
	});

	it("returns a copied array when removal id is missing", () => {
		const result = removeGlobalTerminalTemplate(templates, "x");
		expect(result).toEqual(templates);
		expect(result).not.toBe(templates);
	});
});
