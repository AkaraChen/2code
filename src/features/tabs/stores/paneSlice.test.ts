import { enableMapSet } from "immer";
import { beforeEach, describe, expect, it } from "vitest";
import { create } from "zustand";
import { immer } from "zustand/middleware/immer";

enableMapSet();
import {
	createNotificationSlice,
	type NotificationSlice,
} from "./notificationSlice";
import { createPaneSlice, type PaneSlice } from "./paneSlice";

type TestStore = PaneSlice & NotificationSlice & { profiles: any };

const useMockStore = create<TestStore>()(
	immer((...a) => ({
		profiles: {},
		...(createPaneSlice as any)(...a),
		...(createNotificationSlice as any)(...a),
	})),
);

describe("paneSlice", () => {
	beforeEach(() => {
		useMockStore.setState({
			notifiedTabs: new Set(),
			profiles: {
				prof1: {
					tabs: [
						{
							type: "terminal",
							id: "tab1",
							title: "Shell",
							panes: [],
							activePaneId: "",
						},
					],
					activeTabId: "tab1",
					counter: 1,
				},
			},
		});
	});

	it("should add a pane", () => {
		useMockStore
			.getState()
			.addPane("prof1", "tab1", { sessionId: "s1", title: "t1" });

		const tab = useMockStore.getState().profiles.prof1.tabs[0];
		expect(tab.panes).toHaveLength(1);
		expect(tab.panes[0].sessionId).toBe("s1");
		expect(tab.activePaneId).toBe("s1");
	});

	it("should close a pane and switch to adjacent", () => {
		useMockStore
			.getState()
			.addPane("prof1", "tab1", { sessionId: "s1", title: "t1" });
		useMockStore
			.getState()
			.addPane("prof1", "tab1", { sessionId: "s2", title: "t2" });

		useMockStore.getState().closePane("prof1", "tab1", "s2");
		const tab = useMockStore.getState().profiles.prof1.tabs[0];
		expect(tab.panes).toHaveLength(1);
		expect(tab.activePaneId).toBe("s1");
	});

	it("should cleanup notifications when closing a pane", () => {
		useMockStore.setState({ notifiedTabs: new Set(["s1"]) });
		useMockStore
			.getState()
			.addPane("prof1", "tab1", { sessionId: "s1", title: "t1" });

		useMockStore.getState().closePane("prof1", "tab1", "s1");
		expect(useMockStore.getState().notifiedTabs.has("s1")).toBe(false);
	});
});
