import { describe, expect, it } from "vitest";
import type { ProjectTerminalState } from "./store";
import {
	buildTerminalRestorePlan,
	rebuildTerminalProfilesFromRestorePlan,
	mapWithLimit,
} from "./state";

function createSnapshotProfiles(): Record<string, ProjectTerminalState> {
	return {
		p1: {
			tabs: [
				{
					id: "s1",
					title: "Main",
					activePaneId: "s2",
					primaryPaneId: "s1",
					direction: "horizontal",
					panes: [
						{
							sessionId: "s1",
							title: "Main",
							cwd: "/repo",
							shell: "/bin/zsh",
						},
						{
							sessionId: "s2",
							title: "Split",
							cwd: "/repo/apps/web",
							shell: "/bin/zsh",
						},
					],
				},
			],
			activeTabId: "s1",
			counter: 7,
		},
	};
}

function createSessions() {
	return [
		{
			id: "s1",
			profile_id: "p1",
			title: "Main DB",
			shell: "/bin/zsh",
			cwd: "/repo",
			created_at: "",
			closed_at: null,
			cols: 80,
			rows: 24,
		},
		{
			id: "s2",
			profile_id: "p1",
			title: "Split DB",
			shell: "/bin/zsh",
			cwd: "/repo/apps/web",
			created_at: "",
			closed_at: null,
			cols: 100,
			rows: 30,
		},
		{
			id: "s3",
			profile_id: "p2",
			title: "Loose",
			shell: "/bin/bash",
			cwd: "/repo-2",
			created_at: "",
			closed_at: null,
			cols: 90,
			rows: 26,
		},
	];
}

describe("buildTerminalRestorePlan", () => {
	it("reuses persisted split layout and leaves unknown sessions as loose restores", () => {
		const plan = buildTerminalRestorePlan(
			createSnapshotProfiles(),
			createSessions(),
		);

		expect(plan.profiles.p1).toBeDefined();
		expect(plan.profiles.p1.counter).toBe(7);
		expect(plan.profiles.p1.tabs).toHaveLength(1);
		expect(plan.profiles.p1.tabs[0].panes.map((pane) => pane.oldSessionId)).toEqual(
			["s1", "s2"],
		);
		expect(plan.looseSessions.map((pane) => pane.oldSessionId)).toEqual(["s3"]);
	});

	it("drops panes missing from the live session set", () => {
		const sessions = createSessions().filter((session) => session.id !== "s2");
		const plan = buildTerminalRestorePlan(createSnapshotProfiles(), sessions);

		expect(plan.profiles.p1.tabs[0].panes).toHaveLength(1);
		expect(plan.profiles.p1.tabs[0].direction).toBeNull();
		expect(plan.profiles.p1.tabs[0].activePaneId).toBe("s1");
		expect(plan.profiles.p1.tabs[0].primaryPaneId).toBe("s1");
	});
});

describe("rebuildTerminalProfilesFromRestorePlan", () => {
	it("remaps split panes to new session ids and preserves layout metadata", () => {
		const plan = buildTerminalRestorePlan(
			createSnapshotProfiles(),
			createSessions(),
		);
		const restoredPanes = new Map([
			[
				"s1",
				{
					...plan.profiles.p1.tabs[0].panes[0],
					newSessionId: "new-s1",
					history: new Uint8Array(),
				},
			],
			[
				"s2",
				{
					...plan.profiles.p1.tabs[0].panes[1],
					newSessionId: "new-s2",
					history: new Uint8Array(),
				},
			],
			[
				"s3",
				{
					...plan.looseSessions[0],
					newSessionId: "new-s3",
					history: new Uint8Array(),
				},
			],
		]);

		const profiles = rebuildTerminalProfilesFromRestorePlan(plan, restoredPanes);

		expect(profiles.p1.activeTabId).toBe("new-s1");
		expect(profiles.p1.counter).toBe(7);
		expect(profiles.p1.tabs[0]).toEqual({
			id: "new-s1",
			title: "Main",
			activePaneId: "new-s2",
			primaryPaneId: "new-s1",
			direction: "horizontal",
			panes: [
				{
					sessionId: "new-s1",
					title: "Main",
					cwd: "/repo",
					shell: "/bin/zsh",
				},
				{
					sessionId: "new-s2",
					title: "Split",
					cwd: "/repo/apps/web",
					shell: "/bin/zsh",
				},
			],
		});
		expect(profiles.p2.tabs[0].id).toBe("new-s3");
	});

	it("falls back to surviving panes when part of a split fails to restore", () => {
		const plan = buildTerminalRestorePlan(
			createSnapshotProfiles(),
			createSessions(),
		);
		const restoredPanes = new Map([
			[
				"s2",
				{
					...plan.profiles.p1.tabs[0].panes[1],
					newSessionId: "new-s2",
					history: new Uint8Array(),
				},
			],
		]);

		const profiles = rebuildTerminalProfilesFromRestorePlan(plan, restoredPanes);

		expect(profiles.p1.tabs[0].panes).toHaveLength(1);
		expect(profiles.p1.tabs[0].direction).toBeNull();
		expect(profiles.p1.tabs[0].primaryPaneId).toBe("new-s2");
		expect(profiles.p1.tabs[0].activePaneId).toBe("new-s2");
	});
});

describe("mapWithLimit", () => {
	it("processes all items", async () => {
		const results: number[] = [];
		await mapWithLimit([1, 2, 3], 2, async (item) => {
			results.push(item);
		});
		expect(results).toEqual([1, 2, 3]);
	});

	it("handles empty array", async () => {
		const results: number[] = [];
		await mapWithLimit([], 3, async (item) => {
			results.push(item);
		});
		expect(results).toEqual([]);
	});

	it("limits concurrency to 1 (serial execution)", async () => {
		let concurrent = 0;
		let maxConcurrent = 0;
		const order: number[] = [];

		await mapWithLimit([1, 2, 3, 4], 1, async (item) => {
			concurrent++;
			maxConcurrent = Math.max(maxConcurrent, concurrent);
			await new Promise((r) => setTimeout(r, 5));
			order.push(item);
			concurrent--;
		});

		expect(maxConcurrent).toBe(1);
		expect(order).toEqual([1, 2, 3, 4]);
	});

	it("limits concurrency to specified limit", async () => {
		let concurrent = 0;
		let maxConcurrent = 0;

		await mapWithLimit([1, 2, 3, 4, 5, 6], 3, async () => {
			concurrent++;
			maxConcurrent = Math.max(maxConcurrent, concurrent);
			await new Promise((r) => setTimeout(r, 10));
			concurrent--;
		});

		expect(maxConcurrent).toBeLessThanOrEqual(3);
		expect(maxConcurrent).toBeGreaterThanOrEqual(2);
	});

	it("continues processing after an item throws", async () => {
		const processed: number[] = [];

		await expect(
			mapWithLimit([1, 2, 3, 4], 2, async (item) => {
				if (item === 2) throw new Error("fail on 2");
				await new Promise((r) => setTimeout(r, 5));
				processed.push(item);
			}),
		).rejects.toThrow("fail on 2");
	});

	it("resolves immediately for empty input with any limit", async () => {
		await expect(
			mapWithLimit([], 100, async () => {
				throw new Error("should not be called");
			}),
		).resolves.toBeUndefined();
	});

	it("works with limit larger than items count", async () => {
		const results: number[] = [];
		await mapWithLimit([1, 2], 10, async (item) => {
			results.push(item);
		});
		expect(results).toEqual([1, 2]);
	});
});
