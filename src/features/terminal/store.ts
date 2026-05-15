import { listen } from "@tauri-apps/api/event";
import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";

export interface TerminalTab {
	id: string;
	title: string;
}

export interface ProjectTerminalState {
	tabs: TerminalTab[];
	activeTabId: string | null;
	counter: number;
}

interface TerminalDataState {
	profiles: Record<string, ProjectTerminalState>;
	notifiedTabs: Set<string>;
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

export function addTabState(
	state: TerminalDataState,
	profileId: string,
	sessionId: string,
	title: string,
) {
	const existing = state.profiles[profileId] ?? {
		tabs: [],
		activeTabId: null,
		counter: 0,
	};
	const tab: TerminalTab = { id: sessionId, title };
	const nextState: TerminalDataState = {
		profiles: {
			...state.profiles,
			[profileId]: {
				tabs: [...existing.tabs, tab],
				activeTabId: tab.id,
				counter: existing.counter + 1,
			},
		},
		notifiedTabs: state.notifiedTabs,
	};

	if (getFocusedProfileId() !== profileId) {
		return nextState;
	}

	const activeTabId = nextState.profiles[profileId]?.activeTabId;
	if (!activeTabId || !nextState.notifiedTabs.has(activeTabId)) {
		return nextState;
	}

	const notifiedTabs = new Set(nextState.notifiedTabs);
	notifiedTabs.delete(activeTabId);
	return { ...nextState, notifiedTabs };
}

export function closeTabState(
	state: TerminalDataState,
	profileId: string,
	tabId: string,
) {
	const profile = state.profiles[profileId];
	if (!profile) return state;

	const idx = profile.tabs.findIndex((t) => t.id === tabId);
	if (idx === -1) return state;

	const tabs = profile.tabs.filter((t) => t.id !== tabId);
	const notifiedTabs = state.notifiedTabs.has(tabId)
		? new Set(state.notifiedTabs)
		: state.notifiedTabs;
	if (notifiedTabs !== state.notifiedTabs) {
		notifiedTabs.delete(tabId);
	}

	if (tabs.length === 0) {
		const profiles = { ...state.profiles };
		delete profiles[profileId];
		return { profiles, notifiedTabs };
	}

	let activeTabId = profile.activeTabId;
	if (tabId === profile.activeTabId) {
		const newIdx = Math.min(idx, tabs.length - 1);
		activeTabId = tabs[newIdx].id;
	}

	let nextNotifiedTabs = notifiedTabs;
	if (
		tabId === profile.activeTabId &&
		getFocusedProfileId() === profileId &&
		activeTabId &&
		nextNotifiedTabs.has(activeTabId)
	) {
		nextNotifiedTabs = new Set(nextNotifiedTabs);
		nextNotifiedTabs.delete(activeTabId);
	}

	return {
		profiles: {
			...state.profiles,
			[profileId]: {
				...profile,
				tabs,
				activeTabId,
			},
		},
		notifiedTabs: nextNotifiedTabs,
	};
}

export function setActiveTabState(
	state: TerminalDataState,
	profileId: string,
	tabId: string,
) {
	const profile = state.profiles[profileId];
	if (!profile) return state;

	const notifiedTabs = state.notifiedTabs.has(tabId)
		? new Set(state.notifiedTabs)
		: state.notifiedTabs;
	if (notifiedTabs !== state.notifiedTabs) {
		notifiedTabs.delete(tabId);
	}

	return {
		profiles: {
			...state.profiles,
			[profileId]: {
				...profile,
				activeTabId: tabId,
			},
		},
		notifiedTabs,
	};
}

export function markNotifiedState(
	state: TerminalDataState,
	sessionId: string,
) {
	const profileId = findProfileIdBySessionId(state.profiles, sessionId);
	if (
		profileId &&
		profileId === getFocusedProfileId() &&
		state.profiles[profileId]?.activeTabId === sessionId
	) {
		if (!state.notifiedTabs.has(sessionId)) return state;
		const notifiedTabs = new Set(state.notifiedTabs);
		notifiedTabs.delete(sessionId);
		return { ...state, notifiedTabs };
	}

	if (state.notifiedTabs.has(sessionId)) return state;
	const notifiedTabs = new Set(state.notifiedTabs);
	notifiedTabs.add(sessionId);
	return { ...state, notifiedTabs };
}

export function markReadState(state: TerminalDataState, sessionId: string) {
	if (!state.notifiedTabs.has(sessionId)) return state;
	const notifiedTabs = new Set(state.notifiedTabs);
	notifiedTabs.delete(sessionId);
	return { ...state, notifiedTabs };
}

interface TerminalStore extends TerminalDataState {
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

export const useTerminalStore = create<TerminalStore>()((set) => ({
	profiles: {},
	notifiedTabs: new Set<string>(),

	addTab(profileId, sessionId, title) {
		set((state) => addTabState(state, profileId, sessionId, title));
	},

	closeTab(profileId, tabId) {
		set((state) => closeTabState(state, profileId, tabId));
	},

	setActiveTab(profileId, tabId) {
		set((state) => setActiveTabState(state, profileId, tabId));
	},

	removeProfile(profileId) {
		set((state) => {
			const profile = state.profiles[profileId];
			if (!profile) return state;
			const profiles = { ...state.profiles };
			delete profiles[profileId];
			const notifiedTabs = new Set(state.notifiedTabs);
			for (const tab of profile.tabs) {
				notifiedTabs.delete(tab.id);
			}
			return { profiles, notifiedTabs };
		});
	},

	updateTabTitle(profileId, tabId, title) {
		set((state) => {
			const profile = state.profiles[profileId];
			if (!profile) return state;
			const index = profile.tabs.findIndex((t) => t.id === tabId);
			if (index === -1 || profile.tabs[index].title === title) {
				return state;
			}
			const tabs = [...profile.tabs];
			tabs[index] = { ...tabs[index], title };
			return {
				profiles: {
					...state.profiles,
					[profileId]: { ...profile, tabs },
				},
			};
		});
	},

	removeStaleProfiles(validIds) {
		set((state) => {
			let profiles: Record<string, ProjectTerminalState> | null = null;
			let notifiedTabs: Set<string> | null = null;
			for (const id of Object.keys(state.profiles)) {
				if (!validIds.has(id)) {
					profiles ??= { ...state.profiles };
					notifiedTabs ??= new Set(state.notifiedTabs);
					for (const tab of state.profiles[id].tabs) {
						notifiedTabs.delete(tab.id);
					}
					delete profiles[id];
				}
			}
			if (!profiles || !notifiedTabs) return state;
			return { profiles, notifiedTabs };
		});
	},

	markNotified(sessionId) {
		set((state) => markNotifiedState(state, sessionId));
	},

	markRead(sessionId) {
		set((state) => markReadState(state, sessionId));
	},

	markProfileRead(profileId) {
		set((state) => {
			const profile = state.profiles[profileId];
			if (!profile) return state;
			let notifiedTabs: Set<string> | null = null;
			for (const tab of profile.tabs) {
				if (state.notifiedTabs.has(tab.id)) {
					notifiedTabs ??= new Set(state.notifiedTabs);
					notifiedTabs.delete(tab.id);
				}
			}
			if (!notifiedTabs) return state;
			return { notifiedTabs };
		});
	},
}));

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
