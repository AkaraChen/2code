import { beforeEach, describe, expect, it } from "vitest";
import type { GlobalTerminalTemplate } from "@/features/terminal/templates";
import {
	migrateTerminalTemplatesState,
	useTerminalTemplatesStore,
} from "./terminalTemplatesStore";

const exampleTemplate: GlobalTerminalTemplate = {
	id: "template-1",
	name: "Dev Server",
	commands: ["bun run dev"],
};

function resetStore() {
	useTerminalTemplatesStore.setState({ templates: [] });
}

describe("migrateTerminalTemplatesState", () => {
	it("falls back to an empty list when persisted state is missing", () => {
		expect(migrateTerminalTemplatesState(undefined)).toEqual({
			templates: [],
		});
	});

	it("keeps valid templates from persisted state", () => {
		expect(
			migrateTerminalTemplatesState({
				templates: [exampleTemplate, { invalid: true }],
			}),
		).toEqual({
			templates: [exampleTemplate],
		});
	});
});

describe("useTerminalTemplatesStore", () => {
	beforeEach(resetStore);

	it("defaults to an empty template list", () => {
		expect(useTerminalTemplatesStore.getState().templates).toEqual([]);
	});

	it("updates templates via setTemplates", () => {
		useTerminalTemplatesStore.getState().setTemplates([exampleTemplate]);
		expect(useTerminalTemplatesStore.getState().templates).toEqual([
			exampleTemplate,
		]);
	});
});
