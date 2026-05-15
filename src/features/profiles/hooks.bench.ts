import { bench, describe } from "vitest";
import type { ProjectWithProfiles } from "@/generated";
import { removeProfileFromProjectCache } from "./hooks";

function makeProjects(
	projectCount: number,
	profilesPerProject: number,
): ProjectWithProfiles[] {
	return Array.from({ length: projectCount }, (_, projectIndex) => {
		const projectId = `project-${projectIndex}`;
		return {
			id: projectId,
			name: projectId,
			folder: `/tmp/${projectId}`,
			created_at: "2026-01-01T00:00:00Z",
			group_id: null,
			profiles: Array.from({ length: profilesPerProject }, (_, profileIndex) => ({
				id: `${projectId}-profile-${profileIndex}`,
				project_id: projectId,
				branch_name: profileIndex === 0 ? "main" : `branch-${profileIndex}`,
				worktree_path: `/tmp/${projectId}/profile-${profileIndex}`,
				created_at: "2026-01-01T00:00:00Z",
				is_default: profileIndex === 0,
			})),
		};
	});
}

function removeProfileFromEveryProject(
	projects: ProjectWithProfiles[] | undefined,
	profileId: string,
) {
	return projects?.map((project) => ({
		...project,
		profiles: project.profiles.filter((profile) => profile.id !== profileId),
	}));
}

describe("removeProfileFromProjectCache", () => {
	const projects = makeProjects(1_000, 8);
	const projectId = "project-777";
	const profileId = `${projectId}-profile-4`;

	bench("clone and filter every project", () => {
		removeProfileFromEveryProject(projects, profileId);
	});

	bench("clone only owning project", () => {
		removeProfileFromProjectCache(projects, projectId, profileId);
	});
});
