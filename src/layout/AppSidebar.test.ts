import type { ProjectGroup, ProjectWithProfiles } from "@/generated";
import { describe, expect, it } from "vitest";
import { groupSidebarProjects } from "./AppSidebar";

function makeProject(
	id: string,
	groupId: string | null,
): ProjectWithProfiles {
	return {
		id,
		name: id,
		folder: `/repo/${id}`,
		created_at: "2026-05-15T00:00:00Z",
		group_id: groupId,
		profiles: [],
	};
}

const groups: ProjectGroup[] = [
	{ id: "g1", name: "Group 1", created_at: "2026-05-15T00:00:00Z" },
	{ id: "g2", name: "Group 2", created_at: "2026-05-15T00:00:00Z" },
];

describe("groupSidebarProjects", () => {
	it("groups projects by known group and keeps unknown groups ungrouped", () => {
		const result = groupSidebarProjects(groups, [
			makeProject("p1", "g1"),
			makeProject("p2", null),
			makeProject("p3", "missing"),
			makeProject("p4", "g2"),
		]);

		expect(result.groups).toEqual([
			{ group: groups[0], projects: [makeProject("p1", "g1")] },
			{ group: groups[1], projects: [makeProject("p4", "g2")] },
		]);
		expect(result.ungroupedProjects).toEqual([
			makeProject("p2", null),
			makeProject("p3", "missing"),
		]);
	});

	it("omits empty groups", () => {
		expect(groupSidebarProjects(groups, [makeProject("p1", "g1")]).groups)
			.toEqual([{ group: groups[0], projects: [makeProject("p1", "g1")] }]);
	});
});
