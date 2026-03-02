import { describe, it, expect, beforeEach } from "vitest";
import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import { enableMapSet } from "immer";

enableMapSet();
import { createTabSlice, type TabSlice } from "./tabSlice";
import { type ProfileSlice, createProfileSlice } from "./profileSlice";
import { type NotificationSlice, createNotificationSlice } from "./notificationSlice";
import type { ProfileTab } from "../types";

type TestStore = TabSlice & ProfileSlice & NotificationSlice;

const useMockStore = create<TestStore>()(
	immer((...a) => ({
		...(createProfileSlice as any)(...a),
		...(createTabSlice as any)(...a),
		...(createNotificationSlice as any)(...a),
	}))
);

describe("tabSlice", () => {
	beforeEach(() => {
		useMockStore.setState({
			profiles: {},
			notifiedTabs: new Set<string>(),
		});
	});

	it("should add a tab", () => {
		const tab: ProfileTab = {
			type: "terminal",
			id: "tab1",
			title: "Shell",
			panes: [],
			activePaneId: "pane1"
		};

		useMockStore.getState().addTab("prof1", tab);

		const profile = useMockStore.getState().profiles.prof1;
		expect(profile.tabs).toHaveLength(1);
		expect(profile.tabs[0].id).toBe("tab1");
		expect(profile.activeTabId).toBe("tab1");
		expect(profile.counter).toBe(1);
	});

	it("should close a tab and remove profile if empty", () => {
		useMockStore.setState({
			profiles: {
				prof1: {
					tabs: [{ type: "terminal", id: "tab1", title: "Shell", panes: [], activePaneId: "" }],
					activeTabId: "tab1",
					counter: 1
				}
			}
		});

		useMockStore.getState().closeTab("prof1", "tab1");
		expect(useMockStore.getState().profiles.prof1).toBeUndefined();
	});

	it("should close a tab and cleanup notifications", () => {
		useMockStore.setState({
			notifiedTabs: new Set(["session1"]),
			profiles: {
				prof1: {
					tabs: [
						{ type: "terminal", id: "tab1", title: "Shell", panes: [{ sessionId: "session1", title: "t" }], activePaneId: "session1" },
						{ type: "terminal", id: "tab2", title: "Shell 2", panes: [{ sessionId: "session2", title: "t" }], activePaneId: "session2" }
					],
					activeTabId: "tab1",
					counter: 2
				}
			}
		});

		useMockStore.getState().closeTab("prof1", "tab1");
		expect(useMockStore.getState().profiles.prof1.tabs).toHaveLength(1);
		expect(useMockStore.getState().notifiedTabs.has("session1")).toBe(false);
	});
});
