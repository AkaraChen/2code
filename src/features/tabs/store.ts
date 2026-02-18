import { listen } from "@tauri-apps/api/event";
import { enableMapSet } from "immer";
import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import { useShallow } from "zustand/react/shallow";
import type { ProfileTab } from "./types";

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
	removeStaleProfiles: (validIds: Set<string>) => void;
	markNotified: (sessionId: string) => void;
	markRead: (sessionId: string) => void;
}

export const useTabStore = create<TabStore>()(
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

				state.notifiedTabs.delete(tabId);

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
				state.notifiedTabs.delete(tabId);
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

		removeStaleProfiles(validIds) {
			set((state) => {
				for (const id of Object.keys(state.profiles)) {
					if (!validIds.has(id)) delete state.profiles[id];
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
	})),
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
		return profile.tabs.some((t) => s.notifiedTabs.has(t.id));
	});
}

// Module-level listener for notification events from the backend
listen<string>("pty-notify", (event) => {
	useTabStore.getState().markNotified(event.payload);
});
