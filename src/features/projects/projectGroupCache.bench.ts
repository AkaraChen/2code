import { bench, describe } from "vitest";
import type { ProjectGroup } from "@/generated";
import { upsertProjectGroup } from "./projectGroupCache";

const groups: ProjectGroup[] = Array.from({ length: 2_000 }, (_, index) => ({
	id: `group-${index}`,
	name: `Group ${index}`,
	created_at: "2026-01-01T00:00:00Z",
}));

const existingGroup: ProjectGroup = {
	...groups[1_500],
	name: "Updated group",
};

const newGroup: ProjectGroup = {
	id: "group-new",
	name: "New group",
	created_at: "2026-01-01T00:00:00Z",
};

function upsertWithSomeAndMap(group: ProjectGroup) {
	if (groups.some((item) => item.id === group.id)) {
		return groups.map((item) => (item.id === group.id ? group : item));
	}
	return [...groups, group];
}

describe("project group cache upsert", () => {
	bench("some plus map existing group", () => {
		upsertWithSomeAndMap(existingGroup);
	});

	bench("single pass existing group", () => {
		upsertProjectGroup(groups, existingGroup);
	});

	bench("some plus spread new group", () => {
		upsertWithSomeAndMap(newGroup);
	});

	bench("single pass new group", () => {
		upsertProjectGroup(groups, newGroup);
	});
});
