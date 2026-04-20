import { listen } from "@tauri-apps/api/event";
import { enableMapSet } from "immer";
import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import { useShallow } from "zustand/react/shallow";

enableMapSet();

interface TerminalTab {
	id: string;
	title: string;
}

interface ProjectTerminalState {
	tabs: TerminalTab[];
	activeTabId: string | null;
	counter: number;
}

const PROFILE_PATH_REGEX = /^\/projects\/[^/]+\/profiles\/([^/]+)$/;

function getFocusedProfileId(): string | null {
	if (typeof window === "undefined") return null;
	return window.location.pathname.match(PROFILE_PATH_REGEX)?.[1] ?? null;
}

function findProfileIdBySessionId(
	profiles: Record<string, ProjectTerminalState>,
	sessionId: string,
): string | null {
	for (const [profileId, profile] of Object.entries(profiles)) {
		if (profile.tabs.some((tab) => tab.id === sessionId)) {
			return profileId;
		}
	}

	return null;
}

function clearProfileActiveTabNotification(
	state: Pick<TerminalStore, "profiles" | "notifiedTabs">,
	profileId: string | null,
) {
	if (!profileId) return;

	const activeTabId = state.profiles[profileId]?.activeTabId;
	if (activeTabId) {
		state.notifiedTabs.delete(activeTabId);
	}
}

interface TerminalStore {
	profiles: Record<string, ProjectTerminalState>;
	notifiedTabs: Set<string>;
	addTab: (profileId: string, sessionId: string, title: string) => void;
	closeTab: (profileId: string, tabId: string) => void;
	reorderTabs: (profileId: string, fromIndex: number, toIndex: number) => void;
	setActiveTab: (profileId: string, tabId: string) => void;
	removeProfile: (profileId: string) => void;
	updateTabTitle: (profileId: string, tabId: string, title: string) => void;
	removeStaleProfiles: (validIds: Set<string>) => void;
	markNotified: (sessionId: string) => void;
	markRead: (sessionId: string) => void;
	markProfileRead: (profileId: string) => void;
}

export const useTerminalStore = create<TerminalStore>()(
	immer((set) => ({
		profiles: {},
		notifiedTabs: new Set<string>(),

		addTab(profileId, sessionId, title) {
			set((state) => {
				const existing = state.profiles[profileId] ?? {
					tabs: [],
					activeTabId: null,
					counter: 0,
				};
				const tab: TerminalTab = { id: sessionId, title };
				state.profiles[profileId] = {
					tabs: [...existing.tabs, tab],
					activeTabId: tab.id,
					counter: existing.counter + 1,
				};

				if (getFocusedProfileId() === profileId) {
					clearProfileActiveTabNotification(state, profileId);
				}
			});
		},

		closeTab(profileId, tabId) {
			set((state) => {
				const profile = state.profiles[profileId];
				if (!profile) return;
				const wasActiveTab = tabId === profile.activeTabId;

				state.notifiedTabs.delete(tabId);

				const idx = profile.tabs.findIndex((t) => t.id === tabId);
				profile.tabs = profile.tabs.filter((t) => t.id !== tabId);

				if (profile.tabs.length === 0) {
					delete state.profiles[profileId];
					return;
				}

				if (wasActiveTab) {
					const newIdx = Math.min(idx, profile.tabs.length - 1);
					profile.activeTabId = profile.tabs[newIdx].id;
					if (getFocusedProfileId() === profileId) {
						clearProfileActiveTabNotification(state, profileId);
					}
				}
			});
		},

		reorderTabs(profileId, fromIndex, toIndex) {
			set((state) => {
				const profile = state.profiles[profileId];
				if (
					!profile ||
					fromIndex === toIndex ||
					fromIndex < 0 ||
					toIndex < 0 ||
					fromIndex >= profile.tabs.length ||
					toIndex >= profile.tabs.length
				) {
					return;
				}

				const [movedTab] = profile.tabs.splice(fromIndex, 1);
				if (!movedTab) return;
				profile.tabs.splice(toIndex, 0, movedTab);
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
				const profile = state.profiles[profileId];
				profile?.tabs.forEach((tab) => state.notifiedTabs.delete(tab.id));
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

		removeStaleProfiles(validIds) {
			set((state) => {
				for (const id of Object.keys(state.profiles)) {
					if (!validIds.has(id)) {
						state.profiles[id].tabs.forEach((tab) =>
							state.notifiedTabs.delete(tab.id),
						);
						delete state.profiles[id];
					}
				}
			});
		},

		markNotified(sessionId) {
			set((state) => {
				const profileId = findProfileIdBySessionId(
					state.profiles,
					sessionId,
				);
				if (
					profileId &&
					profileId === getFocusedProfileId() &&
					state.profiles[profileId]?.activeTabId === sessionId
				) {
					state.notifiedTabs.delete(sessionId);
					return;
				}

				state.notifiedTabs.add(sessionId);
			});
		},

		markRead(sessionId) {
			set((state) => {
				state.notifiedTabs.delete(sessionId);
			});
		},

		markProfileRead(profileId) {
			set((state) => {
				const profile = state.profiles[profileId];
				if (!profile) return;
				profile.tabs.forEach((tab) => state.notifiedTabs.delete(tab.id));
			});
		},
	})),
);

/** IDs of profiles that currently have terminal tabs open. */
export function useTerminalProfileIds() {
	return useTerminalStore(useShallow((s) => Object.keys(s.profiles)));
}

/** Whether a profile has any tab with an unread notification. */
export function useProfileHasNotification(profileId: string): boolean {
	return useTerminalStore((s) => {
		const profile = s.profiles[profileId];
		if (!profile) return false;
		return profile.tabs.some((t) => s.notifiedTabs.has(t.id));
	});
}

// Module-level listener for notification events from the backend
listen<string>("pty-notify", (event) => {
	useTerminalStore.getState().markNotified(event.payload);
});
