import { beforeEach, describe, expect, it } from "vitest";
import { useTerminalStore } from "./store";

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
			getState().addTab("p1", "s1", "Shell");
			const profile = getState().profiles.p1;
			expect(profile).toBeDefined();
			expect(profile.tabs).toEqual([{ id: "s1", title: "Shell" }]);
			expect(profile.activeTabId).toBe("s1");
			expect(profile.counter).toBe(1);
		});

		it("appends to existing profile tabs", () => {
			getState().addTab("p1", "s1", "Shell 1");
			getState().addTab("p1", "s2", "Shell 2");
			const profile = getState().profiles.p1;
			expect(profile.tabs).toHaveLength(2);
			expect(profile.tabs[0].id).toBe("s1");
			expect(profile.tabs[1].id).toBe("s2");
		});

		it("sets activeTabId to the newly added tab", () => {
			getState().addTab("p1", "s1", "Shell 1");
			getState().addTab("p1", "s2", "Shell 2");
			getState().addTab("p1", "s3", "Shell 3");
			expect(getState().profiles.p1.activeTabId).toBe("s3");
		});

		it("increments counter for each tab added to same profile", () => {
			getState().addTab("p1", "s1", "Shell 1");
			getState().addTab("p1", "s2", "Shell 2");
			getState().addTab("p1", "s3", "Shell 3");
			expect(getState().profiles.p1.counter).toBe(3);
		});

		it("manages separate profiles independently", () => {
			getState().addTab("p1", "s1", "Shell 1");
			getState().addTab("p2", "s2", "Shell 2");
			expect(Object.keys(getState().profiles)).toHaveLength(2);
			expect(getState().profiles.p1.tabs).toHaveLength(1);
			expect(getState().profiles.p2.tabs).toHaveLength(1);
		});
	});

	describe("closeTab", () => {
		it("removes the tab from the profile", () => {
			getState().addTab("p1", "s1", "T1");
			getState().addTab("p1", "s2", "T2");
			getState().closeTab("p1", "s1");
			expect(getState().profiles.p1.tabs).toHaveLength(1);
			expect(getState().profiles.p1.tabs[0].id).toBe("s2");
		});

		it("deletes the profile when last tab is closed", () => {
			getState().addTab("p1", "s1", "T1");
			getState().closeTab("p1", "s1");
			expect(getState().profiles.p1).toBeUndefined();
		});

		it("removes the tab from notifiedTabs set", () => {
			getState().addTab("p1", "s1", "T1");
			getState().addTab("p1", "s2", "T2");
			getState().markNotified("s1");
			expect(getState().notifiedTabs.has("s1")).toBe(true);
			getState().closeTab("p1", "s1");
			expect(getState().notifiedTabs.has("s1")).toBe(false);
		});

		it("reassigns activeTab when closing the active mid-list tab", () => {
			// [s1, s2, s3], active=s2, close s2
			// idx=1, tabs now [s1, s3], Math.min(1, 1)=1, active=s3
			getState().addTab("p1", "s1", "T1");
			getState().addTab("p1", "s2", "T2");
			getState().addTab("p1", "s3", "T3");
			getState().setActiveTab("p1", "s2");
			getState().closeTab("p1", "s2");
			expect(getState().profiles.p1.activeTabId).toBe("s3");
		});

		it("reassigns activeTab when closing last tab in list", () => {
			// [s1, s2, s3], active=s3 (idx 2), close s3
			// tabs now [s1, s2], Math.min(2, 1)=1, active=s2
			getState().addTab("p1", "s1", "T1");
			getState().addTab("p1", "s2", "T2");
			getState().addTab("p1", "s3", "T3");
			// s3 is already active (last added)
			getState().closeTab("p1", "s3");
			expect(getState().profiles.p1.activeTabId).toBe("s2");
		});

		it("reassigns activeTab when closing first tab in list", () => {
			// [s1, s2, s3], active=s1 (idx 0), close s1
			// tabs now [s2, s3], Math.min(0, 1)=0, active=s2
			getState().addTab("p1", "s1", "T1");
			getState().addTab("p1", "s2", "T2");
			getState().addTab("p1", "s3", "T3");
			getState().setActiveTab("p1", "s1");
			getState().closeTab("p1", "s1");
			expect(getState().profiles.p1.activeTabId).toBe("s2");
		});

		it("does not change activeTab when closing a non-active tab", () => {
			getState().addTab("p1", "s1", "T1");
			getState().addTab("p1", "s2", "T2");
			getState().addTab("p1", "s3", "T3");
			// s3 is active (last added)
			getState().closeTab("p1", "s1");
			expect(getState().profiles.p1.activeTabId).toBe("s3");
		});

		it("no-ops when profile does not exist", () => {
			expect(() => getState().closeTab("nonexistent", "s1")).not.toThrow();
		});

		it("handles closing second tab when active is second of two", () => {
			// [s1, s2], active=s2, close s2
			// tabs [s1], Math.min(1, 0)=0, active=s1
			getState().addTab("p1", "s1", "T1");
			getState().addTab("p1", "s2", "T2");
			getState().closeTab("p1", "s2");
			expect(getState().profiles.p1.tabs).toHaveLength(1);
			expect(getState().profiles.p1.activeTabId).toBe("s1");
		});
	});

	describe("setActiveTab", () => {
		it("sets the activeTabId for the profile", () => {
			getState().addTab("p1", "s1", "T1");
			getState().addTab("p1", "s2", "T2");
			getState().setActiveTab("p1", "s1");
			expect(getState().profiles.p1.activeTabId).toBe("s1");
		});

		it("removes the tab from notifiedTabs (clears notification)", () => {
			getState().addTab("p1", "s1", "T1");
			getState().addTab("p1", "s2", "T2");
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
			getState().addTab("p1", "s1", "T1");
			getState().removeProfile("p1");
			expect(getState().profiles.p1).toBeUndefined();
		});

		it("no-ops when profile does not exist", () => {
			expect(() =>
				getState().removeProfile("nonexistent"),
			).not.toThrow();
		});
	});

	describe("updateTabTitle", () => {
		it("updates the title of the specified tab", () => {
			getState().addTab("p1", "s1", "Old Title");
			getState().updateTabTitle("p1", "s1", "New Title");
			expect(getState().profiles.p1.tabs[0].title).toBe("New Title");
		});

		it("does not update if the title is the same", () => {
			getState().addTab("p1", "s1", "Same");
			getState().updateTabTitle("p1", "s1", "Same");
			expect(getState().profiles.p1.tabs[0].title).toBe("Same");
		});

		it("no-ops when profile does not exist", () => {
			expect(() =>
				getState().updateTabTitle("nonexistent", "s1", "Title"),
			).not.toThrow();
		});

		it("no-ops when tab does not exist in profile", () => {
			getState().addTab("p1", "s1", "T1");
			expect(() =>
				getState().updateTabTitle("p1", "nonexistent", "Title"),
			).not.toThrow();
			expect(getState().profiles.p1.tabs[0].title).toBe("T1");
		});
	});

	describe("removeStaleProfiles", () => {
		it("removes profiles whose IDs are not in the valid set", () => {
			getState().addTab("p1", "s1", "T1");
			getState().addTab("p2", "s2", "T2");
			getState().addTab("p3", "s3", "T3");
			getState().removeStaleProfiles(new Set(["p1", "p3"]));
			expect(getState().profiles.p1).toBeDefined();
			expect(getState().profiles.p2).toBeUndefined();
			expect(getState().profiles.p3).toBeDefined();
		});

		it("keeps all profiles when all are valid", () => {
			getState().addTab("p1", "s1", "T1");
			getState().addTab("p2", "s2", "T2");
			getState().removeStaleProfiles(new Set(["p1", "p2"]));
			expect(Object.keys(getState().profiles)).toHaveLength(2);
		});

		it("removes all profiles when valid set is empty", () => {
			getState().addTab("p1", "s1", "T1");
			getState().addTab("p2", "s2", "T2");
			getState().removeStaleProfiles(new Set());
			expect(Object.keys(getState().profiles)).toHaveLength(0);
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
});
