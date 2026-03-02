import { listen } from "@tauri-apps/api/event";
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	useProfileHasNotification,
	useTabProfileIds as useTerminalProfileIds,
	useTabStore as useTerminalStore,
} from "@/features/tabs/store";

/** Helper to create a terminal tab descriptor. */
function termTab(id: string, title: string) {
	return {
		type: "terminal" as const,
		id,
		title,
		panes: [{ sessionId: id, title }],
		activePaneId: id,
	};
}

function resetStore() {
	useTerminalStore.setState({ profiles: {}, notifiedTabs: new Set() });
}

function getState() {
	return useTerminalStore.getState();
}

describe("useTerminalStore", () => {
	beforeEach(resetStore);

	describe("addTab", () => {
		it("creates a new profile entry when adding to non-existent profile", () => {
			getState().addTab("p1", termTab("s1", "Shell"));
			const profile = getState().profiles.p1;
			expect(profile).toBeDefined();
			expect(profile.tabs).toEqual([termTab("s1", "Shell")]);
			expect(profile.activeTabId).toBe("s1");
			expect(profile.counter).toBe(1);
		});

		it("appends to existing profile tabs", () => {
			getState().addTab("p1", termTab("s1", "Shell 1"));
			getState().addTab("p1", termTab("s2", "Shell 2"));
			const profile = getState().profiles.p1;
			expect(profile.tabs).toHaveLength(2);
			expect(profile.tabs[0].id).toBe("s1");
			expect(profile.tabs[1].id).toBe("s2");
		});

		it("sets activeTabId to the newly added tab", () => {
			getState().addTab("p1", termTab("s1", "Shell 1"));
			getState().addTab("p1", termTab("s2", "Shell 2"));
			getState().addTab("p1", termTab("s3", "Shell 3"));
			expect(getState().profiles.p1.activeTabId).toBe("s3");
		});

		it("increments counter for each tab added to same profile", () => {
			getState().addTab("p1", termTab("s1", "Shell 1"));
			getState().addTab("p1", termTab("s2", "Shell 2"));
			getState().addTab("p1", termTab("s3", "Shell 3"));
			expect(getState().profiles.p1.counter).toBe(3);
		});

		it("manages separate profiles independently", () => {
			getState().addTab("p1", termTab("s1", "Shell 1"));
			getState().addTab("p2", termTab("s2", "Shell 2"));
			expect(Object.keys(getState().profiles)).toHaveLength(2);
			expect(getState().profiles.p1.tabs).toHaveLength(1);
			expect(getState().profiles.p2.tabs).toHaveLength(1);
		});
	});

	describe("closeTab", () => {
		it("removes the tab from the profile", () => {
			getState().addTab("p1", termTab("s1", "T1"));
			getState().addTab("p1", termTab("s2", "T2"));
			getState().closeTab("p1", "s1");
			expect(getState().profiles.p1.tabs).toHaveLength(1);
			expect(getState().profiles.p1.tabs[0].id).toBe("s2");
		});

		it("deletes the profile when last tab is closed", () => {
			getState().addTab("p1", termTab("s1", "T1"));
			getState().closeTab("p1", "s1");
			expect(getState().profiles.p1).toBeUndefined();
		});

		it("removes the tab from notifiedTabs set", () => {
			getState().addTab("p1", termTab("s1", "T1"));
			getState().addTab("p1", termTab("s2", "T2"));
			getState().markNotified("s1");
			expect(getState().notifiedTabs.has("s1")).toBe(true);
			getState().closeTab("p1", "s1");
			expect(getState().notifiedTabs.has("s1")).toBe(false);
		});

		it("reassigns activeTab when closing the active mid-list tab", () => {
			getState().addTab("p1", termTab("s1", "T1"));
			getState().addTab("p1", termTab("s2", "T2"));
			getState().addTab("p1", termTab("s3", "T3"));
			getState().setActiveTab("p1", "s2");
			getState().closeTab("p1", "s2");
			expect(getState().profiles.p1.activeTabId).toBe("s3");
		});

		it("reassigns activeTab when closing last tab in list", () => {
			getState().addTab("p1", termTab("s1", "T1"));
			getState().addTab("p1", termTab("s2", "T2"));
			getState().addTab("p1", termTab("s3", "T3"));
			getState().closeTab("p1", "s3");
			expect(getState().profiles.p1.activeTabId).toBe("s2");
		});

		it("reassigns activeTab when closing first tab in list", () => {
			getState().addTab("p1", termTab("s1", "T1"));
			getState().addTab("p1", termTab("s2", "T2"));
			getState().addTab("p1", termTab("s3", "T3"));
			getState().setActiveTab("p1", "s1");
			getState().closeTab("p1", "s1");
			expect(getState().profiles.p1.activeTabId).toBe("s2");
		});

		it("does not change activeTab when closing a non-active tab", () => {
			getState().addTab("p1", termTab("s1", "T1"));
			getState().addTab("p1", termTab("s2", "T2"));
			getState().addTab("p1", termTab("s3", "T3"));
			getState().closeTab("p1", "s1");
			expect(getState().profiles.p1.activeTabId).toBe("s3");
		});

		it("no-ops when profile does not exist", () => {
			expect(() =>
				getState().closeTab("nonexistent", "s1"),
			).not.toThrow();
		});

		it("handles closing second tab when active is second of two", () => {
			getState().addTab("p1", termTab("s1", "T1"));
			getState().addTab("p1", termTab("s2", "T2"));
			getState().closeTab("p1", "s2");
			expect(getState().profiles.p1.tabs).toHaveLength(1);
			expect(getState().profiles.p1.activeTabId).toBe("s1");
		});
	});

	describe("setActiveTab", () => {
		it("sets the activeTabId for the profile", () => {
			getState().addTab("p1", termTab("s1", "T1"));
			getState().addTab("p1", termTab("s2", "T2"));
			getState().setActiveTab("p1", "s1");
			expect(getState().profiles.p1.activeTabId).toBe("s1");
		});

		it("removes the tab from notifiedTabs (clears notification)", () => {
			getState().addTab("p1", termTab("s1", "T1"));
			getState().addTab("p1", termTab("s2", "T2"));
			getState().markNotified("s1");
			getState().setActiveTab("p1", "s1");
			expect(getState().notifiedTabs.has("s1")).toBe(false);
		});

		it("no-ops when profile does not exist", () => {
			expect(() =>
				getState().setActiveTab("nonexistent", "s1"),
			).not.toThrow();
		});
	});

	describe("removeProfile", () => {
		it("deletes the profile from state", () => {
			getState().addTab("p1", termTab("s1", "T1"));
			getState().removeProfile("p1");
			expect(getState().profiles.p1).toBeUndefined();
		});

		it("no-ops when profile does not exist", () => {
			expect(() => getState().removeProfile("nonexistent")).not.toThrow();
		});
	});

	describe("updateTabTitle", () => {
		it("updates the title of the specified tab", () => {
			getState().addTab("p1", termTab("s1", "Old Title"));
			getState().updateTabTitle("p1", "s1", "New Title");
			expect(getState().profiles.p1.tabs[0].title).toBe("New Title");
		});

		it("does not update if the title is the same", () => {
			getState().addTab("p1", termTab("s1", "Same"));
			getState().updateTabTitle("p1", "s1", "Same");
			expect(getState().profiles.p1.tabs[0].title).toBe("Same");
		});

		it("no-ops when profile does not exist", () => {
			expect(() =>
				getState().updateTabTitle("nonexistent", "s1", "Title"),
			).not.toThrow();
		});

		it("no-ops when tab does not exist in profile", () => {
			getState().addTab("p1", termTab("s1", "T1"));
			expect(() =>
				getState().updateTabTitle("p1", "nonexistent", "Title"),
			).not.toThrow();
			expect(getState().profiles.p1.tabs[0].title).toBe("T1");
		});
	});

	describe("markNotified", () => {
		it("adds sessionId to notifiedTabs set", () => {
			getState().markNotified("s1");
			expect(getState().notifiedTabs.has("s1")).toBe(true);
		});

		it("is idempotent (adding same ID twice)", () => {
			getState().markNotified("s1");
			getState().markNotified("s1");
			expect(getState().notifiedTabs.has("s1")).toBe(true);
			expect(getState().notifiedTabs.size).toBe(1);
		});
	});

	describe("markRead", () => {
		it("removes sessionId from notifiedTabs set", () => {
			getState().markNotified("s1");
			getState().markRead("s1");
			expect(getState().notifiedTabs.has("s1")).toBe(false);
		});

		it("is idempotent (removing non-existent ID)", () => {
			expect(() => getState().markRead("nonexistent")).not.toThrow();
		});
	});

	describe("closeTab edge cases", () => {
		it("closing a tabId that does not exist in tabs array is a no-op", () => {
			getState().addTab("p1", termTab("s1", "T1"));
			getState().addTab("p1", termTab("s2", "T2"));
			getState().closeTab("p1", "ghost");
			expect(getState().profiles.p1.tabs).toHaveLength(2);
			expect(getState().profiles.p1.activeTabId).toBe("s2");
		});

		it("closing all tabs one by one removes the profile", () => {
			getState().addTab("p1", termTab("s1", "T1"));
			getState().addTab("p1", termTab("s2", "T2"));
			getState().addTab("p1", termTab("s3", "T3"));
			getState().closeTab("p1", "s3");
			getState().closeTab("p1", "s2");
			getState().closeTab("p1", "s1");
			expect(getState().profiles.p1).toBeUndefined();
		});

		it("closing tabs from one profile does not affect another", () => {
			getState().addTab("p1", termTab("s1", "T1"));
			getState().addTab("p2", termTab("s2", "T2"));
			getState().closeTab("p1", "s1");
			expect(getState().profiles.p1).toBeUndefined();
			expect(getState().profiles.p2).toBeDefined();
			expect(getState().profiles.p2.tabs).toHaveLength(1);
		});

		it("clears notified state even when closing the last tab (profile deleted)", () => {
			getState().addTab("p1", termTab("s1", "T1"));
			getState().markNotified("s1");
			getState().closeTab("p1", "s1");
			expect(getState().notifiedTabs.has("s1")).toBe(false);
			expect(getState().profiles.p1).toBeUndefined();
		});
	});

	describe("addTab edge cases", () => {
		it("empty string IDs are valid", () => {
			getState().addTab("", termTab("", ""));
			expect(getState().profiles[""]).toBeDefined();
			expect(getState().profiles[""].tabs[0]).toEqual(termTab("", ""));
		});

		it("counter persists after closing tabs and adding new ones", () => {
			getState().addTab("p1", termTab("s1", "T1")); // counter=1
			getState().addTab("p1", termTab("s2", "T2")); // counter=2
			getState().closeTab("p1", "s1");
			getState().addTab("p1", termTab("s3", "T3")); // counter=3
			expect(getState().profiles.p1.counter).toBe(3);
		});

		it("adding a tab with duplicate sessionId creates duplicate entries", () => {
			getState().addTab("p1", termTab("s1", "T1"));
			getState().addTab("p1", termTab("s1", "T2"));
			expect(getState().profiles.p1.tabs).toHaveLength(2);
			expect(getState().profiles.p1.tabs[0].id).toBe("s1");
			expect(getState().profiles.p1.tabs[1].id).toBe("s1");
		});
	});

	describe("notification edge cases", () => {
		it("multiple notifications on different tabs", () => {
			getState().addTab("p1", termTab("s1", "T1"));
			getState().addTab("p1", termTab("s2", "T2"));
			getState().markNotified("s1");
			getState().markNotified("s2");
			expect(getState().notifiedTabs.size).toBe(2);
		});

		it("markNotified for non-existent session does not throw", () => {
			expect(() => getState().markNotified("ghost")).not.toThrow();
			expect(getState().notifiedTabs.has("ghost")).toBe(true);
		});

		it("closing notified tab and re-adding it starts without notification", () => {
			getState().addTab("p1", termTab("s1", "T1"));
			getState().addTab("p1", termTab("s2", "T2"));
			getState().markNotified("s1");
			getState().closeTab("p1", "s1");
			getState().addTab("p1", termTab("s1-new", "T1 New"));
			expect(getState().notifiedTabs.has("s1")).toBe(false);
			expect(getState().notifiedTabs.has("s1-new")).toBe(false);
		});

		it("setActiveTab on already-active tab still clears notification", () => {
			getState().addTab("p1", termTab("s1", "T1"));
			getState().markNotified("s1");
			getState().setActiveTab("p1", "s1");
			expect(getState().notifiedTabs.has("s1")).toBe(false);
		});
	});

	describe("useTerminalProfileIds", () => {
		it("returns empty array when no profiles exist", () => {
			const { result } = renderHook(() => useTerminalProfileIds());
			expect(result.current).toEqual([]);
		});

		it("returns profile IDs when profiles exist", () => {
			getState().addTab("p1", termTab("s1", "T1"));
			getState().addTab("p2", termTab("s2", "T2"));
			const { result } = renderHook(() => useTerminalProfileIds());
			expect(result.current).toEqual(
				expect.arrayContaining(["p1", "p2"]),
			);
			expect(result.current).toHaveLength(2);
		});

		it("reflects changes after adding/removing profiles", () => {
			getState().addTab("p1", termTab("s1", "T1"));
			const { result } = renderHook(() => useTerminalProfileIds());
			expect(result.current).toEqual(["p1"]);

			act(() => {
				getState().addTab("p2", termTab("s2", "T2"));
			});
			expect(result.current).toEqual(
				expect.arrayContaining(["p1", "p2"]),
			);
		});
	});

	describe("useProfileHasNotification", () => {
		it("returns false when profile does not exist", () => {
			const { result } = renderHook(() =>
				useProfileHasNotification("nonexistent"),
			);
			expect(result.current).toBe(false);
		});

		it("returns false when profile has no notified tabs", () => {
			getState().addTab("p1", termTab("s1", "T1"));
			const { result } = renderHook(() =>
				useProfileHasNotification("p1"),
			);
			expect(result.current).toBe(false);
		});

		it("returns true when profile has a notified tab", () => {
			getState().addTab("p1", termTab("s1", "T1"));
			getState().markNotified("s1");
			const { result } = renderHook(() =>
				useProfileHasNotification("p1"),
			);
			expect(result.current).toBe(true);
		});

		it("returns true when any tab in profile is notified", () => {
			getState().addTab("p1", termTab("s1", "T1"));
			getState().addTab("p1", termTab("s2", "T2"));
			getState().markNotified("s2");
			const { result } = renderHook(() =>
				useProfileHasNotification("p1"),
			);
			expect(result.current).toBe(true);
		});

		it("returns false after notification is cleared", () => {
			getState().addTab("p1", termTab("s1", "T1"));
			getState().markNotified("s1");
			getState().markRead("s1");
			const { result } = renderHook(() =>
				useProfileHasNotification("p1"),
			);
			expect(result.current).toBe(false);
		});
	});

	describe("pty-notify listener", () => {
		it("calls markNotified when pty-notify event fires", () => {
			const listenMock = vi.mocked(listen);
			expect(listenMock).toHaveBeenCalledWith(
				"pty-notify",
				expect.any(Function),
			);

			const callback = listenMock.mock.calls.find(
				(call) => call[0] === "pty-notify",
			)?.[1] as (event: { payload: string }) => void;
			expect(callback).toBeDefined();

			callback({ payload: "session-xyz" });
			expect(getState().notifiedTabs.has("session-xyz")).toBe(true);
		});
	});

	describe("updateTabTitle edge cases", () => {
		it("can set title to empty string", () => {
			getState().addTab("p1", termTab("s1", "Old"));
			getState().updateTabTitle("p1", "s1", "");
			expect(getState().profiles.p1.tabs[0].title).toBe("");
		});

		it("updates only the targeted tab when multiple exist", () => {
			getState().addTab("p1", termTab("s1", "T1"));
			getState().addTab("p1", termTab("s2", "T2"));
			getState().addTab("p1", termTab("s3", "T3"));
			getState().updateTabTitle("p1", "s2", "Updated");
			expect(getState().profiles.p1.tabs[0].title).toBe("T1");
			expect(getState().profiles.p1.tabs[1].title).toBe("Updated");
			expect(getState().profiles.p1.tabs[2].title).toBe("T3");
		});
	});
});
