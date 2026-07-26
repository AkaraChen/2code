import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
	consolaErrorMock,
	getQueryCacheMock,
	getQueryDataMock,
	invalidateQueriesMock,
	queryCacheFindAllMock,
	watchProjectsMock,
} = vi.hoisted(() => ({
	consolaErrorMock: vi.fn(),
	getQueryCacheMock: vi.fn(),
	getQueryDataMock: vi.fn(),
	invalidateQueriesMock: vi.fn(),
	queryCacheFindAllMock: vi.fn(),
	watchProjectsMock: vi.fn(),
}));

vi.mock("consola", () => ({
	default: {
		error: consolaErrorMock,
	},
}));

vi.mock("@/generated", () => ({
	watchProjects: watchProjectsMock,
}));

vi.mock("@/shared/lib/queryClient", () => ({
	queryClient: {
		getQueryCache: getQueryCacheMock,
		getQueryData: getQueryDataMock,
		invalidateQueries: invalidateQueriesMock,
	},
}));

async function loadWatcher() {
	await import("./fileWatcher");
	const [{ onEvent }] = watchProjectsMock.mock.calls.map((args) => args[0]);
	return onEvent as {
		onmessage: ((
			event: {
				project_id: string;
				profile_id?: string | null;
				root_path: string;
				path?: string | null;
			},
		) => void) | null;
	};
}

type QueryPredicate = (query: { queryKey: unknown[] }) => boolean;

function queryPredicates() {
	return invalidateQueriesMock.mock.calls
		.map(([call]) => call?.predicate)
		.filter((predicate): predicate is QueryPredicate => typeof predicate === "function");
}

function findPredicateMatching(queryKey: unknown[]) {
	const predicate = queryPredicates().find((candidate) =>
		candidate({ queryKey }),
	);
	expect(predicate).toBeTypeOf("function");
	return predicate as QueryPredicate;
}

describe("fileWatcher", () => {
	beforeEach(() => {
		vi.resetModules();
		vi.useFakeTimers();
		queryCacheFindAllMock.mockReset();
		queryCacheFindAllMock.mockReturnValue([]);
		getQueryCacheMock.mockReset();
		getQueryCacheMock.mockReturnValue({
			findAll: queryCacheFindAllMock,
		});
		getQueryDataMock.mockReset();
		invalidateQueriesMock.mockClear();
		watchProjectsMock.mockClear();
		watchProjectsMock.mockResolvedValue(undefined);
		consolaErrorMock.mockClear();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("starts watching projects as soon as the module loads", async () => {
		const channel = await loadWatcher();

		expect(watchProjectsMock).toHaveBeenCalledTimes(1);
		expect(channel.onmessage).toBeTypeOf("function");
	});

	it("logs watcher startup failures", async () => {
		const error = new Error("watch failed");
		watchProjectsMock.mockRejectedValueOnce(error);

		await loadWatcher();
		await Promise.resolve();

		expect(consolaErrorMock).toHaveBeenCalledWith(
			"[file-watcher] failed to start project watcher",
			error,
		);
	});

	it("debounces bursts of file events into a single invalidation batch", async () => {
		const channel = await loadWatcher();

		channel.onmessage?.({ project_id: "project-1", root_path: "/repo" });
		channel.onmessage?.({ project_id: "project-1", root_path: "/repo" });
		vi.advanceTimersByTime(999);
		expect(invalidateQueriesMock).not.toHaveBeenCalled();

		vi.advanceTimersByTime(1);
		expect(invalidateQueriesMock.mock.calls).toEqual([
			[
				{
					queryKey: ["git-diff"],
					exact: false,
				},
			],
			[
				{
					queryKey: ["git-diff-stats"],
					exact: false,
				},
			],
			[
				{
					queryKey: ["git-status"],
					exact: false,
				},
			],
			[
				{
					queryKey: ["fs-tree"],
					exact: false,
				},
			],
			[
				{
					queryKey: ["fs-file"],
					exact: false,
				},
			],
			[
				{
					queryKey: ["fs-file-preview"],
					exact: false,
				},
			],
		]);
	});

	it("does not reset an armed debounce timer when another event arrives", async () => {
		const channel = await loadWatcher();

		channel.onmessage?.({ project_id: "project-1", root_path: "/repo" });
		vi.advanceTimersByTime(500);
		channel.onmessage?.({ project_id: "project-1", root_path: "/repo" });
		vi.advanceTimersByTime(499);
		expect(invalidateQueriesMock).not.toHaveBeenCalled();

		vi.advanceTimersByTime(1);
		expect(invalidateQueriesMock).toHaveBeenCalledTimes(6);
	});

	it("flushes during sustained file activity on the first armed timer", async () => {
		const channel = await loadWatcher();

		channel.onmessage?.({
			project_id: "project-1",
			profile_id: "profile-1",
			root_path: "/repo",
			path: "file-0.ts",
		});
		for (let i = 1; i <= 3; i++) {
			vi.advanceTimersByTime(250);
			channel.onmessage?.({
				project_id: "project-1",
				profile_id: "profile-1",
				root_path: "/repo",
				path: `file-${i}.ts`,
			});
		}
		expect(invalidateQueriesMock).not.toHaveBeenCalled();

		vi.advanceTimersByTime(250);
		expect(invalidateQueriesMock).toHaveBeenCalled();
	});

	it("invalidates precise profile file and preview queries when event includes a path", async () => {
		const channel = await loadWatcher();

		channel.onmessage?.({
			project_id: "project-1",
			profile_id: "profile-1",
			root_path: "/repo",
			path: "src/index.ts",
		});
		vi.advanceTimersByTime(1000);

		expect(invalidateQueriesMock.mock.calls).toEqual([
			[{ queryKey: ["git-diff", "profile-1"] }],
			[{ queryKey: ["git-diff-stats", "profile-1"] }],
			[{ queryKey: ["git-status", "profile-1"] }],
			[
				{
					queryKey: ["fs-tree", "profile-1"],
					exact: false,
				},
			],
			[{ predicate: expect.any(Function) }],
			[{ predicate: expect.any(Function) }],
		]);
		expect(
			findPredicateMatching(["fs-file", "profile-1", "src/index.ts"])({
				queryKey: ["fs-file", "profile-1", "src-other/index.ts"],
			}),
		).toBe(false);
		expect(
			findPredicateMatching(["fs-file-preview", "profile-1", "src/index.ts"])({
				queryKey: ["fs-file-preview", "profile-1", "src-other/index.ts"],
			}),
		).toBe(false);
	});

	it("invalidates cached descendant file queries for directory events", async () => {
		const channel = await loadWatcher();

		channel.onmessage?.({
			project_id: "project-1",
			profile_id: "profile-1",
			root_path: "/repo",
			path: "src",
		});
		vi.advanceTimersByTime(1000);

		const fsFilePredicate = findPredicateMatching([
			"fs-file",
			"profile-1",
			"src/index.ts",
		]);
		expect(fsFilePredicate({ queryKey: ["fs-file", "profile-1", "src"] }))
			.toBe(true);
		expect(
			fsFilePredicate({
				queryKey: ["fs-file", "profile-1", "src-other/index.ts"],
			}),
		).toBe(false);

		const previewPredicate = findPredicateMatching([
			"fs-file-preview",
			"profile-1",
			"src/components/Button.tsx",
		]);
		expect(
			previewPredicate({
				queryKey: ["fs-file-preview", "profile-1", "src-other/Button.tsx"],
			}),
		).toBe(false);
	});

	it("collapses oversized path bursts to profile-wide file invalidation", async () => {
		const channel = await loadWatcher();

		for (let i = 0; i <= 500; i++) {
			channel.onmessage?.({
				project_id: "project-1",
				profile_id: "profile-1",
				root_path: "/repo",
				path: `src/file-${i}.ts`,
			});
		}
		vi.advanceTimersByTime(1000);

		expect(invalidateQueriesMock).toHaveBeenCalledWith({
			queryKey: ["fs-file", "profile-1"],
			exact: false,
		});
		expect(invalidateQueriesMock).toHaveBeenCalledWith({
			queryKey: ["fs-file-preview", "profile-1"],
			exact: false,
		});
	});

	it("invalidates profile file namespaces when event has no precise path", async () => {
		const channel = await loadWatcher();

		channel.onmessage?.({
			project_id: "project-1",
			profile_id: "profile-1",
			root_path: "/repo",
			path: null,
		});
		vi.advanceTimersByTime(1000);

		expect(invalidateQueriesMock).toHaveBeenCalledWith({
			queryKey: ["fs-file", "profile-1"],
			exact: false,
		});
		expect(invalidateQueriesMock).toHaveBeenCalledWith({
			queryKey: ["fs-file-preview", "profile-1"],
			exact: false,
		});
	});

	it("invalidates changed project profiles when project-only events are cached", async () => {
		getQueryDataMock.mockReturnValue([
			{
				id: "project-1",
				folder: "/repo",
				profiles: [
					{
						id: "profile-1",
						worktree_path: "/repo",
					},
				],
			},
			{
				id: "project-2",
				folder: "/other",
				profiles: [
					{
						id: "profile-2",
						worktree_path: "/other",
					},
				],
			},
		]);
		const channel = await loadWatcher();

		channel.onmessage?.({ project_id: "project-1", root_path: "/repo" });
		vi.advanceTimersByTime(1000);

		expect(invalidateQueriesMock.mock.calls).toEqual([
			[{ queryKey: ["git-diff", "profile-1"] }],
			[{ queryKey: ["git-diff-stats", "profile-1"] }],
			[{ queryKey: ["git-status", "profile-1"] }],
			[
				{
					queryKey: ["fs-tree", "profile-1"],
					exact: false,
				},
			],
			[
				{
					queryKey: ["fs-file", "profile-1"],
					exact: false,
				},
			],
			[
				{
					queryKey: ["fs-file-preview", "profile-1"],
					exact: false,
				},
			],
		]);
	});
});
