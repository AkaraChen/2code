import {
	QueryClient,
	QueryClientProvider,
} from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useWorktreeSettingsStore } from "@/features/settings/stores/worktreeSettingsStore";
import { useCreateProfile, useProfileDeleteCheck } from "./hooks";

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

describe("profile hooks", () => {
	beforeEach(() => {
		createProfileMock.mockReset();
		deleteProfileMock.mockReset();
		getProfileDeleteCheckMock.mockReset();
		useWorktreeSettingsStore.setState({ defaultWorktreeDir: "" });
		localStorage.clear();
	});

	describe("useCreateProfile", () => {
		it("passes the configured default worktree directory to IPC", async () => {
			createProfileMock.mockResolvedValue({
				id: "profile-1",
				project_id: "project-1",
				branch_name: "feature/worktree",
				worktree_path: "/tmp/worktrees/profile-1",
				created_at: "now",
				is_default: false,
				notes: "",
			});
			useWorktreeSettingsStore
				.getState()
				.setDefaultWorktreeDir(" /tmp/worktrees ");

			const { result } = renderHook(() => useCreateProfile(), {
				wrapper: createWrapper(),
			});

			await act(async () => {
				await result.current.mutateAsync({
					projectId: "project-1",
					branchName: "feature/worktree",
				});
			});

			expect(createProfileMock).toHaveBeenCalledWith({
				projectId: "project-1",
				branchName: "feature/worktree",
				defaultWorktreeDir: "/tmp/worktrees",
			});
		});

		it("passes null when no default worktree directory is configured", async () => {
			createProfileMock.mockResolvedValue({
				id: "profile-1",
				project_id: "project-1",
				branch_name: "feature/worktree",
				worktree_path: "/tmp/worktrees/profile-1",
				created_at: "now",
				is_default: false,
				notes: "",
			});

			const { result } = renderHook(() => useCreateProfile(), {
				wrapper: createWrapper(),
			});

			await act(async () => {
				await result.current.mutateAsync({
					projectId: "project-1",
					branchName: "feature/worktree",
				});
			});

			expect(createProfileMock).toHaveBeenCalledWith({
				projectId: "project-1",
				branchName: "feature/worktree",
				defaultWorktreeDir: null,
			});
		});
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
