import {
	QueryClient,
	QueryClientProvider,
} from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { Suspense, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { queryKeys } from "@/shared/lib/queryKeys";
import {
	useCommitGitChanges,
	useGitDiffFiles,
	useGitDiffStats,
} from "./hooks";

const {
	commitGitChangesMock,
	getGitDiffMock,
	getGitDiffStatsMock,
} = vi.hoisted(() => ({
	commitGitChangesMock: vi.fn(),
	getGitDiffMock: vi.fn(),
	getGitDiffStatsMock: vi.fn(),
}));

vi.mock("@/generated", async () => {
	const actual = await vi.importActual<typeof import("@/generated")>(
		"@/generated",
	);
	return {
		...actual,
		commitGitChanges: commitGitChangesMock,
		getGitDiff: getGitDiffMock,
		getGitDiffStats: getGitDiffStatsMock,
	};
});

function createQueryClient() {
	return new QueryClient({
		defaultOptions: {
			queries: {
				retry: false,
			},
		},
	});
}

function createWrapper(queryClient: QueryClient) {
	return ({ children }: { children: ReactNode }) => (
		<QueryClientProvider client={queryClient}>
			<Suspense fallback={null}>{children}</Suspense>
		</QueryClientProvider>
	);
}

function getRuntimeQueryOptions(
	queryClient: QueryClient,
	queryKey: readonly unknown[],
) {
	return queryClient.getQueryCache().find({ queryKey })?.options as
		| Record<string, unknown>
		| undefined;
}

describe("git query refresh policy", () => {
	beforeEach(() => {
		commitGitChangesMock.mockReset();
		getGitDiffMock.mockReset();
		getGitDiffStatsMock.mockReset();
	});

	it("keeps full diff snapshots out of the background polling loop", async () => {
		const queryClient = createQueryClient();
		getGitDiffMock.mockResolvedValue("");

		const { result } = renderHook(
			() => useGitDiffFiles("profile-1"),
			{ wrapper: createWrapper(queryClient) },
		);

		await waitFor(() => {
			expect(result.current).toEqual([]);
		});

		const options = getRuntimeQueryOptions(
			queryClient,
			queryKeys.git.diff("profile-1"),
		);
		expect(options?.refetchInterval).toBe(false);
		expect(options?.staleTime).toBe(30_000);
		expect(options?.refetchOnMount).toBe("always");
	});

	it("uses a low-frequency fallback refresh for visible diff stats", async () => {
		const queryClient = createQueryClient();
		getGitDiffStatsMock.mockResolvedValue({
			files_changed: 1,
			insertions: 2,
			deletions: 3,
		});

		const { result } = renderHook(
			() => useGitDiffStats("profile-1", true),
			{ wrapper: createWrapper(queryClient) },
		);

		await waitFor(() => {
			expect(result.current).toEqual({
				additions: 2,
				deletions: 3,
				filesChanged: 1,
			});
		});

		const options = getRuntimeQueryOptions(
			queryClient,
			queryKeys.git.diffStats("profile-1"),
		);
		expect(options?.refetchInterval).toBe(10_000);
		expect(options?.staleTime).toBe(10_000);
	});
});

describe("git mutations", () => {
	beforeEach(() => {
		commitGitChangesMock.mockReset();
	});

	it("refreshes status, diff, stats, log, and ahead caches after committing", async () => {
		const queryClient = createQueryClient();
		const invalidateQueriesSpy = vi.spyOn(queryClient, "invalidateQueries");
		commitGitChangesMock.mockResolvedValue("abc1234");

		const { result } = renderHook(
			() => useCommitGitChanges("profile-1"),
			{ wrapper: createWrapper(queryClient) },
		);

		await act(async () => {
			await result.current.mutateAsync({
				files: ["src/index.ts"],
				message: "test commit",
			});
		});

		expect(commitGitChangesMock).toHaveBeenCalledWith({
			profileId: "profile-1",
			files: ["src/index.ts"],
			message: "test commit",
			body: undefined,
		});
		expect(invalidateQueriesSpy).toHaveBeenCalledWith({
			queryKey: queryKeys.git.diff("profile-1"),
		});
		expect(invalidateQueriesSpy).toHaveBeenCalledWith({
			queryKey: queryKeys.git.diffStats("profile-1"),
		});
		expect(invalidateQueriesSpy).toHaveBeenCalledWith({
			queryKey: queryKeys.git.log("profile-1"),
		});
		expect(invalidateQueriesSpy).toHaveBeenCalledWith({
			queryKey: queryKeys.git.status("profile-1"),
		});
		expect(invalidateQueriesSpy).toHaveBeenCalledWith({
			queryKey: queryKeys.git.aheadCount("profile-1"),
		});
		invalidateQueriesSpy.mockRestore();
	});
});
