import { renderHook, act } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { listen } from "@tauri-apps/api/event";
import {
	readTerminalLayoutSnapshot,
	useProfileHasNotification,
	useTerminalProfileIds,
	useTerminalStore,
} from "./store";

function resetStore() {
	localStorage.clear();
	useTerminalStore.setState({ profiles: {}, notifiedTabs: new Set() });
}

function getState() {
	return useTerminalStore.getState();
}

function addTab(
	profileId: string,
	sessionId: string,
	title: string,
	cwd = "/tmp/project",
	shell = "/bin/zsh",
) {
	getState().addTab(profileId, sessionId, title, cwd, shell);
}

function splitTab(
	profileId: string,
	tabId: string,
	sessionId: string,
	title: string,
	direction: "horizontal" | "vertical" = "horizontal",
	cwd = "/tmp/project",
	shell = "/bin/zsh",
) {
	getState().splitTab(profileId, tabId, direction, {
		sessionId,
		title,
		cwd,
		shell,
	});
}

describe("useTerminalStore", () => {
	beforeEach(resetStore);

	describe("addTab", () => {
		it("creates a new tab with a single pane", () => {
			addTab("p1", "s1", "Shell");
			const profile = getState().profiles.p1;

			expect(profile).toBeDefined();
			expect(profile.activeTabId).toBe("s1");
			expect(profile.counter).toBe(1);
			expect(profile.tabs).toEqual([
				{
					id: "s1",
					title: "Shell",
					activePaneId: "s1",
					primaryPaneId: "s1",
					direction: null,
					panes: [
						{
							sessionId: "s1",
							title: "Shell",
							cwd: "/tmp/project",
							shell: "/bin/zsh",
						},
					],
				},
			]);
		});

		it("adds multiple tabs independently within a profile", () => {
			addTab("p1", "s1", "Shell 1");
			addTab("p1", "s2", "Shell 2");
			const profile = getState().profiles.p1;

			expect(profile.tabs).toHaveLength(2);
			expect(profile.tabs[0].id).toBe("s1");
			expect(profile.tabs[1].id).toBe("s2");
			expect(profile.activeTabId).toBe("s2");
			expect(profile.counter).toBe(2);
		});
	});

	describe("splitTab", () => {
		it("adds a second pane to an existing tab and tracks focus", () => {
			addTab("p1", "s1", "Shell 1");
			splitTab("p1", "s1", "s2", "Shell 2", "vertical");

			const tab = getState().profiles.p1.tabs[0];
			expect(tab.direction).toBe("vertical");
			expect(tab.panes).toHaveLength(2);
			expect(tab.activePaneId).toBe("s2");
			expect(tab.primaryPaneId).toBe("s1");
			expect(tab.title).toBe("Shell 1");
			expect(getState().profiles.p1.counter).toBe(2);
		});

		it("ignores split requests once a tab already has two panes", () => {
			addTab("p1", "s1", "Shell 1");
			splitTab("p1", "s1", "s2", "Shell 2");
			splitTab("p1", "s1", "s3", "Shell 3");

			const tab = getState().profiles.p1.tabs[0];
			expect(tab.panes).toHaveLength(2);
			expect(tab.panes.map((pane) => pane.sessionId)).toEqual(["s1", "s2"]);
		});
	});

	describe("closeTab", () => {
		it("removes a tab and all notifications for its panes", () => {
			addTab("p1", "s1", "Shell 1");
			splitTab("p1", "s1", "s2", "Shell 2");
			addTab("p1", "s3", "Shell 3");
			getState().markNotified("s1");
			getState().markNotified("s2");
			getState().markNotified("s3");

			getState().closeTab("p1", "s1");

			expect(getState().profiles.p1.tabs).toHaveLength(1);
			expect(getState().profiles.p1.tabs[0].id).toBe("s3");
			expect(getState().profiles.p1.activeTabId).toBe("s3");
			expect(getState().notifiedTabs.has("s1")).toBe(false);
			expect(getState().notifiedTabs.has("s2")).toBe(false);
			expect(getState().notifiedTabs.has("s3")).toBe(true);
		});

		it("deletes the profile when the last tab closes", () => {
			addTab("p1", "s1", "Shell 1");
			getState().closeTab("p1", "s1");
			expect(getState().profiles.p1).toBeUndefined();
		});
	});

	describe("closePane", () => {
		it("collapses a split tab back to a single pane", () => {
			addTab("p1", "s1", "Shell 1");
			splitTab("p1", "s1", "s2", "Shell 2");

			getState().closePane("p1", "s1", "s2");

			const tab = getState().profiles.p1.tabs[0];
			expect(tab.panes).toHaveLength(1);
			expect(tab.direction).toBeNull();
			expect(tab.activePaneId).toBe("s1");
			expect(tab.primaryPaneId).toBe("s1");
		});

		it("promotes the remaining pane when the primary pane closes", () => {
			addTab("p1", "s1", "Shell 1");
			splitTab("p1", "s1", "s2", "Shell 2");

			getState().closePane("p1", "s1", "s1");

			const tab = getState().profiles.p1.tabs[0];
			expect(tab.title).toBe("Shell 2");
			expect(tab.primaryPaneId).toBe("s2");
			expect(tab.activePaneId).toBe("s2");
			expect(tab.panes.map((pane) => pane.sessionId)).toEqual(["s2"]);
		});

		it("removes the whole tab when its last pane closes", () => {
			addTab("p1", "s1", "Shell 1");
			getState().closePane("p1", "s1", "s1");
			expect(getState().profiles.p1).toBeUndefined();
		});
	});

	describe("activation and notifications", () => {
		it("setActiveTab clears notifications for all panes in the tab", () => {
			addTab("p1", "s1", "Shell 1");
			splitTab("p1", "s1", "s2", "Shell 2");
			addTab("p1", "s3", "Shell 3");
			getState().markNotified("s1");
			getState().markNotified("s2");
			getState().markNotified("s3");

			getState().setActiveTab("p1", "s1");

			expect(getState().profiles.p1.activeTabId).toBe("s1");
			expect(getState().notifiedTabs.has("s1")).toBe(false);
			expect(getState().notifiedTabs.has("s2")).toBe(false);
			expect(getState().notifiedTabs.has("s3")).toBe(true);
		});

		it("setActivePane focuses a pane and clears only that pane notification", () => {
			addTab("p1", "s1", "Shell 1");
			splitTab("p1", "s1", "s2", "Shell 2");
			getState().markNotified("s1");
			getState().markNotified("s2");

			getState().setActivePane("p1", "s1", "s2");

			const tab = getState().profiles.p1.tabs[0];
			expect(tab.activePaneId).toBe("s2");
			expect(getState().notifiedTabs.has("s1")).toBe(true);
			expect(getState().notifiedTabs.has("s2")).toBe(false);
		});

		it("markProfileRead clears notifications across every pane", () => {
			addTab("p1", "s1", "Shell 1");
			splitTab("p1", "s1", "s2", "Shell 2");
			addTab("p1", "s3", "Shell 3");
			getState().markNotified("s1");
			getState().markNotified("s2");
			getState().markNotified("s3");

			getState().markProfileRead("p1");

			expect(getState().notifiedTabs.size).toBe(0);
		});
	});

	describe("updateTabTitle", () => {
		it("updates the tab title when the primary pane title changes", () => {
			addTab("p1", "s1", "Shell 1");
			splitTab("p1", "s1", "s2", "Shell 2");

			getState().updateTabTitle("p1", "s1", "Main Shell");

			const tab = getState().profiles.p1.tabs[0];
			expect(tab.title).toBe("Main Shell");
			expect(tab.panes[0].title).toBe("Main Shell");
		});

		it("keeps the tab title when a secondary pane title changes", () => {
			addTab("p1", "s1", "Shell 1");
			splitTab("p1", "s1", "s2", "Shell 2");

			getState().updateTabTitle("p1", "s2", "Split Shell");

			const tab = getState().profiles.p1.tabs[0];
			expect(tab.title).toBe("Shell 1");
			expect(tab.panes[1].title).toBe("Split Shell");
		});
	});

	describe("profile cleanup", () => {
		it("removeProfile clears notifications owned by the profile", () => {
			addTab("p1", "s1", "Shell 1");
			splitTab("p1", "s1", "s2", "Shell 2");
			addTab("p2", "s3", "Shell 3");
			getState().markNotified("s1");
			getState().markNotified("s2");
			getState().markNotified("s3");

			getState().removeProfile("p1");

			expect(getState().profiles.p1).toBeUndefined();
			expect(getState().notifiedTabs.has("s1")).toBe(false);
			expect(getState().notifiedTabs.has("s2")).toBe(false);
			expect(getState().notifiedTabs.has("s3")).toBe(true);
		});

		it("removeStaleProfiles drops invalid profiles and their notifications", () => {
			addTab("p1", "s1", "Shell 1");
			addTab("p2", "s2", "Shell 2");
			getState().markNotified("s1");
			getState().markNotified("s2");

			getState().removeStaleProfiles(new Set(["p2"]));

			expect(getState().profiles.p1).toBeUndefined();
			expect(getState().profiles.p2).toBeDefined();
			expect(getState().notifiedTabs.has("s1")).toBe(false);
			expect(getState().notifiedTabs.has("s2")).toBe(true);
		});
	});

	describe("layout persistence", () => {
		it("persists split tabs to the layout snapshot", () => {
			addTab("p1", "s1", "Shell 1");
			splitTab("p1", "s1", "s2", "Shell 2", "vertical");

			expect(readTerminalLayoutSnapshot()).toEqual(getState().profiles);
		});

		it("removes the persisted snapshot when the last profile disappears", () => {
			addTab("p1", "s1", "Shell 1");
			getState().removeProfile("p1");

			expect(readTerminalLayoutSnapshot()).toEqual({});
		});
	});

	describe("selectors", () => {
		it("useTerminalProfileIds reflects profile additions", () => {
			const { result } = renderHook(() => useTerminalProfileIds());
			expect(result.current).toEqual([]);

			act(() => {
				addTab("p1", "s1", "Shell 1");
				addTab("p2", "s2", "Shell 2");
			});

			expect(result.current).toEqual(expect.arrayContaining(["p1", "p2"]));
		});

		it("useProfileHasNotification checks panes inside split tabs", () => {
			addTab("p1", "s1", "Shell 1");
			splitTab("p1", "s1", "s2", "Shell 2");
			const { result } = renderHook(() => useProfileHasNotification("p1"));

			expect(result.current).toBe(false);

			act(() => {
				getState().markNotified("s2");
			});

			expect(result.current).toBe(true);
		});
	});

	describe("pty-notify listener", () => {
		it("marks the matching session as notified when the backend event fires", () => {
			const listenMock = vi.mocked(listen);
			expect(listenMock).toHaveBeenCalledWith(
				"pty-notify",
				expect.any(Function),
			);

			const callback = listenMock.mock.calls.find(
				(call) => call[0] === "pty-notify",
			)?.[1] as (event: { payload: string }) => void;

			callback({ payload: "session-xyz" });

			expect(getState().notifiedTabs.has("session-xyz")).toBe(true);
		});
	});
});
