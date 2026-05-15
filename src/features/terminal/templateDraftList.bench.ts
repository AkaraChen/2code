import { bench, describe } from "vitest";
import {
	removeTemplateDraft,
	updateTemplateDraft,
} from "./templateDraftList";

interface Draft {
	id: string;
	name: string;
	commandsText: string;
}

const templates: Draft[] = Array.from({ length: 2_000 }, (_, index) => ({
	id: `template-${index}`,
	name: `Template ${index}`,
	commandsText: `echo ${index}`,
}));

const updateIndex = 1_500;
const removeIndex = 1_500;

function updateWithMap() {
	return templates.map((template, templateIndex) =>
		templateIndex === updateIndex
			? { ...template, name: "Updated" }
			: template,
	);
}

function removeWithFilter() {
	return templates.filter((_, templateIndex) => templateIndex !== removeIndex);
}

describe("template draft list updates", () => {
	bench("map update by index", () => {
		updateWithMap();
	});

	bench("slice update by index", () => {
		updateTemplateDraft(templates, updateIndex, { name: "Updated" });
	});

	bench("filter remove by index", () => {
		removeWithFilter();
	});

	bench("splice remove by index", () => {
		removeTemplateDraft(templates, removeIndex);
	});
});
