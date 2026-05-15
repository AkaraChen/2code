import type { ProjectWithProfiles } from "@/generated";
import { describe, expect, it } from "vitest";
import { getReplacementProject } from "./DeleteProjectDialog";

function makeProject(id: string, profileIds: string[]): ProjectWithProfiles {
	return {
		id,
		name: id,
		folder: `/repo/${id}`,
		created_at: "2026-05-15T00:00:00Z",
		group_id: null,
		profiles: profileIds.map((profileId, index) => ({
			id: profileId,
			project_id: id,
			branch_name: profileId,
			worktree_path: `/repo/${id}/${profileId}`,
			created_at: "2026-05-15T00:00:00Z",
			is_default: index === 0,
			config: null,
		})),
	};
}

describe("getReplacementProject", () => {
	it("selects the next project at the deleted project position", () => {
		const projects = [
			makeProject("one", ["one-default"]),
			makeProject("two", ["two-default"]),
			makeProject("three", ["three-default"]),
		];

		expect(getReplacementProject(projects, "two")).toEqual({
			project: projects[2],
			profile: projects[2].profiles[0],
		});
	});

	it("falls back to the previous project when deleting the last project", () => {
		const projects = [
			makeProject("one", ["one-default"]),
			makeProject("two", ["two-default"]),
		];

		expect(getReplacementProject(projects, "two")).toEqual({
			project: projects[0],
			profile: projects[0].profiles[0],
		});
	});
});
