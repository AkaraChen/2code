import type { StateCreator } from "zustand";
import type { TabStore } from "../store";
import type { ProfileTab } from "../types";

export interface TabSlice {
	addTab: (profileId: string, tab: ProfileTab) => void;
	closeTab: (profileId: string, tabId: string) => void;
	setActiveTab: (profileId: string, tabId: string) => void;
	updateTabTitle: (profileId: string, tabId: string, title: string) => void;
	replaceTab: (profileId: string, oldTabId: string, newTab: ProfileTab) => void;
	updateAgentSessionId: (profileId: string, tabId: string, newSessionId: string) => void;
}

export const createTabSlice: StateCreator<
	TabStore,
	[["zustand/immer", never]],
	[],
	TabSlice
> = (set) => ({
	addTab: (profileId, tab) =>
		set((state) => {
			const existing = state.profiles[profileId] ?? {
				tabs: [],
				activeTabId: null,
				counter: 0,
			};
			state.profiles[profileId] = {
				tabs: [...existing.tabs, tab],
				activeTabId: tab.id,
				counter: existing.counter + 1,
			};
		}),

	closeTab: (profileId, tabId) =>
		set((state) => {
			const profile = state.profiles[profileId];
			if (!profile) return;

			const tab = profile.tabs.find((t) => t.id === tabId);

			// Clean up notifications for terminal panes
			if (tab?.type === "terminal") {
				for (const pane of tab.panes) {
					state.notifiedTabs.delete(pane.sessionId);
				}
			}

			const idx = profile.tabs.findIndex((t) => t.id === tabId);
			profile.tabs = profile.tabs.filter((t) => t.id !== tabId);

			if (profile.tabs.length === 0) {
				delete state.profiles[profileId];
				return;
			}

			if (tabId === profile.activeTabId) {
				const newIdx = Math.min(idx, profile.tabs.length - 1);
				profile.activeTabId = profile.tabs[newIdx].id;
			}
		}),

	setActiveTab: (profileId, tabId) =>
		set((state) => {
			const profile = state.profiles[profileId];
			if (!profile) return;
			profile.activeTabId = tabId;
			// Clear pane notifications for the newly-focused terminal tab
			const tab = profile.tabs.find((t) => t.id === tabId);
			if (tab?.type === "terminal") {
				for (const pane of tab.panes) {
					state.notifiedTabs.delete(pane.sessionId);
				}
			}
		}),

	updateTabTitle: (profileId, tabId, title) =>
		set((state) => {
			const profile = state.profiles[profileId];
			if (!profile) return;
			const tab = profile.tabs.find((t) => t.id === tabId);
			if (tab && tab.title !== title) tab.title = title;
		}),

	replaceTab: (profileId, oldTabId, newTab) =>
		set((state) => {
			const profile = state.profiles[profileId];
			if (!profile) return;
			const idx = profile.tabs.findIndex((t) => t.id === oldTabId);
			if (idx === -1) return;
			profile.tabs[idx] = newTab;
			if (profile.activeTabId === oldTabId) {
				profile.activeTabId = newTab.id;
			}
		}),

	updateAgentSessionId: (profileId, tabId, newSessionId) =>
		set((state) => {
			const profile = state.profiles[profileId];
			if (!profile) return;
			const tab = profile.tabs.find((t) => t.id === tabId);
			if (!tab || tab.type !== "agent") return;
			tab.sessionId = newSessionId;
		}),
});
