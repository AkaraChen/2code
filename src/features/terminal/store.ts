import { listen } from "@tauri-apps/api/event";
import { create as createMutative, type Draft } from "mutative";
import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";

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

function refreshSessionProfileId(
	state: Pick<TerminalStore, "profiles" | "sessionProfileIds">,
	sessionId: string,
) {
	const profileId = findProfileIdBySessionId(state.profiles, sessionId);
	if (profileId) {
		state.sessionProfileIds[sessionId] = profileId;
	} else {
		delete state.sessionProfileIds[sessionId];
	}
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
	sessionProfileIds: Record<string, string>;
	addTab: (profileId: string, sessionId: string, title: string) => void;
	closeTab: (profileId: string, tabId: string) => void;
	setActiveTab: (profileId: string, tabId: string) => void;
	removeProfile: (profileId: string) => void;
	updateTabTitle: (profileId: string, tabId: string, title: string) => void;
	removeStaleProfiles: (validIds: Set<string>) => void;
	markNotified: (sessionId: string) => void;
	markRead: (sessionId: string) => void;
	markProfileRead: (profileId: string) => void;
}

export const useTerminalStore = create<TerminalStore>()((set) => {
	const mutate = (recipe: (state: Draft<TerminalStore>) => void) => {
		set((state) => createMutative(state, recipe));
	};

	return {
		profiles: {},
		notifiedTabs: new Set<string>(),
		sessionProfileIds: {},

		addTab(profileId, sessionId, title) {
			mutate((state) => {
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
				state.sessionProfileIds[sessionId] ??= profileId;

				if (getFocusedProfileId() === profileId) {
					clearProfileActiveTabNotification(state, profileId);
				}
			});
		},

		closeTab(profileId, tabId) {
			mutate((state) => {
				const profile = state.profiles[profileId];
				if (!profile) return;
				const wasActiveTab = tabId === profile.activeTabId;

				state.notifiedTabs.delete(tabId);

				const idx = profile.tabs.findIndex((t) => t.id === tabId);
				profile.tabs = profile.tabs.filter((t) => t.id !== tabId);
				refreshSessionProfileId(state, tabId);

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

		setActiveTab(profileId, tabId) {
			mutate((state) => {
				const profile = state.profiles[profileId];
				if (!profile) return;
				profile.activeTabId = tabId;
				state.notifiedTabs.delete(tabId);
			});
		},

		removeProfile(profileId) {
			mutate((state) => {
				const profile = state.profiles[profileId];
				profile?.tabs.forEach((tab) => state.notifiedTabs.delete(tab.id));
				delete state.profiles[profileId];
				profile?.tabs.forEach((tab) =>
					refreshSessionProfileId(state, tab.id),
				);
			});
		},

		updateTabTitle(profileId, tabId, title) {
			mutate((state) => {
				const profile = state.profiles[profileId];
				if (!profile) return;
				const tab = profile.tabs.find((t) => t.id === tabId);
				if (tab && tab.title !== title) tab.title = title;
			});
		},

		removeStaleProfiles(validIds) {
			mutate((state) => {
				for (const id of Object.keys(state.profiles)) {
					if (!validIds.has(id)) {
						state.profiles[id].tabs.forEach((tab) =>
							state.notifiedTabs.delete(tab.id),
						);
						const removedSessionIds = state.profiles[id].tabs.map(
							(tab) => tab.id,
						);
						delete state.profiles[id];
						removedSessionIds.forEach((sessionId) =>
							refreshSessionProfileId(state, sessionId),
						);
					}
				}
			});
		},

		markNotified(sessionId) {
			mutate((state) => {
				const profileId = state.sessionProfileIds[sessionId] ?? null;
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
			mutate((state) => {
				state.notifiedTabs.delete(sessionId);
			});
		},

		markProfileRead(profileId) {
			mutate((state) => {
				const profile = state.profiles[profileId];
				if (!profile) return;
				profile.tabs.forEach((tab) => state.notifiedTabs.delete(tab.id));
			});
		},
	};
});

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
