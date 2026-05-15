import { bench } from "vitest";
import type { ProjectWithProfiles } from "@/generated";
import { buildValidProfileIds } from "./state";

function createProjects(): ProjectWithProfiles[] {
	return Array.from({ length: 400 }, (_, projectIndex) => ({
		id: `project-${projectIndex}`,
		name: `Project ${projectIndex}`,
		folder: `/repo/${projectIndex}`,
		created_at: "now",
		group_id: null,
		profiles: Array.from({ length: 8 }, (_, profileIndex) => ({
			id: `profile-${projectIndex}-${profileIndex}`,
			project_id: `project-${projectIndex}`,
			branch_name: `branch-${profileIndex}`,
			worktree_path: `/repo/${projectIndex}/${profileIndex}`,
			created_at: "now",
			is_default: profileIndex === 0,
		})),
	}));
}

const PROJECTS = createProjects();

function buildValidProfileIdsWithFlatMap(projects: ProjectWithProfiles[]) {
	return new Set(projects.flatMap((p) => p.profiles.map((pr) => pr.id)));
}

bench("flatMap valid profile ids", () => {
	const ids = buildValidProfileIdsWithFlatMap(PROJECTS);
	if (ids.size === 0) throw new Error("unreachable");
});

bench("direct valid profile ids", () => {
	const ids = buildValidProfileIds(PROJECTS);
	if (ids.size === 0) throw new Error("unreachable");
});
