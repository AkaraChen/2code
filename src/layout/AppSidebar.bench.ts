import type { ProjectGroup, ProjectWithProfiles } from "@/generated";
import { bench, describe } from "vitest";
import { groupSidebarProjects } from "./AppSidebar";

const groups: ProjectGroup[] = Array.from({ length: 300 }, (_, index) => ({
	id: `group-${index}`,
	name: `Group ${index}`,
	created_at: "2026-05-15T00:00:00Z",
}));

const projects: ProjectWithProfiles[] = Array.from(
	{ length: 10_000 },
	(_, index) => ({
		id: `project-${index}`,
		name: `Project ${index}`,
		folder: `/repo/project-${index}`,
		created_at: "2026-05-15T00:00:00Z",
		group_id:
			index % 7 === 0
				? `missing-${index}`
				: index % 5 === 0
					? null
					: `group-${index % groups.length}`,
		profiles: [],
	}),
);
let sink = 0;

function groupSidebarProjectsWithSet(
	projectGroups: ProjectGroup[],
	projects: ProjectWithProfiles[],
) {
	const knownGroupIds = new Set(projectGroups.map((group) => group.id));
	const projectsByGroup = new Map(
		projectGroups.map((group) => [group.id, [] as ProjectWithProfiles[]]),
	);
	const ungroupedProjects: ProjectWithProfiles[] = [];

	for (const project of projects) {
		const groupId = project.group_id ?? null;
		if (groupId && knownGroupIds.has(groupId)) {
			projectsByGroup.get(groupId)?.push(project);
		} else {
			ungroupedProjects.push(project);
		}
	}

	return {
		groups: projectGroups
			.map((group) => ({
				group,
				projects: projectsByGroup.get(group.id) ?? [],
			}))
			.filter((group) => group.projects.length > 0),
		ungroupedProjects,
	};
}

describe("app sidebar project grouping", () => {
	bench("set plus map/filter grouping", () => {
		const result = groupSidebarProjectsWithSet(groups, projects);
		sink = result.groups.length + result.ungroupedProjects.length;
		if (sink === Number.NEGATIVE_INFINITY) throw new Error("unreachable");
	});

	bench("map-only grouping", () => {
		const result = groupSidebarProjects(groups, projects);
		sink = result.groups.length + result.ungroupedProjects.length;
		if (sink === Number.NEGATIVE_INFINITY) throw new Error("unreachable");
	});
});
