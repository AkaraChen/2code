import { describe, expect, it } from "vitest";
import type { ProjectTerminalTemplateDraft } from "@/features/terminal/templates";
import {
	removeProjectTemplateDraft,
	replaceProjectTemplateDraft,
} from "./projectTemplateDraftList";

const drafts: ProjectTerminalTemplateDraft[] = [
	{ id: "a", name: "A", commandsText: "a", cwd: "" },
	{ id: "b", name: "B", commandsText: "b", cwd: "apps/web" },
	{ id: "c", name: "C", commandsText: "c", cwd: "" },
];

describe("project template draft list updates", () => {
	it("replaces a draft by id", () => {
		const replacement = {
			id: "b",
			name: "Updated",
			commandsText: "dev",
			cwd: "apps/api",
		};
		expect(replaceProjectTemplateDraft(drafts, "b", replacement)).toEqual([
			drafts[0],
			replacement,
			drafts[2],
		]);
	});

	it("returns a copied array when replacement id is missing", () => {
		const result = replaceProjectTemplateDraft(drafts, "x", {
			id: "x",
			name: "X",
			commandsText: "",
			cwd: "",
		});
		expect(result).toEqual(drafts);
		expect(result).not.toBe(drafts);
	});

	it("removes a draft by id", () => {
		expect(removeProjectTemplateDraft(drafts, "b")).toEqual([
			drafts[0],
			drafts[2],
		]);
	});

	it("returns a copied array when removal id is missing", () => {
		const result = removeProjectTemplateDraft(drafts, "x");
		expect(result).toEqual(drafts);
		expect(result).not.toBe(drafts);
	});
});
