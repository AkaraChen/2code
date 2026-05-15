import type { Profile, ProjectWithProfiles } from "@/generated";

export function upsertProjectProfile(
	projects: ProjectWithProfiles[] | undefined,
	profile: Profile,
): ProjectWithProfiles[] | undefined {
	if (!projects) return projects;

	const projectIndex = projects.findIndex(
		(project) => project.id === profile.project_id,
	);
	if (projectIndex === -1) return projects.slice();

	const nextProjects = projects.slice();
	const project = nextProjects[projectIndex];
	const profileIndex = project.profiles.findIndex(
		(item) => item.id === profile.id,
	);
	const nextProfiles = project.profiles.slice();

	if (profileIndex === -1) {
		nextProfiles.push(profile);
	} else {
		nextProfiles[profileIndex] = profile;
	}

	nextProjects[projectIndex] = {
		...project,
		profiles: nextProfiles,
	};
	return nextProjects;
}

export function removeProjectProfile(
	projects: ProjectWithProfiles[] | undefined,
	projectId: string,
	profileId: string,
): ProjectWithProfiles[] | undefined {
	if (!projects) return projects;

	const projectIndex = projects.findIndex((project) => project.id === projectId);
	if (projectIndex === -1) return projects.slice();

	const nextProjects = projects.slice();
	const project = nextProjects[projectIndex];
	const profileIndex = project.profiles.findIndex(
		(profile) => profile.id === profileId,
	);
	if (profileIndex === -1) return nextProjects;

	const nextProfiles = project.profiles.slice();
	nextProfiles.splice(profileIndex, 1);
	nextProjects[projectIndex] = {
		...project,
		profiles: nextProfiles,
	};
	return nextProjects;
}
