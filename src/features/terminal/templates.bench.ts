import { bench, describe } from "vitest";
import type {
	GlobalTerminalTemplateDraft,
	ProjectTerminalTemplateDraft,
} from "./templates";
import {
	normalizeGlobalTerminalTemplates,
	normalizeProjectTerminalTemplates,
	textToCommands,
} from "./templates";

const globalDrafts: GlobalTerminalTemplateDraft[] = Array.from(
	{ length: 10_000 },
	(_, index) => ({
		id: `global-${index}`,
		name: index % 4 === 0 ? "  " : ` Template ${index} `,
		commandsText:
			index % 5 === 0 ? " \n " : ` bun task:${index}\n bun test:${index} `,
	}),
);
const projectDrafts: ProjectTerminalTemplateDraft[] = globalDrafts.map(
	(draft, index) => ({
		...draft,
		id: `project-${index}`,
		cwd: ` packages/app-${index} `,
	}),
);
let sink = 0;

function normalizeGlobalTerminalTemplatesWithMapFilter(
	drafts: GlobalTerminalTemplateDraft[],
) {
	return drafts
		.map((draft) => ({
			id: draft.id || crypto.randomUUID(),
			name: draft.name.trim(),
			commands: textToCommands(draft.commandsText),
		}))
		.filter((template) => template.name && template.commands.length > 0);
}

function normalizeProjectTerminalTemplatesWithMapFilter(
	drafts: ProjectTerminalTemplateDraft[],
) {
	return drafts
		.map((draft) => ({
			id: draft.id || crypto.randomUUID(),
			name: draft.name.trim(),
			cwd: draft.cwd.trim(),
			commands: textToCommands(draft.commandsText),
		}))
		.filter((template) => template.name && template.commands.length > 0);
}

describe("terminal template normalization", () => {
	bench("global map/filter normalization", () => {
		const templates =
			normalizeGlobalTerminalTemplatesWithMapFilter(globalDrafts);
		sink = templates.length;
		if (sink === Number.NEGATIVE_INFINITY) throw new Error("unreachable");
	});

	bench("global single-pass normalization", () => {
		const templates = normalizeGlobalTerminalTemplates(globalDrafts);
		sink = templates.length;
		if (sink === Number.NEGATIVE_INFINITY) throw new Error("unreachable");
	});

	bench("project map/filter normalization", () => {
		const templates =
			normalizeProjectTerminalTemplatesWithMapFilter(projectDrafts);
		sink = templates.length;
		if (sink === Number.NEGATIVE_INFINITY) throw new Error("unreachable");
	});

	bench("project single-pass normalization", () => {
		const templates = normalizeProjectTerminalTemplates(projectDrafts);
		sink = templates.length;
		if (sink === Number.NEGATIVE_INFINITY) throw new Error("unreachable");
	});
});
