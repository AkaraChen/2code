import {
	QueryClient,
	QueryClientProvider,
} from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
	FileSearchResult,
	ProjectSidebarLayoutUpdate,
	ProjectWithProfiles,
} from "@/generated";
import { queryKeys, queryNamespaces } from "@/shared/lib/queryKeys";
import {
	useDeleteFileTreePaths,
	useDeleteProject,
	useFileTreeGitStatus,
	useFileSearch,
	useUpdateProjectSidebarLayout,
} from "./hooks";

const {
	deleteFileTreePathsMock,
	deleteProjectMock,
	getFileTreeGitStatusMock,
	searchFileMock,
	updateProjectSidebarLayoutMock,
} = vi.hoisted(() => ({
	deleteFileTreePathsMock: vi.fn(),
	deleteProjectMock: vi.fn(),
	getFileTreeGitStatusMock: vi.fn(),
	searchFileMock: vi.fn(),
	updateProjectSidebarLayoutMock: vi.fn(),
}));

vi.mock("@/generated", async () => {
	const actual = await vi.importActual<typeof import("@/generated")>(
		"@/generated",
	);
	return {
		...actual,
		deleteFileTreePaths: deleteFileTreePathsMock,
		deleteProject: deleteProjectMock,
		getFileTreeGitStatus: getFileTreeGitStatusMock,
		searchFile: searchFileMock,
		updateProjectSidebarLayout: updateProjectSidebarLayoutMock,
	};
});

function createDeferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((res) => {
		resolve = res;
	});
	return { promise, resolve };
}

function createWrapper() {
	return createWrapperWithClient(createQueryClient());
}

function createQueryClient() {
	return new QueryClient({
		defaultOptions: {
			queries: {
				retry: false,
			},
		},
	});
}

function createWrapperWithClient(queryClient: QueryClient) {
	return ({ children }: { children: ReactNode }) => (
		<QueryClientProvider client={queryClient}>
			{children}
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

describe("useDeleteProject", () => {
	beforeEach(() => {
		deleteProjectMock.mockReset();
	});

	it("runs success callback before invalidating dependent caches", async () => {
		const queryClient = createQueryClient();
		const projects: ProjectWithProfiles[] = [
			{
				id: "project-1",
				name: "Project 1",
				folder: "/projects/one",
				created_at: "2026-01-01T00:00:00Z",
				sort_order: 1000,
				profiles: [],
			},
			{
				id: "project-2",
				name: "Project 2",
				folder: "/projects/two",
				created_at: "2026-01-01T00:00:00Z",
				sort_order: 2000,
				profiles: [],
			},
		];
		const events: string[] = [];
		const invalidateQueriesSpy = vi
			.spyOn(queryClient, "invalidateQueries")
			.mockImplementation(async () => {
				events.push("invalidate");
			});
		const onSuccess = vi.fn(() => {
			events.push("success");
		});
		queryClient.setQueryData(queryKeys.projects.all, projects);
		deleteProjectMock.mockResolvedValue(undefined);

		const { result } = renderHook(
			() => useDeleteProject({ onSuccess }),
			{ wrapper: createWrapperWithClient(queryClient) },
		);

		await act(async () => {
			await result.current.mutateAsync("project-1");
		});

		expect(deleteProjectMock).toHaveBeenCalledWith({ id: "project-1" });
		expect(onSuccess).toHaveBeenCalledWith("project-1", projects);
		expect(invalidateQueriesSpy).toHaveBeenCalledWith({
			queryKey: queryKeys.projects.all,
		});
		expect(invalidateQueriesSpy).toHaveBeenCalledWith({
			queryKey: queryKeys.projectGroups.all,
		});
		expect(events).toEqual(["success", "invalidate", "invalidate"]);
		invalidateQueriesSpy.mockRestore();
	});
});

describe("useDeleteFileTreePaths", () => {
	beforeEach(() => {
		deleteFileTreePathsMock.mockReset();
	});

	it("deletes paths and refreshes file tree, file, search, and git caches", async () => {
		const queryClient = createQueryClient();
		const invalidateQueriesSpy = vi.spyOn(queryClient, "invalidateQueries");
		deleteFileTreePathsMock.mockResolvedValue(undefined);

		const { result } = renderHook(
			() => useDeleteFileTreePaths("profile-1"),
			{ wrapper: createWrapperWithClient(queryClient) },
		);

		await act(async () => {
			await result.current.mutateAsync({ paths: ["src/index.ts"] });
		});

		expect(deleteFileTreePathsMock).toHaveBeenCalledWith({
			profileId: "profile-1",
			paths: ["src/index.ts"],
		});
		expect(invalidateQueriesSpy).toHaveBeenCalledWith({
			queryKey: queryKeys.fs.tree("profile-1"),
		});
		expect(invalidateQueriesSpy).toHaveBeenCalledWith({
			queryKey: [queryNamespaces["fs-file"], "profile-1"],
		});
		expect(invalidateQueriesSpy).toHaveBeenCalledWith({
			queryKey: [queryNamespaces["fs-file-preview"], "profile-1"],
		});
		expect(invalidateQueriesSpy).toHaveBeenCalledWith({
			queryKey: [queryNamespaces["fs-search"], "profile-1"],
		});
		expect(invalidateQueriesSpy).toHaveBeenCalledWith({
			queryKey: queryKeys.git.status("profile-1"),
		});
		expect(invalidateQueriesSpy).toHaveBeenCalledWith({
			queryKey: queryKeys.git.diff("profile-1"),
		});
		expect(invalidateQueriesSpy).toHaveBeenCalledWith({
			queryKey: queryKeys.git.diffStats("profile-1"),
		});
		invalidateQueriesSpy.mockRestore();
	});
});

describe("useFileTreeGitStatus", () => {
	beforeEach(() => {
		getFileTreeGitStatusMock.mockReset();
	});

	it("keeps visible file-tree git status event-driven instead of polling", async () => {
		const queryClient = createQueryClient();
		getFileTreeGitStatusMock.mockResolvedValue([]);

		const { result } = renderHook(
			() => useFileTreeGitStatus("profile-1", true),
			{ wrapper: createWrapperWithClient(queryClient) },
		);

		await waitFor(() => {
			expect(result.current.data).toEqual([]);
		});

		const options = getRuntimeQueryOptions(
			queryClient,
			queryKeys.git.status("profile-1"),
		);
		expect(options?.refetchInterval).toBe(false);
		expect(options?.staleTime).toBe(Infinity);
	});
});

describe("useUpdateProjectSidebarLayout", () => {
	beforeEach(() => {
		updateProjectSidebarLayoutMock.mockReset();
	});

	it("refreshes project and project group caches after saving sidebar order", async () => {
		const queryClient = createQueryClient();
		const invalidateQueriesSpy = vi.spyOn(queryClient, "invalidateQueries");
		const updates: ProjectSidebarLayoutUpdate[] = [
			{
				kind: "project",
				id: "project-1",
				groupId: null,
				sortOrder: 1000,
				pinnedOrder: null,
			},
		];
		updateProjectSidebarLayoutMock.mockResolvedValue(undefined);

		const { result } = renderHook(
			() => useUpdateProjectSidebarLayout(),
			{ wrapper: createWrapperWithClient(queryClient) },
		);

		await act(async () => {
			await result.current.mutateAsync(updates);
		});

		expect(updateProjectSidebarLayoutMock).toHaveBeenCalledWith({ updates });
		expect(invalidateQueriesSpy).toHaveBeenCalledWith({
			queryKey: queryKeys.projects.all,
		});
		expect(invalidateQueriesSpy).toHaveBeenCalledWith({
			queryKey: queryKeys.projectGroups.all,
		});
		invalidateQueriesSpy.mockRestore();
	});
});

describe("useFileSearch", () => {
	beforeEach(() => {
		searchFileMock.mockReset();
	});

	it("keeps previous results only within the same profile", async () => {
		const requests = new Map<string, ReturnType<typeof createDeferred<FileSearchResult[]>>>();
		const firstResults: FileSearchResult[] = [
			{
				name: "main.ts",
				path: "/repo-a/src/main.ts",
				relative_path: "src/main.ts",
			},
		];
		const secondResults: FileSearchResult[] = [
			{
				name: "main.test.ts",
				path: "/repo-a/src/main.test.ts",
				relative_path: "src/main.test.ts",
			},
		];

		searchFileMock.mockImplementation(
			({
				profileId,
				query,
			}: {
				profileId: string;
				query: string;
			}) => {
				const request = createDeferred<FileSearchResult[]>();
				requests.set(`${profileId}:${query}`, request);
				return request.promise;
			},
		);

		const { result, rerender } = renderHook(
			({ profileId, query }) => useFileSearch(profileId, query),
			{
				initialProps: { profileId: "profile-1", query: "main" },
				wrapper: createWrapper(),
			},
		);

		await waitFor(() => {
			expect(searchFileMock).toHaveBeenCalledWith({
				profileId: "profile-1",
				query: "main",
			});
		});

		await act(async () => {
			requests.get("profile-1:main")?.resolve(firstResults);
		});

		await waitFor(() => {
			expect(result.current.data).toEqual(firstResults);
		});

		rerender({ profileId: "profile-1", query: "main." });

		await waitFor(() => {
			expect(searchFileMock).toHaveBeenCalledWith({
				profileId: "profile-1",
				query: "main.",
			});
		});

		expect(result.current.data).toEqual(firstResults);
		expect(result.current.isPlaceholderData).toBe(true);

		await act(async () => {
			requests.get("profile-1:main.")?.resolve(secondResults);
		});

		await waitFor(() => {
			expect(result.current.data).toEqual(secondResults);
		});

		rerender({ profileId: "profile-2", query: "main." });

		await waitFor(() => {
			expect(searchFileMock).toHaveBeenCalledWith({
				profileId: "profile-2",
				query: "main.",
			});
		});

		expect(result.current.data).toBeUndefined();
		expect(result.current.isPending).toBe(true);
	});

	it("clears previous results when the query becomes empty", async () => {
		const firstResults: FileSearchResult[] = [
			{
				name: "README.md",
				path: "/repo-a/README.md",
				relative_path: "README.md",
			},
		];

		searchFileMock.mockResolvedValue(firstResults);

		const { result, rerender } = renderHook(
			({ query }) => useFileSearch("profile-1", query),
			{
				initialProps: { query: "readme" },
				wrapper: createWrapper(),
			},
		);

		await waitFor(() => {
			expect(result.current.data).toEqual(firstResults);
		});

		rerender({ query: "" });

		expect(result.current.data).toBeUndefined();
		expect(result.current.isFetching).toBe(false);
		expect(result.current.isPlaceholderData).toBe(false);
	});
});
