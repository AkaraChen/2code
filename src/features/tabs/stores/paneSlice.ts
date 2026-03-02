import type { StateCreator } from "zustand";
import type { TabStore } from "../store";
import type { TerminalPane } from "../types";

export interface PaneSlice {
	addPane: (profileId: string, tabId: string, pane: TerminalPane) => void;
	closePane: (profileId: string, tabId: string, paneSessionId: string) => void;
	setActivePane: (profileId: string, tabId: string, paneSessionId: string) => void;
	updatePaneTitle: (profileId: string, tabId: string, paneSessionId: string, title: string) => void;
}

export const createPaneSlice: StateCreator<
	TabStore,
	[["zustand/immer", never]],
	[],
	PaneSlice
> = (set) => ({
	addPane: (profileId, tabId, pane) =>
		set((state) => {
			const profile = state.profiles[profileId];
			if (!profile) return;
			const tab = profile.tabs.find((t) => t.id === tabId);
			if (!tab || tab.type !== "terminal") return;
			tab.panes.push(pane);
			tab.activePaneId = pane.sessionId;
		}),

	closePane: (profileId, tabId, paneSessionId) =>
		set((state) => {
			const profile = state.profiles[profileId];
			if (!profile) return;
			const tab = profile.tabs.find((t) => t.id === tabId);
			if (!tab || tab.type !== "terminal") return;

			const paneIdx = tab.panes.findIndex((p) => p.sessionId === paneSessionId);
			if (paneIdx === -1) return;

			tab.panes.splice(paneIdx, 1);
			state.notifiedTabs.delete(paneSessionId);

			if (tab.panes.length === 0) {
				// Last pane closed — remove the entire tab
				const tabIdx = profile.tabs.findIndex((t) => t.id === tabId);
				profile.tabs.splice(tabIdx, 1);

				if (profile.tabs.length === 0) {
					delete state.profiles[profileId];
				} else if (tabId === profile.activeTabId) {
					const newIdx = Math.min(tabIdx, profile.tabs.length - 1);
					profile.activeTabId = profile.tabs[newIdx].id;
				}
			} else if (paneSessionId === tab.activePaneId) {
				// Active pane was closed — switch to adjacent
				const newIdx = Math.min(paneIdx, tab.panes.length - 1);
				tab.activePaneId = tab.panes[newIdx].sessionId;
			}
		}),

	setActivePane: (profileId, tabId, paneSessionId) =>
		set((state) => {
			const profile = state.profiles[profileId];
			if (!profile) return;
			const tab = profile.tabs.find((t) => t.id === tabId);
			if (!tab || tab.type !== "terminal") return;
			tab.activePaneId = paneSessionId;
		}),

	updatePaneTitle: (profileId, tabId, paneSessionId, title) =>
		set((state) => {
			const profile = state.profiles[profileId];
			if (!profile) return;
			const tab = profile.tabs.find((t) => t.id === tabId);
			if (!tab || tab.type !== "terminal") return;
			const pane = tab.panes.find((p) => p.sessionId === paneSessionId);
			if (pane && pane.title !== title) pane.title = title;
		}),
});
