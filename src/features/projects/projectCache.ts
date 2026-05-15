import type { ProjectWithProfiles } from "@/generated";

export function removeProjectById(
	projects: ProjectWithProfiles[] | undefined,
	projectId: string,
): ProjectWithProfiles[] | undefined {
	if (!projects) return projects;

	const index = projects.findIndex((project) => project.id === projectId);
	if (index === -1) return projects.slice();

	const nextProjects = projects.slice();
	nextProjects.splice(index, 1);
	return nextProjects;
}
