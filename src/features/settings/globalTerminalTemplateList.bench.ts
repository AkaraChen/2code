import { bench, describe } from "vitest";
import type { GlobalTerminalTemplate } from "@/features/terminal/templates";
import {
	removeGlobalTerminalTemplate,
	replaceGlobalTerminalTemplate,
} from "./globalTerminalTemplateList";

const templates: GlobalTerminalTemplate[] = Array.from(
	{ length: 2_000 },
	(_, index) => ({
		id: `template-${index}`,
		name: `Template ${index}`,
		commands: [`echo ${index}`],
	}),
);

const targetId = "template-1500";
const replacement: GlobalTerminalTemplate = {
	id: targetId,
	name: "Updated",
	commands: ["bun run dev"],
};

function replaceWithMap() {
	return templates.map((template) =>
		template.id === targetId ? replacement : template,
	);
}

function removeWithFilter() {
	return templates.filter((template) => template.id !== targetId);
}

describe("global terminal template list updates", () => {
	bench("map replace by id", () => {
		replaceWithMap();
	});

	bench("findIndex replace by id", () => {
		replaceGlobalTerminalTemplate(templates, targetId, replacement);
	});

	bench("filter remove by id", () => {
		removeWithFilter();
	});

	bench("findIndex splice remove by id", () => {
		removeGlobalTerminalTemplate(templates, targetId);
	});
});
