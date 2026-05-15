import {
	QueryClient,
	QueryClientProvider,
} from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { removeProfileFromProjectCache, useProfileDeleteCheck } from "./hooks";

const {
	createProfileMock,
	deleteProfileMock,
	getProfileDeleteCheckMock,
} = vi.hoisted(() => ({
	createProfileMock: vi.fn(),
	deleteProfileMock: vi.fn(),
	getProfileDeleteCheckMock: vi.fn(),
}));

vi.mock("@/generated", async () => {
	const actual = await vi.importActual<typeof import("@/generated")>(
		"@/generated",
	);
	return {
		...actual,
		createProfile: createProfileMock,
		deleteProfile: deleteProfileMock,
		getProfileDeleteCheck: getProfileDeleteCheckMock,
	};
});

function project(id: string, profileIds: string[]) {
	return {
		id,
		name: id,
		folder: `/tmp/${id}`,
		created_at: "2026-01-01T00:00:00Z",
		group_id: null,
		profiles: profileIds.map((profileId, index) => ({
			id: profileId,
			project_id: id,
			branch_name: index === 0 ? "main" : `branch-${index}`,
			worktree_path: `/tmp/${id}/${profileId}`,
			created_at: "2026-01-01T00:00:00Z",
			is_default: index === 0,
		})),
	};
}

function createWrapper() {
	const queryClient = new QueryClient({
		defaultOptions: {
			queries: {
				retry: false,
			},
		},
	});

	return ({ children }: { children: ReactNode }) => (
		<QueryClientProvider client={queryClient}>
			{children}
		</QueryClientProvider>
	);
}

describe("useProfileDeleteCheck", () => {
	beforeEach(() => {
		createProfileMock.mockReset();
		deleteProfileMock.mockReset();
		getProfileDeleteCheckMock.mockReset();
	});

	it("reports local changes and unpushed commits before profile deletion", async () => {
		getProfileDeleteCheckMock.mockResolvedValue({
			working_tree_diff: {
				files_changed: 2,
				insertions: 10,
				deletions: 1,
			},
			unpushed_commit_count: 2,
			unpushed_commit_diff: {
				files_changed: 3,
				insertions: 20,
				deletions: 4,
			},
			total_diff: {
				files_changed: 5,
				insertions: 30,
				deletions: 5,
			},
		});

		const { result } = renderHook(
			() => useProfileDeleteCheck("profile-1", true),
			{ wrapper: createWrapper() },
		);

		await waitFor(() => {
			expect(result.current.isChecking).toBe(false);
		});

		expect(getProfileDeleteCheckMock).toHaveBeenCalledWith({
			id: "profile-1",
		});
		expect(result.current.workingTreeDiff).toEqual({
			files_changed: 2,
			insertions: 10,
			deletions: 1,
		});
		expect(result.current.unpushedCommitCount).toBe(2);
		expect(result.current.unpushedCommitDiff).toEqual({
			files_changed: 3,
			insertions: 20,
			deletions: 4,
		});
		expect(result.current.totalDiff).toEqual({
			files_changed: 5,
			insertions: 30,
			deletions: 5,
		});
		expect(result.current.hasLocalChanges).toBe(true);
		expect(result.current.hasUnpushedCommits).toBe(true);
		expect(result.current.hasRisk).toBe(true);
	});

	it("does not run the git check while disabled", () => {
		renderHook(() => useProfileDeleteCheck("profile-1", false), {
			wrapper: createWrapper(),
		});

		expect(getProfileDeleteCheckMock).not.toHaveBeenCalled();
	});
});

describe("removeProfileFromProjectCache", () => {
	it("only clones the project that owns the removed profile", () => {
		const projects = [
			project("project-1", ["profile-1", "profile-2"]),
			project("project-2", ["profile-3", "profile-4"]),
		];

		const next = removeProfileFromProjectCache(
			projects,
			"project-2",
			"profile-4",
		);

		expect(next).not.toBe(projects);
		expect(next?.[0]).toBe(projects[0]);
		expect(next?.[1]).not.toBe(projects[1]);
		expect(next?.[1].profiles.map((profile) => profile.id)).toEqual([
			"profile-3",
		]);
	});

	it("returns the original cache when the project or profile is missing", () => {
		const projects = [project("project-1", ["profile-1"])];

		expect(
			removeProfileFromProjectCache(projects, "missing", "profile-1"),
		).toBe(projects);
		expect(
			removeProfileFromProjectCache(projects, "project-1", "missing"),
		).toBe(projects);
	});
});
