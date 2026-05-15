import { describe, expect, it } from "vitest";
import type { Profile, ProjectWithProfiles } from "@/generated";
import { removeProjectProfile, upsertProjectProfile } from "./profileCache";

const profileA: Profile = {
	id: "profile-a",
	project_id: "project-1",
	branch_name: "main",
	worktree_path: "/workspace/a",
	created_at: "2026-01-01T00:00:00Z",
	is_default: true,
};

const profileB: Profile = {
	id: "profile-b",
	project_id: "project-1",
	branch_name: "feature",
	worktree_path: "/workspace/b",
	created_at: "2026-01-01T00:00:00Z",
	is_default: false,
};

const projects: ProjectWithProfiles[] = [
	{
		id: "project-1",
		name: "Project",
		folder: "/repo",
		created_at: "2026-01-01T00:00:00Z",
		group_id: null,
		profiles: [profileA],
	},
];

describe("profile project cache updates", () => {
	it("appends a new profile to its project", () => {
		expect(upsertProjectProfile(projects, profileB)?.[0].profiles).toEqual([
			profileA,
			profileB,
		]);
	});

	it("replaces an existing profile", () => {
		const updated = { ...profileA, branch_name: "updated" };
		expect(upsertProjectProfile(projects, updated)?.[0].profiles).toEqual([
			updated,
		]);
	});

	it("removes a profile from its project", () => {
		expect(
			removeProjectProfile(
				[{ ...projects[0], profiles: [profileA, profileB] }],
				"project-1",
				"profile-a",
			)?.[0].profiles,
		).toEqual([profileB]);
	});
});
