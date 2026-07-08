import {
	QueryClient,
	QueryClientProvider,
} from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { Suspense, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { queryKeys } from "@/shared/lib/queryKeys";
import { GIT_LIGHT_REFRESH_INTERVAL_MS } from "@/shared/lib/queryRefresh";
import {
	useCommitGitChanges,
	useGitAheadCount,
	useGitDiffFiles,
	useGitDiffStats,
	useGitLog,
} from "./hooks";

const {
	commitGitChangesMock,
	getGitAheadCountMock,
	getGitDiffStatsMock,
	getGitDiffSnapshotMock,
	getGitLogMock,
} = vi.hoisted(() => ({
	commitGitChangesMock: vi.fn(),
	getGitAheadCountMock: vi.fn(),
	getGitDiffStatsMock: vi.fn(),
	getGitDiffSnapshotMock: vi.fn(),
	getGitLogMock: vi.fn(),
}));

vi.mock("@/generated", async () => {
	const actual = await vi.importActual<typeof import("@/generated")>(
		"@/generated",
	);
	return {
		...actual,
		commitGitChanges: commitGitChangesMock,
		getGitAheadCount: getGitAheadCountMock,
		getGitDiffStats: getGitDiffStatsMock,
		getGitDiffSnapshot: getGitDiffSnapshotMock,
		getGitLog: getGitLogMock,
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
		getGitAheadCountMock.mockReset();
		getGitDiffStatsMock.mockReset();
		getGitDiffSnapshotMock.mockReset();
		getGitLogMock.mockReset();
	});

	it("keeps full diff snapshots on the fast fallback refresh", async () => {
		const queryClient = createQueryClient();
		getGitDiffSnapshotMock.mockResolvedValue({
			diff: "",
			stats: { files_changed: 0, insertions: 0, deletions: 0 },
		});

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
		expect(options?.refetchInterval).toBe(GIT_LIGHT_REFRESH_INTERVAL_MS);
		expect(options?.staleTime).toBe(30_000);
	});

	it("stops full diff snapshot polling while the panel is hidden", async () => {
		const queryClient = createQueryClient();
		getGitDiffSnapshotMock.mockResolvedValue({
			diff: "",
			stats: { files_changed: 0, insertions: 0, deletions: 0 },
		});

		const { result } = renderHook(
			() => useGitDiffFiles("profile-1", false),
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
	});

	it("uses backend stats from the shared diff snapshot", async () => {
		const queryClient = createQueryClient();
		const snapshot = {
			diff: `diff --git a/a.ts b/a.ts
index 587be6b..f9264f7 100644
--- a/a.ts
+++ b/a.ts
@@ -1 +1,2 @@
-old
+new
+line
`,
			stats: {
				files_changed: 1,
				insertions: 2,
				deletions: 1,
			},
		};
		getGitDiffSnapshotMock.mockResolvedValue(snapshot);

		const { result } = renderHook(
			() => useGitDiffFiles("profile-1"),
			{ wrapper: createWrapper(queryClient) },
		);

		await waitFor(() => {
			expect(result.current).toHaveLength(1);
		});
		expect(queryClient.getQueryData(queryKeys.git.diff("profile-1"))).toEqual(
			snapshot,
		);
	});

	it("keeps commit history on the fast fallback refresh", async () => {
		const queryClient = createQueryClient();
		getGitLogMock.mockResolvedValue([]);

		const { result } = renderHook(() => useGitLog("profile-1"), {
			wrapper: createWrapper(queryClient),
		});

		await waitFor(() => {
			expect(result.current.data).toEqual([]);
		});

		const options = getRuntimeQueryOptions(
			queryClient,
			queryKeys.git.log("profile-1"),
		);
		expect(options?.refetchInterval).toBe(GIT_LIGHT_REFRESH_INTERVAL_MS);
		expect(options?.staleTime).toBe(60_000);
		expect(options?.refetchOnMount).toBe("always");
	});

	it("does not fetch commit history while the history panel is inactive", () => {
		const queryClient = createQueryClient();

		renderHook(() => useGitLog("profile-1", false), {
			wrapper: createWrapper(queryClient),
		});

		expect(getGitLogMock).not.toHaveBeenCalled();
		const options = getRuntimeQueryOptions(
			queryClient,
			queryKeys.git.log("profile-1"),
		);
		expect(options?.enabled).toBe(false);
		expect(options?.refetchInterval).toBe(false);
	});

	it("polls lightweight diff stats under the diff-stats key", async () => {
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
		expect(options?.refetchInterval).toBe(GIT_LIGHT_REFRESH_INTERVAL_MS);
		expect(options?.staleTime).toBe(30_000);
		expect(getGitDiffSnapshotMock).not.toHaveBeenCalled();
	});

	it("uses a fast fallback refresh for visible ahead counts", async () => {
		const queryClient = createQueryClient();
		getGitAheadCountMock.mockResolvedValue(2);

		const { result } = renderHook(
			() => useGitAheadCount("profile-1", true),
			{ wrapper: createWrapper(queryClient) },
		);

		await waitFor(() => {
			expect(result.current).toBe(2);
		});

		const options = getRuntimeQueryOptions(
			queryClient,
			queryKeys.git.aheadCount("profile-1"),
		);
		expect(options?.refetchInterval).toBe(GIT_LIGHT_REFRESH_INTERVAL_MS);
		expect(options?.staleTime).toBe(10_000);
	});

	it("refetches diff stats when an enabled-gated profile reactivates", async () => {
		const queryClient = createQueryClient();
		queryClient.setQueryData(queryKeys.git.diffStats("profile-1"), {
			files_changed: 1,
			insertions: 2,
			deletions: 3,
		});
		getGitDiffStatsMock.mockResolvedValue({
			files_changed: 2,
			insertions: 5,
			deletions: 8,
		});

		const { rerender } = renderHook(
			({ enabled }) => useGitDiffStats("profile-1", enabled),
			{
				initialProps: { enabled: false },
				wrapper: createWrapper(queryClient),
			},
		);

		expect(getGitDiffStatsMock).not.toHaveBeenCalled();

		rerender({ enabled: true });

		await waitFor(() => {
			expect(getGitDiffStatsMock).toHaveBeenCalledTimes(1);
		});
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
