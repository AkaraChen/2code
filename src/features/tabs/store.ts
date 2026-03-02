import { listen } from "@tauri-apps/api/event";
import { enableMapSet } from "immer";
import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import { persist } from "zustand/middleware";
import { useShallow } from "zustand/react/shallow";
import type { ProfileTab, TerminalPane } from "./types";

enableMapSet();

interface ProfileTabState {
	tabs: ProfileTab[];
	activeTabId: string | null;
	counter: number;
}

interface TabStore {
	profiles: Record<string, ProfileTabState>;
	notifiedTabs: Set<string>;
	addTab: (profileId: string, tab: ProfileTab) => void;
	closeTab: (profileId: string, tabId: string) => void;
	setActiveTab: (profileId: string, tabId: string) => void;
	removeProfile: (profileId: string) => void;
	updateTabTitle: (profileId: string, tabId: string, title: string) => void;
	replaceTab: (profileId: string, oldTabId: string, newTab: ProfileTab) => void;
	markNotified: (sessionId: string) => void;
	markRead: (sessionId: string) => void;
	addPane: (profileId: string, tabId: string, pane: TerminalPane) => void;
	closePane: (profileId: string, tabId: string, paneSessionId: string) => void;
	setActivePane: (profileId: string, tabId: string, paneSessionId: string) => void;
	updatePaneTitle: (profileId: string, tabId: string, paneSessionId: string, title: string) => void;
	/** Replace the entire state for a profile — used during restoration. */
	restoreProfile: (profileId: string, profileState: ProfileTabState) => void;
	/** Update the backend sessionId on an agent tab without changing its nanoid tab id. */
	updateAgentSessionId: (profileId: string, tabId: string, newSessionId: string) => void;
}

export const useTabStore = create<TabStore>()(
	persist(
		immer((set) => ({
			profiles: {},
			notifiedTabs: new Set<string>(),

			addTab(profileId, tab) {
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
				});
			},

			closeTab(profileId, tabId) {
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
				});
			},

			setActiveTab(profileId, tabId) {
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
				});
			},

			removeProfile(profileId) {
				set((state) => {
					delete state.profiles[profileId];
				});
			},

			updateTabTitle(profileId, tabId, title) {
				set((state) => {
					const profile = state.profiles[profileId];
					if (!profile) return;
					const tab = profile.tabs.find((t) => t.id === tabId);
					if (tab && tab.title !== title) tab.title = title;
				});
			},

			replaceTab(profileId, oldTabId, newTab) {
				set((state) => {
					const profile = state.profiles[profileId];
					if (!profile) return;
					const idx = profile.tabs.findIndex((t) => t.id === oldTabId);
					if (idx === -1) return;
					profile.tabs[idx] = newTab;
					if (profile.activeTabId === oldTabId) {
						profile.activeTabId = newTab.id;
					}
				});
			},


			markNotified(sessionId) {
				set((state) => {
					state.notifiedTabs.add(sessionId);
				});
			},

			markRead(sessionId) {
				set((state) => {
					state.notifiedTabs.delete(sessionId);
				});
			},

			addPane(profileId, tabId, pane) {
				set((state) => {
					const profile = state.profiles[profileId];
					if (!profile) return;
					const tab = profile.tabs.find((t) => t.id === tabId);
					if (!tab || tab.type !== "terminal") return;
					tab.panes.push(pane);
					tab.activePaneId = pane.sessionId;
				});
			},

			closePane(profileId, tabId, paneSessionId) {
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
				});
			},

			setActivePane(profileId, tabId, paneSessionId) {
				set((state) => {
					const profile = state.profiles[profileId];
					if (!profile) return;
					const tab = profile.tabs.find((t) => t.id === tabId);
					if (!tab || tab.type !== "terminal") return;
					tab.activePaneId = paneSessionId;
				});
			},

			updatePaneTitle(profileId, tabId, paneSessionId, title) {
				set((state) => {
					const profile = state.profiles[profileId];
					if (!profile) return;
					const tab = profile.tabs.find((t) => t.id === tabId);
					if (!tab || tab.type !== "terminal") return;
					const pane = tab.panes.find((p) => p.sessionId === paneSessionId);
					if (pane && pane.title !== title) pane.title = title;
				});
			},

			restoreProfile(profileId, profileState) {
				set((state) => {
					state.profiles[profileId] = profileState;
				});
			},

			updateAgentSessionId(profileId, tabId, newSessionId) {
				set((state) => {
					const profile = state.profiles[profileId];
					if (!profile) return;
					const tab = profile.tabs.find((t) => t.id === tabId);
					if (!tab || tab.type !== "agent") return;
					tab.sessionId = newSessionId;
				});
			},
		})),
		{
			name: "tab-layout",
			version: 1,
			// Only persist the tab layout (profiles). notifiedTabs is ephemeral.
			partialize: (state) => ({ profiles: state.profiles }),
		},
	),
);

/** IDs of profiles that currently have tabs open. */
export function useTabProfileIds() {
	return useTabStore(useShallow((s) => Object.keys(s.profiles)));
}

/** Whether a profile has any tab with an unread notification. */
export function useProfileHasNotification(profileId: string): boolean {
	return useTabStore((s) => {
		const profile = s.profiles[profileId];
		if (!profile) return false;
		return profile.tabs.some((t) => {
			if (t.type === "terminal") {
				return t.panes.some((p) => s.notifiedTabs.has(p.sessionId));
			}
			// Agent sessions don't emit pty-notify, so never in notifiedTabs
			return false;
		});
	});
}

// Module-level listener for notification events from the backend
listen<string>("pty-notify", (event) => {
	useTabStore.getState().markNotified(event.payload);
});
