import { bench, describe } from "vitest";
import type { Profile, ProjectWithProfiles } from "@/generated";
import { removeProjectProfile, upsertProjectProfile } from "./profileCache";

const projects: ProjectWithProfiles[] = Array.from(
	{ length: 500 },
	(_, projectIndex) => ({
		id: `project-${projectIndex}`,
		name: `Project ${projectIndex}`,
		folder: `/repo/project-${projectIndex}`,
		created_at: "2026-01-01T00:00:00Z",
		group_id: null,
		profiles: Array.from({ length: 8 }, (_, profileIndex) => ({
			id: `profile-${projectIndex}-${profileIndex}`,
			project_id: `project-${projectIndex}`,
			branch_name: `branch-${profileIndex}`,
			worktree_path: `/workspace/${projectIndex}/${profileIndex}`,
			created_at: "2026-01-01T00:00:00Z",
			is_default: profileIndex === 0,
		})),
	}),
);

const existingProfile: Profile = {
	...projects[350].profiles[6],
	branch_name: "updated",
};

const newProfile: Profile = {
	id: "profile-new",
	project_id: "project-350",
	branch_name: "new",
	worktree_path: "/workspace/new",
	created_at: "2026-01-01T00:00:00Z",
	is_default: false,
};

function upsertWithMap(profile: Profile) {
	return projects.map((project) => {
		if (project.id !== profile.project_id) return project;
		const hasProfile = project.profiles.some((item) => item.id === profile.id);
		return {
			...project,
			profiles: hasProfile
				? project.profiles.map((item) =>
						item.id === profile.id ? profile : item,
					)
				: [...project.profiles, profile],
		};
	});
}

function removeWithMapFilter(profileId: string) {
	return projects.map((project) => ({
		...project,
		profiles: project.profiles.filter((profile) => profile.id !== profileId),
	}));
}

describe("profile project cache updates", () => {
	bench("map upsert existing profile", () => {
		upsertWithMap(existingProfile);
	});

	bench("indexed upsert existing profile", () => {
		upsertProjectProfile(projects, existingProfile);
	});

	bench("map append new profile", () => {
		upsertWithMap(newProfile);
	});

	bench("indexed append new profile", () => {
		upsertProjectProfile(projects, newProfile);
	});

	bench("map filter remove profile", () => {
		removeWithMapFilter(existingProfile.id);
	});

	bench("indexed splice remove profile", () => {
		removeProjectProfile(projects, existingProfile.project_id, existingProfile.id);
	});
});
