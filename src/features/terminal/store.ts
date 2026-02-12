import { useEffect, useMemo } from "react";
import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";

interface TerminalTab {
	id: string;
	title: string;
	restoreFrom?: string;
}

interface ProjectTerminalState {
	tabs: TerminalTab[];
	activeTabId: string | null;
	counter: number;
}

interface TerminalStore {
	profiles: Record<string, ProjectTerminalState>;
	addTab(
		profileId: string,
		sessionId: string,
		title: string,
		restoreFrom?: string,
	): void;
	closeTab(profileId: string, tabId: string): void;
	setActiveTab(profileId: string, tabId: string): void;
	clearRestore(profileId: string, tabId: string): void;
	removeProfile(profileId: string): void;
	updateTabTitle(profileId: string, tabId: string, title: string): void;
	removeStaleProfiles(validIds: Set<string>): void;
}

export const useTerminalStore = create<TerminalStore>((set) => ({
	profiles: {},

	addTab(profileId, sessionId, title, restoreFrom?) {
		set((state) => {
			const existing = state.profiles[profileId] ?? {
				tabs: [],
				activeTabId: null,
				counter: 0,
			};
			const tab: TerminalTab = { id: sessionId, title, restoreFrom };
			return {
				profiles: {
					...state.profiles,
					[profileId]: {
						tabs: [...existing.tabs, tab],
						activeTabId: tab.id,
						counter: existing.counter + 1,
					},
				},
			};
		});
	},

	closeTab(profileId, tabId) {
		set((state) => {
			const profile = state.profiles[profileId];
			if (!profile) return state;

			const idx = profile.tabs.findIndex((t) => t.id === tabId);
			const next = profile.tabs.filter((t) => t.id !== tabId);

			if (next.length === 0) {
				const { [profileId]: _, ...rest } = state.profiles;
				return { profiles: rest };
			}

			let activeTabId = profile.activeTabId;
			if (tabId === activeTabId) {
				const newIdx = Math.min(idx, next.length - 1);
				activeTabId = next[newIdx].id;
			}

			return {
				profiles: {
					...state.profiles,
					[profileId]: {
						...profile,
						tabs: next,
						activeTabId,
					},
				},
			};
		});
	},

	setActiveTab(profileId, tabId) {
		set((state) => {
			const profile = state.profiles[profileId];
			if (!profile) return state;
			return {
				profiles: {
					...state.profiles,
					[profileId]: { ...profile, activeTabId: tabId },
				},
			};
		});
	},

	clearRestore(profileId, tabId) {
		set((state) => {
			const profile = state.profiles[profileId];
			if (!profile) return state;
			const tabs = profile.tabs.map((t) =>
				t.id === tabId ? { id: t.id, title: t.title } : t,
			);
			return {
				profiles: {
					...state.profiles,
					[profileId]: { ...profile, tabs },
				},
			};
		});
	},

	removeProfile(profileId) {
		set((state) => {
			if (!(profileId in state.profiles)) return state;
			const { [profileId]: _, ...rest } = state.profiles;
			return { profiles: rest };
		});
	},

	updateTabTitle(profileId, tabId, title) {
		set((state) => {
			const profile = state.profiles[profileId];
			if (!profile) return state;
			const tab = profile.tabs.find((t) => t.id === tabId);
			if (!tab || tab.title === title) return state;
			const tabs = profile.tabs.map((t) =>
				t.id === tabId ? { ...t, title } : t,
			);
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
			const staleKeys = Object.keys(state.profiles).filter(
				(id) => !validIds.has(id),
			);
			if (staleKeys.length === 0) return state;
			const next = { ...state.profiles };
			for (const key of staleKeys) {
				delete next[key];
			}
			return { profiles: next };
		});
	},
}));

/** IDs of profiles that currently have terminal tabs open. */
export function useTerminalProfileIds() {
	return useTerminalStore(useShallow((s) => Object.keys(s.profiles)));
}

/** Sync store with profiles list — removes terminals for deleted profiles. */
export function useTerminalSync(profiles: { id: string }[]) {
	const removeStaleProfiles = useTerminalStore((s) => s.removeStaleProfiles);
	const validIds = useMemo(
		() => new Set(profiles.map((p) => p.id)),
		[profiles],
	);
	useEffect(() => {
		removeStaleProfiles(validIds);
	}, [validIds, removeStaleProfiles]);
}
