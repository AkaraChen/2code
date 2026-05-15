import { bench, describe } from "vitest";
import type { ProjectTerminalTemplateDraft } from "@/features/terminal/templates";
import {
	removeProjectTemplateDraft,
	replaceProjectTemplateDraft,
} from "./projectTemplateDraftList";

const drafts: ProjectTerminalTemplateDraft[] = Array.from(
	{ length: 2_000 },
	(_, index) => ({
		id: `template-${index}`,
		name: `Template ${index}`,
		commandsText: `echo ${index}`,
		cwd: `packages/app-${index}`,
	}),
);

const targetId = "template-1500";
const replacement: ProjectTerminalTemplateDraft = {
	id: targetId,
	name: "Updated",
	commandsText: "bun run dev",
	cwd: "apps/web",
};

function replaceWithMap() {
	return drafts.map((draft) => (draft.id === targetId ? replacement : draft));
}

function removeWithFilter() {
	return drafts.filter((draft) => draft.id !== targetId);
}

describe("project template draft list updates", () => {
	bench("map replace by id", () => {
		replaceWithMap();
	});

	bench("findIndex replace by id", () => {
		replaceProjectTemplateDraft(drafts, targetId, replacement);
	});

	bench("filter remove by id", () => {
		removeWithFilter();
	});

	bench("findIndex splice remove by id", () => {
		removeProjectTemplateDraft(drafts, targetId);
	});
});
