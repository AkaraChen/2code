import { bench, describe } from "vitest";
import type { ProjectWithProfiles } from "@/generated";
import { removeProjectById } from "./projectCache";

const projects: ProjectWithProfiles[] = Array.from(
	{ length: 5_000 },
	(_, index) => ({
		id: `project-${index}`,
		name: `Project ${index}`,
		folder: `/repo/project-${index}`,
		created_at: "2026-01-01T00:00:00Z",
		group_id: null,
		profiles: [],
	}),
);

const projectId = "project-3500";

function removeWithFilter() {
	return projects.filter((project) => project.id !== projectId);
}

describe("project cache removal", () => {
	bench("filter remove project", () => {
		removeWithFilter();
	});

	bench("findIndex splice remove project", () => {
		removeProjectById(projects, projectId);
	});
});
