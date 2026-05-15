import type { ProjectWithProfiles } from "@/generated";
import { bench, describe } from "vitest";
import { getReplacementProject } from "./DeleteProjectDialog";

const projects: ProjectWithProfiles[] = Array.from(
	{ length: 10_000 },
	(_, index) => ({
		id: `project-${index}`,
		name: `Project ${index}`,
		folder: `/repo/project-${index}`,
		created_at: "2026-05-15T00:00:00Z",
		group_id: null,
		profiles: [
			{
				id: `profile-${index}`,
				project_id: `project-${index}`,
				branch_name: "main",
				worktree_path: `/repo/project-${index}`,
				created_at: "2026-05-15T00:00:00Z",
				is_default: true,
				config: null,
			},
		],
	}),
);
const deletedProjectId = "project-7_500".replace("_", "");
let sink = "";

function getReplacementProjectWithFindFilter(
	projects: ProjectWithProfiles[],
	deletedProjectId: string,
) {
	const deletedIndex = projects.findIndex(
		(item) => item.id === deletedProjectId,
	);
	const remainingProjects = projects.filter(
		(item) => item.id !== deletedProjectId,
	);
	if (remainingProjects.length === 0) return null;

	const replacementIndex =
		deletedIndex >= 0
			? Math.min(deletedIndex, remainingProjects.length - 1)
			: 0;
	const replacementProject = remainingProjects[replacementIndex];
	const replacementProfile =
		replacementProject.profiles.find((profile) => profile.is_default) ??
		replacementProject.profiles[0];

	if (!replacementProfile) return null;
	return { project: replacementProject, profile: replacementProfile };
}

describe("delete project replacement", () => {
	bench("findIndex plus filter replacement", () => {
		const replacement = getReplacementProjectWithFindFilter(
			projects,
			deletedProjectId,
		);
		sink = replacement?.project.id ?? "";
		if (sink === "__never__") throw new Error("unreachable");
	});

	bench("single pass replacement", () => {
		const replacement = getReplacementProject(projects, deletedProjectId);
		sink = replacement?.project.id ?? "";
		if (sink === "__never__") throw new Error("unreachable");
	});
});
