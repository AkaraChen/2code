import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getQueryDataMock, invalidateQueriesMock, watchProjectsMock } = vi.hoisted(() => ({
	getQueryDataMock: vi.fn(),
	invalidateQueriesMock: vi.fn(),
	watchProjectsMock: vi.fn(),
}));

vi.mock("@/generated", () => ({
	watchProjects: watchProjectsMock,
}));

vi.mock("@/shared/lib/queryClient", () => ({
	queryClient: {
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

describe("fileWatcher", () => {
	beforeEach(() => {
		vi.resetModules();
		vi.useFakeTimers();
		getQueryDataMock.mockReset();
		invalidateQueriesMock.mockClear();
		watchProjectsMock.mockClear();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("starts watching projects as soon as the module loads", async () => {
		const channel = await loadWatcher();

		expect(watchProjectsMock).toHaveBeenCalledTimes(1);
		expect(channel.onmessage).toBeTypeOf("function");
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
					queryKey: ["git-log"],
					exact: false,
				},
			],
			[
				{
					queryKey: ["git-branch"],
					exact: false,
				},
			],
			[
				{
					queryKey: ["git-ahead-count"],
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

	it("resets the debounce timer when another event arrives before the flush", async () => {
		const channel = await loadWatcher();

		channel.onmessage?.({ project_id: "project-1", root_path: "/repo" });
		vi.advanceTimersByTime(500);
		channel.onmessage?.({ project_id: "project-1", root_path: "/repo" });
		vi.advanceTimersByTime(999);
		expect(invalidateQueriesMock).not.toHaveBeenCalled();

		vi.advanceTimersByTime(1);
		expect(invalidateQueriesMock).toHaveBeenCalledTimes(9);
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
			[{ queryKey: ["git-log", "profile-1"] }],
			[{ queryKey: ["git-ahead-count", "profile-1"] }],
			[
				{
					queryKey: ["fs-tree", "profile-1"],
					exact: false,
				},
			],
			[{ queryKey: ["git-branch", "/repo"] }],
			[{ queryKey: ["fs-file", "profile-1", "src/index.ts"] }],
			[{ queryKey: ["fs-file-preview", "profile-1", "src/index.ts"] }],
		]);
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
			[{ queryKey: ["git-log", "profile-1"] }],
			[{ queryKey: ["git-ahead-count", "profile-1"] }],
			[
				{
					queryKey: ["fs-tree", "profile-1"],
					exact: false,
				},
			],
			[{ queryKey: ["git-branch", "/repo"] }],
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
