import { renderHook, act } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { listen } from "@tauri-apps/api/event";
import {
	useTerminalStore,
	useTerminalProfileIds,
	useProfileAgentStatus,
	useProfileHasNotification,
} from "./store";

function resetStore() {
	useTerminalStore.setState({
		profiles: {},
		agentStatuses: {},
		sessionProfileIds: {},
	});
	window.history.pushState({}, "", "/");
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

		it("keeps existing agent status when adding a matching tab", () => {
			getState().setAgentStatus("s1", "running");
			getState().addTab("p1", "s1", "Shell 1");
			expect(getState().agentStatuses.s1).toBe("running");
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

		it("removes the tab from agentStatuses", () => {
			getState().addTab("p1", "s1", "T1");
			getState().addTab("p1", "s2", "T2");
			getState().setAgentStatus("s1", "running");
			expect(getState().agentStatuses.s1).toBe("running");
			getState().closeTab("p1", "s1");
			expect(getState().agentStatuses.s1).toBeUndefined();
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

		it("keeps agent status on the newly focused tab after closing the active tab", () => {
			getState().addTab("p1", "s1", "T1");
			getState().addTab("p1", "s2", "T2");
			getState().setAgentStatus("s1", "running");
			getState().closeTab("p1", "s2");
			expect(getState().profiles.p1.activeTabId).toBe("s1");
			expect(getState().agentStatuses.s1).toBe("running");
		});
	});

	describe("setActiveTab", () => {
		it("sets the activeTabId for the profile", () => {
			getState().addTab("p1", "s1", "T1");
			getState().addTab("p1", "s2", "T2");
			getState().setActiveTab("p1", "s1");
			expect(getState().profiles.p1.activeTabId).toBe("s1");
		});

		it("does not clear agent status when the tab becomes active", () => {
			getState().addTab("p1", "s1", "T1");
			getState().addTab("p1", "s2", "T2");
			getState().setAgentStatus("s1", "waiting");
			getState().setActiveTab("p1", "s1");
			expect(getState().agentStatuses.s1).toBe("waiting");
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

	describe("setAgentStatus", () => {
		it("stores a running status for a session", () => {
			getState().setAgentStatus("s1", "running");
			expect(getState().agentStatuses.s1).toBe("running");
		});

		it("overwrites the same session status", () => {
			getState().setAgentStatus("s1", "running");
			getState().setAgentStatus("s1", "waiting");
			expect(getState().agentStatuses).toEqual({ s1: "waiting" });
		});

		it("keeps status for active tabs", () => {
			getState().addTab("p1", "s1", "T1");
			getState().setAgentStatus("s1", "waiting");
			expect(getState().agentStatuses.s1).toBe("waiting");
		});

		it("clears a session status when idle is received", () => {
			getState().setAgentStatus("s1", "running");
			getState().setAgentStatus("s1", "idle");
			expect(getState().agentStatuses.s1).toBeUndefined();
		});
	});

	describe("clearAgentStatus", () => {
		it("removes a session from agentStatuses", () => {
			getState().setAgentStatus("s1", "running");
			getState().clearAgentStatus("s1");
			expect(getState().agentStatuses.s1).toBeUndefined();
		});

		it("is idempotent (removing non-existent ID)", () => {
			expect(() =>
				getState().clearAgentStatus("nonexistent"),
			).not.toThrow();
		});
	});

	describe("closeTab edge cases", () => {
		it("closing a tabId that does not exist in tabs array is a no-op", () => {
			getState().addTab("p1", "s1", "T1");
			getState().addTab("p1", "s2", "T2");
			getState().closeTab("p1", "ghost");
			// Tabs unchanged
			expect(getState().profiles.p1.tabs).toHaveLength(2);
			expect(getState().profiles.p1.activeTabId).toBe("s2");
		});

		it("closing all tabs one by one removes the profile", () => {
			getState().addTab("p1", "s1", "T1");
			getState().addTab("p1", "s2", "T2");
			getState().addTab("p1", "s3", "T3");
			getState().closeTab("p1", "s3");
			getState().closeTab("p1", "s2");
			getState().closeTab("p1", "s1");
			expect(getState().profiles.p1).toBeUndefined();
		});

		it("closing tabs from one profile does not affect another", () => {
			getState().addTab("p1", "s1", "T1");
			getState().addTab("p2", "s2", "T2");
			getState().closeTab("p1", "s1");
			expect(getState().profiles.p1).toBeUndefined();
			expect(getState().profiles.p2).toBeDefined();
			expect(getState().profiles.p2.tabs).toHaveLength(1);
		});

		it("clears agent status even when closing the last tab (profile deleted)", () => {
			getState().addTab("p1", "s1", "T1");
			getState().setAgentStatus("s1", "running");
			getState().closeTab("p1", "s1");
			expect(getState().agentStatuses.s1).toBeUndefined();
			expect(getState().profiles.p1).toBeUndefined();
		});
	});

	describe("addTab edge cases", () => {
		it("empty string IDs are valid", () => {
			getState().addTab("", "", "");
			expect(getState().profiles[""]).toBeDefined();
			expect(getState().profiles[""].tabs[0]).toEqual({
				id: "",
				title: "",
			});
		});

		it("counter persists after closing tabs and adding new ones", () => {
			getState().addTab("p1", "s1", "T1"); // counter=1
			getState().addTab("p1", "s2", "T2"); // counter=2
			getState().closeTab("p1", "s1");
			getState().addTab("p1", "s3", "T3"); // counter=3
			expect(getState().profiles.p1.counter).toBe(3);
		});

		it("adding a tab with duplicate sessionId creates duplicate entries", () => {
			getState().addTab("p1", "s1", "T1");
			getState().addTab("p1", "s1", "T2");
			// No dedup — both entries exist
			expect(getState().profiles.p1.tabs).toHaveLength(2);
			expect(getState().profiles.p1.tabs[0].id).toBe("s1");
			expect(getState().profiles.p1.tabs[1].id).toBe("s1");
		});
	});

	describe("agent status edge cases", () => {
		it("tracks statuses on different tabs", () => {
			getState().addTab("p1", "s1", "T1");
			getState().addTab("p1", "s2", "T2");
			getState().setAgentStatus("s1", "running");
			getState().setAgentStatus("s2", "waiting");
			expect(getState().agentStatuses).toEqual({
				s1: "running",
				s2: "waiting",
			});
		});

		it("setAgentStatus for non-existent session does not throw", () => {
			expect(() =>
				getState().setAgentStatus("ghost", "running"),
			).not.toThrow();
			expect(getState().agentStatuses.ghost).toBe("running");
		});

		it("closing a status tab and re-adding a new session starts without status", () => {
			getState().addTab("p1", "s1", "T1");
			getState().addTab("p1", "s2", "T2");
			getState().setAgentStatus("s1", "waiting");
			getState().closeTab("p1", "s1");
			getState().addTab("p1", "s1-new", "T1 New");
			expect(getState().agentStatuses.s1).toBeUndefined();
			expect(getState().agentStatuses["s1-new"]).toBeUndefined();
		});

		it("setActiveTab on already-active tab still keeps status", () => {
			getState().addTab("p1", "s1", "T1");
			getState().setAgentStatus("s1", "waiting");
			getState().setActiveTab("p1", "s1");
			expect(getState().agentStatuses.s1).toBe("waiting");
		});
	});

	describe("useTerminalProfileIds", () => {
		it("returns empty array when no profiles exist", () => {
			const { result } = renderHook(() => useTerminalProfileIds());
			expect(result.current).toEqual([]);
		});

		it("returns profile IDs when profiles exist", () => {
			getState().addTab("p1", "s1", "T1");
			getState().addTab("p2", "s2", "T2");
			const { result } = renderHook(() => useTerminalProfileIds());
			expect(result.current).toEqual(
				expect.arrayContaining(["p1", "p2"]),
			);
			expect(result.current).toHaveLength(2);
		});

		it("reflects changes after adding/removing profiles", () => {
			getState().addTab("p1", "s1", "T1");
			const { result } = renderHook(() => useTerminalProfileIds());
			expect(result.current).toEqual(["p1"]);

			act(() => {
				getState().addTab("p2", "s2", "T2");
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

		it("returns false when profile has no active agent status", () => {
			getState().addTab("p1", "s1", "T1");
			const { result } = renderHook(() =>
				useProfileHasNotification("p1"),
			);
			expect(result.current).toBe(false);
		});

		it("returns true when profile has a running tab", () => {
			getState().addTab("p1", "s1", "T1");
			getState().setAgentStatus("s1", "running");
			const { result } = renderHook(() =>
				useProfileHasNotification("p1"),
			);
			expect(result.current).toBe(true);
		});

		it("returns true when any tab in profile is waiting", () => {
			getState().addTab("p1", "s1", "T1");
			getState().addTab("p1", "s2", "T2");
			getState().setAgentStatus("s2", "waiting");
			const { result } = renderHook(() =>
				useProfileHasNotification("p1"),
			);
			expect(result.current).toBe(true);
		});

		it("returns false after status is cleared", () => {
			getState().addTab("p1", "s1", "T1");
			getState().setAgentStatus("s1", "running");
			getState().clearAgentStatus("s1");
			const { result } = renderHook(() =>
				useProfileHasNotification("p1"),
			);
			expect(result.current).toBe(false);
		});
	});

	describe("useProfileAgentStatus", () => {
		it("returns null when no profile tabs have status", () => {
			getState().addTab("p1", "s1", "T1");
			const { result } = renderHook(() => useProfileAgentStatus("p1"));
			expect(result.current).toBeNull();
		});

		it("returns running when the profile has a running tab", () => {
			getState().addTab("p1", "s1", "T1");
			getState().setAgentStatus("s1", "running");
			const { result } = renderHook(() => useProfileAgentStatus("p1"));
			expect(result.current).toBe("running");
		});

		it("prioritizes waiting over running", () => {
			getState().addTab("p1", "s1", "T1");
			getState().addTab("p1", "s2", "T2");
			getState().setAgentStatus("s1", "running");
			getState().setAgentStatus("s2", "waiting");
			const { result } = renderHook(() => useProfileAgentStatus("p1"));
			expect(result.current).toBe("waiting");
		});
	});

	describe("pty-agent-status listener", () => {
		it("updates status when pty-agent-status event fires", () => {
			// The listen mock was called at module load time
			const listenMock = vi.mocked(listen);
			expect(listenMock).toHaveBeenCalledWith(
				"pty-agent-status",
				expect.any(Function),
			);

			// Extract the callback that was registered
			const callback = listenMock.mock.calls.find(
				(call) => call[0] === "pty-agent-status",
			)?.[1] as (event: {
				payload: { sessionId: string; status: "running" };
			}) => void;
			expect(callback).toBeDefined();

			callback({ payload: { sessionId: "session-xyz", status: "running" } });
			expect(getState().agentStatuses["session-xyz"]).toBe("running");
		});

		it("clears status when an idle event fires with snake_case payload", () => {
			const listenMock = vi.mocked(listen);
			const callback = listenMock.mock.calls.find(
				(call) => call[0] === "pty-agent-status",
			)?.[1] as (event: {
				payload: { session_id: string; status: "idle" };
			}) => void;
			getState().setAgentStatus("session-xyz", "waiting");
			callback({ payload: { session_id: "session-xyz", status: "idle" } });
			expect(getState().agentStatuses["session-xyz"]).toBeUndefined();
		});
	});

	describe("removeStaleProfiles edge cases", () => {
		it("validIds with extra IDs that don't exist in profiles is fine", () => {
			getState().addTab("p1", "s1", "T1");
			getState().removeStaleProfiles(
				new Set(["p1", "p99", "p100"]),
			);
			expect(getState().profiles.p1).toBeDefined();
			expect(Object.keys(getState().profiles)).toHaveLength(1);
		});

		it("called on empty profiles is a no-op", () => {
			expect(() =>
				getState().removeStaleProfiles(new Set(["p1"])),
			).not.toThrow();
			expect(Object.keys(getState().profiles)).toHaveLength(0);
		});
	});

	describe("updateTabTitle edge cases", () => {
		it("can set title to empty string", () => {
			getState().addTab("p1", "s1", "Old");
			getState().updateTabTitle("p1", "s1", "");
			expect(getState().profiles.p1.tabs[0].title).toBe("");
		});

		it("updates only the targeted tab when multiple exist", () => {
			getState().addTab("p1", "s1", "T1");
			getState().addTab("p1", "s2", "T2");
			getState().addTab("p1", "s3", "T3");
			getState().updateTabTitle("p1", "s2", "Updated");
			expect(getState().profiles.p1.tabs[0].title).toBe("T1");
			expect(getState().profiles.p1.tabs[1].title).toBe("Updated");
			expect(getState().profiles.p1.tabs[2].title).toBe("T3");
		});
	});
});
